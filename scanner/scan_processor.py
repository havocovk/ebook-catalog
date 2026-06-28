# -*- coding: utf-8 -*-
"""
Tarama orkestrasyonu modülü.

Bir klasördeki tüm ebook dosyalarını toplar, hangilerinin zaten kayıtlı
olduğunu toplu sorguyla bulur ve dosyaları seri (sıralı) veya paralel
modda işler. Faz 3'ün en karmaşık parçası — threading, ThreadPoolExecutor
ve thread-safe çıktı yönetimi burada.

scan.py'den bölündü — Adım 3-3 (Faz 3 refactoring).
"""

import os
import sys
from io import StringIO
from concurrent.futures import ThreadPoolExecutor, as_completed

from scan_cli import (
    _analyze_path_for_publisher,
    _ask_folder_series,
    _ThreadLocalStdout,
)
from uploader import get_indexed_paths_batch
from scan_file import process_file
from scan_report import _print_summary, _write_csv_report
from logger_setup import get_logger

# Modül seviyesinde bir kez oluşturulur — orijinal scan.py'deki global
# 'log' değişkeniyle aynı davranış (Adım 8 loglama mantığı korunur).
log = get_logger()

# scan.py'den taşınan modül seviyesi sabitleri (scan_folder ve collect_files
# bunları kullanıyor).
SUPPORTED_FORMATS = {".epub", ".pdf"}

# Adım P2: Varsayılan paralel iş sayısı (aynı anda işlenecek kitap sayısı)
DEFAULT_WORKERS = 5


def scan_folder(
    folder_path: str,
    recursive: bool = True,
    verbose: bool = False,
    report_csv: str = None,
    workers: int = DEFAULT_WORKERS,
    no_interactive: bool = False,
    publisher: str = None,
    series: str = None,
):
    if not os.path.isdir(folder_path):
        print(f"Hata: '{folder_path}' klasörü bulunamadı.")
        log.error(f"Klasör bulunamadı: {folder_path}")
        sys.exit(1)

    print(f"\n📚 Klasör taranıyor: {folder_path}")
    print("─" * 55)
    log.info(f"Tarama başladı: {folder_path}")

    # ── Adım P3: Yayınevi ve seri belirleme ─────────────────────────────────
    #
    # Üç senaryo:
    #
    #   1) --no-interactive  → hiçbir soru sorulmaz.
    #      --publisher ve/veya --series verilmişse onlar kullanılır, yoksa None.
    #
    #   2) --publisher / --series verilmiş ama --no-interactive YOK
    #      → Parametre doğrudan kabul edilir, o alan için soru sorulmaz.
    #        Diğer alan için (verilmemişse) soru sorulmaya devam eder.
    #
    #   3) Hiçbir parametre yok (eski davranış)
    #      → Her iki alan için de interaktif sorular sorulur.
    #
    # ÖNEMLİ: Sorular paralel işlem BAŞLAMADAN önce tamamlanır.
    # Thread'ler hiçbir zaman kullanıcıya soru soramaz.

    if no_interactive:
        # Tam otomatik mod — komut satırından gelen değerleri doğrudan kullan
        forced_publisher = publisher or None
        forced_series    = series or None
        if forced_publisher:
            print(f"⚙️  Yayınevi (parametre): {forced_publisher}")
        if forced_series:
            print(f"⚙️  Seri (parametre): {forced_series}")
        if not forced_publisher and not forced_series:
            print("⚙️  Otomatik mod: yayınevi ve seri dosya adı / API'dan belirlenecek.")
        print()
    else:
        # İnteraktif mod — önce komut satırı parametrelerine bak,
        # verilmemişse kullanıcıya sor
        if publisher:
            # --publisher verilmiş → soru sorma, doğrudan kullan
            forced_publisher = publisher
            print(f"⚙️  Yayınevi (parametre): {forced_publisher}\n")
        else:
            # --publisher verilmemiş → klasör yoluna bakıp kullanıcıya sor
            forced_publisher = _analyze_path_for_publisher(folder_path)

        if series:
            # --series verilmiş → soru sorma, doğrudan kullan
            forced_series = series
            print(f"⚙️  Seri (parametre): {forced_series}\n")
        else:
            # --series verilmemiş → klasör adına bakıp kullanıcıya sor
            forced_series = _ask_folder_series(folder_path)

    files = collect_files(folder_path, recursive)
    total = len(files)
    print(f"Toplam {total} ebook dosyası bulundu.")

    stats = {"new": 0, "skipped": 0, "error": 0}
    missing_tracker = {
        "title": [], "author": [], "publisher": [],
        "series": [], "year": [], "language": [],
    }

    if total == 0:
        _print_summary(stats, missing_tracker)
        return

    # ── Adım 7: Toplu "zaten kayıtlı mı?" kontrolü ──────────────────────────
    # Taramaya başlamadan ÖNCE, tüm dosyalar için TEK SEFERDE (100'lük gruplar
    # halinde) Appwrite'a sorulur. Önceki yöntemde her dosya için ayrı bir
    # ağ isteği atılıyordu (3000 kitapta 3000 istek); şimdi en fazla
    # ceil(3000/100) = 30 istek atılıyor.
    print("🔍 Hangi dosyaların zaten kayıtlı olduğu kontrol ediliyor (toplu sorgu)...")
    indexed_paths = get_indexed_paths_batch(files)
    print(f"   {len(indexed_paths)}/{total} dosya zaten kayıtlı, atlanacak.\n")

    # ── Worker sayısını belirle ──────────────────────────────────────────────
    # Dosya sayısından fazla worker açmak anlamsız
    effective_workers = max(1, min(workers, total))

    if effective_workers <= 1:
        # Seri (sıralı) mod — eski davranış, paralellik kapalı
        print("⚙️  Sıralı (seri) modda taranıyor.\n")
        _scan_sequential(
            files, stats, missing_tracker,
            verbose, forced_publisher, forced_series,
            indexed_paths,
        )
    else:
        # Paralel mod
        print(f"⚙️  Paralel modda taranıyor (aynı anda {effective_workers} kitap).\n")
        _scan_parallel(
            files, stats, missing_tracker,
            verbose, forced_publisher, forced_series,
            effective_workers, indexed_paths,
        )

    _print_summary(stats, missing_tracker)

    if report_csv:
        _write_csv_report(report_csv, missing_tracker)


