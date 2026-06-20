import os
import re
import requests
import time
from dotenv import load_dotenv

# ── Adım P1: tenacity ile retry mekanizması ──────────────────────────────────
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
import logging

# Sadece retry uyarılarını görmek için minimal logger
logging.basicConfig(level=logging.WARNING)
_log = logging.getLogger("api_retry")

# .env dosyasını yükle — api.py doğrudan çalıştırıldığında da key okunur
load_dotenv()

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_URL  = "https://openlibrary.org/search.json"   # Adım 8
HARDCOVER_URL     = "https://api.hardcover.app/v1/graphql"  # YENİ — Adım 10
REQUEST_DELAY = 1.0  # seconds between requests


# ─────────────────────────────────────────────────────────────────────────────
# Adım P1: Retry yardımcıları
# ─────────────────────────────────────────────────────────────────────────────

class _RateLimitError(Exception):
    """429 Too Many Requests için özel hata — farklı bekleme süresi uygular."""
    def __init__(self, retry_after: int = 10):
        self.retry_after = retry_after
        super().__init__(f"Rate limit aşıldı, {retry_after}s bekleniyor.")


def _handle_response(response: requests.Response) -> requests.Response:
    """
    API yanıtını inceler:
      - 429 → _RateLimitError (Retry-After başlığına saygı gösterir)
      - Diğer HTTP hataları → requests.HTTPError
      - Başarılı → response nesnesini döner
    """
    if response.status_code == 429:
        retry_after = int(response.headers.get("Retry-After", 10))
        print(f"  [API] ⚠ Rate limit (429) — {retry_after}s bekleniyor...")
        raise _RateLimitError(retry_after=retry_after)
    response.raise_for_status()
    return response


def _retry_on_rate_limit(retry_state):
    """
    429 hatası alındığında Retry-After süresini bekler.
    tenacity'nin wait mekanizmasına ek olarak çalışır.
    """
    exc = retry_state.outcome.exception()
    if isinstance(exc, _RateLimitError):
        time.sleep(exc.retry_after)


# Ağ ve sunucu hatalarına karşı retry dekoratörü
# 3 deneme, 2s → 4s → 8s artan bekleme, yalnızca bağlantı/timeout hatalarında
_network_retry = retry(
    retry=retry_if_exception_type((
        requests.exceptions.ConnectionError,
        requests.exceptions.Timeout,
        requests.exceptions.ChunkedEncodingError,
    )),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(_log, logging.WARNING),
    reraise=True,
)

# Rate limit (429) hatalarına karşı retry dekoratörü
# 3 deneme, Retry-After başlığına saygı gösterir
_rate_limit_retry = retry(
    retry=retry_if_exception_type(_RateLimitError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=5, max=60),
    before_sleep=_retry_on_rate_limit,
    reraise=True,
)


def _get_hardcover_token() -> str:
    """Hardcover API tokenini .env'den oku. Yoksa boş string döner (adım atlanır)."""
    return os.getenv("HARDCOVER_API_TOKEN", "")


def _get_api_key() -> str:
    """Her sorguda güncel API key'i oku. load_dotenv sonrası garantili çalışır."""
    return os.getenv("GOOGLE_API_KEY", "")


