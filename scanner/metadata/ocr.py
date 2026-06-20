# -*- coding: utf-8 -*-
"""
OCR (taranmış PDF okuma) modülü.

İki motor desteklenir (öncelik sırasıyla): Tesseract, EasyOCR.
Hiçbiri kurulu değilse OCR sessizce atlanır.
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import re
import fitz  # PyMuPDF


_OCR_ENGINE = None           # "tesseract" | "easyocr" | None
_OCR_LANGS = ("tur", "eng")  # Tesseract dil kodları (Türkçe + İngilizce)
_easyocr_reader = None        # EasyOCR okuyucusu (ilk kullanımda oluşturulur — ağır)


def _detect_ocr_engine() -> str:
    """
    Kurulu OCR motorunu tespit eder. Modül yüklenirken bir kez çağrılır.

    Dönüş:
      "tesseract" → pytesseract + Tesseract programı bulundu
      "easyocr"   → easyocr kütüphanesi bulundu
      None        → hiçbiri yok, OCR devre dışı
    """
    global _OCR_LANGS

    # 1) Tesseract dene
    try:
        import pytesseract
        # Tesseract programının gerçekten erişilebilir olduğunu doğrula
        pytesseract.get_tesseract_version()
        # Kurulu dil paketlerini öğren; istediğimiz dillerden sadece
        # mevcut olanları kullan (Türkçe paketi yoksa hata vermesin)
        try:
            available = set(pytesseract.get_languages(config=""))
            wanted = [lang for lang in ("tur", "eng") if lang in available]
            if wanted:
                _OCR_LANGS = tuple(wanted)
            else:
                # İstediğimiz dillerden hiçbiri yok ama Tesseract var —
                # yine de mevcut ne varsa onunla devam et (örn. sadece eng)
                _OCR_LANGS = tuple(available) if available else ("eng",)
        except Exception:
            # get_languages başarısız olursa varsayılana güven
            _OCR_LANGS = ("eng",)
        return "tesseract"
    except Exception:
        pass

    # 2) EasyOCR dene
    try:
        import easyocr  # noqa: F401
        return "easyocr"
    except Exception:
        pass

    return None


# Motoru bir kez tespit et
_OCR_ENGINE = _detect_ocr_engine()


def _get_easyocr_reader():
    """
    EasyOCR okuyucusunu ilk kullanımda oluşturur (lazy init).
    Model yükleme ağır olduğu için sadece gerçekten gerekince yapılır.
    """
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        # EasyOCR dil kodları Tesseract'tan farklı: tr, en
        _easyocr_reader = easyocr.Reader(["tr", "en"], gpu=False)
    return _easyocr_reader


def _ocr_image_bytes(png_bytes: bytes) -> str:
    """
    Verilen PNG görüntü baytlarından OCR ile metin çıkarır.
    Aktif motora göre Tesseract veya EasyOCR kullanır.
    Hata olursa boş string döner (asla çökmez).
    """
    if _OCR_ENGINE == "tesseract":
        try:
            import pytesseract
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(png_bytes))
            return pytesseract.image_to_string(img, lang="+".join(_OCR_LANGS))
        except Exception as e:
            print(f"  [OCR Tesseract hatası] {e}")
            return ""

    if _OCR_ENGINE == "easyocr":
        try:
            reader = _get_easyocr_reader()
            # EasyOCR doğrudan bayt dizisi kabul eder; detail=0 → sadece metin
            results = reader.readtext(png_bytes, detail=0, paragraph=True)
            return "\n".join(results)
        except Exception as e:
            print(f"  [OCR EasyOCR hatası] {e}")
            return ""

    return ""


def _ocr_pdf_pages(doc, max_pages: int = 3) -> str:
    """
    PDF'in ilk N sayfasını görüntüye çevirip OCR ile okur.

    Sadece taratılmış (metin katmanı olmayan) PDF'lerde çağrılır.
    Performans için varsayılan olarak yalnızca ilk 3 sayfa işlenir.

    Her sayfa 200 DPI çözünürlükte görüntüye dönüştürülür — OCR doğruluğu
    için yeterli, ama bellek/hız açısından makul bir denge.
    """
    if not _OCR_ENGINE:
        return ""

    texts = []
    limit = min(max_pages, len(doc))
    print(f"  → OCR çalışıyor ({_OCR_ENGINE}, ilk {limit} sayfa)...")

    for page_num in range(limit):
        try:
            page = doc[page_num]
            # Sayfayı 200 DPI görüntüye çevir (zoom ≈ 200/72)
            matrix = fitz.Matrix(200 / 72, 200 / 72)
            pixmap = page.get_pixmap(matrix=matrix)
            png_bytes = pixmap.tobytes("png")
            text = _ocr_image_bytes(png_bytes)
            if text:
                texts.append(text)
        except Exception as e:
            print(f"  [OCR sayfa {page_num + 1} hatası] {e}")

    return "\n".join(texts)
