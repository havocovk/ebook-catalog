import argparse
from dotenv import load_dotenv

# KRİTİK: .env dosyası burada, her şeyden ÖNCE yüklenmeli.
# Aksi halde scan_processor -> uploader importu, api paketinin
# load_dotenv() çağrısından ÖNCE çalışır ve uploader.py'deki
# APPWRITE_PROJECT_ID gibi değerler placeholder ("YOUR_PROJECT_ID")
# olarak sabitlenir — Appwrite "Project not found" hatası verir.
load_dotenv()

from scan_cli import check_env, run_backup_full, run_restore_full
from scan_processor import scan_folder, DEFAULT_WORKERS

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ebook klasörünü tara ve kataloğa ekle.")
    # ── Adım 1: "folder" artık opsiyonel — --backup-full kullanılırken
    # klasör taranmayacağı için zorunlu olmamalı. nargs="?" ile bu sağlanır.
    parser.add_argument("folder", nargs="?", default=None,
                        help="Taranacak klasör yolu (--backup-full kullanılıyorsa gerekmez)")
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
    # ── Adım 1: --backup-full — veritabanı + kapak resimlerini TAR.GZ'ye yedekle
    parser.add_argument("--backup-full",
                        metavar="ÇIKTI.tar.gz",
                        help='Tüm kitap kayıtlarını ve kapak resimlerini belirtilen '
                             '.tar.gz dosyasına yedekler. Bu parametre verildiğinde '
                             'hiçbir klasör taraması yapılmaz, sadece yedekleme çalışır. '
                             'Örn: --backup-full yedekler/backup-2025-06-30.tar.gz')
    # ── Adım 2: --restore-backup — TAR.GZ veya eski JSON yedeğinden paralel geri yükle
    parser.add_argument("--restore-backup",
                        metavar="YEDEK.tar.gz|YEDEK.json",
                        help='Bir yedek dosyasından (--backup-full ile alınmış .tar.gz '
                             'VEYA eski tek-dosya .json) veritabanını ve kapak resimlerini '
                             'PARALEL olarak geri yükler. Bu parametre verildiğinde '
                             'hiçbir klasör taraması yapılmaz, sadece geri yükleme çalışır. '
                             'Örn: --restore-backup yedekler/backup-2025-06-30.tar.gz')
    parser.add_argument("--restore-workers", type=int, default=10,
                        metavar="N",
                        help="--restore-backup sırasında aynı anda çalışacak paralel "
                             "işlem sayısı (varsayılan: 10).")
    args = parser.parse_args()

    check_env()

    # ── Adım 1: --backup-full verilmişse, taramaya hiç girmeden yedekle ve çık.
    if args.backup_full:
        run_backup_full(args.backup_full)
    # ── Adım 2: --restore-backup verilmişse, taramaya hiç girmeden geri yükle ve çık.
    elif args.restore_backup:
        run_restore_full(args.restore_backup, args.restore_workers)
    else:
        if not args.folder:
            parser.error("folder argümanı gereklidir (--backup-full / --restore-backup kullanmıyorsanız).")
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