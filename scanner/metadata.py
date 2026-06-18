import os
import re
import zipfile
import ebooklib
from ebooklib import epub
import fitz  # PyMuPDF


# ─────────────────────────────────────────────────────────────────────────────
# Adım P6: OCR (taratılmış PDF'ler için) — opsiyonel motor tespiti
#
# İki motor desteklenir, öncelik sırasıyla denenir:
#   1) Tesseract (pytesseract)  — küçük, hızlı, ayrı program kurulumu gerektirir
#   2) EasyOCR                  — büyük, sadece pip, PATH'e dokunmaz
#
# Hiçbiri kurulu değilse OCR sessizce atlanır; program normal çalışmaya devam eder.
# Bu tespit modül yüklenirken bir kez yapılır (her dosyada tekrar denenmez).
# ─────────────────────────────────────────────────────────────────────────────

_OCR_ENGINE = None           # "tesseract" | "easyocr" | None
_OCR_LANGS = ("tur", "eng")  # Tesseract dil kodları (Türkçe + İngilizce)
_easyocr_reader = None        # EasyOCR okuyucusu (ilk kullanımda oluşturulur — ağır)


def _detect_ocr_engine() -> str:
    """
    Kurulu OCR motorunu tespit eder. Modül yüklenirken bir kez çağrılır.

    Dönüş:
      "tesseract" → pytesseract + Tesseract programı bulundu
      "easyocr"   → easyocr kütüphanesi bulundu
      None        → hiçbiri yok, OCR devre dışı
    """
    global _OCR_LANGS

    # 1) Tesseract dene
    try:
        import pytesseract
        # Tesseract programının gerçekten erişilebilir olduğunu doğrula
        pytesseract.get_tesseract_version()
        # Kurulu dil paketlerini öğren; istediğimiz dillerden sadece
        # mevcut olanları kullan (Türkçe paketi yoksa hata vermesin)
        try:
            available = set(pytesseract.get_languages(config=""))
            wanted = [lang for lang in ("tur", "eng") if lang in available]
            if wanted:
                _OCR_LANGS = tuple(wanted)
            else:
                # İstediğimiz dillerden hiçbiri yok ama Tesseract var —
                # yine de mevcut ne varsa onunla devam et (örn. sadece eng)
                _OCR_LANGS = tuple(available) if available else ("eng",)
        except Exception:
            # get_languages başarısız olursa varsayılana güven
            _OCR_LANGS = ("eng",)
        return "tesseract"
    except Exception:
        pass

    # 2) EasyOCR dene
    try:
        import easyocr  # noqa: F401
        return "easyocr"
    except Exception:
        pass

    return None


# Motoru bir kez tespit et
_OCR_ENGINE = _detect_ocr_engine()


def _get_easyocr_reader():
    """
    EasyOCR okuyucusunu ilk kullanımda oluşturur (lazy init).
    Model yükleme ağır olduğu için sadece gerçekten gerekince yapılır.
    """
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        # EasyOCR dil kodları Tesseract'tan farklı: tr, en
        _easyocr_reader = easyocr.Reader(["tr", "en"], gpu=False)
    return _easyocr_reader


def _ocr_image_bytes(png_bytes: bytes) -> str:
    """
    Verilen PNG görüntü baytlarından OCR ile metin çıkarır.
    Aktif motora göre Tesseract veya EasyOCR kullanır.
    Hata olursa boş string döner (asla çökmez).
    """
    if _OCR_ENGINE == "tesseract":
        try:
            import pytesseract
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(png_bytes))
            return pytesseract.image_to_string(img, lang="+".join(_OCR_LANGS))
        except Exception as e:
            print(f"  [OCR Tesseract hatası] {e}")
            return ""

    if _OCR_ENGINE == "easyocr":
        try:
            reader = _get_easyocr_reader()
            # EasyOCR doğrudan bayt dizisi kabul eder; detail=0 → sadece metin
            results = reader.readtext(png_bytes, detail=0, paragraph=True)
            return "\n".join(results)
        except Exception as e:
            print(f"  [OCR EasyOCR hatası] {e}")
            return ""

    return ""


def _ocr_pdf_pages(doc, max_pages: int = 3) -> str:
    """
    PDF'in ilk N sayfasını görüntüye çevirip OCR ile okur.

    Sadece taratılmış (metin katmanı olmayan) PDF'lerde çağrılır.
    Performans için varsayılan olarak yalnızca ilk 3 sayfa işlenir.

    Her sayfa 200 DPI çözünürlükte görüntüye dönüştürülür — OCR doğruluğu
    için yeterli, ama bellek/hız açısından makul bir denge.
    """
    if not _OCR_ENGINE:
        return ""

    texts = []
    limit = min(max_pages, len(doc))
    print(f"  → OCR çalışıyor ({_OCR_ENGINE}, ilk {limit} sayfa)...")

    for page_num in range(limit):
        try:
            page = doc[page_num]
            # Sayfayı 200 DPI görüntüye çevir (zoom ≈ 200/72)
            matrix = fitz.Matrix(200 / 72, 200 / 72)
            pixmap = page.get_pixmap(matrix=matrix)
            png_bytes = pixmap.tobytes("png")
            text = _ocr_image_bytes(png_bytes)
            if text:
                texts.append(text)
        except Exception as e:
            print(f"  [OCR sayfa {page_num + 1} hatası] {e}")

    return "\n".join(texts)


# ─────────────────────────────────────────────────────────────────────────────
# Adım P8: Metadata Güven Skoru (Confidence Scoring)
# ─────────────────────────────────────────────────────────────────────────────

