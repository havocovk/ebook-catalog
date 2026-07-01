# -*- coding: utf-8 -*-
"""
Tam Geri Yükleme modülü (ADIM 2 — Birleştirilmiş Yedekleme Çözüm Planı).

backup.py'nin oluşturduğu TAR.GZ arşivini alır ve içindeki beş tabloyu
(authors, publishers, series, collections, books) ile kapak resimlerini
Appwrite'a geri yükler.

YÜKLEMESİRASI (bağımlılık sırası korunur):
    1. authors      — bağımsız
    2. publishers   — bağımsız
    3. series       — publisher_id içerir → publishers önce yüklenmeli
    4. collections  — bağımsız
    5. books        — en fazla alan, en son
    6. covers       — books yüklendikten sonra; cover_url books'a yazılır

UPSERT MANTIĞI (409 çakışması):
    Hem boş hem dolu veritabanına güvenle çalışır.
    createDocument → 409 (kayıt zaten var) → updateDocument ile devam et.
    Bu uploader.py'deki save_book() ile aynı yaklaşım.

KAPAK file_id KARARI:
    Yüklenen her kapak için file_id = book_id kullanılır.
    (TAR.GZ'deki dosya adı zaten {book_id}.jpg.)
    Web'den el-yüklemeli kapaklarda orijinal file_id farklıydı ama restore
    sonrası file_id = book_id olarak standartlaşır; cover_url yeniden
    oluşturulur ve books kaydı güncellenir.

THROTTLİNG KARARI:
    Python tarafında açık throttle yok — uploader.py ve scan_processor.py
    ile aynı yaklaşım. Appwrite rate limit (429) hatası gelirse tenacity
    otomatik retry yapar (exponential backoff: 2s→4s→8s, max 5 deneme).
    Bu seçim: hız önce, hata sonra otomatik düzelt — restore tek seferlik
    kritik işlem olduğu için bu tercih edildi.
"""

import os
import json
import tarfile
import tempfile
import shutil
import time

from dotenv import load_dotenv
load_dotenv()

import requests

from appwrite.exception import AppwriteException
from appwrite.input_file import InputFile
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception,
)

from uploader import (
    get_databases,
    get_storage,
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    DATABASE_ID,
    BUCKET_ID,
    TABLE_ID,
)
from logger_setup import get_logger

log = get_logger()

# Koleksiyon ID'leri — backup.py ve appwrite.js ile aynı
AUTHORS_ID     = "authors"
PUBLISHERS_ID  = "publishers"
SERIES_ID      = "series"
COLLECTIONS_ID = "collections"

# Yükleme sırası: bağımlılık sırası korunur (series → publishers'a bağımlı)
_RESTORE_ORDER = [
    ("authors",     AUTHORS_ID),
    ("publishers",  PUBLISHERS_ID),
    ("series",      SERIES_ID),
    ("collections", COLLECTIONS_ID),
    ("books",       TABLE_ID),
]

# Appwrite'ın döndürdüğü ama createDocument/updateDocument'a
# GÖNDERİLEMEYEN sistem alanları — data dict'inden ayıklanır.
_SYSTEM_FIELDS = frozenset([
    "$id", "$createdAt", "$updatedAt",
    "$permissions", "$databaseId", "$collectionId",
])

# Rate limit (429) için retry ayarları
def _is_rate_limit(exc: Exception) -> bool:
    """Appwrite 429 rate limit hatasını tanır."""
    return isinstance(exc, AppwriteException) and exc.code == 429


