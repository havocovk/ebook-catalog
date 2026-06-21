# -*- coding: utf-8 -*-
"""
filename_parser.py için otomatik testler.

Bu dosya, dosya adlarının doğru şekilde parçalara ayrıldığını (yazar,
başlık, yayınevi, baskı, yıl, seri) kontrol eder. Üç farklı arşiv
formatı (A: seri, B: standart, C: basit) ve yardımcı fonksiyonlar
(_is_edition, _is_publisher_string, _to_series_index) test edilir.
"""

from scanner.metadata.filename_parser import (
    _parse_filename,
    _is_edition,
    _is_publisher_string,
    _to_series_index,
)


# ─────────────────────────────────────────────────────────────────────────────
# Format B: "Yazar - Başlık [Yayınevi] [Baskı] - Yıl"
# ─────────────────────────────────────────────────────────────────────────────

def test_format_b_standart_tum_alanlar():
    """Standart format: yazar, başlık, yayınevi, baskı ve yıl hepsi dolu olmalı."""
    sonuc = _parse_filename(
        "H. G. Wells - Açık Komplo [Anka Yayınları] [1. Baskı] - 2004.pdf"
    )
    assert sonuc["author"] == "H. G. Wells"
    assert sonuc["title"] == "Açık Komplo"
    assert sonuc["publisher"] == "Anka Yayınları"
    assert sonuc["edition"] == "1. Baskı"
    assert sonuc["year"] == 2004


def test_format_b_sadece_yil_var():
    """Yayınevi/baskı köşeli parantezi olmadan, sadece yıl bilgisiyle."""
    sonuc = _parse_filename("Frank Herbert - Dune - 1965.epub")
    assert sonuc["author"] == "Frank Herbert"
    assert sonuc["title"] == "Dune"
    assert sonuc["year"] == 1965
    assert "publisher" not in sonuc
    assert "edition" not in sonuc


# ─────────────────────────────────────────────────────────────────────────────
# Format C: "Yazar - Başlık" (yayınevi/baskı/yıl yok)
# ─────────────────────────────────────────────────────────────────────────────

def test_format_c_basit_format():
    """Sadece yazar ve başlık olan en basit format."""
    sonuc = _parse_filename("H. G. Wells - Zaman Makinesi.epub")
    assert sonuc["author"] == "H. G. Wells"
    assert sonuc["title"] == "Zaman Makinesi"
    assert "year" not in sonuc
    assert "publisher" not in sonuc


def test_format_c_tek_parca_sadece_baslik():
    """Hiç ' - ' ayracı olmayan dosya adı → tamamı başlık olarak alınmalı."""
    sonuc = _parse_filename("ZamanMakinesi.pdf")
    assert sonuc["title"] == "ZamanMakinesi"
    assert "author" not in sonuc


# ─────────────────────────────────────────────────────────────────────────────
# Format A: Seri formatı
# ─────────────────────────────────────────────────────────────────────────────

def test_format_a_seri_adi_ile_birlikte():
    """'Seri Adı NN - Yazar - Başlık' deseni doğru ayrıştırılmalı."""
    sonuc = _parse_filename(
        "Biyografi Serisi 01 - Martin Gilbert - Churchill [2. Baskı] - 2013.pdf"
    )
    assert sonuc["series"] == "Biyografi Serisi"
    assert sonuc["series_index"] == 1
    assert sonuc["author"] == "Martin Gilbert"
    assert sonuc["title"] == "Churchill"
    assert sonuc["edition"] == "2. Baskı"
    assert sonuc["year"] == 2013


def test_format_a_sadece_sayi_ile_baslayan():
    """'002 - Yazar - Başlık' deseni: seri adı yok, sadece sıra numarası var."""
    sonuc = _parse_filename("002 - Yazar Adı - Kitap Başlığı.pdf")
    assert sonuc["series_index"] == 2
    assert sonuc["author"] == "Yazar Adı"
    assert sonuc["title"] == "Kitap Başlığı"
    assert "series" not in sonuc  # Seri adı klasörden gelecek, dosya adında yok


def test_format_a_ondalikli_seri_sirasi():
    """Seri sırası '2.5' gibi ondalıklı olabilir (özel bölüm kitapları için)."""
    sonuc = _parse_filename("002.5 - Yazar Adı - Ara Bölüm.pdf")
    assert sonuc["series_index"] == 2.5


# ─────────────────────────────────────────────────────────────────────────────
# Yıl çıkarımı — köşeli parantez İÇİNDE 4 haneli sayı
# ─────────────────────────────────────────────────────────────────────────────

def test_yil_koseli_parantez_icinde():
    """'[2021]' formatında köşeli parantez içi yıl da tanınmalı."""
    sonuc = _parse_filename("Yazar - Başlık [Yayınevi] [2021].pdf")
    assert sonuc["year"] == 2021
    assert sonuc["publisher"] == "Yayınevi"


def test_yil_aralik_disinda_kabul_edilmez():
    """1800-2100 aralığı dışındaki 4 haneli sayılar yıl olarak kabul edilmemeli."""
    sonuc = _parse_filename("Yazar - Başlık - 1500.pdf")
    # 1500, izin verilen aralığın (1800-2100) dışında kaldığı için
    # sondaki " - 1500" yıl olarak ayrılmaz, başlığın bir parçası kalır.
    assert "year" not in sonuc


# ─────────────────────────────────────────────────────────────────────────────
# _is_edition() — köşeli parantez içinin "baskı" bilgisi olup olmadığı
# ─────────────────────────────────────────────────────────────────────────────

def test_is_edition_turkce_baski():
    assert _is_edition("1. Baskı") is True
    assert _is_edition("3. Basım") is True


def test_is_edition_ingilizce_edition():
    assert _is_edition("3rd Edition") is True
    assert _is_edition("Revised Edition") is True


def test_is_edition_yayinevi_degil():
    """Yayınevi adı, baskı bilgisi olarak yanlış tanınmamalı."""
    assert _is_edition("Anka Yayınları") is False


# ─────────────────────────────────────────────────────────────────────────────
# _is_publisher_string() — köşeli parantez içinin yayınevi olup olmadığı
# ─────────────────────────────────────────────────────────────────────────────

def test_is_publisher_string_turkce_yayinevi():
    assert _is_publisher_string("Anka Yayınları") is True
    assert _is_publisher_string("İletişim Yayınevi") is True


def test_is_publisher_string_ingilizce_press():
    assert _is_publisher_string("Penguin Press") is True
    assert _is_publisher_string("Oxford Publishing") is True


def test_is_publisher_string_baski_bilgisi_degil():
    """Baskı bilgisi, yayınevi olarak yanlış tanınmamalı."""
    assert _is_publisher_string("1. Baskı") is False


# ─────────────────────────────────────────────────────────────────────────────
# _to_series_index() — string'den sayıya çevirme
# ─────────────────────────────────────────────────────────────────────────────

def test_to_series_index_tam_sayi_string():
    """Baştaki sıfırlı string'ler ('03') tam sayıya çevrilmeli, tipi int olmalı."""
    sonuc = _to_series_index("03")
    assert sonuc == 3
    assert isinstance(sonuc, int)


def test_to_series_index_ondalikli():
    sonuc = _to_series_index("2.5")
    assert sonuc == 2.5
    assert isinstance(sonuc, float)


def test_to_series_index_gecersiz_deger():
    """Sayı olmayan bir metin verilirse None dönmeli, hata fırlatmamalı."""
    assert _to_series_index("abc") is None
    assert _to_series_index(None) is None