# Her kaynağın güven yüzdesi (yol haritası tablosuna göre)
SOURCE_CONFIDENCE = {
    "isbn":          100,   # ISBN eşleşmesi — en kesin
    "user":           95,   # Kullanıcı girişi (--publisher / --series)
    "filename":       90,   # Dosya adı — kullanıcı düzenli tutuyor
    "epub":           85,   # EPUB içi metadata
    "google_books":   75,   # Google Books API
    "open_library":   70,   # Open Library API
    "hardcover":      70,   # Hardcover API
    "folder":         65,   # Klasör yapısı
    "pdf":            60,   # PDF metni (OCR dahil)
}

# Güven skoru hesaplanırken dikkate alınan ana alanlar ve ağırlıkları.
# Başlık ve yazar en önemli; dil/baskı daha az kritik.
CONFIDENCE_WEIGHTS = {
    "title":      3,
    "author":     3,
    "publisher":  2,
    "series":     2,
    "year":       1,
    "language":   1,
}


def compute_confidence(metadata: dict) -> tuple:
    """
    Adım P8: Kitabın metadata güven skorunu hesaplar.

    Mantık:
      - Her dolu alan için kaynağına göre bir güven yüzdesi alınır.
      - Alanlar ağırlıklarına göre (CONFIDENCE_WEIGHTS) ortalanır.
      - ISBN varsa genel skora küçük bir güven primi eklenir (maks 100).
      - Boş alanlar hesaba katılmaz (sadece dolu alanlar puanlanır).

    Dönüş:
      (score, source_map)
        score      → 0–100 arası tam sayı (genel güven yüzdesi)
        source_map → "title:filename, author:google_books, ..." biçiminde metin
                     (veritabanındaki metadata_source alanına yazılır)

    Hiç dolu alan yoksa (0, "") döner.
    """
    sources = metadata.get("_sources", {})

    weighted_sum = 0
    total_weight = 0
    source_parts = []

    for field, weight in CONFIDENCE_WEIGHTS.items():
        value = metadata.get(field)
        if value in (None, "", []):
            continue   # Boş alan — puanlamaya katılmaz

        source = sources.get(field, "pdf")   # Kaynağı bilinmiyorsa en düşük varsay
        confidence = SOURCE_CONFIDENCE.get(source, 60)

        weighted_sum += confidence * weight
        total_weight += weight
        source_parts.append(f"{field}:{source}")

    if total_weight == 0:
        return 0, ""

    score = weighted_sum / total_weight

    # ISBN ile doğrulanmış kayıtlara küçük güven primi
    if metadata.get("isbn") and sources.get("isbn") == "isbn":
        score = min(100, score + 5)

    # ISBN dosyadan okunmuşsa da hafif prim (ISBN varlığı güveni artırır)
    elif metadata.get("isbn"):
        score = min(100, score + 3)

    return int(round(score)), ", ".join(source_parts)


