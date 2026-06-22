"""
Tanı scripti #3 — Gerçek 43 dosyalık liste ile toplu sorgu testi.

Önceki testler TEK bir dosya ile yapıldı ve sorunsuz çalıştı. Bu script,
scan.py'nin GERÇEKTE yaptığı gibi, klasördeki TÜM dosyaları toplayıp
(collect_files ile birebir aynı mantık), get_indexed_paths_batch'i
GERÇEK haliyle çağırır ve sonucu ayrıntılı olarak raporlar:
  - Kaç dosya bulundu
  - Kaç tanesi "kayıtlı" çıktı
  - "Kayıtlı değil" çıkanların TAM LİSTESİ (hangi dosyalar kaçıyor)
  - Appwrite'tan dönen ham yanıtın ilk 1000 karakteri

Kullanım:
    python diagnose_batch.py "D:\\Kitaplar\\Is Bankasi Kültür Yayinlari\\Biyografi Serisi"
"""
import sys
import os
import hashlib
import requests
from dotenv import load_dotenv

load_dotenv()

APPWRITE_ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
APPWRITE_PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", "YOUR_PROJECT_ID")
APPWRITE_API_KEY = os.getenv("APPWRITE_API_KEY", "YOUR_API_KEY")
DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", "ebook_catalog")
TABLE_ID = os.getenv("APPWRITE_TABLE_ID", "books")

SUPPORTED_FORMATS = {".pdf", ".epub"}


def _book_id_from_path(file_path: str) -> str:
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


def collect_files(folder_path: str) -> list:
    # scan.py'deki collect_files ile birebir aynı mantık (recursive=True hali)
    files = []
    for root, _, filenames in os.walk(folder_path):
        for f in filenames:
            if os.path.splitext(f)[1].lower() in SUPPORTED_FORMATS:
                files.append(os.path.join(root, f))
    return sorted(files)


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python diagnose_batch.py \"KLASÖR/YOLU\"")
        sys.exit(1)

    folder_path = sys.argv[1]
    files = collect_files(folder_path)
    print(f"Bulunan dosya sayısı: {len(files)}\n")

    if not files:
        print("Hiç dosya bulunamadı — klasör yolunu kontrol et.")
        sys.exit(1)

    path_by_doc_id = {_book_id_from_path(p): p for p in files}
    all_doc_ids = list(path_by_doc_id.keys())

    print(f"Üretilen doc_id sayısı: {len(all_doc_ids)}")
    print(f"İlk 3 doc_id örneği: {all_doc_ids[:3]}\n")

    from appwrite.query import Query

    url = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents"
    headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key": APPWRITE_API_KEY,
        "Content-Type": "application/json",
    }
    queries = [
        Query.equal("$id", all_doc_ids),
        Query.limit(100),
    ]

    query_str_len = sum(len(q) for q in queries)
    print(f"Toplam query string uzunluğu (karakter): {query_str_len}\n")

    resp = requests.get(url, headers=headers, params={"queries[]": queries}, timeout=20)

    print(f"Tam istek URL'i uzunluğu: {len(resp.url)} karakter")
    print(f"Status: {resp.status_code}\n")

    if resp.status_code != 200:
        print(f"HATA — Tam yanıt:\n{resp.text[:1500]}")
        sys.exit(1)

    data = resp.json()
    found_docs = data.get("documents", [])
    found_ids = {doc.get("$id") for doc in found_docs}

    print(f"Appwrite'ın 'total' alanı: {data.get('total')}")
    print(f"Dönen belge sayısı (documents listesi): {len(found_docs)}\n")

    matched_paths = [path_by_doc_id[d] for d in found_ids if d in path_by_doc_id]
    missing_paths = [p for p in files if p not in matched_paths]

    print(f"✅ Kayıtlı bulunan: {len(matched_paths)}/{len(files)}")
    print(f"❌ Kayıtlı bulunamayan: {len(missing_paths)}/{len(files)}\n")

    if missing_paths:
        print("── Kayıtlı bulunamayan dosyaların ilk 5'i ──")
        for p in missing_paths[:5]:
            print(f"  - {p}")
            print(f"    doc_id: {_book_id_from_path(p)}")


if __name__ == "__main__":
    main()