def enrich_metadata(title: str, author: str = None, isbn: str = None) -> dict:
    """
    Kitap bilgilerini önce Google Books, eksik kalırsa Open Library ile zenginleştirir.

    Öncelik sırası:
      1) ISBN varsa → Google Books'a doğrudan ISBN sorgusu (en kesin sonuç)
      2) ISBN yoksa → Google Books'a başlık + yazar sorgusu, 5 sonuç al, en iyisini seç
      3) YENİ (Adım 8): Google'dan yayınevi veya seri gelmezse → Open Library'ye fallback
    """
    if isbn:
        print(f"  [API] ISBN ile sorgu: {isbn}")
        result = _query_google_books_by_isbn(isbn)
        if result:
            time.sleep(REQUEST_DELAY)
            # YENİ (Adım 8): ISBN ile bulundu ama yayınevi veya seri eksikse OL'ye bak
            if not result.get("publisher") or not result.get("series"):
                ol_data = _query_open_library(title=title, author=author, isbn=isbn)
                if ol_data.get("publisher") and not result.get("publisher"):
                    result["publisher"] = ol_data["publisher"]
                    print(f"  [Open Library] Yayınevi tamamlandı: {ol_data['publisher']}")
                if ol_data.get("series") and not result.get("series"):
                    result["series"] = ol_data["series"]
                    print(f"  [Open Library] Seri tamamlandı: {ol_data['series']}")
            # YENİ (Adım 10): Seri hâlâ boşsa Hardcover'a sor
            if not result.get("series"):
                hc_data = _query_hardcover(title=title, author=author)
                if hc_data.get("series"):
                    result["series"] = hc_data["series"]
                    if hc_data.get("series_order") and not result.get("series_order"):
                        result["series_order"] = hc_data["series_order"]
                    print(f"  [Hardcover] Seri tamamlandı: {hc_data['series']}")
            return result
        print(f"  [API] ISBN sorgusu sonuç vermedi, başlık/yazar ile deneniyor...")

    if not title:
        return {}

    query = _build_query(title, author)
    result = _query_google_books(query, title=title, author=author)
    time.sleep(REQUEST_DELAY)

    # YENİ (Adım 8): Google'dan yayınevi veya seri gelmezse Open Library'ye fallback
    if not result.get("publisher") or not result.get("series"):
        print(f"  [API] Google eksik döndü, Open Library deneniyor...")
        ol_data = _query_open_library(title=title, author=author)
        if ol_data.get("publisher") and not result.get("publisher"):
            result["publisher"] = ol_data["publisher"]
            print(f"  [Open Library] Yayınevi tamamlandı: {ol_data['publisher']}")
        if ol_data.get("series") and not result.get("series"):
            result["series"] = ol_data["series"]
            print(f"  [Open Library] Seri tamamlandı: {ol_data['series']}")

    # YENİ (Adım 10): Seri hâlâ boşsa Hardcover'a sor (zincirin en sonu)
    if not result.get("series"):
        hc_data = _query_hardcover(title=title, author=author)
        if hc_data.get("series"):
            result["series"] = hc_data["series"]
            if hc_data.get("series_order") and not result.get("series_order"):
                result["series_order"] = hc_data["series_order"]
            print(f"  [Hardcover] Seri tamamlandı: {hc_data['series']}")

    return result


# ─────────────────────────────────────────────────────────────────────────────
# ISBN ile doğrudan sorgulama (Adım 2 — değişmedi)
# ─────────────────────────────────────────────────────────────────────────────

def _query_google_books_by_isbn(isbn: str) -> dict:
    """
    Google Books'a ISBN numarasıyla doğrudan sorgu atar.
    ISBN eşleşmesi zaten kesin olduğundan skorlama gerekmez, ilk sonuç alınır.
    Adım P1: Ağ hataları ve rate limit için retry mekanizması eklendi.
    """
    @_network_retry
    @_rate_limit_retry
    def _do_request():
        params = {
            "q": f"isbn:{isbn}",
            "maxResults": 1,
            "fields": "items(volumeInfo(title,authors,publishedDate,description,seriesInfo,imageLinks,publisher,language,industryIdentifiers))",
        }
        api_key = _get_api_key()
        if api_key:
            params["key"] = api_key
        response = requests.get(GOOGLE_BOOKS_URL, params=params, timeout=10)
        return _handle_response(response)

    try:
        response = _do_request()
        data = response.json()
        items = data.get("items")
        if not items:
            return {}
        volume_info = items[0].get("volumeInfo", {})
        return _parse_volume_info(volume_info)

    except _RateLimitError as e:
        print(f"  [Google Books ISBN] ✗ Rate limit aşıldı, 3 denemede de başarısız: {e}")
        return {}
    except requests.exceptions.RequestException as e:
        print(f"  [Google Books ISBN sorgu hatası] {e}")
        return {}
    except Exception as e:
        print(f"  [Google Books ISBN parse hatası] {e}")
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Başlık + Yazar ile sorgulama — YENİ (Adım 3): 5 sonuç al, en iyisini seç
# ─────────────────────────────────────────────────────────────────────────────