def extract_metadata(file_path: str, forced_publisher: str = None, use_folder_series: bool = True) -> dict:
    """
    Extract metadata from an ebook file.

    Öncelik sırası (arşiv mantığına göre):
      1) Dosya adı — kullanıcı tarafından düzenli tutulur, en güvenilir kaynak
      2) Dosya içi metadata (EPUB/PDF) — ISBN için özellikle değerli
      3) API (Google Books, Open Library, Hardcover) — dosya adında eksik kalanlar için

    forced_publisher: scan.py klasör yapısını analiz ederek kullanıcıya sorduktan
                      sonra belirlediği yayınevi adı. Bu değer varsa yayınevi
                      için dosya içine veya API'ya bakılmaz.
    use_folder_series: False → klasör adı seri olarak kullanılmaz (scan.py yönetir)
    """
    ext = os.path.splitext(file_path)[1].lower()
    metadata = {
        "title":        None,
        "author":       None,
        "year":         None,
        "publisher":    None,
        "language":     None,
        "series":       None,
        "series_index": None,
        "edition":      None,   # YENİ: baskı/edition bilgisi
        "isbn":         None,
        "format":       ext.lstrip("."),
        "file_path":    file_path,
        "file_size":    os.path.getsize(file_path),
    }

    # ── Adım P8: Kaynak takibi ───────────────────────────────────────────────
    # Her alanın hangi kaynaktan geldiğini kaydeder. Güven skoru bundan hesaplanır.
    # Olası kaynaklar: "filename", "user", "epub", "pdf", "folder",
    #                  "google_books", "open_library", "hardcover", "isbn"
    # (API kaynakları scan.py'de _merge_api_data sırasında işaretlenir.)
    sources = {}

    # ── 1. ÖNCELİK: Dosya adı parser ────────────────────────────────────────
    # Sizin arşiv formatınızı tanır:
    # "Yazar - Kitap Adı [Yayınevi] [X. Baskı] - Yıl.pdf"
    # "Seri Adı XX - Yazar - Kitap Adı [X. Baskı] - Yıl.pdf"
    parsed = _parse_filename(file_path)

    metadata["title"]        = parsed.get("title")
    metadata["author"]       = parsed.get("author")
    metadata["year"]         = parsed.get("year")
    metadata["edition"]      = parsed.get("edition")
    metadata["series"]       = parsed.get("series")
    metadata["series_index"] = parsed.get("series_index")

    # Dosya adından gelen alanları işaretle
    for field in ("title", "author", "year", "edition", "series", "series_index"):
        if parsed.get(field) is not None:
            sources[field] = "filename"

    # Yayınevi: forced_publisher varsa direkt kullan, yoksa dosya adından al
    if forced_publisher:
        metadata["publisher"] = forced_publisher
        sources["publisher"] = "user"   # Kullanıcı girişi — yüksek güven
    elif parsed.get("publisher"):
        metadata["publisher"] = parsed.get("publisher")
        sources["publisher"] = "filename"

    # ── 2. ÖNCELİK: Dosya içi metadata ──────────────────────────────────────
    # Dosya adında bulunamamış alanlar için dosya içine bak.
    # ISBN için her zaman dosya içine bak (dosya adında olmaz).
    if ext == ".epub":
        file_meta = _extract_epub_metadata(file_path)
        file_source = "epub"
    elif ext == ".pdf":
        file_meta = _extract_pdf_metadata(file_path)
        file_source = "pdf"
    else:
        file_meta = {}
        file_source = "pdf"

    # ISBN: dosya adında olmaz, her zaman dosya içinden al
    if file_meta.get("isbn"):
        metadata["isbn"] = file_meta["isbn"]
        sources["isbn"] = file_source

    # Başlık: dosya adından bulunamadıysa dosya içinden al
    if not metadata["title"] and file_meta.get("title"):
        metadata["title"] = file_meta["title"]
        sources["title"] = file_source

    # Yazar: dosya adından bulunamadıysa dosya içinden al
    if not metadata["author"] and file_meta.get("author"):
        metadata["author"] = file_meta["author"]
        sources["author"] = file_source

    # Yıl: dosya adından bulunamadıysa dosya içinden al
    if not metadata["year"] and file_meta.get("year"):
        metadata["year"] = file_meta["year"]
        sources["year"] = file_source

    # Yayınevi: forced veya dosya adından gelmemişse dosya içinden al
    if not metadata["publisher"] and file_meta.get("publisher"):
        metadata["publisher"] = file_meta["publisher"]
        sources["publisher"] = file_source

    # Dil: her zaman dosya içinden al (dosya adında olmaz)
    if file_meta.get("language"):
        metadata["language"] = file_meta["language"]
        sources["language"] = file_source

    # Seri: dosya adından bulunamadıysa dosya içinden al (Calibre/EPUB3)
    if not metadata["series"] and file_meta.get("series"):
        metadata["series"] = file_meta["series"]
        sources["series"] = file_source
    if metadata["series_index"] is None and file_meta.get("series_index") is not None:
        metadata["series_index"] = file_meta["series_index"]
        sources["series_index"] = file_source

    # Baskı: dosya adından bulunamadıysa dosya içinden al
    if not metadata["edition"] and file_meta.get("edition"):
        metadata["edition"] = file_meta["edition"]
        sources["edition"] = file_source

    # ── Klasör yapısından yazar bilgisi (seri scan.py tarafından yönetilir) ──
    folder_data = _parse_folder_structure(file_path)
    if not metadata["author"] and folder_data.get("author"):
        metadata["author"] = folder_data.get("author")
        sources["author"] = "folder"
    if use_folder_series and not metadata["series"] and folder_data.get("series"):
        metadata["series"] = folder_data.get("series")
        sources["series"] = "folder"

    # ── Yazar adı normalizasyonu ──────────────────────────────────────────────
    if metadata["author"]:
        metadata["author"] = _normalize_author(metadata["author"])

    # ── Yayınevi doğrulama (Adım 11) ─────────────────────────────────────────
    if metadata["publisher"]:
        if not _validate_publisher(metadata["publisher"]):
            metadata["publisher"] = None
            sources.pop("publisher", None)   # Geçersiz → kaynağı da sil

    # ── Adım P8: Kaynak sözlüğünü metadata'ya ekle ──────────────────────────
    # scan.py API verilerini ekledikten sonra _sources'ı günceller,
    # ardından compute_confidence() ile final skor hesaplanır.
    metadata["_sources"] = sources

    return metadata


# ─────────────────────────────────────────────────────────────────────────────
# 1. ÖNCELİK: DOSYA ADI PARSER
# Arşiv formatı: "Yazar - Kitap Adı [Yayınevi] [X. Baskı] - Yıl.pdf"
#                "Seri Adı XX - Yazar - Kitap Adı [X. Baskı] - Yıl.pdf"
# ─────────────────────────────────────────────────────────────────────────────

