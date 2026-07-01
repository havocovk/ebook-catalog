# -*- coding: utf-8 -*-
"""
Tam Yedekleme modülü (ADIM 1 — Birleştirilmiş Yedekleme Çözüm Planı).

Appwrite veritabanındaki BEŞ tabloyu (books, authors, publishers, series,
collections) ve Storage bucket'ındaki TÜM kitap kapak resimlerini indirip
tek bir TAR.GZ arşivine paketler.

TAR.GZ içeriği:
    backup-full-2026-07-01_14-30.tar.gz
    ├── books.json
    ├── authors.json
    ├── publishers.json
    ├── series.json
    ├── collections.json
    └── covers/
        ├── <kitap-id-1>.jpg
        ├── <kitap-id-2>.jpg
        └── ...

ÖNEMLİ (throttling kararı): Bu modül SADECE OKUMA yapar (Appwrite'a
hiçbir yazma isteği — createDocument/updateDocument/deleteDocument vb. —
göndermez). appwrite.js'deki Adım 30/32 throttling mekanizması SADECE
yazma uçlarını yavaşlatıyordu, çünkü Appwrite'ın hız sınırı (rate limit)
sadece yazma işlemlerinde sorun çıkarıyordu. Bu yüzden burada (backup
alırken) hiçbir bekleme/throttle YOK — sadece paralel indirme var.
restore_full() (ADIM 2) yazma yapacağı için orada bu konu ayrıca ele
alınacak.

NOT (SDK bypass kararı): _fetch_all_documents(), Appwrite Python SDK'sının
list_documents() metodu yerine doğrudan HTTP GET kullanıyor. Bu,
uploader.py'deki get_indexed_paths_batch() fonksiyonuyla AYNI SEBEBE
dayanıyor (bkz. uploader.py Adım 7 notları) — projede zaten kanıtlanmış,
test edilmiş bir yöntem; aynı yaklaşım burada da tekrar kullanılıyor.
"""

import os
import json
import tempfile
import tarfile
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# KRİTİK: .env dosyası, uploader importundan ÖNCE yüklenmeli. Aksi halde
# uploader.py'deki APPWRITE_PROJECT_ID gibi değerler placeholder
# ("YOUR_PROJECT_ID") olarak sabitlenir (bkz. scan.py başındaki aynı uyarı).
# Bu satır zararsızdır: backup.py, zaten load_dotenv() çağırmış olan scan.py
# tarafından import edildiğinde de (env zaten yüklü), veya doğrudan
# "python backup.py" ile tek başına çalıştırıldığında da (env HENÜZ
# yüklenmemiş) doğru çalışmasını garanti eder.
from dotenv import load_dotenv
load_dotenv()

import requests
from appwrite.query import Query

from uploader import (
    get_databases,
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    DATABASE_ID,
    BUCKET_ID,
    TABLE_ID,
)
from logger_setup import get_logger

log = get_logger()

# Appwrite panelindeki koleksiyon ID'leri — web/appwrite.js'deki sabitlerle
# (AUTHORS_ID, PUBLISHERS_ID, SERIES_ID, COLLECTIONS_ID) BİREBİR aynı olmak
# zorunda, çünkü ikisi de aynı Appwrite projesindeki aynı koleksiyonlara
# işaret ediyor.
AUTHORS_ID = "authors"
PUBLISHERS_ID = "publishers"
SERIES_ID = "series"
COLLECTIONS_ID = "collections"

# Sırasıyla yedeklenecek tablolar: {json dosya adı: koleksiyon ID'si}
_TABLES = {
    "books": TABLE_ID,
    "authors": AUTHORS_ID,
    "publishers": PUBLISHERS_ID,
    "series": SERIES_ID,
    "collections": COLLECTIONS_ID,
}

# Appwrite tek sorguda en fazla 100 kayıt döndürür (uploader.py'deki
# _BATCH_SIZE ile aynı sınır) — sayfalama bu boyutta ilerler.
_PAGE_SIZE = 100

# Kapak resimlerini paralel indirirken kaç thread aynı anda çalışsın.
_COVER_DOWNLOAD_WORKERS = 10


# ─────────────────────────────────────────────────────────────────────────────
# Tablo indirme (JSON) — sayfa sayfa, cursor tabanlı
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_all_documents(collection_id: str) -> list:
    """
    Bir koleksiyondaki (tablodaki) TÜM belgeleri sayfa sayfa (100'erli
    gruplar halinde) çeker.

    Sayfalama mantığı ("cursor" / imleç yöntemi): her sayfanın son kaydının
    $id'si, bir sonraki sorguya "bundan SONRAsını getir" diye verilir.
    Böylece 100'den fazla kayıt olsa bile hepsi toplanana kadar devam eder.
    """
    all_docs = []
    last_id = None

    url = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{collection_id}/documents"
    headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": APPWRITE_API_KEY,
        "Content-Type": "application/json",
    }

    while True:
        queries = [Query.limit(_PAGE_SIZE)]
        if last_id:
            queries.append(Query.cursor_after(last_id))

        resp = requests.get(
            url, headers=headers, params={"queries[]": queries}, timeout=30,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"'{collection_id}' tablosu okunamadı: "
                f"HTTP {resp.status_code} — {resp.text[:200]}"
            )

        batch = resp.json().get("documents", [])
        if not batch:
            break

        all_docs.extend(batch)
        last_id = batch[-1]["$id"]

        # Dönen kayıt sayısı sayfa boyutundan azsa, bu son sayfaydı.
        if len(batch) < _PAGE_SIZE:
            break

    return all_docs