def _clean_query(text: str) -> str:
    """
    YENİ (Adım 7): Sorgu metnini Google Books'a göndermeden önce temizler.

    Temizlenenler:
      1) Dosya uzantıları: .pdf, .epub, .mobi vb.
      2) Parantez/köşeli parantez içi açıklamalar: (Özel Baskı), [2021]
      3) Stop-word listesi: indir, oku, full, hd, ekitap vb.
      4) Özel karakterler: _ . – — / \\
      5) Fazladan boşluklar

    Örn: "Dune_Herbert_indir_pdf_full" → "Dune Herbert"
    Örn: "Vakıf [İthaki] (Özel Baskı)"  → "Vakıf"
    """
    if not text:
        return text

    # 1) Dosya uzantılarını kaldır
    text = re.sub(r'\.(pdf|epub|mobi|azw\d?|djvu|cbz|cbr|fb2)\b', ' ', text, flags=re.IGNORECASE)

    # 2) Parantez ve köşeli parantez içini kaldır
    text = re.sub(r'\([^)]*\)', ' ', text)
    text = re.sub(r'\[[^\]]*\]', ' ', text)

    # 3) Özel karakterleri boşluğa çevir — stop-word filtresinden ÖNCE yapılmalı
    #    "indir_pdf_full" → "indir pdf full" olur, sonra her kelime ayrı elenebilir
    text = re.sub(r'[_.\-–—/\\]', ' ', text)

    # 4) Stop-word listesi (Türkçe + İngilizce)
    stop_words = {
        "pdf", "epub", "mobi", "indir", "download", "oku", "read",
        "ekitap", "e-kitap", "ebook", "e-book", "full", "hd", "hq",
        "baski", "baskı", "edition", "revised", "updated", "version",
        "zlibrary", "z-library", "zlib", "libgen", "kitap",
        # Tire boşluğa çevrilince oluşan parçalar da elensin
        "z", "library", "lib",
    }
    words = text.split()
    words = [w for w in words if w.lower().strip(".,;:-_") not in stop_words]
    text = " ".join(words)

    # 5) Fazladan boşlukları temizle
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def _build_query(title: str, author: str = None) -> str:
    # YENİ (Adım 7): Başlık ve yazar sorguya gitmeden önce temizleniyor
    clean_title = _clean_query(title)
    query = f'intitle:"{clean_title}"'
    if author:
        clean_author = _clean_query(author.split(",")[0].strip())
        query += f' inauthor:"{clean_author}"'
    return query


def _query_google_books(query: str, title: str = None, author: str = None) -> dict:
    """
    Google Books'a sorgu atar, 5 sonuç alır ve en iyi eşleşeni seçer.

    Adım 3 değişikliği:
      - maxResults: 1 → 5
      - Gelen her sonuç _score_volume() ile puanlanır
      - En yüksek puanlı sonuç parse edilir
      - Eşit puan varsa Google'ın sıraladığı ilk tercih edilir

    Adım P1 değişikliği:
      - Ağ hataları ve rate limit için retry mekanizması eklendi
    """
    @_network_retry
    @_rate_limit_retry
    def _do_request():
        params = {
            "q": query,
            "maxResults": 5,   # YENİ: 1 yerine 5 sonuç
            "fields": "items(volumeInfo(title,authors,publishedDate,description,seriesInfo,imageLinks,publisher,language,industryIdentifiers))",
        }
        api_key = _get_api_key()
        if api_key:
            params["key"] = api_key
        response = requests.get(GOOGLE_BOOKS_URL, params=params, timeout=10)
        return _handle_response(response)

    try:
        response = _do_request()
        data = response.json()
        items = data.get("items")
        if not items:
            return {}

        # YENİ (Adım 3): 5 sonucu puanla, en iyisini seç
        best_item = _pick_best_item(items, title=title, author=author)
        volume_info = best_item.get("volumeInfo", {})
        return _parse_volume_info(volume_info)

    except _RateLimitError as e:
        print(f"  [Google Books] ✗ Rate limit aşıldı, 3 denemede de başarısız: {e}")
        return {}
    except requests.exceptions.RequestException as e:
        print(f"  [Google Books API hatası] {e}")
        return {}
    except Exception as e:
        print(f"  [Google Books parse hatası] {e}")
        return {}


