import os
import sys
import tempfile
import argparse
from dotenv import load_dotenv

load_dotenv()

from metadata import extract_metadata
from cover import extract_cover
from api import enrich_metadata
from uploader import (
    upload_cover,
    upload_cover_from_url,
    save_book,
    _book_id_from_path,
)

SUPPORTED_FORMATS = {".epub", ".pdf"}


def check_env():
    required = {
        "APPWRITE_PROJECT_ID": "YOUR_PROJECT_ID",
        "APPWRITE_API_KEY": "YOUR_API_KEY",
        "APPWRITE_USER_ID": "YOUR_USER_ID",
    }
    missing = []
    for var, placeholder in required.items():
        val = os.getenv(var, "")
        if not val or val == placeholder:
            missing.append(var)

    if missing:
        print("⚠️  .env dosyasında eksik/ayarlanmamış değerler var:")
        for var in missing:
            print(f"    - {var}")
        print("\nLütfen scanner/.env dosyasını doldurup tekrar çalıştır.")
        sys.exit(1)


def scan_folder(folder_path: str, recursive: bool = True):
    if not os.path.isdir(folder_path):
        print(f"Hata: '{folder_path}' klasörü bulunamadı.")
        sys.exit(1)

    print(f"\n📚 Klasör taranıyor: {folder_path}")
    print("-" * 50)

    files = collect_files(folder_path, recursive)
    print(f"Toplam {len(files)} ebook dosyası bulundu.\n")

    stats = {"new": 0, "skipped": 0, "error": 0}

    for i, file_path in enumerate(files, 1):
        filename = os.path.basename(file_path)
        print(f"[{i}/{len(files)}] {filename}")

        try:
            result = process_file(file_path)
            if result:
                stats["new"] += 1
                print("  ✓ Başarıyla eklendi.")
            else:
                stats["error"] += 1
                print("  ✗ Eklenemedi.")
        except Exception as e:
            stats["error"] += 1
            print(f"  ✗ Hata: {e}")

    print("\n" + "=" * 50)
    print(f"✅ Yeni eklenen : {stats['new']}")
    print(f"⏭  Atlanan      : {stats['skipped']}")
    print(f"❌ Hata         : {stats['error']}")
    print("=" * 50)


def collect_files(folder_path: str, recursive: bool) -> list:
    files = []
    if recursive:
        for root, _, filenames in os.walk(folder_path):
            for f in filenames:
                if os.path.splitext(f)[1].lower() in SUPPORTED_FORMATS:
                    files.append(os.path.join(root, f))
    else:
        for f in os.listdir(folder_path):
            full = os.path.join(folder_path, f)
            if os.path.isfile(full) and os.path.splitext(f)[1].lower() in SUPPORTED_FORMATS:
                files.append(full)
    return sorted(files)


def process_file(file_path: str) -> bool:
    print("  → Metadata çekiliyor...")
    metadata = extract_metadata(file_path)

    print("  → Google Books sorgulanıyor...")
    api_data = enrich_metadata(
        title=metadata.get("title", ""),
        author=metadata.get("author"),
    )

    # Yıl: dosya içinden bulunamazsa API'dan al
    if api_data.get("year") and not metadata.get("year"):
        metadata["year"] = api_data["year"]

    # Seri: dosya içinden bulunamazsa API'dan al
    if api_data.get("series") and not metadata.get("series"):
        metadata["series"] = api_data["series"]

    # Seri sırası: dosya içinden bulunamazsa API'dan al
    if api_data.get("series_order") and not metadata.get("series_order"):
        metadata["series_order"] = api_data["series_order"]

    # Açıklama: her zaman API'dan al (dosya içinde genellikle bulunmaz)
    if api_data.get("description"):
        metadata["description"] = api_data["description"]

    # Yazar: dosya içinden bulunamazsa API'dan al
    if api_data.get("author_api") and not metadata.get("author"):
        metadata["author"] = api_data["author_api"]

    # YENİ: Yayınevi — önce dosya içi, yoksa API'dan al
    if api_data.get("publisher") and not metadata.get("publisher"):
        metadata["publisher"] = api_data["publisher"]

    # YENİ: Dil — önce dosya içi, yoksa API'dan al
    if api_data.get("language") and not metadata.get("language"):
        metadata["language"] = api_data["language"]

    print("  → Kapak çekiliyor...")
    cover_url = None
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cover_extracted = extract_cover(file_path, tmp_path)
        book_id = _book_id_from_path(file_path)

        if cover_extracted and os.path.getsize(tmp_path) > 0:
            cover_url = upload_cover(tmp_path, book_id)
        elif api_data.get("cover_url_api"):
            print("  → Dosyadan kapak alınamadı, API'dan deneniyor...")
            cover_url = upload_cover_from_url(api_data["cover_url_api"], book_id)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    print("  → Veritabanına kaydediliyor...")
    return save_book(metadata, cover_url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ebook klasörünü tara ve kataloğa ekle.")
    parser.add_argument("folder", help="Taranacak klasör yolu")
    parser.add_argument("--no-recursive", action="store_true", help="Alt klasörleri tarama")
    args = parser.parse_args()

    check_env()
    scan_folder(args.folder, recursive=not args.no_recursive)