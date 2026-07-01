# -*- coding: utf-8 -*-
"""
Kapak indirme sorununu teşhis eden tek-dosya test scripti.
scanner/ klasöründen çalıştır: python diagnose_cover.py
"""
from dotenv import load_dotenv
load_dotenv()

import os, json, requests
from appwrite.client import Client
from appwrite.services.databases import Databases
from appwrite.services.storage import Storage
from appwrite.query import Query

ENDPOINT   = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID")
API_KEY    = os.getenv("APPWRITE_API_KEY")
DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID", "ebook_catalog")
TABLE_ID    = os.getenv("APPWRITE_TABLE_ID", "books")
BUCKET_ID   = os.getenv("APPWRITE_BUCKET_ID", "covers")

client = Client().set_endpoint(ENDPOINT).set_project(PROJECT_ID).set_key(API_KEY)
storage = Storage(client)

# 1) Veritabanından kapağı olan bir kitap bul
print("=== 1) Kapağı olan bir kitap aranıyor... ===")
headers = {
    "X-Appwrite-Project": PROJECT_ID,
    "X-Appwrite-Key": API_KEY,
    "Content-Type": "application/json",
}
resp = requests.get(
    f"{ENDPOINT}/databases/{DATABASE_ID}/collections/{TABLE_ID}/documents",
    headers=headers,
    params={"queries[]": [Query.limit(10)]},
    timeout=15,
)
print(f"   HTTP {resp.status_code}")
books = resp.json().get("documents", [])
book_with_cover = next((b for b in books if b.get("cover_url")), None)

if not book_with_cover:
    print("   HATA: Kapağı olan kitap bulunamadı!")
    exit(1)

book_id = book_with_cover["$id"]
cover_url = book_with_cover["cover_url"]
print(f"   Kitap ID: {book_id}")
print(f"   cover_url: {cover_url}")

# 2) SDK ile dene
print("\n=== 2) SDK get_file_download() deneniyor... ===")
try:
    content = storage.get_file_download(bucket_id=BUCKET_ID, file_id=book_id)
    print(f"   Sonuç tipi: {type(content)}")
    if isinstance(content, bytes):
        print(f"   ✅ BAŞARILI: {len(content)} byte indirildi")
    elif isinstance(content, dict):
        print(f"   ❌ DICT döndü (hata): {json.dumps(content, ensure_ascii=False)[:300]}")
    else:
        print(f"   ❓ Beklenmeyen tip: {repr(content)[:200]}")
except Exception as e:
    print(f"   ❌ HATA: {type(e).__name__}: {e}")

# 3) Doğrudan HTTP GET ile dene (SDK bypass)
print("\n=== 3) Doğrudan HTTP GET deneniyor... ===")
url = f"{ENDPOINT}/storage/buckets/{BUCKET_ID}/files/{book_id}/download"
try:
    r = requests.get(url, headers=headers, timeout=15)
    print(f"   HTTP {r.status_code}")
    print(f"   Content-Type: {r.headers.get('Content-Type')}")
    if r.status_code == 200:
        print(f"   ✅ BAŞARILI: {len(r.content)} byte indirildi")
    else:
        print(f"   ❌ Yanıt: {r.text[:300]}")
except Exception as e:
    print(f"   ❌ HATA: {type(e).__name__}: {e}")

# 4) cover_url'i doğrudan dene (public URL)
print("\n=== 4) cover_url doğrudan deneniyor... ===")
try:
    r2 = requests.get(cover_url, timeout=15)
    print(f"   HTTP {r2.status_code}")
    print(f"   Content-Type: {r2.headers.get('Content-Type')}")
    if r2.status_code == 200:
        print(f"   ✅ BAŞARILI: {len(r2.content)} byte indirildi")
    else:
        print(f"   ❌ Yanıt: {r2.text[:300]}")
except Exception as e:
    print(f"   ❌ HATA: {type(e).__name__}: {e}")