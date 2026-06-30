# -*- coding: utf-8 -*-
"""
Tam Yedekleme modülü (Adım 1 — backup-full).

AMAÇ: Sadece kitap kayıtlarının (metadata) JSON yedeğini almak yeterli
değil — Appwrite Storage'daki kapak resimleri yedeklenmediği için, JSON'dan
geri yükleme yapıldığında kitaplar görünür ama kapakları kaybolmuş olur.

Bu modül, hem veritabanındaki TÜM kitap kayıtlarını hem de Storage'daki
TÜM kapak resimlerini tek bir TAR.GZ dosyasına paketler:

    backup-full-2025-06-30.tar.gz
    ├── books.json          (tüm kitap kayıtları)
    └── covers/
        ├── {book_id_1}.jpg
        ├── {book_id_2}.jpg
        └── ...

ÖNEMLİ TEKNİK NOT: uploader.py'deki upload_cover() / upload_cover_from_url()
fonksiyonları, Storage'a yüklerken file_id olarak kitabın KENDİ $id'sini
kullanıyor (bkz. uploader.py satır 183, 203: "file_id = book_id"). Yani
bir kitabın cover_url'i doluysa, o kitabın Storage'daki dosyasının ID'si
yine o kitabın $id'sidir — cover_url'i ayrıca parse etmeye gerek yoktur.

uploader.py mutlak import kullandığı için (bkz. __init__.py'deki açıklama:
scanner/ bir paket olarak import edilmiyor, "python scan.py" ile direkt
çalıştırılıyor), bu dosya da aynı şekilde mutlak import kullanır.
"""

import os
import json
import shutil
import tarfile
import tempfile
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

from uploader import (
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    DATABASE_ID,
    TABLE_ID,
    BUCKET_ID,
)
from logger_setup import get_logger

log = get_logger()

# Appwrite list_documents tek seferde en fazla 100 kayıt döner (sayfalama gerekir)
_PAGE_SIZE = 100

# Kapak indirme için paralel thread sayısı (ağ G/Ç ağırlıklı iş, yüksek tutulabilir)
_DOWNLOAD_WORKERS = 10


def _headers():
    return {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": APPWRITE_API_KEY,
        "Content-Type": "application/json",
    }


def _fetch_all_books() -> list:
    """
    Appwrite'daki TÜM kitap belgelerini sayfalama ile çeker.

    NOT: uploader.py'deki get_indexed_paths_batch() ile aynı sebepten
    (SDK 5.0.1'in GET isteklerine body eklemesi ve 400 hatası vermesi)
    burada da SDK'nın list_documents'ı DEĞİL, doğrudan requests.get
    kullanılır.
    """
    url = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents"
    all_docs = []
    offset = 0

    while True:
        params = {
            "queries[]": [
                f'{{"method":"limit","values":[{_PAGE_SIZE}]}}',
                f'{{"method":"offset","values":[{offset}]}}',
            ]
        }
        resp = requests.get(url, headers=_headers(), params=params, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        docs = payload.get("documents", [])
        all_docs.extend(docs)

        print(f"  [Yedekleme] {len(all_docs)} / {payload.get('total', '?')} kitap kaydı çekildi...")

        if len(docs) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE

    return all_docs


def _download_one_cover(book: dict, covers_dir: str) -> dict:
    """
    Tek bir kitabın kapak resmini Storage'dan indirir.
    Dönüş: {"book_id": ..., "status": "ok"|"skipped"|"error", "detail": ...}
    """
    book_id = book.get("$id")
    cover_url = book.get("cover_url")

    if not cover_url:
        return {"book_id": book_id, "status": "skipped", "detail": "cover_url boş"}

    download_url = (
        f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}"
        f"/files/{book_id}/download?project={APPWRITE_PROJECT_ID}"
    )
    try:
        resp = requests.get(download_url, headers=_headers(), timeout=20)
        if resp.status_code == 404:
            return {"book_id": book_id, "status": "skipped", "detail": "Storage'da dosya yok (404)"}
        resp.raise_for_status()

        out_path = os.path.join(covers_dir, f"{book_id}.jpg")
        with open(out_path, "wb") as f:
            f.write(resp.content)
        return {"book_id": book_id, "status": "ok", "detail": None}

    except Exception as e:
        return {"book_id": book_id, "status": "error", "detail": str(e)}


