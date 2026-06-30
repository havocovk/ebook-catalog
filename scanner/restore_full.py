# -*- coding: utf-8 -*-
"""
Tam Geri Yükleme modülü (Adım 2 — restore-backup).

AMAÇ: backup_full.py'nin ürettiği .tar.gz dosyasını (veya eski tek-dosya
.json yedeğini) Appwrite'a PARALEL olarak geri yükler. Eski (varsayımsal)
seri yükleme yöntemi 3457 kitap için saatler sürebilirdi — bu modül
ThreadPoolExecutor ile aynı anda birden fazla kayıt/dosya yükleyerek bu
süreyi büyük ölçüde kısaltır (bkz. scan_processor.py'deki _scan_parallel
ile aynı paralellik deseni).

KABUL EDİLEN İKİ FORMAT:
  1) backup-full TAR.GZ (Adım 1'in çıktısı):
       books.json + covers/{book_id}.jpg dosyaları birlikte yüklenir.
  2) Eski tek-dosya JSON yedeği (sadece kitap kayıtları):
       Sadece veritabanı kayıtları yüklenir, kapak yüklenemez (yedekte
       kapak verisi yoktur) — kullanıcı bilgilendirilir.

KRİTİK TEKNİK NOT — Appwrite sistem alanları:
  backup_full.py'nin ürettiği books.json, Appwrite'ın list_documents
  yanıtını ham haliyle içerir. Bu yanıtlardaki $id, $createdAt, $updatedAt,
  $permissions, $databaseId, $collectionId, $sequence gibi "$" ile başlayan
  alanlar Appwrite SİSTEM alanlarıdır — create_document'a "data" olarak
  gönderilemezler (Appwrite bunları kendi otomatik yönetir, dışarıdan
  yazılmasına izin vermez). Bu yüzden her kayıttan:
    - $id  → document_id parametresine ayrılır (kitabın orijinal ID'si
             korunur, böylece cover dosyalarıyla eşleşme bozulmaz)
    - "$" ile başlayan TÜM diğer alanlar data'dan temizlenir

uploader.py mutlak import kullandığı için (__init__.py'deki açıklamayla
aynı sebep), bu dosya da mutlak import kullanır.
"""

import os
import sys
import json
import shutil
import tarfile
import tempfile
from io import StringIO
from concurrent.futures import ThreadPoolExecutor, as_completed

from appwrite.exception import AppwriteException

from uploader import get_databases, get_storage, DATABASE_ID, TABLE_ID, BUCKET_ID
from appwrite.input_file import InputFile
from scan_cli import _ThreadLocalStdout
from logger_setup import get_logger

log = get_logger()

# Restore işlemi network I/O ağırlıklı (Appwrite'a yazma) — tarama
# worker sayısından (DEFAULT_WORKERS=5) daha yüksek tutulabilir, çünkü
# CPU işi yok, sadece bekleme var.
DEFAULT_RESTORE_WORKERS = 10

# Appwrite sistem alanları — create_document/update_document'a gönderilmemeli
_SYSTEM_FIELD_PREFIX = "$"


def _clean_document_data(raw_doc: dict) -> tuple[str, dict]:
    """
    Appwrite'tan gelen ham bir doküman kaydından sistem alanlarını ayıklar.

    Dönüş: (document_id, temiz_data)
    """
    doc_id = raw_doc.get("$id")
    clean = {k: v for k, v in raw_doc.items() if not k.startswith(_SYSTEM_FIELD_PREFIX)}
    return doc_id, clean


def _extract_backup(backup_path: str, tmp_dir: str) -> tuple[list, str | None]:
    """
    Yedek dosyasını okur. .tar.gz/.tgz ise extract eder, .json ise
    doğrudan okur.

    Dönüş: (books_listesi, covers_klasör_yolu_veya_None)
    """
    lower = backup_path.lower()

    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        with tarfile.open(backup_path, "r:gz") as tar:
            tar.extractall(tmp_dir, filter="data")

        books_json_path = os.path.join(tmp_dir, "books.json")
        if not os.path.exists(books_json_path):
            raise FileNotFoundError(
                "TAR.GZ içinde books.json bulunamadı — bu dosya geçerli bir "
                "tam yedek değil mi?"
            )
        with open(books_json_path, "r", encoding="utf-8") as f:
            books = json.load(f)

        covers_dir = os.path.join(tmp_dir, "covers")
        covers_dir = covers_dir if os.path.isdir(covers_dir) else None
        return books, covers_dir

    elif lower.endswith(".json"):
        with open(backup_path, "r", encoding="utf-8") as f:
            books = json.load(f)
        return books, None

    else:
        raise ValueError(
            f"Desteklenmeyen yedek dosyası uzantısı: '{backup_path}'. "
            f"'.tar.gz', '.tgz' veya '.json' bekleniyor."
        )