def _pick_best_item(items: list, title: str = None, author: str = None) -> dict:
    """
    Google Books'tan gelen sonuçları puanlayarak en iyi eşleşeni döndürür.

    Puanlama kriterleri (toplam max ~100 puan):
      +50  Başlık tam eşleşme (büyük/küçük harf fark etmez)
      +30  Başlık kısmi eşleşme (aranan başlık, sonuçtaki başlığın içinde geçiyor)
      +20  Yazar eşleşme (soyadı veya tam ad)
      +10  publishedDate alanı dolu (güvenilirlik işareti)
      +10  publisher alanı dolu
       -20  Sonuç dili Türkçe kitap için İngilizce geldi (opsiyonel — şimdilik uygulanmıyor)

    Tüm sonuçlar 0 puan alırsa Google'ın ilk sıraladığı döner.
    """
    scored = []
    for item in items:
        info = item.get("volumeInfo", {})
        score = _score_volume(info, title=title, author=author)
        scored.append((score, item))

    # En yüksek puanlı sonucu seç; puan eşitse ilk sıradaki kazanır
    scored.sort(key=lambda x: x[0], reverse=True)

    best_score, best_item = scored[0]
    best_title = best_item.get("volumeInfo", {}).get("title", "?")
    print(f"  [API] {len(items)} sonuçtan seçildi (puan {best_score}): {best_title}")

    return best_item


def _score_volume(info: dict, title: str = None, author: str = None) -> int:
    """
    Tek bir Google Books sonucunu puanlar.
    Yüksek puan = daha iyi eşleşme.
    """
    score = 0

    result_title = info.get("title", "").strip().lower()
    result_authors = [a.lower() for a in info.get("authors", [])]

    # ── Başlık puanlaması ────────────────────────────────────────────────────
    if title:
        search_title = title.strip().lower()

        if search_title == result_title:
            score += 50   # Tam eşleşme — en güçlü sinyal
        elif search_title in result_title or result_title in search_title:
            score += 30   # Kısmi eşleşme — yine güçlü
        else:
            # Kelime bazlı kısmi eşleşme: başlıktaki kelimelerin kaçı örtüşüyor?
            search_words = set(search_title.split())
            result_words = set(result_title.split())
            common = search_words & result_words
            if search_words:
                overlap_ratio = len(common) / len(search_words)
                score += int(overlap_ratio * 20)  # Max +20

    # ── Yazar puanlaması ─────────────────────────────────────────────────────
    if author and result_authors:
        search_author = author.strip().lower()
        # Soyadı karşılaştırması: "Crawford" → "dorothy h. crawford" içinde var mı?
        search_lastname = search_author.split()[-1] if search_author.split() else ""

        for result_author in result_authors:
            if search_author == result_author:
                score += 20   # Tam yazar eşleşmesi
                break
            elif search_lastname and search_lastname in result_author:
                score += 10   # Soyadı eşleşmesi
                break

    # ── Veri kalitesi bonusları ──────────────────────────────────────────────
    if info.get("publishedDate"):
        score += 10   # Yayın tarihi varsa güvenilirlik artar
    if info.get("publisher"):
        score += 10   # Yayınevi varsa güvenilirlik artar

    return score


# ─────────────────────────────────────────────────────────────────────────────
# Ortak: API yanıtını parse etme (değişmedi)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_volume_info(info: dict) -> dict:
    result = {}

    published = info.get("publishedDate", "")
    if published and len(published) >= 4:
        try:
            result["year"] = int(published[:4])
        except ValueError:
            pass

    authors = info.get("authors")
    if authors:
        result["author_api"] = ", ".join(authors)

    series_info = info.get("seriesInfo", {})
    if series_info:
        book_series = series_info.get("bookSeries", [])
        if book_series:
            result["series"] = book_series[0].get("title")
            result["series_order"] = book_series[0].get("bookOrderNumber")

    description = info.get("description", "")
    if description:
        result["description"] = description[:500]

    image_links = info.get("imageLinks", {})
    cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if cover:
        result["cover_url_api"] = cover.replace("http://", "https://")

    publisher = info.get("publisher", "")
    if publisher and publisher.strip():
        result["publisher"] = publisher.strip()

    language = info.get("language", "")
    if language and language.strip():
        result["language"] = language.strip().lower()

    industry_identifiers = info.get("industryIdentifiers", [])
    for id_item in industry_identifiers:
        if id_item.get("type") in ("ISBN_13", "ISBN_10"):
            raw = re.sub(r'[\s\-]', '', id_item.get("identifier", ""))
            if raw.isdigit() and len(raw) in (10, 13):
                result["isbn_api"] = raw
                break

    return result