def _download_all_covers(books: list, covers_dir: str) -> dict:
    """
    Kapağı olan tüm kitapların resimlerini PARALEL indirir.
    scan_processor.py'deki ThreadPoolExecutor + as_completed deseniyle
    aynı yaklaşım kullanılır (bkz. _scan_parallel).
    """
    books_with_cover = [b for b in books if b.get("cover_url")]
    total = len(books_with_cover)
    stats = {"ok": 0, "skipped": 0, "error": 0}

    if total == 0:
        print("  [Yedekleme] Kapak resmi olan kitap yok, indirme atlanıyor.")
        return stats

    print(f"  [Yedekleme] {total} kapak resmi paralel indiriliyor ({_DOWNLOAD_WORKERS} thread)...")

    with ThreadPoolExecutor(max_workers=_DOWNLOAD_WORKERS) as executor:
        future_to_book = {
            executor.submit(_download_one_cover, book, covers_dir): book
            for book in books_with_cover
        }
        done = 0
        for future in as_completed(future_to_book):
            done += 1
            res = future.result()
            stats[res["status"]] += 1

            if res["status"] == "error":
                print(f"  [{done}/{total}] ✗ Hata ({res['book_id']}): {res['detail']}")
                log.error(f"Kapak indirilemedi: {res['book_id']} — {res['detail']}")
            elif done % 25 == 0 or done == total:
                print(f"  [{done}/{total}] Kapaklar indiriliyor... (ok={stats['ok']}, atlanan={stats['skipped']}, hata={stats['error']})")

    return stats


def backup_full(output_path: str) -> bool:
    """
    Tüm kitap kayıtlarını ve kapak resimlerini tek bir TAR.GZ dosyasına
    yedekler.

    Args:
        output_path: Oluşturulacak .tar.gz dosyasının tam yolu.
                      Örn: "C:/Yedekler/backup-2025-06-30.tar.gz"

    Dönüş: Başarılıysa True, kritik bir hata oluşursa False.
    """
    print("─" * 55)
    print("📦 TAM YEDEKLEME BAŞLIYOR")
    print("─" * 55)

    # ── 1) Geçici çalışma klasörü oluştur ────────────────────────────────
    tmp_dir = tempfile.mkdtemp(prefix="ebook_backup_")
    covers_dir = os.path.join(tmp_dir, "covers")
    os.makedirs(covers_dir, exist_ok=True)

    try:
        # ── 2) Tüm kitap kayıtlarını çek ──────────────────────────────────
        print("\n[1/3] Kitap kayıtları çekiliyor...")
        books = _fetch_all_books()
        print(f"  ✓ Toplam {len(books)} kitap kaydı çekildi.")

        books_json_path = os.path.join(tmp_dir, "books.json")
        with open(books_json_path, "w", encoding="utf-8") as f:
            json.dump(books, f, ensure_ascii=False, indent=2)

        # ── 3) Kapak resimlerini paralel indir ────────────────────────────
        print("\n[2/3] Kapak resimleri indiriliyor...")
        cover_stats = _download_all_covers(books, covers_dir)
        print(
            f"  ✓ Kapak indirme tamamlandı: "
            f"{cover_stats['ok']} indirildi, "
            f"{cover_stats['skipped']} atlandı (kapak yok), "
            f"{cover_stats['error']} hata."
        )

        # ── 4) TAR.GZ olarak sıkıştır ──────────────────────────────────────
        print("\n[3/3] TAR.GZ dosyası oluşturuluyor...")
        os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

        with tarfile.open(output_path, "w:gz") as tar:
            tar.add(books_json_path, arcname="books.json")
            tar.add(covers_dir, arcname="covers")

        final_size_mb = os.path.getsize(output_path) / (1024 * 1024)

        print("\n" + "─" * 55)
        print("✅ YEDEKLEME TAMAMLANDI")
        print(f"   Dosya: {output_path}")
        print(f"   Boyut: {final_size_mb:.1f} MB")
        print(f"   Kitap sayısı: {len(books)}")
        print(f"   Kapak sayısı: {cover_stats['ok']}")
        print("─" * 55)

        log.info(
            f"Tam yedekleme tamamlandı: {output_path} "
            f"({len(books)} kitap, {cover_stats['ok']} kapak, {final_size_mb:.1f} MB)"
        )
        return True

    except Exception as e:
        print(f"\n❌ Yedekleme sırasında hata oluştu: {e}")
        log.error(f"Tam yedekleme başarısız: {e}")
        return False

    finally:
        # ── 5) Geçici klasörü her durumda temizle ──────────────────────────
        shutil.rmtree(tmp_dir, ignore_errors=True)