def _parse_filename(file_path: str) -> dict:
    """
    Dosya adını arşiv formatına göre parse eder.

    Desteklenen formatlar:
      A) Seri formatı (ilk parça sayıyla biter):
         "Biyografi Serisi 01 - Martin Gilbert - Churchill [2. Baskı] - 2013"
         → series="Biyografi Serisi", series_index=1, author="Martin Gilbert",
           title="Churchill", edition="2. Baskı", year=2013

      B) Standart format:
         "H. G. Wells - Açık Komplo [Anka Yayınları] [1. Baskı] - 2004"
         → author="H. G. Wells", title="Açık Komplo",
           publisher="Anka Yayınları", edition="1. Baskı", year=2004

      C) Yayınevi/baskı olmayan basit format:
         "H. G. Wells - Zaman Makinesi"
         → author="H. G. Wells", title="Zaman Makinesi"

    Köşeli parantez içleri:
      [Yayınevi] → publisher (yayınevi anahtar kelimesi varsa)
      [X. Baskı] veya [Xth Edition] → edition
      [2021] → year (sadece 4 haneli sayıysa)
    """
    result = {}
    filename = os.path.splitext(os.path.basename(file_path))[0]

    # ── Adım 1: Sondaki " - Yıl" bilgisini çıkar ─────────────────────────────
    # Örn: "... - 2004" veya "... - 2013"
    year_suffix = re.search(r'\s*-\s*(\d{4})\s*$', filename)
    if year_suffix:
        try:
            yr = int(year_suffix.group(1))
            if 1800 <= yr <= 2100:
                result["year"] = yr
        except ValueError:
            pass
        filename = filename[:year_suffix.start()].strip()

    # ── Adım 2: Köşeli parantez içlerini topla ve temizle ────────────────────
    # [Anka Yayınları], [2. Baskı], [1st Edition] gibi
    brackets = re.findall(r'\[([^\]]+)\]', filename)
    filename_clean = re.sub(r'\s*\[[^\]]*\]\s*', ' ', filename).strip()
    filename_clean = re.sub(r'\s+', ' ', filename_clean).strip()

    for bracket in brackets:
        bracket = bracket.strip()
        # Yıl mı? (sadece 4 haneli sayı)
        if re.match(r'^\d{4}$', bracket):
            try:
                yr = int(bracket)
                if 1800 <= yr <= 2100 and not result.get("year"):
                    result["year"] = yr
            except ValueError:
                pass
        # Baskı/edition mı?
        elif _is_edition(bracket):
            result["edition"] = bracket
        # Yayınevi mi?
        elif _is_publisher_string(bracket):
            result["publisher"] = bracket

    # ── Adım 3: Kalan metni " - " ile parçala ────────────────────────────────
    dash_parts = [p.strip() for p in filename_clean.split(" - ")]
    dash_parts = [p for p in dash_parts if p]  # boş parçaları at

    if not dash_parts:
        return result

    # ── Format A: Seri formatı (başında sayı+isim veya sadece sayı) ──────────
    # "Biyografi Serisi 01 - Yazar - Başlık" → seri adı + sıra
    # "002 - Yazar - Başlık"                 → sadece sıra (seri adı klasörden gelir)
    if len(dash_parts) >= 3:
        # İlk parça SADECE sayıysa: "002 - Yazar - Başlık"
        only_number = re.match(r'^(\d{1,3}(?:\.\d+)?)$', dash_parts[0].strip())
        if only_number:
            result["series_index"] = _to_series_index(only_number.group(1))
            result["author"]       = dash_parts[1].strip()
            result["title"]        = dash_parts[2].strip()
            return result

        # İlk parça "Seri Adı 01" gibi sayıyla bitiyorsa
        first_series = re.match(r'^(.+?)\s+(\d{1,3}(?:\.\d+)?)\s*$', dash_parts[0])
        if first_series:
            result["series"]       = first_series.group(1).strip()
            result["series_index"] = _to_series_index(first_series.group(2))
            result["author"]       = dash_parts[1].strip()
            result["title"]        = dash_parts[2].strip()
            return result

    # ── Format B & C: Yazar - Başlık ─────────────────────────────────────────
    if len(dash_parts) >= 2:
        result["author"] = dash_parts[0].strip()
        result["title"]  = dash_parts[1].strip()
        return result

    # ── Fallback: tek parça → başlık ─────────────────────────────────────────
    result["title"] = dash_parts[0].strip()
    return result


def _is_edition(text: str) -> bool:
    """
    Köşeli parantez içinin baskı/edition bilgisi olup olmadığını kontrol eder.
    Örn: "1. Baskı", "2. Basım", "3rd Edition", "Revised Edition", "4. Baskı"
    """
    edition_patterns = [
        r'^\d+[.\s]*(?:bask[ıi]|bask[ıi]m|basım|edition|ed\.?|bask)$',
        r'^(?:revised|updated|expanded|new|genişletilmiş|gözden\s+geçirilmiş)\s+(?:edition|bask[ıi])$',
        r'^\d+(?:st|nd|rd|th)\s+(?:edition|ed\.?)$',
        r'^(?:bask[ıi]|edition)\s*\d+$',
    ]
    text_lower = text.strip().lower()
    for pattern in edition_patterns:
        if re.match(pattern, text_lower, re.IGNORECASE):
            return True
    # "Baskı" veya "Edition" kelimesi geçiyor mu?
    if re.search(r'\bbask[ıi]\b|\bedition\b|\bbasım\b', text_lower):
        return True
    return False


def _is_publisher_string(text: str) -> bool:
    """
    Köşeli parantez içinin yayınevi adı olup olmadığını kontrol eder.
    Yayınevi anahtar kelimelerinden birini içeriyorsa True döner.
    """
    pub_keywords = [
        r'yay[ıi]nlar[ıi]', r'yay[ıi]nevi', r'yay[ıi]nc[ıi]l[ıi]k',
        r'press', r'publishers?', r'publishing', r'verlag',
        r'editions?', r'editore', r'editorial',
    ]
    text_lower = text.strip().lower()
    for kw in pub_keywords:
        if re.search(kw, text_lower):
            return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# 2. ÖNCELİK: EPUB DOSYASI İÇİ METADATA
# ─────────────────────────────────────────────────────────────────────────────

