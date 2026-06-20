# -*- coding: utf-8 -*-
"""
Ortak ağ istemcisi altyapısı (api paketi).

Tüm servis modülleri (google_books, open_library, hardcover) buradaki
retry dekoratörlerini, rate-limit yönetimini ve hata işleyiciyi paylaşır.
api.py'den bölündü — Adım 5 (refactoring).
"""

import time
import logging
import requests

# ── Adım P1: tenacity ile retry mekanizması ──────────────────────────────────
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

# Sadece retry uyarılarını görmek için minimal logger
logging.basicConfig(level=logging.WARNING)
_log = logging.getLogger("api_retry")

REQUEST_DELAY = 1.0  # seconds between requests


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
