# -*- coding: utf-8 -*-
"""
Yayınevi doğrulama modülü.
publisher_whitelist.json tabanlı geçerlilik kontrolü + yazılım adı tespiti.
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import os
import re


def _is_software_name(text: str) -> bool:
    """PDF producer alanı veya yayınevi adının yazılım adı içerip içermediğini kontrol eder."""
    software_keywords = [
        "adobe", "acrobat", "word", "office", "libreoffice", "openoffice",
        "ghostscript", "pdfmaker", "pdftk", "itext", "fpdf", "reportlab",
        "calibre", "kindlegen", "latex", "tex", "quark", "indesign",
        "scribus", "wkhtmltopdf", "chrome", "webkit", "prince",
    ]
    lower = text.lower()
    return any(kw in lower for kw in software_keywords)


_publisher_whitelist_cache = None


def _load_publisher_whitelist() -> dict:
    """publisher_whitelist.json dosyasını yükler. Cache'e alır."""
    import json
    global _publisher_whitelist_cache
    if _publisher_whitelist_cache is not None:
        return _publisher_whitelist_cache

    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "publisher_whitelist.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            _publisher_whitelist_cache = json.load(f)
    except Exception:
        _publisher_whitelist_cache = {}

    return _publisher_whitelist_cache


def _validate_publisher(publisher: str) -> bool:
    """Verilen yayınevi adının geçerli olup olmadığını doğrular."""
    if not publisher or not publisher.strip():
        return False

    pub = publisher.strip()

    if len(pub) < 2 or len(pub) > 100:
        return False

    if not any(c.isalpha() for c in pub):
        return False

    wl = _load_publisher_whitelist()
    pub_lower = pub.lower()

    reject_keywords = wl.get("keywords_reject", [])
    if pub_lower in [r.lower() for r in reject_keywords]:
        return False
    for rk in reject_keywords:
        if rk.lower() in pub_lower and len(rk) > 4:
            return False

    if _is_software_name(pub):
        return False

    all_known = (
        [p.lower() for p in wl.get("turkish", [])] +
        [p.lower() for p in wl.get("international", [])]
    )
    if pub_lower in all_known:
        return True

    for known in all_known:
        if known in pub_lower or pub_lower in known:
            return True

    accept_keywords = wl.get("keywords_accept", [])
    for kw in accept_keywords:
        if kw.lower() in pub_lower:
            return True

    words = pub.split()
    if len(words) >= 2 and len(pub) >= 4:
        return True

    return False