def _extract_epub_metadata(file_path: str) -> dict:
    result = {}
    try:
        book = epub.read_epub(file_path, options={"ignore_ncx": True})

        title = book.get_metadata("DC", "title")
        if title:
            result["title"] = title[0][0].strip()

        creator = book.get_metadata("DC", "creator")
        if creator:
            result["author"] = creator[0][0].strip()

        date = book.get_metadata("DC", "date")
        if date:
            raw = date[0][0]
            match = re.search(r"\d{4}", raw)
            if match:
                result["year"] = int(match.group())

        publisher = book.get_metadata("DC", "publisher")
        if publisher and publisher[0][0].strip():
            result["publisher"] = publisher[0][0].strip()

        language = book.get_metadata("DC", "language")
        if language and language[0][0].strip():
            lang_raw = language[0][0].strip().lower()
            result["language"] = lang_raw.split("-")[0]

        # ISBN — EPUB'da DC "identifier" alanında bulunur
        identifier = book.get_metadata("DC", "identifier")
        if identifier:
            for id_entry in identifier:
                isbn = _extract_isbn_from_string(id_entry[0])
                if isbn:
                    result["isbn"] = isbn
                    break

        # Adım P7: dc:subject alanından seri çıkarımı
        # Calibre/EPUB3'ten seri bulunamadıysa bu alana bakılacak.
        # (Calibre kontrolü aşağıda yapılıyor; burada ham değerleri saklıyoruz.)
        subject_entries = book.get_metadata("DC", "subject") or []
        result["_subjects_raw"] = [s[0].strip() for s in subject_entries if s[0].strip()]

    except Exception as e:
        print(f"  [EPUB metadata hatası] {file_path}: {e}")

    # Calibre + EPUB3 seri bilgisi (Adım 1)
    series, series_index = _extract_epub_series(file_path)
    if series:
        result["series"] = series
    if series_index is not None:
        result["series_index"] = series_index

    # Adım P7: Calibre/EPUB3'ten seri bulunamadıysa dc:subject'e bak
    if not result.get("series"):
        subjects = result.pop("_subjects_raw", [])
        series_from_subject = _extract_series_from_subjects(subjects)
        if series_from_subject:
            result["series"] = series_from_subject
            print(f"  [EPUB dc:subject] Seri bulundu: {series_from_subject}")
    else:
        result.pop("_subjects_raw", None)  # Seri zaten vardı, temizle

    return result


def _extract_epub_series(file_path: str):
    """
    EPUB dosyasının içindeki OPF manifest dosyasını doğrudan ZIP olarak açar
    ve şu iki seri standardını tarar:

    1) Calibre standardı:
       <meta name="calibre:series"       content="Vakıf Serisi"/>
       <meta name="calibre:series_index" content="1"/>

    2) EPUB3 standardı:
       <meta property="belongs-to-collection">Vakıf Serisi</meta>
       <meta property="group-position">1</meta>
    """
    series = None
    series_index = None

    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            opf_path = _find_opf_path(zf)
            if not opf_path:
                return None, None

            opf_content = zf.read(opf_path).decode("utf-8", errors="replace")

            cal_series_match = re.search(
                r'<meta[^>]+name=["\']calibre:series["\'][^>]+content=["\']([^"\']+)["\']',
                opf_content, re.IGNORECASE
            )
            if not cal_series_match:
                cal_series_match = re.search(
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']calibre:series["\']',
                    opf_content, re.IGNORECASE
                )
            if cal_series_match:
                series = cal_series_match.group(1).strip()

            cal_index_match = re.search(
                r'<meta[^>]+name=["\']calibre:series_index["\'][^>]+content=["\']([^"\']+)["\']',
                opf_content, re.IGNORECASE
            )
            if not cal_index_match:
                cal_index_match = re.search(
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']calibre:series_index["\']',
                    opf_content, re.IGNORECASE
                )
            if cal_index_match:
                try:
                    series_index = float(cal_index_match.group(1).strip())
                    if series_index == int(series_index):
                        series_index = int(series_index)
                except ValueError:
                    pass

            if not series:
                epub3_series_match = re.search(
                    r'<meta[^>]+property=["\']belongs-to-collection["\'][^>]*>([^<]+)</meta>',
                    opf_content, re.IGNORECASE
                )
                if epub3_series_match:
                    series = epub3_series_match.group(1).strip()

            if series_index is None:
                epub3_index_match = re.search(
                    r'<meta[^>]+property=["\']group-position["\'][^>]*>([^<]+)</meta>',
                    opf_content, re.IGNORECASE
                )
                if epub3_index_match:
                    try:
                        series_index = float(epub3_index_match.group(1).strip())
                        if series_index == int(series_index):
                            series_index = int(series_index)
                    except ValueError:
                        pass

    except Exception as e:
        print(f"  [EPUB seri okuma hatası] {file_path}: {e}")

    return series, series_index


