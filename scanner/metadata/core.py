# -*- coding: utf-8 -*-
"""
Ana metadata orkestrasyonu.
extract_metadata() tüm kaynakları sırayla çağırır + klasör/yazar yardımcıları.
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import os
import re

from .filename_parser import _parse_filename, _is_publisher_string
from .epub_extractor import _extract_epub_metadata
from .pdf_extractor import _extract_pdf_metadata
from .publisher_validator import _validate_publisher


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
        "page_count":   None,   # Adım 13: sayfa sayısı
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

    # Sayfa sayısı: dosya içinden gelir (dosya adında olmaz) — Adım 13
    if file_meta.get("page_count"):
        metadata["page_count"] = file_meta["page_count"]

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