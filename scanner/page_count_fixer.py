# -*- coding: utf-8 -*-
"""
page_count_fixer.py — Adım 12

Yerel ebook dosyalarının sayfa sayısını hesaplar ve Appwrite'taki
books koleksiyonuna yazar.

Kullanım:
  python page_count_fixer.py --folder "D:/Kitaplar"
      → RAPOR MODU: Sadece tarar ve tablo basar. Appwrite'a hiçbir şey YAZMAZ.

  python page_count_fixer.py --folder "D:/Kitaplar" --test
      → TEST MODU: İlk 3 "YAZILACAK" kaydı yazar (onay sorar).

  python page_count_fixer.py --folder "D:/Kitaplar" --confirm
      → TAM ÇALIŞMA: Tüm "YAZILACAK" kayıtları yazar (onay sorar).

Güvenlik kuralları:
  - Appwrite'ta zaten page_count dolu olan kitaplar HİÇBİR ZAMAN üzerine yazılmaz.
  - --test veya --confirm olmadan Appwrite'a tek satır bile yazılmaz.
  - Her yazma isteği arasında 1.2 saniye beklenir (rate limit koruması).
  - Yazma: sadece page_count alanı PATCH edilir, diğer alanlara dokunulmaz.
"""

import argparse
import hashlib
import os
import sys
import time

import requests
from dotenv import load_dotenv

# .env'i her şeyden önce yükle
load_dotenv()

# ─── Yapılandırma ─────────────────────────────────────────────────────────────
APPWRITE_ENDPOINT  = os.getenv("APPWRITE_ENDPOINT",  "https://fra.cloud.appwrite.io/v1")
APPWRITE_PROJECT   = os.getenv("APPWRITE_PROJECT_ID", "")
APPWRITE_KEY       = os.getenv("APPWRITE_API_KEY",    "")
DATABASE_ID        = os.getenv("APPWRITE_DATABASE_ID", "")
TABLE_ID           = os.getenv("APPWRITE_TABLE_ID",   "books")

THROTTLE_SECONDS   = 1.2   # yazma istekleri arası bekleme
EPUB_WORDS_PER_PAGE = 250  # EPUB için kelime ÷ bu sayı = sayfa tahmini

HEADERS = {
    "X-Appwrite-Project": APPWRITE_PROJECT,
    "X-Appwrite-Key":     APPWRITE_KEY,
    "Content-Type":       "application/json",
}

# ─── Yardımcı: dosya yolundan doc_id üret ────────────────────────────────────
def _doc_id(file_path: str) -> str:
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


# ─── Desteklenen uzantılar ────────────────────────────────────────────────────
SUPPORTED = {".pdf", ".epub"}


# ─── Klasördeki tüm ebook dosyalarını topla ───────────────────────────────────
def collect_files(folder: str) -> list[str]:
    result = []
    for root, _, files in os.walk(folder):
        for f in files:
            if os.path.splitext(f)[1].lower() in SUPPORTED:
                result.append(os.path.join(root, f))
    return sorted(result)


# ─── PDF sayfa sayısı ─────────────────────────────────────────────────────────
def count_pdf_pages(path: str) -> int | None:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        n = doc.page_count
        doc.close()
        return n if n > 0 else None
    except Exception as e:
        print(f"  [PDF hata] {os.path.basename(path)}: {e}")
        return None


# ─── EPUB sayfa tahmini (kelime ÷ 250) ───────────────────────────────────────
def count_epub_pages(path: str) -> int | None:
    try:
        import ebooklib
        from ebooklib import epub
        from html.parser import HTMLParser

        class _TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.text_parts = []
            def handle_data(self, data):
                self.text_parts.append(data)

        book = epub.read_epub(path, options={"ignore_ncx": True})
        word_count = 0
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            parser = _TextExtractor()
            parser.feed(item.get_content().decode("utf-8", errors="ignore"))
            text = " ".join(parser.text_parts)
            word_count += len(text.split())

        pages = max(1, round(word_count / EPUB_WORDS_PER_PAGE))
        return pages
    except Exception as e:
        print(f"  [EPUB hata] {os.path.basename(path)}: {e}")
        return None