def _extract_series_from_subjects(subjects: list) -> str | None:
    """
    Adım P7: dc:subject listesinden seri adını çıkarmaya çalışır.

    Bazı EPUB'larda seri bilgisi Calibre/EPUB3 standardı yerine dc:subject
    alanına yazılır. Örn:
      <dc:subject>Vakıf Serisi</dc:subject>
      <dc:subject>Dune Saga</dc:subject>
      <dc:subject>The Lord of the Rings Trilogy</dc:subject>

    Filtreleme mantığı (yanlış eşleşmeleri önlemek için):
      ✓ "Serisi", "Saga", "Series", "Trilogy", "Cycle", "Chronicles",
        "Sequence", "Saga", "Koleksiyon" gibi seri belirteçleri içeriyorsa
        → seri adayı olarak değerlendir
      ✗ Tek kelimeyse (örn. "Roman", "Tarih", "Fiction") → konu, seri değil
      ✗ Çok uzunsa (>80 karakter) → açıklama satırı, seri değil
      ✗ Sayısal ise ya da yıl içeriyorsa → seri değil

    Birden fazla aday varsa ilki alınır (en spesifik genellikle ilk gelir).
    Hiçbiri uygun değilse None döner.

    Dönüş:
      str  → bulunan seri adı
      None → bu listede seri yok
    """
    if not subjects:
        return None

    # Seri olduğuna kuvvetle işaret eden anahtar kelimeler
    series_markers = re.compile(
        r'\b(?:'
        r'seri(?:si|ler)?|saga|series|trilogy|tetralogy|pentalogy|hexalogy|'
        r'cycle|chronicles?|sequence|koleksiyon|dizi|collection'
        r')\b',
        re.IGNORECASE,
    )

    # Bunlar varsa seri değil, konu/tür bilgisidir
    topic_markers = re.compile(
        r'\b(?:'
        r'roman|fiction|kurgu|novel|history|tarih|biyografi|biography|'
        r'science|bilim|felsefe|philosophy|psikoloji|psychology|'
        r'polisiye|mystery|thriller|horror|korku|fantasy|fantastik|'
        r'poetry|şiir|children|çocuk|young adult|gençlik|classic|klasik'
        r')\b',
        re.IGNORECASE,
    )

    for subject in subjects:
        s = subject.strip()

        # Çok kısa veya çok uzunsa atla
        if len(s) < 3 or len(s) > 80:
            continue

        # Tek kelimeyse büyük ihtimalle tür bilgisidir
        if len(s.split()) == 1:
            continue

        # Yıl içeriyorsa konu satırı olabilir (örn. "2001 Baskı")
        if re.search(r'\b(19|20)\d{2}\b', s):
            continue

        # Sadece sayı veya noktalama içeriyorsa atla
        if not any(c.isalpha() for c in s):
            continue

        # Konu/tür belirteçleri varsa ve seri belirteci YOKSA atla
        is_series = bool(series_markers.search(s))
        is_topic  = bool(topic_markers.search(s))

        if is_series and not is_topic:
            return s
        if is_series and is_topic:
            # İkisi bir arada varsa temkinli davran — seri adayı olarak işaretle
            # ama diğer adaylar yoksa yine de döndür
            continue

    # İkinci geçiş: seri belirteci olmayan ama tür de olmayan
    # çok kelimeli adayları son çare olarak değerlendir
    # (örn. "The Dune Chronicles" — Chronicles seri_markers'da var, yukarıda yakalanmalıydı)
    # Bu blok normalde boş döner; yedek güvenlik katmanı
    return None
    """EPUB ZIP içindeki OPF manifest dosyasının yolunu bulur."""
    try:
        container = zf.read("META-INF/container.xml").decode("utf-8", errors="replace")
        match = re.search(r'full-path=["\']([^"\']+\.opf)["\']', container, re.IGNORECASE)
        if match:
            return match.group(1)
    except Exception:
        pass
    for name in zf.namelist():
        if name.endswith(".opf"):
            return name
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 2. ÖNCELİK: PDF DOSYASI İÇİ METADATA
# ─────────────────────────────────────────────────────────────────────────────

def _extract_pdf_metadata(file_path: str) -> dict:
    result = {}
    try:
        doc = fitz.open(file_path)
        meta = doc.metadata

        if meta.get("title") and meta["title"].strip():
            result["title"] = meta["title"].strip()

        if meta.get("author") and meta["author"].strip():
            result["author"] = meta["author"].strip()

        if meta.get("creationDate"):
            match = re.search(r"\d{4}", meta["creationDate"])
            if match:
                result["year"] = int(match.group())

        producer = meta.get("producer", "").strip()
        if producer and not _is_software_name(producer):
            result["publisher"] = producer

        # İlk 5 sayfanın metnini tek seferde oku
        page_text = _extract_pdf_page_text(doc, max_pages=5)

        # ISBN
        if not result.get("isbn"):
            isbn = _extract_isbn_from_string(page_text)
            if isbn:
                result["isbn"] = isbn

        # Yayınevi (dosya adında bulunamadıysa)
        if not result.get("publisher"):
            publisher = _extract_publisher_from_text(page_text)
            if publisher:
                result["publisher"] = publisher

        # Seri
        series, series_index = _extract_series_from_text(page_text)
        if series:
            result["series"] = series
        if series_index is not None:
            result["series_index"] = series_index

        # Baskı (dosya adında bulunamadıysa sayfa metninden ara)
        edition = _extract_edition_from_text(page_text)
        if edition:
            result["edition"] = edition

        doc.close()
    except Exception as e:
        print(f"  [PDF metadata hatası] {file_path}: {e}")

    return result


def _extract_pdf_page_text(doc, max_pages: int = 5) -> str:
    """
    PDF belgesinin ilk N sayfasının tüm metnini birleştirip döndürür.

    Adım P6 değişikliği:
      Önce normal yöntem (get_text) denenir. Eğer toplam metin neredeyse boşsa
      (taratılmış PDF işareti), OCR devreye girer ve sayfalar görüntüden okunur.
      OCR motoru kurulu değilse bu adım sessizce atlanır.
    """
    texts = []
    limit = min(max_pages, len(doc))
    for page_num in range(limit):
        texts.append(doc[page_num].get_text())
    combined = "\n".join(texts)

    # Adım P6: Metin katmanı yok veya çok az → taratılmış PDF olabilir, OCR dene
    # Eşik: harf/rakam sayısı 20'nin altındaysa "boş" kabul edilir
    meaningful_chars = len(re.sub(r'\s', '', combined))
    if meaningful_chars < 20 and _OCR_ENGINE:
        ocr_text = _ocr_pdf_pages(doc, max_pages=3)
        if ocr_text and len(re.sub(r'\s', '', ocr_text)) > meaningful_chars:
            return ocr_text

    return combined


