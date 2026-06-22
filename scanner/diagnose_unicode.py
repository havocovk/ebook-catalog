"""
Tanı scripti #2 — Unicode normalizasyon farkı testi.

scan.py, dosyaları os.walk() ile bulur. Bu script AYNI klasörü os.walk() ile
tarar, içindeki "Immanuel Kant" geçen dosyayı bulur, ve bu YOLUN ÜRETTİĞİ
book_id'yi, ÖNCEKİ diagnose_query.py çalıştırmasında elle yazılan yoldan
üretilen book_id ile karşılaştırır.

Eğer ikisi farklıysa, sorun kesinleşmiş olur: os.walk()'un döndürdüğü string,
komut satırına elle yazılan (görsel olarak aynı görünen) string'den BYTE
DÜZEYİNDE farklı (Unicode normalizasyon sorunu — örn. NFC vs NFD).

Kullanım:
    python diagnose_unicode.py "D:\\Kitaplar\\Is Bankasi Kültür Yayinlari\\Biyografi Serisi"

(Klasör yolunu ver, dosya adını değil — script içindeki klasörü tarayıp
"Kant" geçen dosyayı kendisi bulacak.)
"""
import sys
import os
import hashlib
import unicodedata


def _book_id_from_path(file_path: str) -> str:
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python diagnose_unicode.py \"KLASÖR/YOLU\"")
        sys.exit(1)

    folder_path = sys.argv[1]
    print(f"Taranan klasör: {folder_path}\n")

    found = None
    for root, _, filenames in os.walk(folder_path):
        for fname in filenames:
            if "Kant" in fname:
                found = os.path.join(root, fname)
                break
        if found:
            break

    if not found:
        print("'Kant' içeren dosya bulunamadı — klasör yolunu kontrol et.")
        sys.exit(1)

    print(f"os.walk() ile bulunan TAM yol:")
    print(f"  {found}")
    print(f"  (repr: {repr(found)})")
    print()

    doc_id_oswalk = _book_id_from_path(found)
    print(f"Bu yoldan üretilen doc_id (os.walk): {doc_id_oswalk}")
    print()

    # Önceki diagnose_query.py çalıştırmasında elle yazılan yol ile üretilen
    # doc_id (senin paylaştığın çıktıdan alınan referans değer).
    REFERENCE_DOC_ID = "f27cad20df611db0f47e9eef9f38f44a"
    print(f"Önceki testte (komut satırından elle) üretilen doc_id: {REFERENCE_DOC_ID}")
    print()

    if doc_id_oswalk == REFERENCE_DOC_ID:
        print("✅ EŞLEŞTİ — Unicode normalizasyon farkı YOK. Sorun başka bir yerde.")
    else:
        print("❌ EŞLEŞMEDİ — Unicode normalizasyon farkı VAR. Sorunun kaynağı bu.")
        # Hangi karakterlerin farklı kodlandığını göster (NFC/NFD analizi).
        print()
        print("── Unicode analiz ──")
        print(f"NFC normalize edilmiş hali : {unicodedata.normalize('NFC', found)}")
        print(f"NFD normalize edilmiş hali : {repr(unicodedata.normalize('NFD', found))}")
        nfc_id = _book_id_from_path(unicodedata.normalize("NFC", found))
        print(f"NFC ile üretilen doc_id    : {nfc_id}")
        print(f"NFC referansla eşleşiyor mu: {nfc_id == REFERENCE_DOC_ID}")


if __name__ == "__main__":
    main()
