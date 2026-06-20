# -*- coding: utf-8 -*-
"""
Metadata güven skoru (confidence scoring) modülü.
Her alanın kaynağına göre ağırlıklı güven yüzdesi hesaplar.
metadata.py'den bölündü — Adım 2 (refactoring).
"""


SOURCE_CONFIDENCE = {
    "isbn":          100,   # ISBN eşleşmesi — en kesin
    "user":           95,   # Kullanıcı girişi (--publisher / --series)
    "filename":       90,   # Dosya adı — kullanıcı düzenli tutuyor
    "epub":           85,   # EPUB içi metadata
    "google_books":   75,   # Google Books API
    "open_library":   70,   # Open Library API
    "hardcover":      70,   # Hardcover API
    "folder":         65,   # Klasör yapısı
    "pdf":            60,   # PDF metni (OCR dahil)
}


CONFIDENCE_WEIGHTS = {
    "title":      3,
    "author":     3,
    "publisher":  2,
    "series":     2,
    "year":       1,
    "language":   1,
}


def compute_confidence(metadata: dict) -> tuple:
    """
    Adım P8: Kitabın metadata güven skorunu hesaplar.

    Mantık:
      - Her dolu alan için kaynağına göre bir güven yüzdesi alınır.
      - Alanlar ağırlıklarına göre (CONFIDENCE_WEIGHTS) ortalanır.
      - ISBN varsa genel skora küçük bir güven primi eklenir (maks 100).
      - Boş alanlar hesaba katılmaz (sadece dolu alanlar puanlanır).

    Dönüş:
      (score, source_map)
        score      → 0–100 arası tam sayı (genel güven yüzdesi)
        source_map → "title:filename, author:google_books, ..." biçiminde metin
                     (veritabanındaki metadata_source alanına yazılır)

    Hiç dolu alan yoksa (0, "") döner.
    """
    sources = metadata.get("_sources", {})

    weighted_sum = 0
    total_weight = 0
    source_parts = []

    for field, weight in CONFIDENCE_WEIGHTS.items():
        value = metadata.get(field)
        if value in (None, "", []):
            continue   # Boş alan — puanlamaya katılmaz

        source = sources.get(field, "pdf")   # Kaynağı bilinmiyorsa en düşük varsay
        confidence = SOURCE_CONFIDENCE.get(source, 60)

        weighted_sum += confidence * weight
        total_weight += weight
        source_parts.append(f"{field}:{source}")

    if total_weight == 0:
        return 0, ""

    score = weighted_sum / total_weight

    # ISBN ile doğrulanmış kayıtlara küçük güven primi
    if metadata.get("isbn") and sources.get("isbn") == "isbn":
        score = min(100, score + 5)

    # ISBN dosyadan okunmuşsa da hafif prim (ISBN varlığı güveni artırır)
    elif metadata.get("isbn"):
        score = min(100, score + 3)

    return int(round(score)), ", ".join(source_parts)
