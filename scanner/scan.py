import os
import sys
import csv
import re
import tempfile
import argparse
import threading
from io import StringIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv()

from metadata import extract_metadata, _is_publisher_string, _is_generic_folder, compute_confidence
from cover import extract_cover
from api import enrich_metadata
from uploader import (
    upload_cover,
    upload_cover_from_url,
    save_book,
    is_already_indexed,
    get_indexed_paths_batch,
    _book_id_from_path,
)
from logger_setup import get_logger

# ── Adım 8: Loglama ──────────────────────────────────────────────────────────
# "Orta seviye" loglama: özet istatistikler + hatalar. Her kitabın detayı
# loglanmaz (bkz. logger_setup.py docstring'i). Ekrandaki print() ifadeleri
# bu logger'dan bağımsız çalışmaya devam eder — hiçbiri kaldırılmadı.
log = get_logger()

SUPPORTED_FORMATS = {".epub", ".pdf"}

# Adım P2: Varsayılan paralel iş sayısı (aynı anda işlenecek kitap sayısı)
DEFAULT_WORKERS = 5


def check_env():
    required = {
        "APPWRITE_PROJECT_ID": "YOUR_PROJECT_ID",
        "APPWRITE_API_KEY":    "YOUR_API_KEY",
        "APPWRITE_USER_ID":    "YOUR_USER_ID",
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
        log.error(f".env dosyasında eksik değerler, tarama başlatılamadı: {', '.join(missing)}")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Adım P2: Thread-local stdout — paralel modda çıktı karışmasını önler
# ─────────────────────────────────────────────────────────────────────────────

class _ThreadLocalStdout:
    """
    Her thread'in print çıktısını kendi tamponuna (buffer) yönlendirir.

    Paralel tarama sırasında 5 kitap aynı anda işlendiğinde, normalde her
    kitabın satırları terminalde iç içe girer. Bu sınıf, sys.stdout'un yerine
    geçer: bir worker thread'i kendi tamponuna yazar, ana thread doğrudan
    gerçek terminale yazar. Böylece her kitabın çıktısı bütün halinde,
    karışmadan basılabilir.
    """

    def __init__(self, default_stream):
        self._default = default_stream      # Gerçek terminal (ana thread için)
        self._local = threading.local()     # Her thread'e özel saklama alanı

    def write(self, text):
        buffer = getattr(self._local, "buffer", None)
        (buffer if buffer is not None else self._default).write(text)

    def flush(self):
        buffer = getattr(self._local, "buffer", None)
        (buffer if buffer is not None else self._default).flush()

    def set_buffer(self, buffer):
        """Bu thread'in çıktısını verilen tampona yönlendir."""
        self._local.buffer = buffer

    def clear_buffer(self):
        """Bu thread'i tekrar gerçek terminale döndür."""
        self._local.buffer = None


# ─────────────────────────────────────────────────────────────────────────────
# TARAMA ÖNCESİ KULLANICI SORU AKIŞI
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_path_for_publisher(folder_path: str) -> str | None:
    """
    Taranacak klasörün tam yolundaki klasör adlarını inceler.
    Yayınevi adı içeren bir klasör bulursa kullanıcıya sorar.

    Örn: D:\\Kitaplar\\İş Bankası Kültür Yayınları\\Biyografi Serisi
         → "İş Bankası Kültür Yayınları" yayınevi mi diye sorar

    Dönüş:
      str  → onaylanan veya kullanıcının girdiği yayınevi adı
      None → yayınevi belirsiz, dosya adlarından / dosya içinden bulunacak
    """
    parts = os.path.normpath(folder_path).split(os.sep)

    # Yol parçalarında yayınevi anahtar kelimesi geçen klasör var mı?
    publisher_candidate = None
    for part in parts:
        if part and not _is_generic_folder(part) and _is_publisher_string(part):
            publisher_candidate = part
            break

    print("\n" + "─" * 55)

    if publisher_candidate:
        print(f'❓ Klasör adresindeki "{publisher_candidate}"')
        print(f'   taranacak kitapların yayınevi midir?')
        answer = _ask("   Cevabınız (e/h): ")

        if answer:
            print(f'   ✓ Yayınevi "{publisher_candidate}" olarak belirlendi.\n')
            return publisher_candidate
        # "Hayır" yanıtı → manuel giriş sorusu
    else:
        print("ℹ️  Klasör adresinde yayınevi adı tespit edilemedi.")

    # Yayınevini manuel girmek ister mi?
    print("❓ Taranacak kitapların yayınevini yazmak ister misiniz?")
    answer2 = _ask("   Cevabınız (e/h): ")

    if answer2:
        while True:
            pub = input("   Yayınevinin adını yazınız: ").strip()
            if pub:
                print(f'   ✓ Yayınevi "{pub}" olarak belirlendi.\n')
                return pub
            print("   Boş bırakılamaz, tekrar deneyin.")
    else:
        print("   Yayınevi ismi girilmedi.")
        print("   Yayınevi ismini tarama esnasında kendi iş akışıma göre bulacağım.\n")
        return None


def _ask_folder_series(folder_path: str) -> str | None:
    """
    Taranacak klasörün adı genel bir kelime değilse ve
    yayınevi adı içermiyorsa, seri adı olup olmadığını sorar.

    Dönüş:
      str  → onaylanan seri adı (tüm kitaplara atanacak)
      None → seri adı belirsiz (dosya adı / API'dan bulunacak)
    """
    folder_name = os.path.basename(os.path.normpath(folder_path))

    # Genel klasör adı veya yayınevi adıysa sorma
    if _is_generic_folder(folder_name) or _is_publisher_string(folder_name):
        return None

    print(f'❓ Klasör adı: "{folder_name}"')
    print(f'   Bu klasördeki kitapların tamamı "{folder_name}" serisine mi ait?')
    answer = _ask("   Cevabınız (e/h): ")

    if answer:
        print(f'   ✓ Tüm kitaplara seri adı "{folder_name}" atanacak.\n')
        return folder_name
    else:
        print(f'   ✓ Seri bilgisi dosya adı ve API\'dan belirlenecek.\n')
        return None


def _ask(prompt: str) -> bool:
    """Kullanıcıdan e/h cevabı alır. True=evet, False=hayır."""
    while True:
        ans = input(prompt).strip().lower()
        if ans in ("e", "evet", "y", "yes"):
            return True
        if ans in ("h", "hayır", "hayir", "n", "no"):
            return False
        print("   Lütfen 'e' veya 'h' girin.")


# ─────────────────────────────────────────────────────────────────────────────
# ANA TARAMA AKIŞI
# ─────────────────────────────────────────────────────────────────────────────

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


def process_file(
    file_path: str,
    verbose: bool = False,
    forced_publisher: str = None,
    forced_series: str = None,
):
    """
    Tek bir dosyayı işler.

    Öncelik sırası:
      1) Dosya adı (arşiv formatı: Yazar - Başlık [Yayınevi] [Baskı] - Yıl)
      2) Klasör yapısı (yayınevi ve seri kullanıcı onayıyla belirlendi)
      3) Dosya içi metadata (EPUB/PDF)
      4) API (Google Books → Open Library → Hardcover)
    """
    print("  → Metadata çekiliyor...")
    metadata = extract_metadata(
        file_path,
        forced_publisher=forced_publisher,
        use_folder_series=False,  # Seri kararı scan.py yönetir
    )

    # Kullanıcı seri adı onayladıysa direkt ata (API'ı ezmez)
    if forced_series and not metadata.get("series"):
        metadata["series"] = forced_series
        metadata.setdefault("_sources", {})["series"] = "user"

    print("  → Google Books sorgulanıyor...")
    api_data = enrich_metadata(
        title=metadata.get("title", ""),
        author=metadata.get("author"),
        isbn=metadata.get("isbn"),
    )

    # API'dan gelen verilerle eksik alanları tamamla
    _merge_api_data(metadata, api_data, forced_publisher, forced_series)

    # ── Adım P8: Güven skorunu hesapla ───────────────────────────────────────
    score, source_map = compute_confidence(metadata)
    metadata["confidence_score"] = score
    metadata["metadata_source"] = source_map
    print(f"  → Güven skoru: %{score}")

    if verbose:
        _print_verbose(metadata, api_data)

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
    success = save_book(metadata, cover_url)
    return success, metadata


def _merge_api_data(
    metadata: dict,
    api_data: dict,
    forced_publisher: str,
    forced_series: str,
):
    """
    API'dan gelen verilerle metadata'daki eksik alanları tamamlar.
    Dosya adından veya kullanıcıdan gelen bilgiler asla ezilmez.

    Adım P8: API'dan doldurulan her alanın kaynağı _sources'a işaretlenir.
    api_data içindeki "_source_*" ipuçları varsa kullanılır; yoksa
    varsayılan olarak "google_books" kabul edilir (en yaygın API kaynağı).
    """
    sources = metadata.setdefault("_sources", {})

    # API verisinin hangi kaynaktan geldiğini belirlemeye yardımcı
    def api_source(field, default="google_books"):
        # api.py ileride "_source_series" gibi ipuçları eklerse onları kullan
        return api_data.get(f"_source_{field}", default)

    if api_data.get("year") and not metadata.get("year"):
        metadata["year"] = api_data["year"]
        sources["year"] = api_source("year")

    # Seri: forced yoksa ve dosya adında yoksa API'dan al
    if not forced_series and not metadata.get("series") and api_data.get("series"):
        metadata["series"] = api_data["series"]
        sources["series"] = api_source("series")

    # API series_order → metadata series_index olarak yaz
    # (uploader.py her ikisine de bakar: series_order or series_index)
    if api_data.get("series_order") and not metadata.get("series_index") and not metadata.get("series_order"):
        metadata["series_index"] = api_data["series_order"]
        sources["series_index"] = api_source("series")

    if api_data.get("description"):
        metadata["description"] = api_data["description"]

    if api_data.get("author_api") and not metadata.get("author"):
        metadata["author"] = api_data["author_api"]
        sources["author"] = api_source("author")

    # Yayınevi: forced veya dosya adından gelmediyse API'dan al
    if not forced_publisher and not metadata.get("publisher") and api_data.get("publisher"):
        metadata["publisher"] = api_data["publisher"]
        sources["publisher"] = api_source("publisher")

    if api_data.get("language") and not metadata.get("language"):
        metadata["language"] = api_data["language"]
        sources["language"] = api_source("language")


# ─────────────────────────────────────────────────────────────────────────────
# RAPORLAMA (Adım 12)
# ─────────────────────────────────────────────────────────────────────────────

def _print_summary(stats: dict, missing_tracker: dict):
    processed = stats["new"] + stats["error"]

    print("\n" + "=" * 55)
    print(f"✅ Yeni eklenen  : {stats['new']}")
    print(f"⏭  Atlanan       : {stats['skipped']}")
    print(f"❌ Hata          : {stats['error']}")
    print("-" * 55)

    if processed > 0:
        print("📊 EKSİK ALAN İSTATİSTİĞİ (yeni eklenenler):")
        fields_tr = {
            "title":     "Başlık bulunamayan  ",
            "author":    "Yazar bulunamayan   ",
            "publisher": "Yayınevi bulunamayan",
            "series":    "Seri bulunamayan    ",
            "year":      "Yıl bulunamayan     ",
            "language":  "Dil bulunamayan     ",
        }
        for field, label in fields_tr.items():
            count = len(missing_tracker[field])
            pct = int(count / processed * 100) if processed > 0 else 0
            bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
            print(f"  {label}: {count:3d} / {processed}  [{bar}] %{pct}")

    print("=" * 55)

    # ── Adım 8: Tarama özetini logla ────────────────────────────────────────
    # Burası "orta seviye" loglamanın ana noktası: her kitabın tek tek detayı
    # değil, ama taramanın genel sonucu kalıcı olarak kaydedilir.
    log.info(
        f"Tarama tamamlandı — Yeni: {stats['new']}, "
        f"Atlanan: {stats['skipped']}, Hata: {stats['error']}"
    )
    if stats["error"] > 0:
        log.warning(f"Bu taramada {stats['error']} dosya hata ile sonuçlandı (detaylar yukarıda).")


def _write_csv_report(csv_path: str, missing_tracker: dict):
    file_issues = {}
    for field, paths in missing_tracker.items():
        for path in paths:
            if path not in file_issues:
                file_issues[path] = []
            file_issues[path].append(field)

    try:
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["Dosya Adı", "Dosya Yolu", "Eksik Alanlar"])
            for path, fields in sorted(file_issues.items()):
                writer.writerow([os.path.basename(path), path, ", ".join(fields)])
        print(f"\n📄 Eksik alan raporu kaydedildi: {csv_path}")
    except Exception as e:
        print(f"\n⚠️  CSV raporu yazılamadı: {e}")


def _print_verbose(metadata: dict, api_data: dict):
    api_fields = {"year", "series", "series_order", "description", "author", "publisher", "language"}
    field_labels = {
        "title":        "Başlık     ",
        "author":       "Yazar      ",
        "year":         "Yıl        ",
        "publisher":    "Yayınevi   ",
        "edition":      "Baskı      ",
        "language":     "Dil        ",
        "series":       "Seri       ",
        "series_index": "Seri Sırası",
        "isbn":         "ISBN       ",
    }
    print("  ┌─ Metadata Kaynakları ──────────────────────")
    for field, label in field_labels.items():
        value = metadata.get(field)
        if value:
            came_from_api = field in api_fields and api_data.get(
                field if field != "author" else "author_api"
            )
            source = "[api]   " if came_from_api else "[dosya] "
            print(f"  │ {label}: {source} {value}")
        else:
            print(f"  │ {label}: ⚠ EKSİK")
    print("  └────────────────────────────────────────────")


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