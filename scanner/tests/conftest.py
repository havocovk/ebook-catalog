# -*- coding: utf-8 -*-
"""
pytest fixture tanımları.

Bu dosyanın özel bir adı var ("conftest.py") — pytest bu ismi otomatik
tanır ve içindeki fixture'ları tüm test dosyalarına otomatik sağlar.
Test dosyalarında bu fonksiyonları import etmemize gerek yok; pytest
bunları parametre adından (örn. "calibre_epub") tanıyıp kendisi çağırır.

Her fixture, geçici bir klasörde (tmp_path) ihtiyaç duyulan sahte EPUB
dosyasını üretir ve dosya yolunu testin kullanımına sunar. "tmp_path",
pytest'in kendi sağladığı, her test için otomatik temizlenen bir klasördür
— testler arasında dosya kalıntısı kalmaz.
"""

import pytest

# NOT: Burada bilerek "from ._epub_fixtures import ..." (relative import)
# DEĞİL, mutlak import kullanılıyor. pytest, conftest.py dosyalarını kendi
# özel mekanizmasıyla yükler ve bu dosyayı her zaman bir paketin parçası
# olarak görmeyebilir — relative import bu durumda "attempted relative
# import with no known parent package" hatasına yol açar. Mutlak import,
# scanner/tests/ klasörünün bir paket olmasından (yani __init__.py'den)
# bağımsız çalışır.
from scanner.tests._epub_fixtures import (
    _make_calibre_series_epub,
    _make_epub3_series_epub,
    _make_subject_series_epub,
    _make_minimal_epub,
    _make_corrupt_epub,
)
from scanner.tests._pdf_fixtures import (
    _make_full_metadata_pdf,
    _make_page_text_pdf,
    _make_software_producer_pdf,
    _make_minimal_pdf,
    _make_scanned_empty_pdf,
    _make_corrupt_pdf,
)


@pytest.fixture
def calibre_epub(tmp_path):
    """Calibre standardına uygun seri bilgisi içeren EPUB dosyasının yolunu döner."""
    path = str(tmp_path / "calibre_series.epub")
    _make_calibre_series_epub(path)
    return path


@pytest.fixture
def epub3_series_epub(tmp_path):
    """EPUB3 standardına uygun seri bilgisi içeren EPUB dosyasının yolunu döner."""
    path = str(tmp_path / "epub3_series.epub")
    _make_epub3_series_epub(path)
    return path


@pytest.fixture
def subject_series_epub(tmp_path):
    """Seri bilgisi sadece dc:subject alanında geçen EPUB dosyasının yolunu döner."""
    path = str(tmp_path / "subject_series.epub")
    _make_subject_series_epub(path)
    return path


@pytest.fixture
def minimal_epub(tmp_path):
    """Sadece başlık içeren, başka metadata'sı olmayan EPUB dosyasının yolunu döner."""
    path = str(tmp_path / "minimal.epub")
    _make_minimal_epub(path)
    return path


@pytest.fixture
def corrupt_epub(tmp_path):
    """Geçersiz/bozuk bir EPUB (gerçekte ZIP bile olmayan) dosyasının yolunu döner."""
    path = str(tmp_path / "corrupt.epub")
    _make_corrupt_epub(path)
    return path


# ─────────────────────────────────────────────────────────────────────────────
# PDF fixture'ları
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def full_metadata_pdf(tmp_path):
    """
    PDF metadata alanları (title, author, creationDate, producer) dolu
    bir PDF dosyasının yolunu döner. Producer alanı gerçek bir yayınevi
    adı gibi göründüğü için, kod sayfa metnine hiç bakmadan onu kullanmalı.
    """
    path = str(tmp_path / "full_metadata.pdf")
    _make_full_metadata_pdf(path)
    return path


@pytest.fixture
def page_text_pdf(tmp_path):
    """
    PDF metadata alanları boş, ama sayfa metninde ISBN/yayınevi/seri/baskı
    bilgisi geçen bir PDF dosyasının yolunu döner.
    """
    path = str(tmp_path / "page_text.pdf")
    _make_page_text_pdf(path)
    return path


@pytest.fixture
def software_producer_pdf(tmp_path):
    """Producer alanı bir yazılım adı (Adobe) olan PDF dosyasının yolunu döner."""
    path = str(tmp_path / "software_producer.pdf")
    _make_software_producer_pdf(path)
    return path


@pytest.fixture
def minimal_pdf(tmp_path):
    """Hiçbir metadata'sı olmayan, sade bir PDF dosyasının yolunu döner."""
    path = str(tmp_path / "minimal.pdf")
    _make_minimal_pdf(path)
    return path


@pytest.fixture
def scanned_empty_pdf(tmp_path):
    """Hiç metin katmanı olmayan (taratılmış PDF benzeri) dosyanın yolunu döner."""
    path = str(tmp_path / "scanned_empty.pdf")
    _make_scanned_empty_pdf(path)
    return path


@pytest.fixture
def corrupt_pdf(tmp_path):
    """Geçersiz/bozuk bir PDF dosyasının yolunu döner."""
    path = str(tmp_path / "corrupt.pdf")
    _make_corrupt_pdf(path)
    return path