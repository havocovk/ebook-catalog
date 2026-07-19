import os
import hashlib
import requests
from appwrite.client import Client
from appwrite.services.databases import Databases
from appwrite.services.storage import Storage
from appwrite.input_file import InputFile
from appwrite.query import Query
from appwrite.id import ID
from appwrite.exception import AppwriteException


# ─── Configuration ────────────────────────────────────────────────────────────
APPWRITE_ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
APPWRITE_PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", "YOUR_PROJECT_ID")
APPWRITE_API_KEY = os.getenv("APPWRITE_API_KEY", "YOUR_API_KEY")

DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", "ebook_catalog")
TABLE_ID = os.getenv("APPWRITE_TABLE_ID", "books")
BUCKET_ID = os.getenv("APPWRITE_BUCKET_ID", "covers")

OWNER_USER_ID = os.getenv("APPWRITE_USER_ID", "YOUR_USER_ID")


_client: Client = None
_databases: Databases = None
_storage: Storage = None


def _init():
    global _client, _databases, _storage
    if _client is None:
        _client = (
            Client()
            .set_endpoint(APPWRITE_ENDPOINT)
            .set_project(APPWRITE_PROJECT_ID)
            .set_key(APPWRITE_API_KEY)
        )
        _databases = Databases(_client)
        _storage = Storage(_client)


def get_databases() -> Databases:
    _init()
    return _databases


def get_storage() -> Storage:
    _init()
    return _storage


def _book_id_from_path(file_path: str) -> str:
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


def is_already_indexed(file_path: str) -> bool:
    _init()
    doc_id = _book_id_from_path(file_path)
    url = (
        f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}"
        f"/collections/{TABLE_ID}/documents/{doc_id}"
    )
    headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key":     APPWRITE_API_KEY,
        "Content-Type":       "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return True
        if resp.status_code == 404:
            return False
        print(f"  [Kontrol hatası] HTTP {resp.status_code}: {resp.text[:120]}")
        return False
    except Exception as e:
        print(f"  [Kontrol hatası] {e}")
        return False


# ── Adım 7: Toplu "zaten kayıtlı mı?" kontrolü ─────────────────────────────────
#
# is_already_indexed() her dosya için AYRI bir HTTP isteği atıyor — 3000 kitaplık
# bir kütüphanede bu, tekrar taramalarda 3000 ayrı ağ isteği demek (çok yavaş).
#
# Bu fonksiyon yerine, TÜM dosya yollarını alıp tek (veya birkaç) toplu sorguyla
# "bunlardan hangileri zaten kayıtlı?" sorusunu sorar. Appwrite'ın list_documents
# endpoint'i tek seferde en fazla 100 ID sorgulayabildiği için (ve SDK 5.0.1'de
# GET isteklerine body eklenip 400 hatası verdiği için, is_already_indexed'teki
# aynı nedenle), burada da SDK bypass edilip doğrudan HTTP GET kullanılıyor.
#
# Örnek: 3000 dosya → 30 toplu istek (her biri 100 ID). Önceki yöntemle bu
# 3000 ayrı istek olurdu. ~100x daha az ağ isteği.
#
# GÜVENLİK: Herhangi bir toplu istek başarısız olursa (ağ hatası, beklenmeyen
# yanıt), o gruptaki dosyalar için sessizce is_already_indexed() (tek-tek,
# eski yöntem) fallback olarak devreye girer — tarama asla bu yüzden durmaz.
_BATCH_SIZE = 100  # Appwrite: tek sorguda en fazla 100 değer + max 100 query


def get_indexed_paths_batch(file_paths: list) -> set:
    """Verilen dosya yollarından hangilerinin veritabanında zaten kayıtlı
    olduğunu toplu sorgularla bulur. Dönüş: kayıtlı olan dosya yollarının
    kümesi (set) — `path in result` ile O(1) hızda kontrol edilebilir.
    """
    _init()
    indexed_paths = set()

    # Dosya yolu → doc_id eşlemesi (doc_id'den geri dosya yoluna dönmek için)
    path_by_doc_id = {_book_id_from_path(p): p for p in file_paths}
    all_doc_ids = list(path_by_doc_id.keys())

    url = f"{APPWRITE_ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents"
    headers = {
        "X-Appwrite-Project": APPWRITE_PROJECT_ID,
        "X-Appwrite-Key":     APPWRITE_API_KEY,
        "Content-Type":       "application/json",
    }

    # 100'lük gruplar halinde sorgula
    for i in range(0, len(all_doc_ids), _BATCH_SIZE):
        batch_ids = all_doc_ids[i : i + _BATCH_SIZE]
        batch_paths = [path_by_doc_id[d] for d in batch_ids]

        try:
            queries = [
                Query.equal("$id", batch_ids),
                Query.limit(_BATCH_SIZE),
            ]
            resp = requests.get(
                url,
                headers=headers,
                params={"queries[]": queries},
                timeout=20,
            )
            if resp.status_code != 200:
                print(f"  [Toplu kontrol hatası] HTTP {resp.status_code} — bu grup için tek-tek kontrole geçiliyor.")
                _fallback_check_batch(batch_paths, indexed_paths)
                continue

            found_docs = resp.json().get("documents", [])
            for doc in found_docs:
                doc_id = doc.get("$id")
                if doc_id in path_by_doc_id:
                    indexed_paths.add(path_by_doc_id[doc_id])

        except Exception as e:
            print(f"  [Toplu kontrol hatası] {e} — bu grup için tek-tek kontrole geçiliyor.")
            _fallback_check_batch(batch_paths, indexed_paths)

    return indexed_paths


