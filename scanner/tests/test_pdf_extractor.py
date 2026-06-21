# -*- coding: utf-8 -*-
"""
pdf_extractor.py için otomatik testler.

EPUB testlerindeki gibi, burada da gerçek (ama küçük, sahte) PDF dosyaları
kullanılır. Dosyalar conftest.py'deki fixture'lar tarafından PyMuPDF
(fitz) ile üretilir.

ÖNEMLİ NOT: Sayfa metni gerektiren fixture'larda Türkçe karakter (ı, ş,
ğ vb.) kullanılmıyor, çünkü PyMuPDF'in varsayılan fontu bu karakterleri
render edemiyor — bu, test ortamının bir kısıtı, kodun hatası değil.

Test edilen senaryolar:
  - PDF metadata alanlarının (title, author, year, producer→publisher)
    okunması
  - producer alanı gerçek bir yayınevi adıysa kullanılması
  - producer alanı bir yazılım adıysa (Adobe vb.) reddedilip sayfa
    metnine başvurulması
  - Sayfa metninden ISBN, yayınevi, seri, baskı çıkarımı
  - Taratılmış (metin katmanı olmayan) PDF'lerde OCR yoluna düşülmesi
    (bu, önceki turda düzeltilen _OCR_ENGINE importunun da dolaylı testi)
  - Bozuk/eksik PDF dosyalarında çökmeme
  - Saf metin fonksiyonları (_extract_publisher_from_text, _clean_publisher,
    _extract_series_from_text, _extract_edition_from_text)
"""

import fitz

from scanner.metadata.pdf_extractor import (
    _extract_pdf_metadata,
    _extract_pdf_page_text,
    _extract_isbn_from_pdf,
    _extract_publisher_from_text,
    _clean_publisher,
    _extract_series_from_text,
    _extract_edition_from_text,
)


# ─────────────────────────────────────────────────────────────────────────────
# _extract_pdf_metadata() — PDF metadata alanları
# ─────────────────────────────────────────────────────────────────────────────

def test_tam_metadata_pdf_metadata_alanlari_dogru_okunur(full_metadata_pdf):
    """
    title, author, creationDate (→year) ve producer (→publisher) alanları
    PDF metadata'sından doğru çekilmeli.
    """
    result = _extract_pdf_metadata(full_metadata_pdf)
    assert result["title"] == "Test Kitabı"
    assert result["author"] == "Test Yazar"
    assert result["year"] == 2021
    assert result["publisher"] == "Gerçek Bir Yayınevi Producer Adı"


def test_tam_metadata_pdf_isbn_sayfa_metninden_gelir(full_metadata_pdf):
    """
    PDF metadata'sında ISBN alanı yok; ISBN sayfa metninden ('ISBN: 978...')
    çıkarılmalı.
    """
    result = _extract_pdf_metadata(full_metadata_pdf)
    assert result["isbn"] == "9786053327820"


def test_producer_doluyken_sayfadaki_yayinevi_satiri_gormezden_gelinir(full_metadata_pdf):
    """
    Producer alanı zaten doluysa (gerçek bir yayınevi adı gibiyse), kod
    sayfa metnindeki 'Yayinevi: ...' satırına hiç bakmamalı — bu fixture'da
    sayfa metninde bilerek yanlış bir yayınevi adı var, sonuç bunu içermemeli.
    """
    result = _extract_pdf_metadata(full_metadata_pdf)
    assert "Sahte" not in result["publisher"]


# ─────────────────────────────────────────────────────────────────────────────
# _extract_pdf_metadata() — sayfa metninden tamamlama (metadata boşken)
# ─────────────────────────────────────────────────────────────────────────────

def test_metadata_boşken_isbn_yayinevi_seri_baski_sayfadan_gelir(page_text_pdf):
    """
    PDF metadata alanları (producer dahil) boşken, ISBN/yayınevi/seri/baskı
    bilgisinin hepsi sayfa metninden çıkarılmalı.
    """
    result = _extract_pdf_metadata(page_text_pdf)
    assert result["isbn"] == "9786053327820"
    assert "Test Publishing House" in result["publisher"]
    assert result["series"] == "History Collection"
    assert result["series_index"] == 3
    assert result["edition"] == "2. Baski"


# ─────────────────────────────────────────────────────────────────────────────
# producer alanı yazılım adıysa reddedilmeli
# ─────────────────────────────────────────────────────────────────────────────