def _scan_sequential(
    files, stats, missing_tracker,
    verbose, forced_publisher, forced_series,
    indexed_paths,
):
    """
    Dosyaları tek tek, sırayla işler (eski davranış).
    --workers 1 verildiğinde veya tek dosya olduğunda kullanılır.

    Adım 7: "zaten kayıtlı mı?" kontrolü artık burada ağ isteği atmıyor —
    indexed_paths kümesi taramaya başlamadan ÖNCE toplu sorguyla hesaplandı
    (bkz. scan_folder). Burada sadece kümede arama yapılıyor (anında, ağ yok).
    """
    total = len(files)
    for i, file_path in enumerate(files, 1):
        filename = os.path.basename(file_path)
        print(f"[{i}/{total}] {filename}")

        try:
            if file_path in indexed_paths:
                stats["skipped"] += 1
                print("  ⏭  Zaten kayıtlı, atlanıyor.")
                continue

            result, final_metadata = process_file(
                file_path,
                verbose=verbose,
                forced_publisher=forced_publisher,
                forced_series=forced_series,
            )

            if result:
                stats["new"] += 1
                print("  ✓ Başarıyla eklendi.")
            else:
                stats["error"] += 1
                print("  ✗ Eklenemedi.")

            for field in missing_tracker:
                if not final_metadata.get(field):
                    missing_tracker[field].append(file_path)

        except Exception as e:
            stats["error"] += 1
            print(f"  ✗ Hata: {e}")
            log.error(f"Dosya işlenemedi: {file_path} — {e}")