def _restore_one_book(raw_doc: dict, proxy) -> dict:
    """
    Tek bir kitap kaydını Appwrite'a yazar. Önce create_document dener;
    kayıt zaten varsa (409) update_document'a düşer — uploader.save_book()
    ile aynı davranış deseni.
    """
    buffer = StringIO()
    proxy.set_buffer(buffer)

    doc_id, data = _clean_document_data(raw_doc)
    title = data.get("title") or "(başlıksız)"
    status = "error"

    try:
        db = get_databases()
        print(f"{title}")

        try:
            db.create_document(
                database_id=DATABASE_ID,
                collection_id=TABLE_ID,
                document_id=doc_id,
                data=data,
            )
            print("  ✓ Eklendi.")
            status = "created"
        except AppwriteException as e:
            if getattr(e, "code", None) == 409:
                db.update_document(
                    database_id=DATABASE_ID,
                    collection_id=TABLE_ID,
                    document_id=doc_id,
                    data=data,
                )
                print("  ✓ Güncellendi (zaten vardı).")
                status = "updated"
            else:
                print(f"  ✗ Hata: {e.message}")
                status = "error"

    except Exception as e:
        print(f"  ✗ Hata: {e}")
        log.error(f"Kitap geri yüklenemedi ({doc_id}): {e}")
        status = "error"
    finally:
        proxy.clear_buffer()

    return {"doc_id": doc_id, "status": status, "log": buffer.getvalue()}


def _restore_books_parallel(books: list, workers: int) -> dict:
    """
    Tüm kitap kayıtlarını PARALEL olarak Appwrite'a yazar.
    scan_processor.py'deki _scan_parallel ile aynı thread-local stdout
    deseni kullanılır — çıktı satırları karışmaz.
    """
    total = len(books)
    stats = {"created": 0, "updated": 0, "error": 0}

    real_stdout = sys.stdout
    proxy = _ThreadLocalStdout(real_stdout)
    sys.stdout = proxy

    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_doc = {
                executor.submit(_restore_one_book, doc, proxy): doc
                for doc in books
            }
            done = 0
            for future in as_completed(future_to_doc):
                done += 1
                res = future.result()
                real_stdout.write(f"[{done}/{total}] {res['log']}")
                real_stdout.flush()
                stats[res["status"]] += 1
    finally:
        sys.stdout = real_stdout

    return stats


def _restore_one_cover(book_id: str, covers_dir: str, proxy) -> dict:
    """Tek bir kitabın kapak dosyasını Storage'a yükler (varsa)."""
    buffer = StringIO()
    proxy.set_buffer(buffer)

    cover_path = os.path.join(covers_dir, f"{book_id}.jpg")
    status = "skipped"

    try:
        if not os.path.exists(cover_path):
            status = "skipped"
        else:
            storage = get_storage()
            print(f"{book_id}.jpg")

            # Varsa eski dosyayı temizle (uploader.py'deki _delete_if_exists
            # ile aynı "üzerine yaz" davranışı)
            try:
                storage.get_file(bucket_id=BUCKET_ID, file_id=book_id)
                storage.delete_file(bucket_id=BUCKET_ID, file_id=book_id)
            except AppwriteException:
                pass

            storage.create_file(
                bucket_id=BUCKET_ID,
                file_id=book_id,
                file=InputFile.from_path(cover_path),
            )
            print("  ✓ Kapak yüklendi.")
            status = "uploaded"

    except Exception as e:
        print(f"  ✗ Kapak hatası: {e}")
        log.error(f"Kapak geri yüklenemedi ({book_id}): {e}")
        status = "error"
    finally:
        proxy.clear_buffer()

    return {"book_id": book_id, "status": status, "log": buffer.getvalue()}