def _fallback_check_batch(batch_paths: list, indexed_paths: set):
    """Toplu sorgu başarısız olduğunda, o gruptaki dosyaları eski (tek-tek)
    yöntemle kontrol eder ve sonuçları indexed_paths kümesine ekler.
    Bu fonksiyon tarama sırasında SESSİZCE devreye girer — kullanıcı için
    tek fark, o grup için biraz daha yavaş olması (yine de tarama durmaz)."""
    for p in batch_paths:
        if is_already_indexed(p):
            indexed_paths.add(p)


def _build_public_url(file_id: str) -> str:
    return (
        f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}"
        f"/files/{file_id}/view?project={APPWRITE_PROJECT_ID}"
    )


def _delete_if_exists(file_id: str):
    storage = get_storage()
    try:
        storage.get_file(bucket_id=BUCKET_ID, file_id=file_id)
        storage.delete_file(bucket_id=BUCKET_ID, file_id=file_id)
    except AppwriteException:
        pass


def upload_cover(local_cover_path: str, book_id: str) -> str | None:
    storage = get_storage()
    file_id = book_id

    try:
        _delete_if_exists(file_id)
        storage.create_file(
            bucket_id=BUCKET_ID,
            file_id=file_id,
            file=InputFile.from_path(local_cover_path),
        )
        return _build_public_url(file_id)
    except AppwriteException as e:
        print(f"  [Kapak yükleme hatası] {e.message}")
        return None
    except Exception as e:
        print(f"  [Kapak yükleme hatası] {e}")
        return None


def upload_cover_from_url(api_cover_url: str, book_id: str) -> str | None:
    storage = get_storage()
    file_id = book_id

    try:
        response = requests.get(api_cover_url, timeout=10)
        response.raise_for_status()

        _delete_if_exists(file_id)
        storage.create_file(
            bucket_id=BUCKET_ID,
            file_id=file_id,
            file=InputFile.from_bytes(
                response.content,
                filename=f"{file_id}.jpg",
            ),
        )
        return _build_public_url(file_id)
    except AppwriteException as e:
        print(f"  [API kapak yükleme hatası] {e.message}")
        return None
    except Exception as e:
        print(f"  [API kapak yükleme hatası] {e}")
        return None


def save_book(metadata: dict, cover_url: str = None) -> bool:
    db = get_databases()

    file_path = metadata.get("file_path")
    doc_id = _book_id_from_path(file_path) if file_path else ID.unique()

    data = {
        "user_id": OWNER_USER_ID,
        "title": metadata.get("title"),
        "author": metadata.get("author"),
        "publisher": metadata.get("publisher"),
        "edition": metadata.get("edition"),   # YENİ: baskı/edition bilgisi
        "language": metadata.get("language"),
        "series": metadata.get("series"),
        "series_order": metadata.get("series_order") or metadata.get("series_index"),
        "format": metadata.get("format"),
        "file_path": file_path,
        "file_size": metadata.get("file_size"),
        "cover_url": cover_url,
        "year": metadata.get("year"),
        "description": metadata.get("description"),
        "status": "okunmadi",
        "rating": None,
        "notes": None,
        "finished_at": None,
        "tags": [],
        "confidence_score": metadata.get("confidence_score"),
        "metadata_source": metadata.get("metadata_source"),
        "page_count": metadata.get("page_count"),          # Adım 13
        "has_physical_copy": metadata.get("has_physical_copy", False),  # Adım 13
    }

    for int_field in ("series_order", "file_size", "year", "rating"):
        if data.get(int_field) in ("", 0) and int_field in ("series_order", "year", "rating"):
            if data[int_field] == "":
                data[int_field] = None

    try:
        db.create_document(
            database_id=DATABASE_ID,
            collection_id=TABLE_ID,
            document_id=doc_id,
            data=data,
        )
        return True
    except AppwriteException as e:
        if getattr(e, "code", None) == 409:
            try:
                db.update_document(
                    database_id=DATABASE_ID,
                    collection_id=TABLE_ID,
                    document_id=doc_id,
                    data=data,
                )
                return True
            except Exception as e2:
                print(f"  [Güncelleme hatası] {e2}")
                return False
        print(f"  [Kayıt hatası] {e.message}")
        return False
    except Exception as e:
        print(f"  [Kayıt hatası] {e}")
        return False