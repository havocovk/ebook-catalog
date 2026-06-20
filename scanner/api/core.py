# -*- coding: utf-8 -*-
"""
Ana zenginleştirme orkestrasyonu (api paketi).

enrich_metadata() üç servisi sırayla çağırır:
  Google Books → Open Library (fallback) → Hardcover (seri için).
api.py'den bölündü — Adım 5 (refactoring).
"""

import time

from .client import REQUEST_DELAY
from .google_books import (
    _query_google_books_by_isbn, _query_google_books, _build_query,
)
from .open_library import _query_open_library
from .hardcover import _query_hardcover


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