def _restore_covers_parallel(books: list, covers_dir: str, workers: int) -> dict:
    """Kapak dosyası olan kitapların resimlerini PARALEL olarak yükler."""
    book_ids = [b.get("$id") for b in books if b.get("$id")]
    total = len(book_ids)
    stats = {"uploaded": 0, "skipped": 0, "error": 0}

    real_stdout = sys.stdout
    proxy = _ThreadLocalStdout(real_stdout)
    sys.stdout = proxy

    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_id = {
                executor.submit(_restore_one_cover, book_id, covers_dir, proxy): book_id
                for book_id in book_ids
            }
            done = 0
            for future in as_completed(future_to_id):
                done += 1
                res = future.result()
                if res["status"] != "skipped":
                    real_stdout.write(f"[{done}/{total}] {res['log']}")
                    real_stdout.flush()
                stats[res["status"]] += 1
    finally:
        sys.stdout = real_stdout

    return stats


def restore_full(backup_path: str, workers: int = DEFAULT_RESTORE_WORKERS) -> bool:
    """
    Bir yedek dosyasından (.tar.gz tam yedek veya eski .json) veritabanını
    ve (varsa) kapak resimlerini PARALEL olarak Appwrite'a geri yükler.

    Args:
        backup_path: ".tar.gz"/".tgz" (tam yedek) veya ".json" (eski,
                     sadece veritabanı) dosyasının yolu.
        workers: Aynı anda çalışacak paralel işlem sayısı.

    Dönüş: Kritik bir hata oluşmazsa True (kayıt bazlı hatalar bile olsa
           genel akış tamamlanır), dosya okunamazsa False.
    """
    print("─" * 55)
    print("📥 TAM GERİ YÜKLEME BAŞLIYOR")
    print("─" * 55)

    if not os.path.exists(backup_path):
        print(f"\n❌ Yedek dosyası bulunamadı: {backup_path}")
        log.error(f"Geri yükleme: dosya bulunamadı: {backup_path}")
        return False

    tmp_dir = tempfile.mkdtemp(prefix="ebook_restore_")

    try:
        print("\n[1/3] Yedek dosyası okunuyor...")
        books, covers_dir = _extract_backup(backup_path, tmp_dir)
        print(f"  ✓ {len(books)} kitap kaydı bulundu.")
        if covers_dir:
            cover_count = len([f for f in os.listdir(covers_dir) if f.endswith(".jpg")])
            print(f"  ✓ {cover_count} kapak resmi bulundu (paralel yüklenecek).")
        else:
            print("  ⚠ Bu yedekte kapak resmi yok (eski format ya da boş katalog).")
            print("     Sadece kitap kayıtları geri yüklenecek, kapaklar boş kalacak.")

        if len(books) == 0:
            print("\n⚠ Yedekte hiç kitap kaydı yok, geri yükleme atlanıyor.")
            return True

        print(f"\n[2/3] {len(books)} kitap kaydı paralel yükleniyor ({workers} thread)...")
        book_stats = _restore_books_parallel(books, workers)
        print(
            f"  ✓ Kitap kayıtları tamamlandı: "
            f"{book_stats['created']} eklendi, "
            f"{book_stats['updated']} güncellendi, "
            f"{book_stats['error']} hata."
        )

        cover_stats = {"uploaded": 0, "skipped": 0, "error": 0}
        if covers_dir:
            print(f"\n[3/3] Kapak resimleri paralel yükleniyor ({workers} thread)...")
            cover_stats = _restore_covers_parallel(books, covers_dir, workers)
            print(
                f"  ✓ Kapaklar tamamlandı: "
                f"{cover_stats['uploaded']} yüklendi, "
                f"{cover_stats['skipped']} atlandı (kapak yok), "
                f"{cover_stats['error']} hata."
            )
        else:
            print("\n[3/3] Kapak yükleme atlandı (bu yedekte kapak verisi yok).")

        print("\n" + "─" * 55)
        print("✅ GERİ YÜKLEME TAMAMLANDI")
        print(f"   Kitaplar: {book_stats['created']} eklendi, {book_stats['updated']} güncellendi, {book_stats['error']} hata")
        print(f"   Kapaklar: {cover_stats['uploaded']} yüklendi, {cover_stats['error']} hata")
        print("─" * 55)

        log.info(
            f"Tam geri yükleme tamamlandı: {backup_path} — "
            f"kitap(eklendi={book_stats['created']}, güncellendi={book_stats['updated']}, hata={book_stats['error']}), "
            f"kapak(yüklendi={cover_stats['uploaded']}, hata={cover_stats['error']})"
        )
        return True

    except Exception as e:
        print(f"\n❌ Geri yükleme sırasında hata oluştu: {e}")
        log.error(f"Tam geri yükleme başarısız: {e}")
        return False

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)