# ─────────────────────────────────────────────────────────────────────────────
# Kapak resimleri indirme — paralel
# ─────────────────────────────────────────────────────────────────────────────

# cover_url'den Storage dosya ID'sini çıkaran yardımcı.
# web/core/api/api-books.js'deki extractCoverFileId() ile aynı mantık:
#   ".../files/<FILE_ID>/..." → FILE_ID
import re as _re
_COVER_FILE_ID_RE = _re.compile(r"/files/([^/]+)/")

def _extract_file_id_from_cover_url(cover_url: str) -> str | None:
    """cover_url'den Storage dosya ID'sini çıkarır."""
    if not cover_url:
        return None
    m = _COVER_FILE_ID_RE.search(cover_url)
    return m.group(1) if m else None


def _download_all_covers(books_with_cover: list, covers_dir: str, progress_callback=None) -> dict:
    """
    Kapağı olan kitapların resimlerini Appwrite Storage'dan PARALEL olarak
    indirir (aynı anda _COVER_DOWNLOAD_WORKERS kadar).

    Parametre: books_with_cover — cover_url alanı dolu olan kitap belgelerinin
    listesi (her eleman bir dict, en az "$id" ve "cover_url" içerir).

    NEDEN BOOK_ID DEĞİL COVER_URL?
    Python scanner, kapakları her zaman file_id = book_id olarak yükler.
    Ama web arayüzünden "Resim Yükle" butonu ile eklenen kapaklarda
    file_id = ID.unique() (rastgele) — book_id ile aynı değil. Bu yüzden
    book_id'den URL türetmek 4 el-yüklemeli kapağı bulamıyordu.
    Çözüm: cover_url'deki gerçek file_id'yi regex ile çıkar, onu kullan.
    (web tarafındaki extractCoverFileId() ile aynı mantık.)

    TAR.GZ'deki dosya adı: {book_id}.jpg — restore sırasında hangi kapağın
    hangi kitaba ait olduğunu book_id üzerinden eşleştiriyoruz. Storage'daki
    gerçek file_id farklı olsa bile yedek dosya adı her zaman book_id'dir.

    SDK BYPASS: Appwrite Python SDK 6.1.0 GET uçlarında request body
    gönderiyor — Appwrite reddediyor. Doğrudan requests.get() kullanılıyor.

    Dönüş: {"ok": indirilen sayısı, "fail": başarısız sayısı}
    """
    os.makedirs(covers_dir, exist_ok=True)
    stats = {"ok": 0, "fail": 0}
    total = len(books_with_cover)

    if total == 0:
        return stats

    _headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": APPWRITE_API_KEY,
    }
    done_counter = {"n": 0}

    def _download_one(book: dict) -> bool:
        book_id = book["$id"]
        cover_url = book.get("cover_url", "")

        # cover_url'den gerçek Storage file_id'sini çıkar.
        file_id = _extract_file_id_from_cover_url(cover_url)
        if not file_id:
            log.error(f"Kapak indirilemedi ({book_id}): cover_url'den file_id çıkarılamadı — {cover_url!r}")
            return False

        url = (
            f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}"
            f"/files/{file_id}/download"
        )
        try:
            resp = requests.get(url, headers=_headers, timeout=30)
            if resp.status_code != 200:
                log.error(
                    f"Kapak indirilemedi ({book_id}, file_id={file_id}): "
                    f"HTTP {resp.status_code} — {resp.text[:120]}"
                )
                return False
            # Dosya adı = book_id (restore'da eşleştirme için)
            out_path = os.path.join(covers_dir, f"{book_id}.jpg")
            with open(out_path, "wb") as f:
                f.write(resp.content)
            return True
        except Exception as e:
            log.error(f"Kapak indirilemedi ({book_id}, file_id={file_id}): {e}")
            return False

    with ThreadPoolExecutor(max_workers=_COVER_DOWNLOAD_WORKERS) as executor:
        future_to_book = {executor.submit(_download_one, b): b for b in books_with_cover}

        for future in as_completed(future_to_book):
            done_counter["n"] += 1
            ok = future.result()
            if ok:
                stats["ok"] += 1
            else:
                stats["fail"] += 1

            if progress_callback:
                progress_callback("covers", done_counter["n"], total)
            elif done_counter["n"] % 50 == 0 or done_counter["n"] == total:
                print(f"   🖼  Kapaklar indiriliyor: {done_counter['n']}/{total}")

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Ana fonksiyon
# ─────────────────────────────────────────────────────────────────────────────

