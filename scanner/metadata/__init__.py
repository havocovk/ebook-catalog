# -*- coding: utf-8 -*-
"""
metadata paketi — köprü (compatibility shim).

Bu paket, eski tek-dosyalık metadata.py'nin yerini alır (Adım 2 refactoring).
scan.py'nin beklediği isimleri dışa açar:

    from metadata import extract_metadata, _is_publisher_string, \
                         _is_generic_folder, compute_confidence

Böylece scan.py'de HİÇBİR değişiklik gerekmez — eski import satırı
aynen çalışmaya devam eder.
"""

from .core import (
    extract_metadata,
    _is_generic_folder,
    _normalize_author,
    _parse_folder_structure,
)
from .filename_parser import (
    _parse_filename,
    _is_edition,
    _is_publisher_string,
    _to_series_index,
)
from .confidence import (
    compute_confidence,
    SOURCE_CONFIDENCE,
    CONFIDENCE_WEIGHTS,
)
from .isbn import (
    _extract_isbn_from_string,
    _isbn13_checksum_valid,
)
from .publisher_validator import (
    _validate_publisher,
    _load_publisher_whitelist,
    _is_software_name,
)
from .epub_extractor import (
    _extract_epub_metadata,
    _extract_epub_series,
    _extract_series_from_subjects,
    _find_opf_path,
)
from .pdf_extractor import (
    _extract_pdf_metadata,
    _extract_pdf_page_text,
    _extract_isbn_from_pdf,
    _extract_publisher_from_text,
    _clean_publisher,
    _extract_series_from_text,
    _extract_edition_from_text,
)
from .ocr import (
    _detect_ocr_engine,
    _ocr_pdf_pages,
)

__all__ = [
    "extract_metadata",
    "compute_confidence",
    "_is_publisher_string",
    "_is_generic_folder",
]
