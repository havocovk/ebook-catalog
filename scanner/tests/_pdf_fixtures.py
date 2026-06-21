# -*- coding: utf-8 -*-
"""
PDF test dosyalarını (fixture) üreten yardımcı modül.

Bu dosya gerçek bir test dosyası DEĞİLDİR — test_pdf_extractor.py'nin
ihtiyaç duyduğu sahte PDF dosyalarını PyMuPDF (fitz) ile diskte oluşturur.

ÖNEMLİ NOT — Türkçe karakter kısıtı:
  PyMuPDF'in varsayılan gömülü fontu (Helvetica) Türkçe karakterleri
  (ı, ş, ğ, ü, ö, ç) doğru render edemiyor — render edilen metin
  "İletişim" yerine "·leti·im" gibi bozuk çıkıyor. Bu, pdf_extractor.py
  kodunun bir hatası DEĞİL, sadece bizim test fixture'ımızın bir kısıtı.
  Bu yüzden sayfa içeriği gerektiren tüm fixture'larda bilerek ASCII
  (Türkçe karaktersiz) metin kullanılıyor — örn. "Yayinevi" yerine
  "Yayınevi" değil. PDF METADATA alanları (title, author gibi) bu
  kısıtın dışındadır çünkü onlar PyMuPDF'in metadata API'siyle yazılır,
  render edilmez; orada Türkçe karakter sorunsuz çalışır.
"""

import fitz


def _make_full_metadata_pdf(path: str):
    """
    PDF metadata alanları (title, author, creationDate, producer) dolu,
    ayrıca sayfa içinde de ISBN bilgisi geçen bir PDF üretir. Producer
    alanı GERÇEK bir yayınevi adı gibi göründüğü için, kod bu alanı
    yayınevi olarak almalı (sayfa metnindeki "Yayinevi" satırına hiç
    bakmamalı — bu, _extract_pdf_metadata'nın tasarlanmış davranışıdır).
    """
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "ISBN: 978-605-332-782-0")
    page.insert_text((50, 80), "Bu satir gormezden gelinmeli: Yayinevi Sahte")

    doc.set_metadata({
        "title": "Test Kitabı",
        "author": "Test Yazar",
        "creationDate": "D:20210615120000",
        "producer": "Gerçek Bir Yayınevi Producer Adı",
    })

    doc.save(path)
    doc.close()


def _make_page_text_pdf(path: str):
    """
    PDF metadata alanları BOŞ (producer yok), ama sayfa metninde ISBN,
    yayınevi, seri ve baskı bilgisi geçen bir PDF üretir. Bu senaryoda
    kod, eksik metadata alanlarını sayfa metninden tamamlamaya çalışmalı.

    ASCII kısıtı nedeniyle "Yayınevi" yerine "Yayinevi" kullanılıyor.
    """
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "ISBN: 978-605-332-782-0")
    page.insert_text((50, 80), "Yayinevi: Test Publishing House")
    page.insert_text((50, 110), "Seri: History Collection #3")
    page.insert_text((50, 140), "2. Baski")
    page.insert_text((50, 170), "A book first page content goes here and continues.")

    doc.save(path)
    doc.close()


def _make_software_producer_pdf(path: str):
    """
    Producer alanı bir yazılım adı (Adobe Acrobat) olan PDF. Kod bu alanı
    yayınevi olarak ALMAMALI, bunun yerine sayfa metnindeki gerçek
    yayınevi bilgisine bakmalı.
    """
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Yayinevi: Real Publishing House")
    doc.set_metadata({"producer": "Adobe Acrobat Pro DC"})
    doc.save(path)
    doc.close()


def _make_minimal_pdf(path: str):
    """Hiçbir metadata'sı olmayan, sadece düz metin içeren en sade PDF."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Just some plain text with no special info.")
    doc.save(path)
    doc.close()


def _make_scanned_empty_pdf(path: str):
    """
    Hiç metin katmanı olmayan, tamamen boş bir sayfa içeren PDF.
    Taratılmış (resim tabanlı) bir PDF'i simüle eder — OCR yoluna
    düşmesi gereken senaryo budur.
    """
    doc = fitz.open()
    doc.new_page()  # hiç metin eklenmedi
    doc.save(path)
    doc.close()


def _make_corrupt_pdf(path: str):
    """Gerçekte bir PDF olmayan, bozuk dosya senaryosunu temsil eden dosya."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("bu bir PDF dosyası değil, sadece düz metin")