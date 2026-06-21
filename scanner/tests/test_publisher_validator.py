# -*- coding: utf-8 -*-
"""
publisher_validator.py için otomatik testler.

Yazılım adı tespitini ve yayınevi geçerlilik doğrulamasını
(whitelist eşleşmesi, reddedilen kelimeler, anahtar kelime kabulü,
genel "iki kelimeli isim" kuralı) test eder.
"""

from scanner.metadata.publisher_validator import (
    _is_software_name,
    _validate_publisher,
)


# ─────────────────────────────────────────────────────────────────────────────
# _is_software_name()
# ─────────────────────────────────────────────────────────────────────────────

def test_adobe_yazilim_adi_olarak_taninir():
    assert _is_software_name("Adobe Acrobat Pro") is True


def test_microsoft_word_yazilim_adi_olarak_taninir():
    assert _is_software_name("Microsoft Word 2019") is True


def test_calibre_yazilim_adi_olarak_taninir():
    assert _is_software_name("calibre 5.x") is True


def test_gercek_yayinevi_yazilim_olarak_taninmaz():
    assert _is_software_name("İthaki Yayınları") is False


# ─────────────────────────────────────────────────────────────────────────────
# _validate_publisher() — whitelist eşleşmesi
# ─────────────────────────────────────────────────────────────────────────────

def test_bilinen_turk_yayinevi_kabul_edilir():
    """Whitelist'teki Türk yayınevleri tam eşleşmeyle kabul edilmeli."""
    assert _validate_publisher("İthaki") is True
    assert _validate_publisher("Can Yayınları") is True


def test_bilinen_uluslararasi_yayinevi_kabul_edilir():
    """Whitelist'teki uluslararası yayınevleri kabul edilmeli."""
    assert _validate_publisher("Penguin Books") is True
    assert _validate_publisher("Oxford University Press") is True


# ─────────────────────────────────────────────────────────────────────────────
# _validate_publisher() — reddedilen kelimeler
# ─────────────────────────────────────────────────────────────────────────────

def test_yazilim_adi_yayinevi_olarak_reddedilir():
    assert _validate_publisher("Adobe Acrobat") is False


def test_unknown_kelimesi_reddedilir():
    assert _validate_publisher("unknown") is False


def test_bos_string_reddedilir():
    assert _validate_publisher("") is False


def test_none_degeri_reddedilir():
    assert _validate_publisher(None) is False


def test_tek_harf_reddedilir():
    """2 karakterden kısa isimler geçersiz sayılmalı."""
    assert _validate_publisher("A") is False


def test_harf_icermeyen_deger_reddedilir():
    """Sadece sayılardan oluşan bir değer yayınevi olamaz."""
    assert _validate_publisher("12345") is False


# ─────────────────────────────────────────────────────────────────────────────
# _validate_publisher() — anahtar kelime kabulü ("Yayınları", "Press" vb.)
# ─────────────────────────────────────────────────────────────────────────────

def test_bilinmeyen_ama_yayinlari_iceren_isim_kabul_edilir():
    """
    Whitelist'te olmayan bir isim, içinde 'Yayınları' gibi bir
    anahtar kelime geçtiği için kabul edilmeli.
    """
    assert _validate_publisher("Rastgele Test Yayınları") is True


def test_bilinmeyen_ama_press_iceren_isim_kabul_edilir():
    assert _validate_publisher("Brand New Press") is True


# ─────────────────────────────────────────────────────────────────────────────
# _validate_publisher() — genel "çok kelimeli isim" kuralı
# ─────────────────────────────────────────────────────────────────────────────

def test_bilinmeyen_iki_kelimelik_isim_genel_kuralla_kabul_edilir():
    """
    Whitelist'te yok, özel anahtar kelime de içermiyor, ama 2+ kelimeden
    oluşuyor ve yeterince uzunsa, genel kural ile kabul edilmeli.
    """
    assert _validate_publisher("Falanca Kitabevi") is True


def test_bilinmeyen_tek_kelimelik_isim_anahtar_kelimesiz_reddedilir():
    """
    Whitelist'te yok, anahtar kelime de içermiyor, tek kelimeden
    oluşuyorsa (2+ kelime kuralına uymadığı için) reddedilmeli.
    """
    assert _validate_publisher("Falancakitap") is False
