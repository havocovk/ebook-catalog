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
# Bu değerleri scanner/.env dosyasından okur.
APPWRITE_ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
APPWRITE_PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", "YOUR_PROJECT_ID")
APPWRITE_API_KEY = os.getenv("APPWRITE_API_KEY", "YOUR_API_KEY")

DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", "ebook_catalog")
TABLE_ID = os.getenv("APPWRITE_TABLE_ID", "books")
BUCKET_ID = os.getenv("APPWRITE_BUCKET_ID", "covers")

# Kayıtlara yazılacak kullanıcı ID'si. Appwrite panelinde Auth altında
# oluşturduğun kullanıcının ID'si ($id). .env içine APPWRITE_USER_ID olarak gir.
OWNER_USER_ID = os.getenv("APPWRITE_USER_ID", "YOUR_USER_ID")


_client: Client = None
_databases: Databases = None
_storage: Storage = None


def _init():
    """Appwrite client'ı ve servisleri tek seferlik kurar."""
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
    """Dosya yolundan kararlı (deterministik) bir ID üretir.
    Aynı dosya tekrar taranırsa aynı ID döner, böylece storage'da tekrar oluşmaz.
    Appwrite ID'leri max 36 karakter; md5 hash 32 karakter, güvenli."""
    return hashlib.md5(file_path.encode("utf-8")).hexdigest()


# ─── Duplicate check ──────────────────────────────────────────────────────────

def is_already_indexed(file_path: str) -> bool:
    """Bu dosya veritabanında zaten var mı, file_path'e göre kontrol eder.

    NOT: Bunun çalışması için Appwrite panelinde books tablosunda
    `file_path` alanına bir index eklenmiş olmalı. (Indexes sekmesi → Create index → key: file_path, type: key)
    """
    db = get_databases()
    try:
        result = db.list_documents(
            database_id=DATABASE_ID,
            collection_id=TABLE_ID,
            queries=[
                Query.equal("file_path", file_path),
                Query.limit(1),
            ],
        )
        return result.get("total", 0) > 0
    except AppwriteException as e:
        # Index yoksa veya başka bir sorun varsa: güvenli tarafta kal,
        # "kayıtlı değil" döndürmek yerine hatayı bildir ve atlanmasını engelle.
        print(f"  [Kontrol hatası] {e.message}")
        return False
    except Exception as e:
        print(f"  [Kontrol hatası] {e}")
        return False


# ─── Cover upload ─────────────────────────────────────────────────────────────

def _build_public_url(file_id: str) -> str:
    """Storage dosyası için public görüntüleme URL'i kurar.
    covers bucket'ı public okuma izinli olduğundan bu URL tarayıcıda açılır."""
    return (
        f"{APPWRITE_ENDPOINT}/storage/buckets/{BUCKET_ID}"
        f"/files/{file_id}/view?project={APPWRITE_PROJECT_ID}"
    )


def _delete_if_exists(file_id: str):
    """Aynı ID'li dosya storage'da varsa siler (upsert davranışı için)."""
    storage = get_storage()
    try:
        storage.get_file(bucket_id=BUCKET_ID, file_id=file_id)
        # Varsa sil
        storage.delete_file(bucket_id=BUCKET_ID, file_id=file_id)
    except AppwriteException:
        # Yoksa zaten sorun yok
        pass


def upload_cover(local_cover_path: str, book_id: str) -> str | None:
    """Yerel kapak görselini Appwrite Storage'a yükler.
    Başarılıysa public URL, değilse None döner."""
    storage = get_storage()
    file_id = book_id  # md5 hash, 32 karakter — geçerli Appwrite ID

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
    """Kapağı bir API URL'inden indirip Appwrite Storage'a yükler.
    Dosyadan kapak çıkarılamadığında yedek yol olarak kullanılır."""
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


# ─── Save record ──────────────────────────────────────────────────────────────

def save_book(metadata: dict, cover_url: str = None) -> bool:
    """Kitap kaydını Appwrite veritabanına yazar.
    Başarılıysa True, değilse False döner."""
    db = get_databases()

    file_path = metadata.get("file_path")
    doc_id = _book_id_from_path(file_path) if file_path else ID.unique()

    # Appwrite, None değerleri kabul eder ama yalnızca alan "required" değilse.
    # tags alanı array; boş liste olarak veriyoruz.
    data = {
        "user_id": OWNER_USER_ID,
        "title": metadata.get("title"),
        "author": metadata.get("author"),
        "series": metadata.get("series"),
        "series_order": metadata.get("series_order"),
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
    }

    # series_order ve year integer alanları; boş string gelirse None yap
    for int_field in ("series_order", "file_size", "year", "rating"):
        if data.get(int_field) in ("", 0) and int_field in ("series_order", "year", "rating"):
            # 0 geçerli bir year/rating değil; None'a çevir
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
        # Aynı doc_id zaten varsa (409) güncelle
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