# ─────────────────────────────────────────────────────────────────────────────
# YENİ (Adım 8): Open Library API — Google Books fallback
# ─────────────────────────────────────────────────────────────────────────────

def _query_open_library(title: str = None, author: str = None, isbn: str = None) -> dict:
    """
    Open Library'ye sorgu atar ve eksik yayınevi / seri bilgisini tamamlar.

    Open Library (openlibrary.org):
      - Internet Archive tarafından işletilir
      - 36 milyondan fazla kitap kaydı içerir
      - API anahtarı gerektirmez
      - Türkçe kitaplar dahil geniş kapsamlıdır

    Sorgu önceliği:
      1) ISBN varsa → isbn: parametresiyle kesin eşleşme
      2) ISBN yoksa → title + author parametreleriyle arama, ilk sonuç alınır

    Döndürülen alanlar:
      - publisher: yazılım adı içermeyen ilk geçerli yayınevi
      - series:    varsa seri adı

    Bu fonksiyon yalnızca Google Books eksik döndüğünde çağrılır.

    Adım P1 değişikliği:
      - Ağ hataları ve rate limit için retry mekanizması eklendi
    """
    result = {}

    @_network_retry
    @_rate_limit_retry
    def _do_request(params):
        response = requests.get(OPEN_LIBRARY_URL, params=params, timeout=10)
        return _handle_response(response)

    try:
        params = {"limit": 1, "fields": "title,author_name,publisher,series,isbn"}

        if isbn:
            params["isbn"] = isbn
        elif title:
            params["title"] = _clean_query(title)
            if author:
                params["author"] = _clean_query(author.split(",")[0].strip())
        else:
            return {}

        response = _do_request(params)
        data = response.json()

        docs = data.get("docs", [])
        if not docs:
            return {}

        doc = docs[0]

        # Adım P4: Doğrulama için dönen başlık ve yazar bilgisini al
        returned_title  = doc.get("title", "")
        returned_authors = doc.get("author_name", [])
        returned_author  = returned_authors[0] if returned_authors else ""

        # Adım P4: Sonucu doğrula — başlık veya yazar uyuşmuyorsa reddet
        validation_probe = {
            "result_title":  returned_title,
            "result_author": returned_author,
        }
        if not _validate_result(
            validation_probe,
            search_title=title or "",
            search_author=author,
            source="Open Library",
        ):
            return {}

        # Yayınevi: liste halinde gelir, yazılım adı içermeyeni al
        publishers = doc.get("publisher", [])
        for pub in publishers:
            pub = pub.strip()
            if pub and not _is_software_name(pub) and len(pub) >= 3:
                result["publisher"] = pub
                break

        # Seri: liste halinde gelir, ilkini al
        series_list = doc.get("series", [])
        if series_list:
            result["series"] = series_list[0].strip()

        time.sleep(REQUEST_DELAY)

    except _RateLimitError as e:
        print(f"  [Open Library] ✗ Rate limit aşıldı, 3 denemede de başarısız: {e}")
    except requests.exceptions.RequestException as e:
        print(f"  [Open Library sorgu hatası] {e}")
    except Exception as e:
        print(f"  [Open Library parse hatası] {e}")

    return result


def _is_software_name(text: str) -> bool:
    """
    Yayınevi adı gibi görünen ama aslında yazılım adı olan değerleri filtreler.
    PDF producer alanı ve Open Library publisher listesi için kullanılır.
    """
    software_keywords = [
        "adobe", "acrobat", "word", "office", "libreoffice", "openoffice",
        "ghostscript", "pdfmaker", "pdftk", "itext", "fpdf", "reportlab",
        "calibre", "kindlegen", "latex", "tex", "quark", "indesign",
        "scribus", "wkhtmltopdf", "chrome", "webkit", "prince",
    ]
    lower = text.lower()
    return any(kw in lower for kw in software_keywords)


