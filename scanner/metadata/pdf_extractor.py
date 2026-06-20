# -*- coding: utf-8 -*-
"""
PDF dosyası içi metadata okuma modülü.
Sayfa metni madenciliği: yayınevi, seri, baskı çıkarımı (+OCR fallback).
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import re
import fitz  # PyMuPDF

from .isbn import _extract_isbn_from_string
from .ocr import _ocr_pdf_pages
from .filename_parser import _to_series_index
from .publisher_validator import _is_software_name


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
