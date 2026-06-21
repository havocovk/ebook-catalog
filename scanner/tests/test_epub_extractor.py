# -*- coding: utf-8 -*-
"""
epub_extractor.py için otomatik testler.

Bu testler önceki turlardan farklıdır: burada gerçek (ama küçük, sahte)
EPUB dosyaları kullanılır. Dosyalar conftest.py'deki fixture'lar
tarafından her test için otomatik üretilir ve test bitince otomatik
silinir (pytest'in tmp_path mekanizması sayesinde).

Test edilen senaryolar:
  - Calibre seri standardı (calibre:series meta etiketi)
  - EPUB3 seri standardı (belongs-to-collection / group-position)
  - dc:subject alanından seri çıkarımı (Adım P7)
  - Eksik/minimal metadata
  - Bozuk/geçersiz EPUB dosyası (çökmemeli)
  - _extract_series_from_subjects() saf mantığı (dosya gerektirmez)
"""

from scanner.metadata.epub_extractor import (
    _extract_epub_metadata,
    _extract_epub_series,
    _extract_series_from_subjects,
)


# ─────────────────────────────────────────────────────────────────────────────
# Calibre seri standardı
# ─────────────────────────────────────────────────────────────────────────────

def test_calibre_seri_bilgisi_dogru_okunur(calibre_epub):
    """Calibre'nin calibre:series / calibre:series_index meta etiketleri okunmalı."""
    series, series_index = _extract_epub_series(calibre_epub)
    assert series == "Dune Serisi"
    assert series_index == 1


def test_calibre_epub_tam_metadata_dogru(calibre_epub):
    """
    Calibre formatlı bir EPUB'dan başlık, yazar, yıl, yayınevi, dil, ISBN
    ve seri bilgisinin hepsi doğru şekilde çıkarılmalı.
    """
    result = _extract_epub_metadata(calibre_epub)
    assert result["title"] == "Dune"
    assert result["author"] == "Frank Herbert"
    assert result["year"] == 1965
    assert result["publisher"] == "İthaki Yayınları"
    assert result["language"] == "tr"
    assert result["isbn"] == "9786053327820"
    assert result["series"] == "Dune Serisi"
    assert result["series_index"] == 1


def test_calibre_series_index_tam_sayi_tipinde(calibre_epub):
    """series_index '1' string'i değil, 1 tam sayısı olarak dönmeli."""
    _, series_index = _extract_epub_series(calibre_epub)
    assert isinstance(series_index, int)


# ─────────────────────────────────────────────────────────────────────────────
# EPUB3 seri standardı (belongs-to-collection / group-position)
# ─────────────────────────────────────────────────────────────────────────────

def test_epub3_seri_bilgisi_dogru_okunur(epub3_series_epub):
    """
    Calibre meta'sı olmayan ama EPUB3 standardına uygun (belongs-to-collection,
    group-position) bir EPUB'dan seri bilgisi doğru okunmalı.
    """
    series, series_index = _extract_epub_series(epub3_series_epub)
    assert series == "Dune Saga"
    assert series_index == 2


# ─────────────────────────────────────────────────────────────────────────────
# dc:subject'ten seri çıkarımı (Adım P7) — gerçek dosya ile
# ─────────────────────────────────────────────────────────────────────────────

def test_subject_seri_calibre_ve_epub3_yoksa_devreye_girer(subject_series_epub):
    """
    Calibre/EPUB3 seri meta'sı olmayan, ama dc:subject alanında 'Foundation
    Series' gibi bir ibare geçen EPUB'da, seri bilgisi bu alandan çıkarılmalı.
    """
    result = _extract_epub_metadata(subject_series_epub)
    assert result["series"] == "Foundation Series"
    assert result["title"] == "Foundation and Empire"
    assert result["author"] == "Isaac Asimov"


# ─────────────────────────────────────────────────────────────────────────────
# Minimal / eksik metadata
# ─────────────────────────────────────────────────────────────────────────────

