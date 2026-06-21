# -*- coding: utf-8 -*-
"""
confidence.py için otomatik testler.

Güven skoru hesaplama mantığını test eder: her alanın kaynağına göre
ağırlıklandırılması, ISBN primi, boş metadata durumu ve kaynağı
bilinmeyen alanların varsayılan davranışı.
"""

from scanner.metadata.confidence import compute_confidence


def test_bos_metadata_sifir_doner():
    """Hiç dolu alan yoksa skor 0, kaynak metni boş string olmalı."""
    score, source_map = compute_confidence({"_sources": {}})
    assert score == 0
    assert source_map == ""


def test_tum_alanlar_filename_kaynakli():
    """
    Tüm alanlar 'filename' kaynaklı olduğunda (güven=90), ağırlıklı
    ortalama da 90 olmalı (tüm alanlar aynı kaynağa sahipse ortalama
    o kaynağın güven değerine eşittir).
    """
    metadata = {
        "title": "Kar", "author": "Orhan Pamuk", "publisher": "İletişim",
        "year": 2002, "language": "tr",
        "_sources": {
            "title": "filename", "author": "filename",
            "publisher": "filename", "year": "filename", "language": "filename",
        },
    }
    score, source_map = compute_confidence(metadata)
    assert score == 90
    assert "title:filename" in source_map
    assert "author:filename" in source_map


def test_isbn_kaynakli_kayitlara_prim_eklenir():
    """
    ISBN'in kendisi 'isbn' kaynaklı olarak işaretlenmişse, genel skora
    +5 prim eklenmeli (üst sınır 100).
    """
    metadata = {
        "title": "Dune", "author": "Frank Herbert", "isbn": "9786053327820",
        "_sources": {"title": "isbn", "author": "isbn", "isbn": "isbn"},
    }
    score, _ = compute_confidence(metadata)
    # title ve author ağırlıkları eşit (3+3), her ikisi de isbn kaynaklı (100)
    # → ağırlıklı ortalama 100, +5 prim üst sınır 100'de kalır.
    assert score == 100


def test_isbn_var_ama_kaynagi_isbn_degilse_kucuk_prim():
    """
    ISBN alanı doluysa ama kaynağı 'isbn' değilse (örn. dosyadan okunmuş),
    daha küçük bir prim (+3) eklenmeli.
    """
    metadata = {
        "title": "Dune", "isbn": "9786053327820",
        "_sources": {"title": "pdf"},
    }
    score, _ = compute_confidence(metadata)
    # title tek alan, kaynağı pdf (60) + 3 prim = 63
    assert score == 63


def test_kaynagi_bilinmeyen_alan_pdf_varsayilan_kullanir():
    """
    _sources sözlüğünde bir alanın kaydı yoksa, en düşük güven
    değeri olan 'pdf' (60) varsayılan olarak kullanılmalı.
    """
    metadata = {"title": "Test Kitap", "_sources": {}}
    score, source_map = compute_confidence(metadata)
    assert score == 60
    assert source_map == "title:pdf"


def test_bos_deger_olan_alanlar_hesaba_katilmaz():
    """
    None, boş string veya boş liste değerine sahip alanlar, dolu
    olmadıkları için skor hesabına dahil edilmemeli.
    """
    metadata = {
        "title": "Test Kitap",
        "author": None,
        "publisher": "",
        "series": [],
        "_sources": {"title": "filename"},
    }
    score, source_map = compute_confidence(metadata)
    # Sadece title dolu, diğerleri boş olduğu için hesaba katılmaz.
    assert score == 90  # filename kaynağı = 90
    assert source_map == "title:filename"


def test_skor_yuvarlanir_ve_tam_sayidir():
    """Dönen skor her zaman tam sayı (int) olmalı, ondalık olmamalı."""
    metadata = {
        "title": "Test", "author": "Yazar",
        "_sources": {"title": "google_books", "author": "open_library"},
    }
    score, _ = compute_confidence(metadata)
    assert isinstance(score, int)