# ─── Appwrite'tan page_count dolu kayıtların doc_id setini çek ────────────────
# Sayfalı okuma: her seferinde 100 kayıt, page_count != null olanlar.
# SDK bypass — direkt HTTP GET (SDK 5.0.1'de GET body hatası var).
def fetch_filled_doc_ids() -> set[str]:
    """Appwrite'ta page_count alanı dolu olan tüm kitapların $id'lerini döndürür."""
    filled = set()
    url    = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents"
    offset = 0
    limit  = 100

    print("  Appwrite'tan dolu kayıtlar sorgulanıyor", end="", flush=True)

    while True:
        params = {
            "queries[]": [
                f'{{"method":"limit","values":[{limit}]}}',
                f'{{"method":"offset","values":[{offset}]}}',
                '{"method":"isNotNull","values":["page_count"]}',
            ]
        }
        try:
            resp = requests.get(url, headers=HEADERS, params=params, timeout=20)
            if resp.status_code != 200:
                print(f"\n  [Appwrite sorgu hatası] HTTP {resp.status_code}: {resp.text[:120]}")
                break
            data = resp.json()
            docs = data.get("documents", [])
            for d in docs:
                filled.add(d["$id"])
            print(".", end="", flush=True)
            if len(docs) < limit:
                break
            offset += limit
        except Exception as e:
            print(f"\n  [Appwrite bağlantı hatası] {e}")
            break

    print(f" {len(filled)} dolu kayıt bulundu.")
    return filled


# ─── Tek kayıt güncelle (sadece page_count) ───────────────────────────────────
def patch_page_count(doc_id: str, page_count: int) -> bool:
    """Appwrite'ta ilgili kitabın sadece page_count alanını günceller.
    Diğer alanlara (title, author, status vb.) kesinlikle dokunulmaz."""
    url = (
        f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}"
        f"/collections/{TABLE_ID}/documents/{doc_id}"
    )
    body = {"data": {"page_count": page_count}}
    try:
        resp = requests.patch(url, headers=HEADERS, json=body, timeout=15)
        if resp.status_code in (200, 201):
            return True
        print(f"  [PATCH hatası] HTTP {resp.status_code}: {resp.text[:120]}")
        return False
    except Exception as e:
        print(f"  [PATCH hatası] {e}")
        return False


# ─── Onay sor ─────────────────────────────────────────────────────────────────
def ask_confirm(prompt: str) -> bool:
    while True:
        answer = input(f"\n{prompt} [e/h]: ").strip().lower()
        if answer in ("e", "evet"):
            return True
        if answer in ("h", "hayır", "hayir"):
            return False
        print("  Lütfen 'e' veya 'h' girin.")


# ─── Raporu tablo olarak yazdır ───────────────────────────────────────────────
def print_report(rows: list[dict]):
    """rows: [{"file": str, "format": str, "pages": int|None, "status": str}]"""
    print()
    print(f"{'Dosya Adı':<55} {'Format':<6} {'Sayfa':<7} Durum")
    print("─" * 85)
    for r in rows:
        name  = os.path.basename(r["file"])[:54]
        fmt   = r["format"].upper()
        pages = str(r["pages"]) if r["pages"] else "?"
        print(f"{name:<55} {fmt:<6} {pages:<7} {r['status']}")
    print("─" * 85)

    total     = len(rows)
    will_write = [r for r in rows if r["status"] == "YAZILACAK"]
    skipped   = [r for r in rows if r["status"] == "ATLANDIK (dolu)"]
    errors    = [r for r in rows if r["status"] == "HATA"]

    print(f"\nToplam : {total}")
    print(f"  Yazılacak   : {len(will_write)}")
    print(f"  Atlandık    : {len(skipped)}")
    print(f"  Hata        : {len(errors)}")


# ─── Yazma işlemi ─────────────────────────────────────────────────────────────
def write_records(to_write: list[dict], label: str):
    print(f"\n{'='*60}")
    print(f"{label} — {len(to_write)} kayıt yazılıyor...")
    print(f"{'='*60}")

    ok_count  = 0
    err_count = 0

    for i, r in enumerate(to_write, 1):
        name = os.path.basename(r["file"])[:50]
        print(f"  [{i}/{len(to_write)}] {name} → {r['pages']} sayfa", end=" ... ", flush=True)

        success = patch_page_count(r["doc_id"], r["pages"])

        if success:
            print("✓")
            ok_count += 1
        else:
            print("✗ HATA")
            err_count += 1

        if i < len(to_write):
            time.sleep(THROTTLE_SECONDS)

    print(f"\nTamamlandı: {ok_count} başarılı, {err_count} hatalı.")


