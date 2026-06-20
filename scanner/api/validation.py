# -*- coding: utf-8 -*-
"""
Sonuç doğrulama ve sorgu metni temizleme (api paketi).

_clean_query üç servis tarafından da kullanılır; _validate_result ve
_title_similarity Open Library + Hardcover sonuçlarını doğrular.
api.py'den bölündü — Adım 5 (refactoring).
"""

import re


def _clean_query(text: str) -> str:
    """
    YENİ (Adım 7): Sorgu metnini Google Books'a göndermeden önce temizler.

    Temizlenenler:
      1) Dosya uzantıları: .pdf, .epub, .mobi vb.
      2) Parantez/köşeli parantez içi açıklamalar: (Özel Baskı), [2021]
      3) Stop-word listesi: indir, oku, full, hd, ekitap vb.
      4) Özel karakterler: _ . – — / \\
      5) Fazladan boşluklar

    Örn: "Dune_Herbert_indir_pdf_full" → "Dune Herbert"
    Örn: "Vakıf [İthaki] (Özel Baskı)"  → "Vakıf"
    """
    if not text:
        return text

    # 1) Dosya uzantılarını kaldır
    text = re.sub(r'\.(pdf|epub|mobi|azw\d?|djvu|cbz|cbr|fb2)\b', ' ', text, flags=re.IGNORECASE)

    # 2) Parantez ve köşeli parantez içini kaldır
    text = re.sub(r'\([^)]*\)', ' ', text)
    text = re.sub(r'\[[^\]]*\]', ' ', text)

    # 3) Özel karakterleri boşluğa çevir — stop-word filtresinden ÖNCE yapılmalı
    #    "indir_pdf_full" → "indir pdf full" olur, sonra her kelime ayrı elenebilir
    text = re.sub(r'[_.\-–—/\\]', ' ', text)

    # 4) Stop-word listesi (Türkçe + İngilizce)
    stop_words = {
        "pdf", "epub", "mobi", "indir", "download", "oku", "read",
        "ekitap", "e-kitap", "ebook", "e-book", "full", "hd", "hq",
        "baski", "baskı", "edition", "revised", "updated", "version",
        "zlibrary", "z-library", "zlib", "libgen", "kitap",
        # Tire boşluğa çevrilince oluşan parçalar da elensin
        "z", "library", "lib",
    }
    words = text.split()
    words = [w for w in words if w.lower().strip(".,;:-_") not in stop_words]
    text = " ".join(words)

    # 5) Fazladan boşlukları temizle
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def _is_software_name(text: str) -> bool:
    """
    Yayınevi adı gibi görünen ama aslında yazılım adı olan değerleri filtreler.
    PDF producer alanı ve Open Library publisher listesi için kullanılır.
    """
    software_keywords = [
        "adobe", "acrobat", "word", "office", "libreoffice", "openoffice",
        "ghostscript", "pdfmaker", "pdftk", "itext", "fpdf", "reportlab",
        "calibre", "kindlegen", "latex", "tex", "quark", "indesign",
        "scribus", "wkhtmltopdf", "chrome", "webkit", "prince",
    ]
    lower = text.lower()
    return any(kw in lower for kw in software_keywords)


def _title_similarity(a: str, b: str) -> float:
    """
    İki başlık arasındaki kelime örtüşme oranını döndürür (0.0 – 1.0).

    Yöntem: her iki başlıktaki kelimelerin kesişimi / birleşimi (Jaccard).
    Büyük/küçük harf farkı gözetilmez. Tek harfli kelimeler (a, I vb.) atlanır.

    Örn:
      "Dune Messiah" ↔ "Dune"         → 1/2 = 0.50  ✓ (eşik tam geçiyor)
      "Foundation"   ↔ "Second Foundation" → 1/2 = 0.50  ✓
      "Dune"         ↔ "Harry Potter"  → 0/3 = 0.00  ✗ (reddedilir)
    """
    def words(text):
        return {w for w in re.sub(r'[^\w\s]', ' ', text.lower()).split() if len(w) > 1}

    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _validate_result(
    result: dict,
    search_title: str,
    search_author: str = None,
    source: str = "API",
) -> bool:
    """
    Adım P4: Open Library ve Hardcover'dan dönen sonucun aranan kitapla
    yeterince örtüşüp örtüşmediğini kontrol eder.

    Kontrol edilenler:
      1) Başlık benzerliği: Jaccard skoru < 0.40 ise reddet.
         (Google Books için bu eşik _score_volume'da zaten uygulanıyor.)
      2) Yazar soyadı: search_author verilmişse ve sonuçta yazar adı varsa,
         soyadı eşleşmiyorsa reddet.

    Sadece iki koşulun her ikisi de başarısız olduğunda reddedilir;
    biri geçerse kabul edilir (toleranslı yaklaşım).

    Dönüş:
      True  → sonuç güvenilir, kabul et
      False → sonuç şüpheli, reddet (boş dict döndür)
    """
    result_title  = result.get("result_title", "")   # API doğrulama için eklenen alan
    result_author = result.get("result_author", "")  # API doğrulama için eklenen alan

    # ── 1) Başlık benzerliği ─────────────────────────────────────────────────
    title_ok = True
    if search_title and result_title:
        sim = _title_similarity(search_title, result_title)
        if sim < 0.40:
            title_ok = False
            print(f"  [{source}] ⚠ Başlık uyuşmuyor "
                  f"(benzerlik %{int(sim*100)}): '{result_title}' ≠ '{search_title}'")
    elif not result_title:
        # Başlık dönmediyse doğrulayamayız — şüpheyle kabul et
        title_ok = True

    # ── 2) Yazar soyadı eşleşmesi ────────────────────────────────────────────
    author_ok = True
    if search_author and result_author:
        # En son kelimeyi soyadı kabul et: "Frank Herbert" → "herbert"
        search_last = search_author.strip().split()[-1].lower()
        if search_last and search_last not in result_author.lower():
            author_ok = False
            print(f"  [{source}] ⚠ Yazar uyuşmuyor: "
                  f"'{result_author}' içinde '{search_last}' yok")
    elif not result_author:
        # Yazar dönmediyse doğrulayamayız — şüpheyle kabul et
        author_ok = True

    # İkisi de başarısız → reddet
    if not title_ok and not author_ok:
        print(f"  [{source}] ✗ Sonuç reddedildi (başlık ve yazar uyuşmuyor).")
        return False

    return True
