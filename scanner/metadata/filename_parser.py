# -*- coding: utf-8 -*-
"""
Dosya adı çözümleme modülü.
Arşiv formatı: "Yazar - Kitap Adı [Yayınevi] [X. Baskı] - Yıl.pdf"
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import os
import re


def _parse_filename(file_path: str) -> dict:
    """
    Dosya adını arşiv formatına göre parse eder.

    Desteklenen formatlar:
      A) Seri formatı (ilk parça sayıyla biter):
         "Biyografi Serisi 01 - Martin Gilbert - Churchill [2. Baskı] - 2013"
         → series="Biyografi Serisi", series_index=1, author="Martin Gilbert",
           title="Churchill", edition="2. Baskı", year=2013

      B) Standart format:
         "H. G. Wells - Açık Komplo [Anka Yayınları] [1. Baskı] - 2004"
         → author="H. G. Wells", title="Açık Komplo",
           publisher="Anka Yayınları", edition="1. Baskı", year=2004

      C) Yayınevi/baskı olmayan basit format:
         "H. G. Wells - Zaman Makinesi"
         → author="H. G. Wells", title="Zaman Makinesi"

    Köşeli parantez içleri:
      [Yayınevi] → publisher (yayınevi anahtar kelimesi varsa)
      [X. Baskı] veya [Xth Edition] → edition
      [2021] → year (sadece 4 haneli sayıysa)
    """
    result = {}
    filename = os.path.splitext(os.path.basename(file_path))[0]

    # ── Adım 1: Sondaki " - Yıl" bilgisini çıkar ─────────────────────────────
    # Örn: "... - 2004" veya "... - 2013"
    year_suffix = re.search(r'\s*-\s*(\d{4})\s*$', filename)
    if year_suffix:
        try:
            yr = int(year_suffix.group(1))
            if 1800 <= yr <= 2100:
                result["year"] = yr
        except ValueError:
            pass
        filename = filename[:year_suffix.start()].strip()

    # ── Adım 2: Köşeli parantez içlerini topla ve temizle ────────────────────
    # [Anka Yayınları], [2. Baskı], [1st Edition] gibi
    brackets = re.findall(r'\[([^\]]+)\]', filename)
    filename_clean = re.sub(r'\s*\[[^\]]*\]\s*', ' ', filename).strip()
    filename_clean = re.sub(r'\s+', ' ', filename_clean).strip()

    for bracket in brackets:
        bracket = bracket.strip()
        # Yıl mı? (sadece 4 haneli sayı)
        if re.match(r'^\d{4}$', bracket):
            try:
                yr = int(bracket)
                if 1800 <= yr <= 2100 and not result.get("year"):
                    result["year"] = yr
            except ValueError:
                pass
        # Baskı/edition mı?
        elif _is_edition(bracket):
            result["edition"] = bracket
        # Yayınevi mi?
        elif _is_publisher_string(bracket):
            result["publisher"] = bracket

    # ── Adım 3: Kalan metni " - " ile parçala ────────────────────────────────
    dash_parts = [p.strip() for p in filename_clean.split(" - ")]
    dash_parts = [p for p in dash_parts if p]  # boş parçaları at

    if not dash_parts:
        return result

    # ── Format A: Seri formatı (başında sayı+isim veya sadece sayı) ──────────
    # "Biyografi Serisi 01 - Yazar - Başlık" → seri adı + sıra
    # "002 - Yazar - Başlık"                 → sadece sıra (seri adı klasörden gelir)
    if len(dash_parts) >= 3:
        # İlk parça SADECE sayıysa: "002 - Yazar - Başlık"
        only_number = re.match(r'^(\d{1,3}(?:\.\d+)?)$', dash_parts[0].strip())
        if only_number:
            result["series_index"] = _to_series_index(only_number.group(1))
            result["author"]       = dash_parts[1].strip()
            result["title"]        = dash_parts[2].strip()
            return result

        # İlk parça "Seri Adı 01" gibi sayıyla bitiyorsa
        first_series = re.match(r'^(.+?)\s+(\d{1,3}(?:\.\d+)?)\s*$', dash_parts[0])
        if first_series:
            result["series"]       = first_series.group(1).strip()
            result["series_index"] = _to_series_index(first_series.group(2))
            result["author"]       = dash_parts[1].strip()
            result["title"]        = dash_parts[2].strip()
            return result

    # ── Format B & C: Yazar - Başlık ─────────────────────────────────────────
    if len(dash_parts) >= 2:
        result["author"] = dash_parts[0].strip()
        result["title"]  = dash_parts[1].strip()
        return result

    # ── Fallback: tek parça → başlık ─────────────────────────────────────────
    result["title"] = dash_parts[0].strip()
    return result


def _is_edition(text: str) -> bool:
    """
    Köşeli parantez içinin baskı/edition bilgisi olup olmadığını kontrol eder.
    Örn: "1. Baskı", "2. Basım", "3rd Edition", "Revised Edition", "4. Baskı"
    """
    edition_patterns = [
        r'^\d+[.\s]*(?:bask[ıi]|bask[ıi]m|basım|edition|ed\.?|bask)$',
        r'^(?:revised|updated|expanded|new|genişletilmiş|gözden\s+geçirilmiş)\s+(?:edition|bask[ıi])$',
        r'^\d+(?:st|nd|rd|th)\s+(?:edition|ed\.?)$',
        r'^(?:bask[ıi]|edition)\s*\d+$',
    ]
    text_lower = text.strip().lower()
    for pattern in edition_patterns:
        if re.match(pattern, text_lower, re.IGNORECASE):
            return True
    # "Baskı" veya "Edition" kelimesi geçiyor mu?
    if re.search(r'\bbask[ıi]\b|\bedition\b|\bbasım\b', text_lower):
        return True
    return False


def _is_publisher_string(text: str) -> bool:
    """
    Köşeli parantez içinin yayınevi adı olup olmadığını kontrol eder.
    Yayınevi anahtar kelimelerinden birini içeriyorsa True döner.
    """
    pub_keywords = [
        r'yay[ıi]nlar[ıi]', r'yay[ıi]nevi', r'yay[ıi]nc[ıi]l[ıi]k',
        r'press', r'publishers?', r'publishing', r'verlag',
        r'editions?', r'editore', r'editorial',
    ]
    text_lower = text.strip().lower()
    for kw in pub_keywords:
        if re.search(kw, text_lower):
            return True
    return False


def _to_series_index(raw: str):
    """'03', '1', '2.5' gibi stringleri uygun sayısal tipe çevirir."""
    try:
        val = float(raw)
        return int(val) if val == int(val) else val
    except (ValueError, TypeError):
        return None