def _extract_isbn_from_pdf(doc) -> str:
    """Geriye dönük uyumluluk için korunmuştur. _extract_pdf_page_text kullanın."""
    max_pages = min(5, len(doc))
    for page_num in range(max_pages):
        text = doc[page_num].get_text()
        isbn = _extract_isbn_from_string(text)
        if isbn:
            return isbn
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PDF SAYFA METNİ MADENCİLİĞİ (Adım 6)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_publisher_from_text(text: str) -> str:
    """PDF sayfa metninden yayınevi adını çıkarır."""
    if not text:
        return None

    publisher_keywords = re.compile(
        r'yay[ıi]nlar[ıi]|yay[ıi]nevi|yay[ıi]nc[ıi]l[ıi]k|press|publishers|publishing',
        re.IGNORECASE
    )
    edition_markers = re.compile(
        r'\b(?:bas[ıi]m|bask[ıi]|edition|printing|print|january|february|march|april|'
        r'may|june|july|august|september|october|november|december|'
        r'ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b',
        re.IGNORECASE
    )

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if not publisher_keywords.search(line):
            continue
        if edition_markers.search(line):
            continue
        if _is_software_name(line):
            continue
        if 3 <= len(line) <= 80:
            return _clean_publisher(line)

    labeled = re.search(
        r'(?:yay[ıi]nevi|publisher|published\s+by)\s*[:\-]?\s*([^\n\r,;]{3,60})',
        text, re.IGNORECASE
    )
    if labeled:
        candidate = labeled.group(1).strip()
        if candidate and not _is_software_name(candidate) and not edition_markers.search(candidate):
            return _clean_publisher(candidate)

    return None


def _clean_publisher(text: str) -> str:
    """Yayınevi adından gereksiz ekleri temizler."""
    text = re.sub(r'^[©®™\s]+', '', text).strip()
    text = re.sub(r'^\d{4}[\s,]+', '', text).strip()
    text = re.sub(r'[\s,]+\d{4}\s*$', '', text).strip()
    text = re.sub(r'[\.,;:\)\]]+$', '', text).strip()
    if len(text) > 80:
        text = text[:80].rsplit(' ', 1)[0]
    return text


def _extract_series_from_text(text: str):
    """PDF sayfa metninden seri adı ve seri sırası çıkarır."""
    if not text:
        return None, None

    series = None
    series_index = None

    match = re.search(
        r'(?:seri|series|koleksiyon|collection)\s*[:\-]\s*([^\n\r,;]{2,80})',
        text, re.IGNORECASE
    )
    if match:
        raw = match.group(1).strip()
        num_match = re.search(r'^(.+?)\s*[#nN°]\s*(\d+(?:\.\d+)?)\s*$', raw)
        if num_match:
            series = num_match.group(1).strip()
            series_index = _to_series_index(num_match.group(2))
        else:
            series = raw

    return series, series_index


