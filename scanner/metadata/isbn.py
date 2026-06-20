# -*- coding: utf-8 -*-
"""
ISBN çıkarma ve doğrulama modülü.
ISBN-13 checksum doğrulaması + metinden ISBN ayıklama.
metadata.py'den bölündü — Adım 2 (refactoring).
"""

import re


def _isbn13_checksum_valid(digits: str) -> bool:
    """
    Adım P5: ISBN-13 checksum (kontrol hanesi) doğrulaması.

    ISBN-13 algoritması:
      - İlk 12 hanenin her biri sırayla 1 ve 3 ile çarpılır.
      - Çarpımlar toplanır.
      - Toplam 10'a bölünür, kalan 10'dan çıkarılır.
      - Sonuç 10 ise 0 alınır.
      - Bu değer 13. hane (kontrol hanesi) ile eşleşmeli.

    Örnek: "9786053327820"
      9×1 + 7×3 + 8×1 + 6×3 + 0×1 + 5×3 + 3×1 + 3×3 + 2×1 + 7×3 + 8×1 + 2×3
      = 9 + 21 + 8 + 18 + 0 + 15 + 3 + 9 + 2 + 21 + 8 + 6 = 120
      120 % 10 = 0  →  (10 - 0) % 10 = 0  ✓ (kontrol hanesi 0)
    """
    if len(digits) != 13 or not digits.isdigit():
        return False
    total = sum(
        int(d) * (1 if i % 2 == 0 else 3)
        for i, d in enumerate(digits[:12])
    )
    check = (10 - (total % 10)) % 10
    return check == int(digits[12])


def _extract_isbn_from_string(text: str) -> str:
    """
    Verilen metin içinden geçerli bir ISBN-13 numarası çıkarır.

    Adım P5 değişikliği:
      Bulunan her aday ISBN-13 numarası artık checksum doğrulamasından
      geçirilir. Matematiksel olarak geçersiz (bozuk/yanlış yazılmış)
      ISBN'ler API'ya gönderilmeden elenir.

    Öncelik sırası:
      1) "ISBN: 978..." gibi etiketli ifadeler (en güvenilir)
      2) Metin içinde serbest geçen 978/979 ile başlayan sayılar
    """
    if not text:
        return None

    # 1) Etiketli ISBN ifadeleri
    labeled = re.findall(
        r'ISBN[\s\-:]*((?:978|979)[\d\-\s]{10,17})',
        text, re.IGNORECASE
    )
    for raw in labeled:
        digits = re.sub(r'[\s\-]', '', raw)
        if len(digits) == 13 and digits.isdigit():
            if _isbn13_checksum_valid(digits):
                return digits

    # 2) Serbest ISBN
    free = re.findall(r'\b((?:978|979)[\d\-]{10,16})\b', text)
    for raw in free:
        digits = re.sub(r'[\s\-]', '', raw)
        if len(digits) == 13 and digits.isdigit():
            if _isbn13_checksum_valid(digits):
                return digits

    return None