_retry_on_rate_limit = retry(
    retry=retry_if_exception(_is_rate_limit),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı: sistem alanlarını ayıkla
# ─────────────────────────────────────────────────────────────────────────────

def _strip_system_fields(doc: dict) -> dict:
    """
    Appwrite belgesinden sistem alanlarını ($id, $createdAt vb.) çıkarır.
    Geriye kalan sözlük createDocument/updateDocument'a "data" olarak verilir.
    """
    return {k: v for k, v in doc.items() if k not in _SYSTEM_FIELDS}


# ─────────────────────────────────────────────────────────────────────────────
# Tablo geri yükleme
# ─────────────────────────────────────────────────────────────────────────────

def _call_with_retry(fn, *args, **kwargs):
    """
    Verilen Appwrite SDK çağrısını çalıştırır.
    429 rate limit hatası gelirse tenacity ile otomatik yeniden dener
    (exponential backoff: 2s → 4s → 8s … maks 5 deneme).
    Diğer hatalar (404, 409 vb.) doğrudan çağıran tarafa fırlatılır —
    tenacity bu hataları yakalamaz.
    """
    @_retry_on_rate_limit
    def _inner():
        return fn(*args, **kwargs)
    return _inner()


def _restore_table(db, collection_id: str, docs: list, progress_callback=None) -> dict:
    """
    Bir tablonun (koleksiyonun) tüm belgelerini Appwrite'a yükler.

    Her belge için:
      1) createDocument dene ($id korunur)
      2) 409 (kayıt zaten var) → updateDocument ile üzerine yaz (upsert)
      3) 429 (rate limit) → _call_with_retry ile otomatik retry

    Dönüş: {"ok": başarılı sayısı, "fail": başarısız sayısı}
    """
    stats = {"ok": 0, "fail": 0}
    total = len(docs)

    if total == 0:
        return stats

    for i, doc in enumerate(docs, 1):
        doc_id = doc["$id"]
        data   = _strip_system_fields(doc)

        try:
            _call_with_retry(
                db.create_document,
                database_id=DATABASE_ID,
                collection_id=collection_id,
                document_id=doc_id,
                data=data,
            )
            stats["ok"] += 1

        except AppwriteException as e:
            if e.code == 409:
                # Kayıt zaten var — updateDocument ile üzerine yaz (upsert)
                try:
                    _call_with_retry(
                        db.update_document,
                        database_id=DATABASE_ID,
                        collection_id=collection_id,
                        document_id=doc_id,
                        data=data,
                    )
                    stats["ok"] += 1
                except Exception as e2:
                    log.error(f"[{collection_id}] Güncelleme hatası ({doc_id}): {e2}")
                    stats["fail"] += 1
            else:
                log.error(f"[{collection_id}] Yükleme hatası ({doc_id}): {e.message}")
                stats["fail"] += 1
        except Exception as e:
            log.error(f"[{collection_id}] Beklenmeyen hata ({doc_id}): {e}")
            stats["fail"] += 1

        if progress_callback:
            progress_callback(collection_id, i, total)

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Kapak geri yükleme
# ─────────────────────────────────────────────────────────────────────────────

def _build_cover_url(file_id: str) -> str:
    """Appwrite Storage'daki kapak dosyasının public URL'sini oluşturur."""
    return (
        f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}"
        f"/files/{file_id}/view?project={APPWRITE_PROJECT_ID}"
    )


def _restore_covers(db, storage, covers_dir: str, progress_callback=None) -> dict:
    """
    covers/ klasöründeki kapak resimlerini Appwrite Storage'a yükler ve
    her kitabın books kaydındaki cover_url'ini günceller.

    Dosya adlandırma kuralı: {book_id}.jpg (backup.py'nin yazdığı format).
    file_id = book_id olarak yüklenir (standartlaştırma kararı — bkz. modül
    başındaki KAPAK file_id KARARI notu).

    Var olan dosya üzerine yazma: deleteFile → createFile sırası.
    deleteFile başarısız olsa bile (dosya yoksa) createFile denenir.

    Dönüş: {"ok": başarılı sayısı, "fail": başarısız sayısı}
    """
    stats = {"ok": 0, "fail": 0}

    if not os.path.isdir(covers_dir):
        return stats

    cover_files = [
        f for f in os.listdir(covers_dir)
        if f.endswith(".jpg")
    ]
    total = len(cover_files)

    if total == 0:
        return stats

    for i, filename in enumerate(cover_files, 1):
        # book_id = dosya adından .jpg uzantısını çıkar
        book_id = filename[:-4]
        file_path = os.path.join(covers_dir, filename)

        try:
            # Var olan kapağı sil (çakışma önlemi)
            try:
                _call_with_retry(
                    storage.delete_file,
                    bucket_id=BUCKET_ID,
                    file_id=book_id,
                )
            except AppwriteException:
                pass  # Dosya yoksa (404) — silme adımını atla

            # Yeni kapağı yükle; file_id = book_id
            _call_with_retry(
                storage.create_file,
                bucket_id=BUCKET_ID,
                file_id=book_id,
                file=InputFile.from_path(file_path),
            )

            # books kaydındaki cover_url'i yeni URL ile güncelle
            new_cover_url = _build_cover_url(book_id)
            _call_with_retry(
                db.update_document,
                database_id=DATABASE_ID,
                collection_id=TABLE_ID,
                document_id=book_id,
                data={"cover_url": new_cover_url},
            )

            stats["ok"] += 1

        except Exception as e:
            log.error(f"Kapak yüklenemedi ({book_id}): {e}")
            stats["fail"] += 1

        if progress_callback:
            progress_callback("covers", i, total)
        elif i % 50 == 0 or i == total:
            print(f"   🖼  Kapaklar yükleniyor: {i}/{total}")

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Ana fonksiyon
# ─────────────────────────────────────────────────────────────────────────────

