# -*- coding: utf-8 -*-
"""
Google Books API servisi (api paketi).

ISBN ile doğrudan sorgu + başlık/yazar ile sorgu (5 sonuç al, en iyisini seç).
api.py'den bölündü — Adım 5 (refactoring).
"""

import os
import re
import requests

from .client import (
    _handle_response, _network_retry, _rate_limit_retry,
    _RateLimitError, REQUEST_DELAY,
)
from .validation import _clean_query

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"


def _get_api_key() -> str:
    """Her sorguda güncel API key'i oku. load_dotenv sonrası garantili çalışır."""
    return os.getenv("GOOGLE_API_KEY", "")


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