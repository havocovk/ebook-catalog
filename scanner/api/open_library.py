# -*- coding: utf-8 -*-
"""
Open Library API servisi (api paketi).

Google Books fallback'i — yayınevi ve seri bilgisini tamamlar.
api.py'den bölündü — Adım 5 (refactoring).
"""

import time
import requests

from .client import (
    _handle_response, _network_retry, _rate_limit_retry,
    _RateLimitError, REQUEST_DELAY,
)
from .validation import _clean_query, _is_software_name, _validate_result

OPEN_LIBRARY_URL = "https://openlibrary.org/search.json"


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
