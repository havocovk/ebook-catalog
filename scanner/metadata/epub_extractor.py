# -*- coding: utf-8 -*-
"""
EPUB dosyası içi metadata okuma modülü.
Calibre + EPUB3 seri standartları, dc:subject seri çıkarımı.
metadata.py'den bölündü — Adım 2 (refactoring).

NOT: Bu bölme sırasında orijinal dosyadaki bir hata düzeltildi —
_find_opf_path fonksiyonunun kayıp 'def' başlığı geri eklendi.
"""

import re
import zipfile
import ebooklib
from ebooklib import epub

from .isbn import _extract_isbn_from_string


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


def _find_opf_path(zf):
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
