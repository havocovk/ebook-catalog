"""
Tanı scripti — Adım: "Yetim kapak / yeniden tarama" hatasını teşhis etmek için.

Bu script, get_indexed_paths_batch() fonksiyonunun YAPTIĞI AYNI sorguyu,
TEK BİR gerçek kitabın book_id'si ile çalıştırır ve Appwrite'tan gelen
GERÇEK HTTP yanıtını (status code + ham içerik) ekrana yazar.

Kullanım:
    python diagnose_query.py "TAM/DOSYA/YOLU/Kitap.pdf"

(Tırnak içine, scan.py'ye verdiğin gerçek dosya yolunu, .pdf uzantısı
dahil tam olarak yapıştır — book_id bu yoldan üretiliyor.)
"""
import sys
import hashlib
import requests
import os
from dotenv import load_dotenv

load_dotenv()  # scan.py'nin de yaptığı gibi — .env dosyasını os.environ'a yükler

# uploader.py'deki ile birebir aynı ortam değişkenleri
APPWRITE_ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
APPWRITE_PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", "YOUR_PROJECT_ID")
APPWRITE_API_KEY = os.getenv("APPWRITE_API_KEY", "YOUR_API_KEY")
DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", "ebook_catalog")
TABLE_ID = os.getenv("APPWRITE_TABLE_ID", "books")


def _book_id_from_path(file_path: str) -> str:
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python diagnose_query.py \"TAM/DOSYA/YOLU/Kitap.pdf\"")
        sys.exit(1)

    # ── Ortam değişkenlerinin gerçekten yüklenip yüklenmediğini göster ──────
    # "YOUR_PROJECT_ID" gibi placeholder görünüyorsa, .env dosyası hiç
    # yüklenmemiş demektir (bu scriptin scanner/ klasöründe, .env'in
    # yanında çalıştırılması gerekir).
    print("── Yüklenen ortam değişkenleri ──")
    print(f"APPWRITE_ENDPOINT   : {APPWRITE_ENDPOINT}")
    print(f"APPWRITE_PROJECT_ID : {APPWRITE_PROJECT_ID}")
    print(f"APPWRITE_API_KEY    : {'(boş/yok)' if not APPWRITE_API_KEY or APPWRITE_API_KEY == 'YOUR_API_KEY' else APPWRITE_API_KEY[:8] + '...' }")
    print(f"DATABASE_ID         : {DATABASE_ID}")
    print(f"TABLE_ID            : {TABLE_ID}")
    print()

    file_path = sys.argv[1]
    doc_id = _book_id_from_path(file_path)

    print(f"Dosya yolu      : {file_path}")
    print(f"Üretilen doc_id : {doc_id}")
    print()

    # ── Test 1: is_already_indexed (tek-tek, eski yöntem — GET /documents/{id}) ──
    print("── Test 1: Tekil GET /documents/{doc_id} ──")
    url1 = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents/{doc_id}"
    headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": APPWRITE_API_KEY,
        "Content-Type": "application/json",
    }
    resp1 = requests.get(url1, headers=headers, timeout=10)
    print(f"Status: {resp1.status_code}")
    print(f"Body  : {resp1.text[:300]}")
    print()

    # ── Test 2: get_indexed_paths_batch (toplu, Query.equal — gerçek hata adayı) ──
    print("── Test 2: Toplu GET /documents?queries[]=... ──")
    from appwrite.query import Query
    url2 = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents"
    queries = [
        Query.equal("$id", [doc_id]),
        Query.limit(100),
    ]
    print(f"Gönderilen queries: {queries}")
    resp2 = requests.get(url2, headers=headers, params={"queries[]": queries}, timeout=20)
    print(f"Tam istek URL'i: {resp2.url}")
    print(f"Status: {resp2.status_code}")
    print(f"Body  : {resp2.text[:500]}")


if __name__ == "__main__":
    main()