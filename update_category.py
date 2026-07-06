#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_category.py

Amaç: books tablosundaki TÜM kitapların 'category' alanını "Edebiyat" olarak günceller.

Düzeltilen iki kritik hata:
  1) Sayfalama: Appwrite REST API limit/offset'i ?queries[]=limit(x)&queries[]=offset(y)
     formatında bekler. Düz ?limit=..&offset=.. yok sayılır ve her seferinde aynı ilk
     sayfa döner -> sonsuz döngü. Doğru query formatı + total ile durdurma eklendi.
  2) Güncelleme gövdesi: REST API alanları {"data": {...}} içinde bekler.
     {"category": "Edebiyat"} yerine {"data": {"category": "Edebiyat"}} gönderilir.
"""

import os
import sys
import time
import json
from dotenv import load_dotenv
import requests


COLLECTION_ID = "books"
TARGET_CATEGORY = "Edebiyat"
PAGE_SIZE = 100            # Appwrite tek sayfada en fazla 100 satir dondurur
REQUEST_TIMEOUT = 20
MAX_RETRIES = 4           # 429/503 gibi gecici hatalarda tekrar deneme


def _request_with_retry(method, url, headers, params=None, json_body=None):
    """429 (rate limit) / 5xx durumlarinda bekleyip tekrar dener."""
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.request(
            method, url, headers=headers, params=params,
            json=json_body, timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code in (429, 500, 502, 503):
            wait = attempt * 2
            print(f"      ⏳ Gecici hata {resp.status_code}, {wait}sn bekleniyor "
                  f"(deneme {attempt}/{MAX_RETRIES})...")
            time.sleep(wait)
            continue
        return resp
    return resp  # son deneme sonucu


def main():
    # ─── ADIM 1: .env dosyasini yukle ────────────────────────────────────
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(script_dir, "scanner", ".env")

    if not os.path.exists(env_path):
        print("❌ HATA: .env dosyasi bulunamadi!")
        print(f"   Beklenen yol: {env_path}")
        sys.exit(1)

    load_dotenv(env_path)
    print(f"✅ .env yuklendi: {env_path}\n")

    # ─── ADIM 2: Konfigurasyon ───────────────────────────────────────────
    ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1").rstrip("/")
    PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID")
    API_KEY = os.getenv("APPWRITE_API_KEY")
    DATABASE_ID = os.getenv("APPWRITE_DATABASE_ID")

    if not all([PROJECT_ID, API_KEY, DATABASE_ID]):
        print("❌ HATA: .env dosyasinda eksik bilgi var!")
        print(f"   PROJECT_ID:  {'✅' if PROJECT_ID else '❌ EKSIK'}")
        print(f"   API_KEY:     {'✅' if API_KEY else '❌ EKSIK'}")
        print(f"   DATABASE_ID: {'✅' if DATABASE_ID else '❌ EKSIK'}")
        sys.exit(1)

    print("📋 Appwrite Konfigurasyonu:")
    print(f"   Endpoint:    {ENDPOINT}")
    print(f"   Project ID:  {PROJECT_ID}")
    print(f"   Database ID: {DATABASE_ID}")
    print(f"   Collection:  {COLLECTION_ID}\n")

    headers = {
        "X-Appwrite-Project": PROJECT_ID,
        "X-Appwrite-Key": API_KEY,
        "Content-Type": "application/json",
    }

    base_url = f"{ENDPOINT}/databases/{DATABASE_ID}/collections/{COLLECTION_ID}/documents"

    # ─── ADIM 3: Tum kitaplari getir (DOGRU sayfalama) ───────────────────
    print("📚 Kitaplar getiriliyor...")
    all_books = []
    offset = 0
    total = None
    # Sonsuz donguye karsi sert guvenlik siniri: makul bir tavan.
    safety_max_iterations = 1000

    for iteration in range(safety_max_iterations):
        # Appwrite 1.9.x query'leri JSON obje olarak bekler (eski limit(x) string
        # syntax'i gecersiz -> "Invalid query: Syntax error"). Dogru format:
        # queries[]={"method":"limit","values":[100]}
        params = [
            ("queries[]", json.dumps({"method": "limit", "values": [PAGE_SIZE]})),
            ("queries[]", json.dumps({"method": "offset", "values": [offset]})),
        ]
        resp = _request_with_retry("GET", base_url, headers, params=params)

        if resp.status_code != 200:
            print(f"❌ HATA: Kitaplar getirilemedi (HTTP {resp.status_code})")
            print(f"   Yanit: {resp.text}")
            sys.exit(1)

        data = resp.json()
        if total is None:
            total = data.get("total", 0)
            print(f"   ℹ️  Appwrite toplam {total} kitap bildirdi.")

        batch = data.get("documents", [])
        if not batch:
            break

        all_books.extend(batch)
        print(f"   ✓ {len(all_books)}/{total} kitap getirildi...")

        # Durma kosulu: hepsini aldiysak veya sayfa yarim doldiysa bitir.
        if len(all_books) >= total or len(batch) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
    else:
        print("⚠️  Guvenlik siniri asildi, dongu durduruldu.")

    total_books = len(all_books)
    print(f"\n✅ Toplam {total_books} kitap alindi.\n")

    if total_books == 0:
        print("⚠️  Hic kitap bulunamadi, cikiliyor.")
        sys.exit(0)

    # ─── ADIM 4: Her kitabin category alanini guncelle (DOGRU govde) ─────
    print(f"🔄 category = '{TARGET_CATEGORY}' olarak guncelleniyor...\n")

    success_count = 0
    error_count = 0
    errors = []

    for idx, book in enumerate(all_books, 1):
        book_id = book.get("$id")
        book_title = book.get("title", "Bilinmiyor")

        url = f"{base_url}/{book_id}"
        # KRITIK DUZELTME: REST API alanlari {"data": {...}} icinde bekler.
        payload = {"data": {"category": TARGET_CATEGORY}}

        try:
            resp = _request_with_retry("PATCH", url, headers, json_body=payload)

            if resp.status_code != 200:
                msg = resp.text
                try:
                    msg = resp.json().get("message", msg)
                except Exception:
                    pass
                raise Exception(f"HTTP {resp.status_code}: {msg}")

            success_count += 1
            if idx % 50 == 0 or idx == total_books:
                print(f"   ✓ {idx}/{total_books} guncellendi...")

        except Exception as e:
            error_count += 1
            errors.append({"kitap": book_title, "id": book_id, "hata": str(e)})
            print(f"   ❌ {idx}/{total_books} HATA: {book_title} -> {e}")

    # ─── ADIM 5: Rapor ───────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("✅ GUNCELLEME TAMAMLANDI")
    print(f"{'='*60}")
    print(f"✅ Basarili: {success_count}")
    print(f"❌ Hatali:   {error_count}")
    print(f"📊 Toplam:   {total_books}")
    if total_books:
        print(f"📈 Oran:     {success_count / total_books * 100:.1f}%")
    print(f"{'='*60}\n")

    if errors:
        print("⚠️  Hatali kitaplar (ilk 10):")
        for err in errors[:10]:
            print(f"   • {err['kitap']} (ID: {err['id']})")
            print(f"     {err['hata']}")
        if len(errors) > 10:
            print(f"   ... ve {len(errors) - 10} kitap daha")
        print()

    if success_count == total_books:
        print("🎉 Tum kitaplar guncellendi. Appwrite'ta category alanini kontrol et.")
    else:
        print("⚠️  Bazi kitaplar guncellenemedi. Yukaridaki hata mesajlarina bak.")


if __name__ == "__main__":
    main()