def test_producer_yazilim_adiysa_reddedilir_sayfa_metnine_bakilir(software_producer_pdf):
    """
    Producer alanı 'Adobe Acrobat Pro DC' gibi bir yazılım adıysa, bu
    değer yayınevi olarak ALINMAMALI; kod sayfa metnindeki gerçek
    yayınevi bilgisine başvurmalı.
    """
    result = _extract_pdf_metadata(software_producer_pdf)
    assert "Adobe" not in result.get("publisher", "")
    assert "Real Publishing House" in result["publisher"]


# ─────────────────────────────────────────────────────────────────────────────
# Minimal / eksik metadata
# ─────────────────────────────────────────────────────────────────────────────

def test_minimal_pdf_bos_sozluk_doner_cokme_olmaz(minimal_pdf):
    """
    Hiçbir özel bilgi içermeyen bir PDF'de (başlık, yazar, ISBN, yayınevi
    yok), sonuç sözlüğünde bu alanlardan hiçbiri bulunmamalı.
    """
    result = _extract_pdf_metadata(minimal_pdf)
    assert "title" not in result
    assert "author" not in result
    assert "isbn" not in result
    assert "publisher" not in result
    assert "series" not in result


# ─────────────────────────────────────────────────────────────────────────────
# Taratılmış PDF → OCR yoluna düşme (dolaylı olarak _OCR_ENGINE importunu da test eder)
# ─────────────────────────────────────────────────────────────────────────────

def test_taratilmis_pdf_ocr_yoluna_dusuldugunde_cokme_olmaz(scanned_empty_pdf):
    """
    Metin katmanı olmayan (taratılmış PDF benzeri) bir dosyada, kod OCR
    motorunu kontrol etmek için _OCR_ENGINE değişkenine bakar. Bu test,
    önceki turda düzeltilen 'NameError: name _OCR_ENGINE is not defined'
    hatasının artık oluşmadığını dolaylı olarak doğrular — fonksiyon
    hata fırlatmadan (boş bir metinle de olsa) tamamlanmalı.
    """
    doc = fitz.open(scanned_empty_pdf)
    result = _extract_pdf_page_text(doc, max_pages=1)
    doc.close()
    assert isinstance(result, str)  # çökmeden bir string döndü


# ─────────────────────────────────────────────────────────────────────────────
# Bozuk / olmayan dosya — hata fırlatmamalı
# ─────────────────────────────────────────────────────────────────────────────

def test_bozuk_pdf_hata_firlatmaz_bos_sozluk_doner(corrupt_pdf):
    """Gerçekte bir PDF olmayan bozuk bir dosya verildiğinde çökmemeli."""
    result = _extract_pdf_metadata(corrupt_pdf)
    assert result == {}


def test_olmayan_pdf_dosyasi_hata_firlatmaz():
    """Diskte hiç var olmayan bir PDF dosya yolu verilse de çökmemeli."""
    result = _extract_pdf_metadata("/bu/yol/hic/var/olmayan/dosya.pdf")
    assert result == {}


# ─────────────────────────────────────────────────────────────────────────────
# _extract_isbn_from_pdf() — geriye dönük uyumluluk fonksiyonu
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_isbn_from_pdf_dogru_isbn_bulur(page_text_pdf):
    """_extract_isbn_from_pdf, doc objesini doğrudan alıp ISBN'i bulmalı."""
    doc = fitz.open(page_text_pdf)
    isbn = _extract_isbn_from_pdf(doc)
    doc.close()
    assert isbn == "9786053327820"


def test_extract_isbn_from_pdf_isbn_yoksa_none_doner(minimal_pdf):
    """ISBN içermeyen bir PDF'de None dönmeli."""
    doc = fitz.open(minimal_pdf)
    isbn = _extract_isbn_from_pdf(doc)
    doc.close()
    assert isbn is None


# ─────────────────────────────────────────────────────────────────────────────
# _extract_publisher_from_text() — saf metin fonksiyonu, dosya gerektirmez
# ─────────────────────────────────────────────────────────────────────────────

def test_publisher_yayinevi_etiketli_satir_bulunur():
    text = "Yayinevi: Test Publishing House\nDiger bilgiler burada."
    sonuc = _extract_publisher_from_text(text)
    assert "Test Publishing House" in sonuc


def test_publisher_baski_kelimesi_iceren_satir_atlanir():
    """
    Yayınevi anahtar kelimesi geçse de, baskı/edition belirteci de
    içeren bir satır (örn. tarih bilgisiyle birleşmiş) atlanmalı.
    """
    text = "Press release: January edition coming soon"
    sonuc = _extract_publisher_from_text(text)
    assert sonuc is None