# ─── Ana akış ─────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Ebook dosyalarının sayfa sayısını hesaplar ve Appwrite'a yazar."
    )
    parser.add_argument(
        "--folder", required=True,
        help="Taranacak klasör yolu (örn: D:/Kitaplar)"
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Test modu: ilk 3 'YAZILACAK' kaydı yazar (onay sorar)."
    )
    parser.add_argument(
        "--confirm", action="store_true",
        help="Tam çalıştırma: tüm 'YAZILACAK' kayıtları yazar (onay sorar)."
    )
    args = parser.parse_args()

    # --test ve --confirm aynı anda kullanılamaz
    if args.test and args.confirm:
        print("Hata: --test ve --confirm aynı anda kullanılamaz.")
        sys.exit(1)

    # .env kontrolü
    if not APPWRITE_PROJECT or not APPWRITE_KEY or not DATABASE_ID:
        print("Hata: .env dosyasında APPWRITE_PROJECT_ID, APPWRITE_API_KEY "
              "veya APPWRITE_DATABASE_ID eksik.")
        sys.exit(1)

    folder = args.folder
    if not os.path.isdir(folder):
        print(f"Hata: Klasör bulunamadı: {folder}")
        sys.exit(1)

    # 1) Dosyaları topla
    print(f"\nKlasör taranıyor: {folder}")
    files = collect_files(folder)
    print(f"{len(files)} dosya bulundu ({', '.join(SUPPORTED)}).\n")
    if not files:
        print("Taranacak dosya yok.")
        sys.exit(0)

    # 2) Appwrite'tan dolu kayıtları çek (1 toplu sorgu zinciri, yazma yok)
    filled_ids = fetch_filled_doc_ids()

    # 3) Her dosyayı tara — sayfa sayısını hesapla
    print("\nDosyalar taranıyor...")
    rows = []
    for path in files:
        ext    = os.path.splitext(path)[1].lower()
        fmt    = "pdf" if ext == ".pdf" else "epub"
        doc_id = _doc_id(path)

        if doc_id in filled_ids:
            # Appwrite'ta zaten dolu → atla
            rows.append({
                "file": path, "format": fmt,
                "pages": None, "status": "ATLANDIK (dolu)",
                "doc_id": doc_id,
            })
            continue

        # Sayfa sayısını hesapla
        if fmt == "pdf":
            pages = count_pdf_pages(path)
        else:
            pages = count_epub_pages(path)

        status = "YAZILACAK" if pages else "HATA"
        rows.append({
            "file": path, "format": fmt,
            "pages": pages, "status": status,
            "doc_id": doc_id,
        })

    # 4) Raporu yazdır
    print_report(rows)

    # 5) Sadece rapor moduysa burada dur
    if not args.test and not args.confirm:
        print("\nRAPOR MODU — Appwrite'a hiçbir şey yazılmadı.")
        print("İlk 3 kaydı yazmak için: --test")
        print("Tümünü yazmak için:      --confirm")
        return

    # 6) Yazılacak kayıtları filtrele
    to_write = [r for r in rows if r["status"] == "YAZILACAK"]

    if not to_write:
        print("\nYazılacak kayıt yok. Tüm kitapların page_count zaten dolu.")
        return

    # 7) Test modu: ilk 3 kayıt
    if args.test:
        batch = to_write[:3]
        print(f"\nTEST MODU — Aşağıdaki {len(batch)} kayıt yazılacak:")
        for r in batch:
            print(f"  • {os.path.basename(r['file'])} → {r['pages']} sayfa")

        if not ask_confirm("Bu 3 kaydı Appwrite'a yazmak istiyor musunuz?"):
            print("İptal edildi.")
            return

        write_records(batch, "TEST MODU")
        print("\nTest başarılıysa tümünü yazmak için: --confirm")
        return

    # 8) Tam çalıştırma
    if args.confirm:
        print(f"\nTAM ÇALIŞMA — {len(to_write)} kayıt yazılacak.")
        print(f"Tahmini süre: ~{round(len(to_write) * THROTTLE_SECONDS / 60, 1)} dakika")

        if not ask_confirm(f"Tüm {len(to_write)} kaydı Appwrite'a yazmak istiyor musunuz?"):
            print("İptal edildi.")
            return

        write_records(to_write, "TAM ÇALIŞMA")


if __name__ == "__main__":
    main()