# ─────────────────────────────────────────────────────────────────────────────
# Adım P4: Open Library ve Hardcover sonuç doğrulama
# ─────────────────────────────────────────────────────────────────────────────

def _title_similarity(a: str, b: str) -> float:
    """
    İki başlık arasındaki kelime örtüşme oranını döndürür (0.0 – 1.0).

    Yöntem: her iki başlıktaki kelimelerin kesişimi / birleşimi (Jaccard).
    Büyük/küçük harf farkı gözetilmez. Tek harfli kelimeler (a, I vb.) atlanır.

    Örn:
      "Dune Messiah" ↔ "Dune"         → 1/2 = 0.50  ✓ (eşik tam geçiyor)
      "Foundation"   ↔ "Second Foundation" → 1/2 = 0.50  ✓
      "Dune"         ↔ "Harry Potter"  → 0/3 = 0.00  ✗ (reddedilir)
    """
    def words(text):
        return {w for w in re.sub(r'[^\w\s]', ' ', text.lower()).split() if len(w) > 1}

    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _validate_result(
    result: dict,
    search_title: str,
    search_author: str = None,
    source: str = "API",
) -> bool:
    """
    Adım P4: Open Library ve Hardcover'dan dönen sonucun aranan kitapla
    yeterince örtüşüp örtüşmediğini kontrol eder.

    Kontrol edilenler:
      1) Başlık benzerliği: Jaccard skoru < 0.40 ise reddet.
         (Google Books için bu eşik _score_volume'da zaten uygulanıyor.)
      2) Yazar soyadı: search_author verilmişse ve sonuçta yazar adı varsa,
         soyadı eşleşmiyorsa reddet.

    Sadece iki koşulun her ikisi de başarısız olduğunda reddedilir;
    biri geçerse kabul edilir (toleranslı yaklaşım).

    Dönüş:
      True  → sonuç güvenilir, kabul et
      False → sonuç şüpheli, reddet (boş dict döndür)
    """
    result_title  = result.get("result_title", "")   # API doğrulama için eklenen alan
    result_author = result.get("result_author", "")  # API doğrulama için eklenen alan

    # ── 1) Başlık benzerliği ─────────────────────────────────────────────────
    title_ok = True
    if search_title and result_title:
        sim = _title_similarity(search_title, result_title)
        if sim < 0.40:
            title_ok = False
            print(f"  [{source}] ⚠ Başlık uyuşmuyor "
                  f"(benzerlik %{int(sim*100)}): '{result_title}' ≠ '{search_title}'")
    elif not result_title:
        # Başlık dönmediyse doğrulayamayız — şüpheyle kabul et
        title_ok = True

    # ── 2) Yazar soyadı eşleşmesi ────────────────────────────────────────────
    author_ok = True
    if search_author and result_author:
        # En son kelimeyi soyadı kabul et: "Frank Herbert" → "herbert"
        search_last = search_author.strip().split()[-1].lower()
        if search_last and search_last not in result_author.lower():
            author_ok = False
            print(f"  [{source}] ⚠ Yazar uyuşmuyor: "
                  f"'{result_author}' içinde '{search_last}' yok")
    elif not result_author:
        # Yazar dönmediyse doğrulayamayız — şüpheyle kabul et
        author_ok = True

    # İkisi de başarısız → reddet
    if not title_ok and not author_ok:
        print(f"  [{source}] ✗ Sonuç reddedildi (başlık ve yazar uyuşmuyor).")
        return False

    return True


# ─────────────────────────────────────────────────────────────────────────────
# YENİ (Adım 10): Hardcover API — Seri uzmanı (zincirin en son katmanı)
# ─────────────────────────────────────────────────────────────────────────────