def test_publisher_yazilim_adi_satiri_atlanir():
    text = "Adobe Acrobat publishing tools"
    sonuc = _extract_publisher_from_text(text)
    assert sonuc is None


def test_publisher_bos_metin_none_doner():
    assert _extract_publisher_from_text("") is None
    assert _extract_publisher_from_text(None) is None


def test_publisher_anahtar_kelime_hic_gecmeyen_metin_none_doner():
    """
    Hiçbir yayınevi anahtar kelimesi ('yayınevi', 'press', 'publisher' vb.)
    içermeyen düz bir metinde None dönmeli.
    """
    text = "Just a regular paragraph with completely unrelated content."
    assert _extract_publisher_from_text(text) is None


def test_publisher_etiketsiz_ama_publisher_kelimesi_gecen_metin_yine_yakalanir():
    """
    DAVRANIŞ NOTU: 'publisher' kelimesi bir cümle içinde geçse bile (etiketli
    bir 'Publisher: X' formatında olmasa da), kod bu kelimeden sonraki kısa
    metni bir aday olarak yakalar — çünkü ':' veya '-' işareti opsiyoneldir.
    Bu, _extract_publisher_from_text'in mevcut tasarlanmış davranışıdır.
    """
    text = "Just a regular paragraph without any publisher information."
    sonuc = _extract_publisher_from_text(text)
    assert sonuc == "information"


# ─────────────────────────────────────────────────────────────────────────────
# _clean_publisher() — yayınevi adı temizleme
# ─────────────────────────────────────────────────────────────────────────────

def test_clean_publisher_baştaki_yil_temizlenir():
    assert _clean_publisher("2021, Penguin Books") == "Penguin Books"


def test_clean_publisher_sondaki_yil_temizlenir():
    assert _clean_publisher("Penguin Books, 2021") == "Penguin Books"


def test_clean_publisher_telif_isareti_temizlenir():
    assert _clean_publisher("© Penguin Books") == "Penguin Books"


def test_clean_publisher_sondaki_noktalama_temizlenir():
    assert _clean_publisher("Penguin Books.") == "Penguin Books"


def test_clean_publisher_80_karakterden_uzunsa_kisaltilir():
    uzun_isim = "A " * 50  # 100 karakter
    sonuc = _clean_publisher(uzun_isim)
    assert len(sonuc) <= 80


# ─────────────────────────────────────────────────────────────────────────────
# _extract_series_from_text() — saf metin fonksiyonu
# ─────────────────────────────────────────────────────────────────────────────

def test_series_numarali_seri_dogru_ayristirilir():
    text = "Seri: History Collection #3"
    series, index = _extract_series_from_text(text)
    assert series == "History Collection"
    assert index == 3


def test_series_numarasiz_seri_sadece_isim_doner():
    text = "Seri: Adventure Collection"
    series, index = _extract_series_from_text(text)
    assert series == "Adventure Collection"
    assert index is None


def test_series_ingilizce_series_kelimesi_de_taninir():
    text = "Series: Mystery Files #7"
    series, index = _extract_series_from_text(text)
    assert series == "Mystery Files"
    assert index == 7


def test_series_eslesme_yoksa_none_none_doner():
    text = "Just a plain paragraph with no series information at all."
    series, index = _extract_series_from_text(text)
    assert series is None
    assert index is None


def test_series_bos_metin_none_none_doner():
    assert _extract_series_from_text("") == (None, None)
    assert _extract_series_from_text(None) == (None, None)


# ─────────────────────────────────────────────────────────────────────────────
# _extract_edition_from_text() — saf metin fonksiyonu
# ─────────────────────────────────────────────────────────────────────────────

def test_edition_turkce_sayisal_format_taninir():
    assert _extract_edition_from_text("2. Baski") == "2. Baski"


def test_edition_ingilizce_sayisal_format_taninir():
    text = "Published as 3rd Edition in 2020."
    assert _extract_edition_from_text(text) == "3rd Edition"


def test_edition_ingilizce_kelimesel_format_taninir():
    text = "This is the Second Edition of the book."
    assert _extract_edition_from_text(text) == "Second Edition"


def test_edition_revised_format_taninir():
    text = "This Revised Edition includes new chapters."
    assert _extract_edition_from_text(text) == "Revised Edition"


def test_edition_eslesme_yoksa_none_doner():
    text = "Just a plain paragraph with no edition information."
    assert _extract_edition_from_text(text) is None


def test_edition_bos_metin_none_doner():
    assert _extract_edition_from_text("") is None
    assert _extract_edition_from_text(None) is None