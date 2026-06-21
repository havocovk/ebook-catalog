# -*- coding: utf-8 -*-
"""
api/validation.py için otomatik testler.

Sorgu metni temizleme (_clean_query), başlık benzerliği (_title_similarity)
ve API sonuç doğrulama (_validate_result) mantığını test eder. Bu dosya
ağ bağlantısı GEREKTİRMEZ — sadece metin işleme mantığını test eder.
"""

from scanner.api.validation import (
    _clean_query,
    _is_software_name,
    _title_similarity,
    _validate_result,
)


# ─────────────────────────────────────────────────────────────────────────────
# _clean_query()
# ─────────────────────────────────────────────────────────────────────────────

def test_alt_cizgi_ve_stopword_temizlenir():
    """'Dune_Herbert_indir_pdf_full' → sadece 'Dune Herbert' kalmalı."""
    sonuc = _clean_query("Dune_Herbert_indir_pdf_full")
    assert sonuc == "Dune Herbert"


def test_koseli_ve_normal_parantez_temizlenir():
    """Köşeli parantez [İthaki] ve normal parantez (Özel Baskı) kaldırılmalı."""
    sonuc = _clean_query("Vakıf [İthaki] (Özel Baskı)")
    assert sonuc == "Vakıf"


def test_dosya_uzantisi_temizlenir():
    """'.epub' gibi dosya uzantıları sorgudan çıkarılmalı."""
    sonuc = _clean_query("Kitap.epub")
    assert "epub" not in sonuc.lower()


def test_bos_metin_bos_doner():
    assert _clean_query("") == ""


def test_none_girdi_hata_firlatmaz():
    """None verilirse hata fırlatmadan None dönmeli (text kontrolü en başta)."""
    assert _clean_query(None) is None


# ─────────────────────────────────────────────────────────────────────────────
# _is_software_name()
# ─────────────────────────────────────────────────────────────────────────────

def test_validation_adobe_yazilim_adi_olarak_taninir():
    assert _is_software_name("Adobe Acrobat") is True


def test_validation_gercek_isim_yazilim_degil():
    assert _is_software_name("İthaki Yayınları") is False


# ─────────────────────────────────────────────────────────────────────────────
# _title_similarity() — Jaccard benzerlik skoru
# ─────────────────────────────────────────────────────────────────────────────

def test_benzerlik_kismi_ortusen_basliklar():
    """'Dune Messiah' ile 'Dune' arasında 1 ortak kelime / 2 toplam kelime = 0.5."""
    sonuc = _title_similarity("Dune Messiah", "Dune")
    assert sonuc == 0.5


def test_benzerlik_hic_ortusmeyen_basliklar():
    """Ortak kelimesi olmayan başlıklar arasında benzerlik 0.0 olmalı."""
    sonuc = _title_similarity("Dune", "Harry Potter")
    assert sonuc == 0.0


def test_benzerlik_ayni_baslik():
    """Aynı başlık kendisiyle karşılaştırıldığında benzerlik 1.0 olmalı."""
    sonuc = _title_similarity("Dune", "Dune")
    assert sonuc == 1.0


def test_benzerlik_bos_baslik_sifir_doner():
    assert _title_similarity("", "Dune") == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# _validate_result() — API sonucu güvenilir mi?
# ─────────────────────────────────────────────────────────────────────────────

def test_validate_result_baslik_ve_yazar_eslesirse_kabul():
    sonuc = _validate_result(
        {"result_title": "Dune", "result_author": "Frank Herbert"},
        search_title="Dune",
        search_author="Frank Herbert",
    )
    assert sonuc is True


def test_validate_result_baslik_ve_yazar_hic_eslesmezse_red():
    """
    Başlık benzerliği düşük (eşik altında) VE yazar soyadı uyuşmuyorsa,
    sonuç güvenilmez kabul edilip reddedilmeli.
    """
    sonuc = _validate_result(
        {"result_title": "Harry Potter", "result_author": "J.K. Rowling"},
        search_title="Dune",
        search_author="Frank Herbert",
    )
    assert sonuc is False


def test_validate_result_yazar_donmezse_temkinli_kabul():
    """
    API'dan yazar bilgisi dönmemişse (boş), bu alan doğrulanamaz ve
    temkinli biçimde kabul edilir — sadece başlık kontrolü geçerli olur.
    """
    sonuc = _validate_result(
        {"result_title": "Dune Messiah", "result_author": ""},
        search_title="Dune",
        search_author="Frank Herbert",
    )
    assert sonuc is True


def test_validate_result_yazar_verilmemisse_sadece_baslik_kontrol_edilir():
    """search_author verilmemişse, yazar kontrolü hiç yapılmamalı."""
    sonuc = _validate_result(
        {"result_title": "Dune", "result_author": "Birisi"},
        search_title="Dune",
        search_author=None,
    )
    assert sonuc is True
