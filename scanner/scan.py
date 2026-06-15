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
    is_already_indexed,
    upload_cover,
    upload_cover_from_url,
    save_book,
    _book_id_from_path,
)

SUPPORTED_FORMATS = {".epub", ".pdf"}


def check_env():
    """Tarama başlamadan önce .env'deki kritik değerler dolu mu kontrol et.
    Eksikse en baştan uyar ki yanlış ayarla saatlerce uğraşılmasın."""
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
    """Scan a folder and index all new ebook files."""

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

        # Skip if already indexed
        if is_already_indexed(file_path):
            print("  → Zaten kayıtlı, atlanıyor.")
            stats["skipped"] += 1
            continue

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
    # Step 1: Extract local metadata
    print("  → Metadata çekiliyor...")
    metadata = extract_metadata(file_path)

    # Step 2: Enrich via Google Books API
    print("  → Google Books sorgulanıyor...")
    api_data = enrich_metadata(
        title=metadata.get("title", ""),
        author=metadata.get("author"),
    )

    # Merge API data — don't overwrite existing local values
    if api_data.get("year") and not metadata.get("year"):
        metadata["year"] = api_data["year"]
    if api_data.get("series") and not metadata.get("series"):
        metadata["series"] = api_data["series"]
    if api_data.get("series_order") and not metadata.get("series_order"):
        metadata["series_order"] = api_data["series_order"]
    if api_data.get("description"):
        metadata["description"] = api_data["description"]
    # If local author was missing and API found one
    if api_data.get("author_api") and not metadata.get("author"):
        metadata["author"] = api_data["author_api"]

    # Step 3: Extract cover
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

    # Step 4: Save to database
    print("  → Veritabanına kaydediliyor...")
    return save_book(metadata, cover_url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ebook klasörünü tara ve kataloğa ekle."
    )
    parser.add_argument("folder", help="Taranacak klasör yolu")
    parser.add_argument(
        "--no-recursive",
        action="store_true",
        help="Alt klasörleri tarama",
    )
    args = parser.parse_args()

    check_env()
    scan_folder(args.folder, recursive=not args.no_recursive)