def restore_full(backup_path: str, progress_callback=None) -> dict:
    """
    Tam geri yükleme: backup.py'nin oluşturduğu TAR.GZ dosyasından
    beş tabloyu (authors, publishers, series, collections, books) ve
    kapak resimlerini Appwrite'a geri yükler.

    Parametreler:
        backup_path: Geri yüklenecek .tar.gz dosyasının tam yolu.
        progress_callback: Opsiyonel ilerleme fonksiyonu.
            İmza: callback(asama: str, yapilan: int, toplam: int)
            "asama": koleksiyon ID'si ("authors", "books", "covers" vb.)

    Dönüş: özet istatistik sözlüğü, örn:
        {
            "authors":     {"ok": 54, "fail": 0},
            "publishers":  {"ok": 1,  "fail": 0},
            "series":      {"ok": 1,  "fail": 0},
            "collections": {"ok": 0,  "fail": 0},
            "books":       {"ok": 83, "fail": 0},
            "covers":      {"ok": 83, "fail": 0},
        }
    """
    if not os.path.isfile(backup_path):
        raise FileNotFoundError(f"Yedek dosyası bulunamadı: {backup_path}")

    if not tarfile.is_tarfile(backup_path):
        raise ValueError(f"Geçerli bir TAR.GZ dosyası değil: {backup_path}")

    db      = get_databases()
    storage = get_storage()

    print(f"\n📂 Yedek açılıyor: {backup_path}")
    print("─" * 55)
    log.info(f"Tam geri yükleme başladı: {backup_path}")

    tmp_dir = tempfile.mkdtemp(prefix="ebook_restore_")

    try:
        # TAR.GZ'yi geçici klasöre aç
        with tarfile.open(backup_path, "r:gz") as tar:
            tar.extractall(tmp_dir)

        results = {}

        # ── 5 tabloyu sırayla yükle ──────────────────────────────────────
        for step, (json_name, collection_id) in enumerate(_RESTORE_ORDER, 1):
            json_path = os.path.join(tmp_dir, f"{json_name}.json")

            if not os.path.isfile(json_path):
                print(f"⚠️  [{step}/6] {json_name}.json yedekte bulunamadı, atlanıyor.")
                results[json_name] = {"ok": 0, "fail": 0}
                continue

            with open(json_path, "r", encoding="utf-8") as f:
                docs = json.load(f)

            total = len(docs)
            print(f"📤 [{step}/6] {json_name} yükleniyor... ({total} kayıt)")

            stats = _restore_table(db, collection_id, docs, progress_callback)
            results[json_name] = stats

            fail_msg = f", {stats['fail']} başarısız" if stats["fail"] else ""
            print(f"   ✓ {stats['ok']} kayıt yüklendi{fail_msg}.")

        # ── Covers bucket temizle (restore öncesi) ───────────────────────
        # Eski file_id'li yetim dosyaları önlemek için bucket tamamen silinir.
        print("\n🗑️  Covers bucket temizleniyor...")
        _cursor = None
        _deleted = 0
        while True:
            _params = {"limit": 100}
            if _cursor:
                _params["cursor"] = _cursor
            _resp = requests.get(
                f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}/files",
                headers={
                    "X-Appwrite-Project": APPWRITE_PROJECT_ID,
                    "X-Appwrite-Key": APPWRITE_API_KEY,
                },
                params=_params,
                timeout=30,
            )
            _files = _resp.json().get("files", [])
            if not _files:
                break
            for _file in _files:
                try:
                    _call_with_retry(
                        storage.delete_file,
                        bucket_id=BUCKET_ID,
                        file_id=_file["$id"],
                    )
                    _deleted += 1
                except Exception:
                    pass
            if len(_files) < 100:
                break
            _cursor = _files[-1]["$id"]
        print(f"   ✓ {_deleted} eski kapak silindi.")

        # ── Kapakları yükle ───────────────────────────────────────────────
        covers_dir = os.path.join(tmp_dir, "covers")
        cover_count = (
            len([f for f in os.listdir(covers_dir) if f.endswith(".jpg")])
            if os.path.isdir(covers_dir) else 0
        )
        print(f"🖼  [6/6] Kapaklar yükleniyor... ({cover_count} kapak)")

        cover_stats = _restore_covers(db, storage, covers_dir, progress_callback)
        results["covers"] = cover_stats

        fail_msg = f", {cover_stats['fail']} başarısız" if cover_stats["fail"] else ""
        print(f"   ✓ {cover_stats['ok']} kapak yüklendi{fail_msg}.")

        # ── Özet ─────────────────────────────────────────────────────────
        print("─" * 55)
        total_ok   = sum(v["ok"]   for v in results.values())
        total_fail = sum(v["fail"] for v in results.values())
        print(f"✅ Geri yükleme tamamlandı! "
              f"({total_ok} başarılı, {total_fail} başarısız)")
        log.info(f"Tam geri yükleme tamamlandı: {results}")

        return results

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─────────────────────────────────────────────────────────────────────────────
# Doğrudan test için: python restore.py backup-full-xxxx.tar.gz
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Kullanım: python restore.py <backup-full-xxxx.tar.gz>")
        sys.exit(1)

    restore_full(sys.argv[1])