def _scan_parallel(
    files, stats, missing_tracker,
    verbose, forced_publisher, forced_series,
    workers, indexed_paths,
):
    """
    Dosyaları paralel olarak (aynı anda 'workers' adet) işler.

    Çalışma mantığı:
      1) sys.stdout, thread-local bir proxy ile değiştirilir. Böylece her
         worker thread'i kendi çıktısını ayrı bir tampona yazar.
      2) Her dosya bir worker'a gönderilir (_process_one).
      3) Bir dosya bittikçe (as_completed), o dosyanın tüm çıktısı tek blok
         halinde gerçek terminale basılır — satırlar karışmaz.
      4) Sayaçlar (stats) ve eksik alan listesi (missing_tracker) yalnızca
         bu ana döngüde, tek thread tarafından güncellenir — yarış durumu olmaz.

    Adım 7: indexed_paths kümesi (taramaya başlamadan önce toplu sorguyla
    hesaplandı) tüm worker thread'lerine salt-okunur olarak paylaşılır.
    Sadece okuma yapıldığı için (hiçbir thread içeriğini değiştirmiyor)
    ek bir kilitleme (lock) gerekmez — Python'da salt-okunur set paylaşımı
    thread-safe'tir.
    """
    total = len(files)
    real_stdout = sys.stdout
    proxy = _ThreadLocalStdout(real_stdout)
    sys.stdout = proxy

    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_path = {
                executor.submit(
                    _process_one,
                    file_path, proxy,
                    verbose, forced_publisher, forced_series,
                    indexed_paths,
                ): file_path
                for file_path in files
            }

            done = 0
            for future in as_completed(future_to_path):
                done += 1
                res = future.result()

                # Çıktıyı gerçek terminale, sıra numarasıyla bas
                real_stdout.write(f"[{done}/{total}] {res['log']}")
                real_stdout.flush()

                # Sayaçları ana thread'de güncelle (yarış durumu yok)
                status = res["status"]
                if status == "new":
                    stats["new"] += 1
                elif status == "skipped":
                    stats["skipped"] += 1
                else:
                    stats["error"] += 1

                # Eksik alan takibi — atlananlar hariç (eski davranışla aynı)
                if status != "skipped":
                    md = res["metadata"]
                    for field in missing_tracker:
                        if not md.get(field):
                            missing_tracker[field].append(res["file_path"])
    finally:
        # sys.stdout'u her durumda eski haline döndür
        sys.stdout = real_stdout


def _process_one(
    file_path, proxy,
    verbose, forced_publisher, forced_series,
    indexed_paths,
):
    """
    Tek bir dosyayı bir worker thread'inde işler.

    Bu fonksiyon paralel havuzda çağrılır. Tüm print çıktısını kendi
    tamponuna toplar ve sonunda (durum, metadata, çıktı metni) döndürür.
    Ana thread bu sonucu alıp terminale basar ve sayaçları günceller.

    Adım 7: indexed_paths kümesinde arama yapmak ağ isteği gerektirmez
    (anında sonuç) — eski is_already_indexed() çağrısı ağ isteği atıyordu.
    """
    buffer = StringIO()
    proxy.set_buffer(buffer)

    status = "error"
    final_metadata = {}

    try:
        filename = os.path.basename(file_path)
        print(f"{filename}")

        if file_path in indexed_paths:
            print("  ⏭  Zaten kayıtlı, atlanıyor.")
            status = "skipped"
        else:
            result, final_metadata = process_file(
                file_path,
                verbose=verbose,
                forced_publisher=forced_publisher,
                forced_series=forced_series,
            )
            if result:
                print("  ✓ Başarıyla eklendi.")
                status = "new"
            else:
                print("  ✗ Eklenemedi.")
                status = "error"

    except Exception as e:
        print(f"  ✗ Hata: {e}")
        log.error(f"Dosya işlenemedi: {file_path} — {e}")
        status = "error"
    finally:
        proxy.clear_buffer()

    return {
        "file_path": file_path,
        "status": status,
        "metadata": final_metadata,
        "log": buffer.getvalue(),
    }


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