def _extract_edition_from_text(text: str) -> str:
    """
    PDF sayfa metninden baskı/edition bilgisini çıkarır.
    Dosya adında bulunamayan baskı bilgisi için kullanılır.

    Aranan kalıplar:
      "1. Baskı", "2. Basım", "3rd Edition", "Second Edition"
    """
    if not text:
        return None

    # "X. Baskı" veya "Xth Edition" kalıpları
    patterns = [
        r'(\d+[.\s]*(?:bask[ıi]|bas[ıi]m))',
        r'(\d+(?:st|nd|rd|th)\s+edition)',
        r'((?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition)',
        r'((?:revised|updated|expanded)\s+edition)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


# ─────────────────────────────────────────────────────────────────────────────
# YARDIMCI FONKSİYONLAR
# ─────────────────────────────────────────────────────────────────────────────

def _isbn13_checksum_valid(digits: str) -> bool:
    """
    Adım P5: ISBN-13 checksum (kontrol hanesi) doğrulaması.

    ISBN-13 algoritması:
      - İlk 12 hanenin her biri sırayla 1 ve 3 ile çarpılır.
      - Çarpımlar toplanır.
      - Toplam 10'a bölünür, kalan 10'dan çıkarılır.
      - Sonuç 10 ise 0 alınır.
      - Bu değer 13. hane (kontrol hanesi) ile eşleşmeli.

    Örnek: "9786053327820"
      9×1 + 7×3 + 8×1 + 6×3 + 0×1 + 5×3 + 3×1 + 3×3 + 2×1 + 7×3 + 8×1 + 2×3
      = 9 + 21 + 8 + 18 + 0 + 15 + 3 + 9 + 2 + 21 + 8 + 6 = 120
      120 % 10 = 0  →  (10 - 0) % 10 = 0  ✓ (kontrol hanesi 0)
    """
    if len(digits) != 13 or not digits.isdigit():
        return False
    total = sum(
        int(d) * (1 if i % 2 == 0 else 3)
        for i, d in enumerate(digits[:12])
    )
    check = (10 - (total % 10)) % 10
    return check == int(digits[12])


def _extract_isbn_from_string(text: str) -> str:
    """
    Verilen metin içinden geçerli bir ISBN-13 numarası çıkarır.

    Adım P5 değişikliği:
      Bulunan her aday ISBN-13 numarası artık checksum doğrulamasından
      geçirilir. Matematiksel olarak geçersiz (bozuk/yanlış yazılmış)
      ISBN'ler API'ya gönderilmeden elenir.

    Öncelik sırası:
      1) "ISBN: 978..." gibi etiketli ifadeler (en güvenilir)
      2) Metin içinde serbest geçen 978/979 ile başlayan sayılar
    """
    if not text:
        return None

    # 1) Etiketli ISBN ifadeleri
    labeled = re.findall(
        r'ISBN[\s\-:]*((?:978|979)[\d\-\s]{10,17})',
        text, re.IGNORECASE
    )
    for raw in labeled:
        digits = re.sub(r'[\s\-]', '', raw)
        if len(digits) == 13 and digits.isdigit():
            if _isbn13_checksum_valid(digits):
                return digits

    # 2) Serbest ISBN
    free = re.findall(r'\b((?:978|979)[\d\-]{10,16})\b', text)
    for raw in free:
        digits = re.sub(r'[\s\-]', '', raw)
        if len(digits) == 13 and digits.isdigit():
            if _isbn13_checksum_valid(digits):
                return digits

    return None


def _is_software_name(text: str) -> bool:
    """PDF producer alanı veya yayınevi adının yazılım adı içerip içermediğini kontrol eder."""
    software_keywords = [
        "adobe", "acrobat", "word", "office", "libreoffice", "openoffice",
        "ghostscript", "pdfmaker", "pdftk", "itext", "fpdf", "reportlab",
        "calibre", "kindlegen", "latex", "tex", "quark", "indesign",
        "scribus", "wkhtmltopdf", "chrome", "webkit", "prince",
    ]
    lower = text.lower()
    return any(kw in lower for kw in software_keywords)


def _normalize_author(author: str) -> str:
    """
    Yazar adı normalizasyonu (Adım 9).
    "Soyadı, Ad" → "Ad Soyadı", editör ekleri temizlenir.
    """
    if not author or not author.strip():
        return author

    cleaned = re.sub(r'\s*\(.*?\)\s*$', '', author.strip()).strip()

    try:
        from nameparser import HumanName
        n = HumanName(cleaned)
        parts = [n.first, n.middle, n.last]
        result = " ".join(p for p in parts if p).strip()
        if result:
            return re.sub(r'\s+', ' ', result)
    except ImportError:
        pass

    match = re.match(r"^([^,]+),\s*(.+)$", cleaned)
    if match:
        last = match.group(1).strip()
        first = match.group(2).strip()
        return f"{first} {last}"

    return cleaned


def _to_series_index(raw: str):
    """'03', '1', '2.5' gibi stringleri uygun sayısal tipe çevirir."""
    try:
        val = float(raw)
        return int(val) if val == int(val) else val
    except (ValueError, TypeError):
        return None


def _parse_folder_structure(file_path: str) -> dict:
    """
    Klasör yapısından yazar ve seri bilgisi çıkarır.
    Yayınevi adı içeren klasörler scan.py tarafından yönetilir (kullanıcıya sorulur).
    """
    result = {}
    parts = os.path.normpath(file_path).split(os.sep)

    if len(parts) >= 2:
        parent = parts[-2]
        if not _is_generic_folder(parent) and not _is_publisher_string(parent):
            result["series"] = parent

    if len(parts) >= 3:
        grandparent = parts[-3]
        if not _is_generic_folder(grandparent) and not _is_publisher_string(grandparent):
            result["author"] = grandparent

    return result


def _is_generic_folder(name: str) -> bool:
    """Genel/anlamsız klasör adlarını filtreler. Sayı ekli olanları da yakalar."""
    generic = {
        "downloads", "indir", "kitaplar", "books", "ebooks", "e-books",
        "epub", "pdf", "documents", "belgeler", "desktop", "masaüstü",
        "library", "kütüphane", "my documents", "my books", "test",
        "temp", "tmp", "new folder", "yeni klasör", "misc", "other",
        "çeşitli", "karışık", "collection", "koleksiyon", "arşiv", "arsiv",
        "arsivim", "arşivim",
    }
    cleaned = name.strip().lower()
    if cleaned in generic:
        return True
    base = re.sub(r'\d+$', '', cleaned).strip()
    if base in generic:
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 11: Yayınevi Doğrulama Katmanı
# ─────────────────────────────────────────────────────────────────────────────

def _load_publisher_whitelist() -> dict:
    """publisher_whitelist.json dosyasını yükler. Cache'e alır."""
    import json
    global _publisher_whitelist_cache
    if _publisher_whitelist_cache is not None:
        return _publisher_whitelist_cache

    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "publisher_whitelist.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            _publisher_whitelist_cache = json.load(f)
    except Exception:
        _publisher_whitelist_cache = {}

    return _publisher_whitelist_cache


_publisher_whitelist_cache = None


def _validate_publisher(publisher: str) -> bool:
    """Verilen yayınevi adının geçerli olup olmadığını doğrular."""
    if not publisher or not publisher.strip():
        return False

    pub = publisher.strip()

    if len(pub) < 2 or len(pub) > 100:
        return False

    if not any(c.isalpha() for c in pub):
        return False

    wl = _load_publisher_whitelist()
    pub_lower = pub.lower()

    reject_keywords = wl.get("keywords_reject", [])
    if pub_lower in [r.lower() for r in reject_keywords]:
        return False
    for rk in reject_keywords:
        if rk.lower() in pub_lower and len(rk) > 4:
            return False

    if _is_software_name(pub):
        return False

    all_known = (
        [p.lower() for p in wl.get("turkish", [])] +
        [p.lower() for p in wl.get("international", [])]
    )
    if pub_lower in all_known:
        return True

    for known in all_known:
        if known in pub_lower or pub_lower in known:
            return True

    accept_keywords = wl.get("keywords_accept", [])
    for kw in accept_keywords:
        if kw.lower() in pub_lower:
            return True

    words = pub.split()
    if len(words) >= 2 and len(pub) >= 4:
        return True

    return False