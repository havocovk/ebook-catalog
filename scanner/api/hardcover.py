# -*- coding: utf-8 -*-
"""
Hardcover API servisi (api paketi).

Seri uzmanı — zincirin en son katmanı. GraphQL/Typesense search kullanır.
api.py'den bölündü — Adım 5 (refactoring).
"""

import os
import time
import requests

from .client import (
    _handle_response, _network_retry, _rate_limit_retry,
    _RateLimitError, REQUEST_DELAY,
)
from .validation import _clean_query, _validate_result

HARDCOVER_URL = "https://api.hardcover.app/v1/graphql"


def _get_hardcover_token() -> str:
    """Hardcover API tokenini .env'den oku. Yoksa boş string döner (adım atlanır)."""
    return os.getenv("HARDCOVER_API_TOKEN", "")


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
