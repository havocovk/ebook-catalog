# -*- coding: utf-8 -*-
"""
EPUB test dosyalarını (fixture) üreten yardımcı modül.

Bu dosya gerçek bir test dosyası DEĞİLDİR — test_epub_extractor.py'nin
ihtiyaç duyduğu sahte EPUB dosyalarını diskte oluşturur. pytest, testler
çalışmadan önce bu fonksiyonları otomatik çağırır (bkz. conftest.py).

Her fonksiyon, tek bir senaryoyu temsil eden küçük bir EPUB üretir:
  - Calibre seri standardı
  - EPUB3 seri standardı (belongs-to-collection / group-position)
  - dc:subject'ten seri çıkarımı senaryosu
  - Hiçbir ekstra bilgi içermeyen minimal dosya
  - Geçersiz/bozuk bir "EPUB" (gerçekte ZIP bile değil)
"""

import os
import re
import zipfile

from ebooklib import epub


def _make_calibre_series_epub(path: str):
    """Calibre standardına uygun seri bilgisi (calibre:series meta) içeren EPUB."""
    book = epub.EpubBook()
    book.set_identifier("9786053327820")
    book.set_title("Dune")
    book.set_language("tr")
    book.add_author("Frank Herbert")
    book.add_metadata("DC", "date", "1965-08-01")
    book.add_metadata("DC", "publisher", "İthaki Yayınları")
    book.add_metadata(None, "meta", "", {"name": "calibre:series", "content": "Dune Serisi"})
    book.add_metadata(None, "meta", "", {"name": "calibre:series_index", "content": "1"})

    chapter = epub.EpubHtml(title="Bölüm 1", file_name="chap1.xhtml", lang="tr")
    chapter.content = "<h1>Bölüm 1</h1><p>İçerik</p>"
    book.add_item(chapter)
    book.toc = (epub.Link("chap1.xhtml", "Bölüm 1", "chap1"),)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chapter]

    epub.write_epub(path, book)


def _make_epub3_series_epub(path: str):
    """
    EPUB3 standardına uygun seri bilgisi (belongs-to-collection / group-position)
    içeren EPUB. ebooklib'in doğrudan API'si bu standardı desteklemediği için,
    önce temel bir EPUB üretilir, sonra içindeki OPF dosyası elle düzenlenir.
    """
    book = epub.EpubBook()
    book.set_identifier("9780441013593")
    book.set_title("Dune Messiah")
    book.set_language("en")
    book.add_author("Frank Herbert")

    chapter = epub.EpubHtml(title="Chapter 1", file_name="chap1.xhtml", lang="en")
    chapter.content = "<h1>Chapter 1</h1><p>Content</p>"
    book.add_item(chapter)
    book.toc = (epub.Link("chap1.xhtml", "Chapter 1", "chap1"),)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chapter]

    tmp_path = path + ".tmp"
    epub.write_epub(tmp_path, book)

    # OPF dosyasını bul ve EPUB3 seri meta etiketlerini elle ekle
    with zipfile.ZipFile(tmp_path, "r") as zin:
        container = zin.read("META-INF/container.xml").decode("utf-8")
        opf_path = re.search(r'full-path=["\']([^"\']+\.opf)["\']', container).group(1)
        opf_content = zin.read(opf_path).decode("utf-8")

    epub3_metas = (
        '<meta property="belongs-to-collection">Dune Saga</meta>'
        '<meta property="group-position">2</meta>'
    )
    new_opf = opf_content.replace("</metadata>", epub3_metas + "</metadata>")

    with zipfile.ZipFile(tmp_path, "r") as zin, zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.namelist():
            data = zin.read(item)
            if item == opf_path:
                data = new_opf.encode("utf-8")
            zout.writestr(item, data)

    os.remove(tmp_path)


def _make_subject_series_epub(path: str):
    """
    Hiçbir Calibre/EPUB3 seri meta'sı yok; seri bilgisi sadece dc:subject
    alanında "... Series" gibi bir ibareyle geçiyor (Adım P7 senaryosu).
    """
    book = epub.EpubBook()
    book.set_identifier("id-subject-series")
    book.set_title("Foundation and Empire")
    book.set_language("en")
    book.add_author("Isaac Asimov")
    book.add_metadata("DC", "subject", "Science Fiction")
    book.add_metadata("DC", "subject", "Foundation Series")

    chapter = epub.EpubHtml(title="Chapter 1", file_name="chap1.xhtml")
    chapter.content = "<h1>Chapter 1</h1>"
    book.add_item(chapter)
    book.toc = (epub.Link("chap1.xhtml", "Chapter 1", "chap1"),)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chapter]

    epub.write_epub(path, book)


def _make_minimal_epub(path: str):
    """Sadece başlık içeren, başka hiçbir metadata'sı olmayan en sade EPUB."""
    book = epub.EpubBook()
    book.set_identifier("minimal-id")
    book.set_title("Minimal Book")

    chapter = epub.EpubHtml(title="Chapter 1", file_name="chap1.xhtml")
    chapter.content = "<h1>Chapter 1</h1>"
    book.add_item(chapter)
    book.toc = (epub.Link("chap1.xhtml", "Chapter 1", "chap1"),)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chapter]

    epub.write_epub(path, book)


def _make_corrupt_epub(path: str):
    """Gerçekte bir ZIP/EPUB olmayan, bozuk dosya senaryosunu temsil eden dosya."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("bu bir epub dosyası değil, sadece düz metin")