def _query_hardcover(title: str = None, author: str = None) -> dict:
    """
    Hardcover (hardcover.app) GraphQL API'sine sorgu atar ve seri bilgisini çeker.

    Hardcover:
      - Okuyucu topluluğu güdümlü bir kitap takip platformudur
      - Özellikle fantastik / bilim kurgu serilerinde çok zengin veriye sahiptir
      - Ücretsiz üyelikle API tokeni alınır

    ÖNEMLİ NOTLAR (resmi dokümana göre):
      - Token, Authorization header'ına "Bearer " ÖNEKİ OLMADAN doğrudan yazılır.
      - _ilike / _like gibi filtreler API'de devre dışıdır; arama için Typesense
        tabanlı `search` endpoint'i kullanılır (query_type: "Book").
      - Dönen sonuçta her kitabın `series_names` ve `featured_series_position`
        alanları seri bilgisini taşır.

    Token .env içinde HARDCOVER_API_TOKEN olarak tanımlı değilse bu adım
    sessizce atlanır (boş dict döner).

    Döndürülen alanlar:
      - series:       seri adı
      - series_order: seri içindeki sıra (varsa)

    Adım P1 değişikliği:
      - Ağ hataları ve rate limit için retry mekanizması eklendi
    """
    result = {}

    token = _get_hardcover_token()
    if not token:
        return {}

    if not title:
        return {}

    clean_title = _clean_query(title)

    # Typesense tabanlı search endpoint'i: query_type "Book"
    graphql_query = """
    query SearchBook($q: String!) {
      search(query: $q, query_type: "Book", per_page: 5, page: 1) {
        results
      }
    }
    """

    # Hardcover token'ı "Bearer " öneki ile gönderilmeli.
    # Token zaten "Bearer" ile başlıyorsa tekrar ekleme.
    auth_value = token if token.lower().startswith("bearer") else f"Bearer {token}"

    headers = {
        "Authorization": auth_value,
        "Content-Type": "application/json",
        "User-Agent": "ebook-catalog-scanner/1.0",
    }
    payload = {
        "query": graphql_query,
        "variables": {"q": clean_title},
    }

    @_network_retry
    @_rate_limit_retry
    def _do_request():
        response = requests.post(HARDCOVER_URL, json=payload, headers=headers, timeout=15)
        return _handle_response(response)

    try:
        response = _do_request()
        data = response.json()

        search_block = data.get("data", {}).get("search", {})
        results_obj = search_block.get("results", {})

        # results bir dict; Typesense formatında "hits" listesi içerir
        hits = []
        if isinstance(results_obj, dict):
            hits = results_obj.get("hits", [])
        if not hits:
            return {}

        # İlk sonucun document kısmından seri bilgisini al
        document = hits[0].get("document", {})

        # Adım P4: Doğrulama için dönen başlık ve yazar bilgisini al
        returned_title  = document.get("title", "")
        returned_authors = document.get("author_names", [])
        returned_author  = returned_authors[0] if isinstance(returned_authors, list) and returned_authors else ""

        # Adım P4: Sonucu doğrula — başlık veya yazar uyuşmuyorsa reddet
        validation_probe = {
            "result_title":  returned_title,
            "result_author": returned_author,
        }
        if not _validate_result(
            validation_probe,
            search_title=title or "",
            search_author=author,
            source="Hardcover",
        ):
            return {}

        # 1) Öncelik: featured_series objesi (en güvenilir seri bilgisi)
        featured = document.get("featured_series")
        if isinstance(featured, dict):
            series_obj = featured.get("series", {})
            if isinstance(series_obj, dict) and series_obj.get("name"):
                result["series"] = series_obj["name"].strip()
            pos = featured.get("position")
            if pos is not None:
                try:
                    p = float(pos)
                    result["series_order"] = int(p) if p == int(p) else p
                except (ValueError, TypeError):
                    pass

        # 2) featured_series yoksa series_names listesinden al
        if not result.get("series"):
            series_names = document.get("series_names", [])
            if series_names:
                if isinstance(series_names, list):
                    result["series"] = series_names[0].strip()
                else:
                    result["series"] = str(series_names).strip()

        # 3) Seri sırası hâlâ boşsa featured_series_position alanına bak
        if result.get("series") and result.get("series_order") is None:
            position = document.get("featured_series_position")
            if position is not None:
                try:
                    pos = float(position)
                    result["series_order"] = int(pos) if pos == int(pos) else pos
                except (ValueError, TypeError):
                    pass

        time.sleep(REQUEST_DELAY)

    except _RateLimitError as e:
        print(f"  [Hardcover] ✗ Rate limit aşıldı, 3 denemede de başarısız: {e}")
    except requests.exceptions.RequestException as e:
        print(f"  [Hardcover sorgu hatası] {e}")
    except Exception as e:
        print(f"  [Hardcover parse hatası] {e}")

    return result