# -*- coding: utf-8 -*-
"""
Tek dosya işleme modülü.

Bir ebook dosyasının tüm işlenme sürecini yürütür: metadata çıkarımı,
API zenginleştirmesi, güven skoru, kapak çıkarımı/yükleme ve veritabanına
kaydetme. Ayrıca API verilerini mevcut metadata ile birleştiren yardımcı
fonksiyonu barındırır.

scan.py'den bölündü — Adım 3-4A (Faz 3 refactoring).
"""

import os
import tempfile

from metadata import extract_metadata, compute_confidence
from cover import extract_cover
from api import enrich_metadata
from uploader import (
    upload_cover,
    upload_cover_from_url,
    save_book,
    _book_id_from_path,
)
from scan_report import _print_verbose


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

    # ── DÜZELTME: Kullanıcı klasör seviyesinde seri onayladıysa (forced_series),
    # bu HER ZAMAN üstün olmalı — dosya adından _parse_filename'in çıkardığı
    # bir seri tahminini de EZER. Önceki hâli (`not metadata.get("series")`)
    # sadece dosya adında HİÇ seri kalıbı yoksa devreye giriyordu; bu da "TEK 01
    # - Yazar - Başlık" gibi dosya adlarında _parse_filename'in "TEK"i seri
    # adı sanıp metadata["series"]'i doldurmasına, ve kullanıcının klasör
    # seviyesinde onayladığı GERÇEK seri adının (örn. "Türk Edebiyat
    # Klasikleri") hiç uygulanmamasına sebep oluyordu.
    #
    # Kullanıcı "hayır" derse forced_series None olur, bu blok hiç çalışmaz,
    # dosya adından gelen seri (varsa) olduğu gibi korunur — eski davranış
    # o senaryoda DEĞİŞMEDİ.
    if forced_series:
        metadata["series"] = forced_series
        metadata.setdefault("_sources", {})["series"] = "user"
    # ── DÜZELTME SONU ────────────────────────────────────────────────────────

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
        # Dosyadan kapak alınamazsa API'dan arama yapılmaz — boş bırakılır.
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