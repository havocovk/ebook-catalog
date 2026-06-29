import argparse
from dotenv import load_dotenv

# KRİTİK: .env dosyası burada, her şeyden ÖNCE yüklenmeli.
# Aksi halde scan_processor -> uploader importu, api paketinin
# load_dotenv() çağrısından ÖNCE çalışır ve uploader.py'deki
# APPWRITE_PROJECT_ID gibi değerler placeholder ("YOUR_PROJECT_ID")
# olarak sabitlenir — Appwrite "Project not found" hatası verir.
load_dotenv()

from scan_cli import check_env
from scan_processor import scan_folder, DEFAULT_WORKERS

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ebook klasörünü tara ve kataloğa ekle.")
    parser.add_argument("folder", help="Taranacak klasör yolu")
    parser.add_argument("--no-recursive", action="store_true", help="Alt klasörleri tarama")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Her kitap için metadata kaynaklarını göster")
    parser.add_argument("--report", metavar="DOSYA.csv",
                        help="Eksik alan raporunu CSV dosyasına kaydet")
    parser.add_argument("--workers", "-w", type=int, default=DEFAULT_WORKERS,
                        metavar="N",
                        help=f"Aynı anda işlenecek kitap sayısı (varsayılan: {DEFAULT_WORKERS}). "
                             f"1 verirsen sıralı (paralel olmayan) modda çalışır.")
    # ── Adım P3: Otomasyon parametreleri ────────────────────────────────────
    parser.add_argument("--no-interactive", action="store_true",
                        help="Hiçbir soru sormadan tamamen otomatik çalış. "
                             "GUI ve zamanlanmış tarama için kullanılır.")
    parser.add_argument("--publisher",
                        metavar="YAYINEVİ",
                        help='Tüm kitaplara uygulanacak yayınevi adı. '
                             'Örn: --publisher "İthaki Yayınları"')
    parser.add_argument("--series",
                        metavar="SERİ",
                        help='Tüm kitaplara uygulanacak seri adı. '
                             'Örn: --series "Vakıf Serisi"')
    args = parser.parse_args()

    check_env()
    scan_folder(
        args.folder,
        recursive=not args.no_recursive,
        verbose=args.verbose,
        report_csv=args.report,
        workers=args.workers,
        no_interactive=args.no_interactive,
        publisher=args.publisher,
        series=args.series,
    )