def default_backup_filename() -> str:
    """Varsayılan yedek dosya adını üretir: backup-full-2026-07-01_14-30.tar.gz"""
    return f"backup-full-{datetime.now().strftime('%Y-%m-%d_%H-%M')}.tar.gz"


def backup_full(output_path: str, progress_callback=None) -> dict:
    """
    Tam yedekleme: 5 tablo (books, authors, publishers, series, collections)
    + tüm kitap kapakları → tek TAR.GZ dosyası.

    Parametreler:
        output_path: Oluşturulacak .tar.gz dosyasının tam yolu.
        progress_callback: Opsiyonel — ilerleme mesajlarını almak isteyen
            bir fonksiyon. İmza: callback(asama: str, yapilan: int, toplam: int)
            "asama" değeri "covers" olur (tablo indirmede henüz kullanılmıyor).

    Dönüş: özet istatistik sözlüğü, örn:
        {
            "books": 3457, "authors": 812, "publishers": 140,
            "series": 96, "collections": 12,
            "covers_ok": 3200, "covers_fail": 5,
            "output_path": "...", "size_mb": 148.2,
        }
    """
    # Ortam değişkenlerinin yüklendiğini erken kontrol et.
    # (SDK'yı kullanmıyoruz — tüm istekler doğrudan requests.get ile yapılıyor.
    # Bu yüzden get_databases() / get_storage() çağrısı gerekmez.)
    if not APPWRITE_PROJECT_ID or APPWRITE_PROJECT_ID == "YOUR_PROJECT_ID":
        raise RuntimeError(
            ".env dosyasında APPWRITE_PROJECT_ID ayarlanmamış. "
            "scanner/.env dosyasını kontrol et."
        )
    if not APPWRITE_API_KEY or APPWRITE_API_KEY == "YOUR_API_KEY":
        raise RuntimeError(
            ".env dosyasında APPWRITE_API_KEY ayarlanmamış. "
            "scanner/.env dosyasını kontrol et."
        )

    print("\n📦 Tam yedekleme başlıyor...")
    print("─" * 55)
    log.info(f"Tam yedekleme başladı: {output_path}")

    # Geçici bir çalışma klasörü oluştur — TAR.GZ'ye sarmadan önce tüm
    # JSON'lar ve kapaklar burada toplanır, işlem bitince silinir.
    tmp_dir = tempfile.mkdtemp(prefix="ebook_backup_")

    try:
        counts = {}
        books_data = []

        for i, (json_name, collection_id) in enumerate(_TABLES.items(), 1):
            print(f"📥 [{i}/{len(_TABLES)}] {json_name} tablosu indiriliyor...")
            docs = _fetch_all_documents(collection_id)
            counts[json_name] = len(docs)
            print(f"   ✓ {len(docs)} kayıt indirildi.")

            json_path = os.path.join(tmp_dir, f"{json_name}.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(docs, f, ensure_ascii=False, indent=2)

            if json_name == "books":
                books_data = docs

        # Kapağı olan kitap nesnelerini topla (tam nesne — cover_url gerekli).
        books_with_cover = [b for b in books_data if b.get("cover_url")]
        print(f"\n🖼  {len(books_with_cover)} kitabın kapağı var, indiriliyor...")

        covers_dir = os.path.join(tmp_dir, "covers")
        cover_stats = _download_all_covers(books_with_cover, covers_dir, progress_callback)
        print(f"   ✓ {cover_stats['ok']} kapak indirildi, {cover_stats['fail']} başarısız.")

        # ── TAR.GZ'ye sıkıştır ────────────────────────────────────────────
        print(f"\n🗜  Arşiv oluşturuluyor: {output_path}")
        out_dir = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(out_dir, exist_ok=True)

        with tarfile.open(output_path, "w:gz") as tar:
            for json_name in _TABLES:
                tar.add(
                    os.path.join(tmp_dir, f"{json_name}.json"),
                    arcname=f"{json_name}.json",
                )
            if os.path.isdir(covers_dir) and os.listdir(covers_dir):
                tar.add(covers_dir, arcname="covers")

        size_mb = round(os.path.getsize(output_path) / (1024 * 1024), 2)

        result = {
            **counts,
            "covers_ok": cover_stats["ok"],
            "covers_fail": cover_stats["fail"],
            "output_path": output_path,
            "size_mb": size_mb,
        }

        print("─" * 55)
        print(f"✅ Yedekleme tamamlandı: {output_path} ({size_mb} MB)")
        log.info(f"Tam yedekleme tamamlandı: {result}")

        return result

    finally:
        # Geçici klasörü her durumda temizle (başarılı da olsa, hata da olsa).
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# Doğrudan test için: python backup.py [çıktı_dosyası.tar.gz]
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    # load_dotenv() zaten dosyanın en başında (importlardan önce) çağrıldı,
    # burada tekrar çağırmaya gerek yok.
    out = sys.argv[1] if len(sys.argv) > 1 else default_backup_filename()
    backup_full(out)