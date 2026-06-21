# -*- coding: utf-8 -*-
"""
isbn.py için otomatik testler.

ISBN-13 checksum (kontrol hanesi) doğrulamasını ve metin içinden ISBN
çıkarma mantığını test eder. Bozuk/yanlış yazılmış ISBN'lerin elendiğini
doğrulamak en kritik kısımdır.
"""

from scanner.metadata.isbn import (
    _isbn13_checksum_valid,
    _extract_isbn_from_string,
)


# ─────────────────────────────────────────────────────────────────────────────
# _isbn13_checksum_valid()
# ─────────────────────────────────────────────────────────────────────────────

def test_gecerli_isbn_dogrulanir():
    """Gerçek, checksum'ı doğru bir ISBN-13 numarası kabul edilmeli."""
    assert _isbn13_checksum_valid("9786053327820") is True


def test_bozuk_checksum_reddedilir():
    """Son hanesi (kontrol hanesi) yanlış olan bir ISBN reddedilmeli."""
    assert _isbn13_checksum_valid("9786053327821") is False


def test_13_haneden_kisa_reddedilir():
    """13 haneden az olan bir sayı geçersiz sayılmalı."""
    assert _isbn13_checksum_valid("978605332782") is False


def test_13_haneden_uzun_reddedilir():
    assert _isbn13_checksum_valid("97860533278201") is False


def test_harf_iceren_deger_reddedilir():
    """Sayı olmayan karakter (harf) içeren değer geçersiz sayılmalı."""
    assert _isbn13_checksum_valid("978605332782X") is False


def test_bos_string_reddedilir():
    assert _isbn13_checksum_valid("") is False


# ─────────────────────────────────────────────────────────────────────────────
# _extract_isbn_from_string()
# ─────────────────────────────────────────────────────────────────────────────

def test_etiketli_isbn_tireli_bulunur():
    """'ISBN: 978-605-332-782-0' gibi etiketli ve tireli yazım tanınmalı."""
    sonuc = _extract_isbn_from_string(
        "Bu kitabın ISBN: 978-605-332-782-0 numarasıdır."
    )
    assert sonuc == "9786053327820"


def test_serbest_isbn_etiketsiz_bulunur():
    """Metin içinde etiketsiz, serbest geçen 978/979 ile başlayan numara da bulunmalı."""
    sonuc = _extract_isbn_from_string("Sayfa 1 9786053327820 başka metin")
    assert sonuc == "9786053327820"


def test_checksumu_bozuk_isbn_metinden_elenir():
    """
    Metinde '978...' ile başlayan ama checksum'ı tutmayan bir sayı
    varsa, bu sayı ISBN olarak kabul edilmemeli (None dönmeli).
    """
    sonuc = _extract_isbn_from_string("ISBN: 978-605-332-782-1")  # bozuk checksum
    assert sonuc is None


def test_isbn_olmayan_metinde_none_doner():
    sonuc = _extract_isbn_from_string("Bu metinde hiç ISBN numarası geçmiyor.")
    assert sonuc is None


def test_bos_metin_none_doner():
    assert _extract_isbn_from_string("") is None


def test_none_girdi_hata_firlatmaz():
    """Fonksiyona None verilirse hata fırlatmadan None dönmeli."""
    assert _extract_isbn_from_string(None) is None


def test_etiketli_oncelik_serbeste_karsi():
    """
    Metinde hem etiketli hem (farklı) serbest bir ISBN varsa,
    etiketli olan önce bulunup döndürülmeli.
    """
    metin = "ISBN: 978-605-332-782-0 ayrıca bir de 9786053327820 var"
    sonuc = _extract_isbn_from_string(metin)
    assert sonuc == "9786053327820"