def test_minimal_epub_sadece_basligi_doner(minimal_epub):
    """
    Sadece başlık bilgisi olan bir EPUB'da, diğer alanlar (yazar, yıl,
    yayınevi, seri) sonuç sözlüğünde hiç yer almamalı (boş değer değil,
    anahtar bile yok).
    """
    result = _extract_epub_metadata(minimal_epub)
    assert result["title"] == "Minimal Book"
    assert "author" not in result
    assert "year" not in result
    assert "publisher" not in result
    assert "series" not in result
    assert "isbn" not in result


# ─────────────────────────────────────────────────────────────────────────────
# Bozuk / geçersiz dosya — hata fırlatmamalı
# ─────────────────────────────────────────────────────────────────────────────

def test_bozuk_epub_hata_firlatmaz_bos_sozluk_doner(corrupt_epub):
    """
    Gerçekte bir ZIP/EPUB olmayan bozuk bir dosya verildiğinde, fonksiyon
    çökmemeli (try/except ile yakalanmalı) ve boş bir sözlük döndürmeli.
    """
    result = _extract_epub_metadata(corrupt_epub)
    assert result == {}


def test_bozuk_epub_seri_fonksiyonu_de_hata_firlatmaz(corrupt_epub):
    """_extract_epub_series de bozuk dosyada çökmemeli, (None, None) dönmeli."""
    series, series_index = _extract_epub_series(corrupt_epub)
    assert series is None
    assert series_index is None


def test_olmayan_dosya_hata_firlatmaz():
    """Diskte hiç var olmayan bir dosya yolu verilse de çökmemeli."""
    result = _extract_epub_metadata("/bu/yol/hic/var/olmayan/dosya.epub")
    assert result == {}


# ─────────────────────────────────────────────────────────────────────────────
# _extract_series_from_subjects() — saf mantık, dosya gerektirmez
# ─────────────────────────────────────────────────────────────────────────────

def test_subjects_seri_belirteci_olan_aday_secilir():
    """'Foundation Series' gibi seri belirteci içeren bir aday seçilmeli."""
    sonuc = _extract_series_from_subjects(["Science Fiction", "Foundation Series"])
    assert sonuc == "Foundation Series"


def test_subjects_tek_kelime_tur_bilgisi_sayilir():
    """Tek kelimelik bir subject ('Fiction'), seri değil tür bilgisi sayılıp atlanmalı."""
    sonuc = _extract_series_from_subjects(["Fiction"])
    assert sonuc is None


def test_subjects_saga_belirteci_taninir():
    """'Saga' kelimesi de seri belirteci olarak tanınmalı."""
    sonuc = _extract_series_from_subjects(["Dune Saga"])
    assert sonuc == "Dune Saga"


def test_subjects_konu_ve_seri_birlikteyse_seri_kazanir():
    """
    'War Chronicles' gibi bir ibarede 'Chronicles' seri belirteci olduğu
    için, konuyla (history/tarih) çakışsa bile farklı bir subject'ten
    geliyorsa seri kabul edilmeli.
    """
    sonuc = _extract_series_from_subjects(["History", "War Chronicles"])
    assert sonuc == "War Chronicles"


def test_subjects_bos_liste_none_doner():
    assert _extract_series_from_subjects([]) is None


def test_subjects_hicbir_seri_belirteci_yoksa_none_doner():
    """Sadece tür/konu bilgisi olan, seri belirteci içermeyen subject'ler None dönmeli."""
    sonuc = _extract_series_from_subjects(["Science Fiction", "Adventure"])
    assert sonuc is None


def test_subjects_cok_uzun_metin_atlanir():
    """80 karakterden uzun bir subject, açıklama satırı sayılıp atlanmalı."""
    uzun_metin = "Bu çok uzun bir açıklama satırı " * 5  # > 80 karakter, "Series" de içeriyor olsa atlanmalı
    sonuc = _extract_series_from_subjects([uzun_metin + " Series"])
    assert sonuc is None


def test_subjects_yil_iceren_metin_atlanir():
    """Yıl içeren bir subject ('2001 Serisi'), seri adı olarak yanlış yakalanmamalı."""
    sonuc = _extract_series_from_subjects(["2001 Serisi"])
    assert sonuc is None