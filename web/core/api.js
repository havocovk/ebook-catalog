// ─────────────────────────────────────────────────────────────────────────────
// API — Tüm Appwrite veritabanı işlemleri tek yerde.
//
// "Veri katmanı" burasıdır: kitapları çekmek, güncellemek, silmek, yedek için
// hepsini almak gibi işler. Bilerek SADE tutuldu — burada ekran/çizim mantığı
// yoktur. Çizimi sayfalar (catalog.js vb.) ve router.js üstlenir. Böylece veri
// işleri ile görsel işler birbirine karışmaz.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, Query, ID, DATABASE_ID, TABLE_ID } from "../appwrite.js";
import { state } from "./state.js";
import { showLoading, showToast } from "../ui/common.js";

// Appwrite tek bir istekte en fazla 100 kayıt döndürür; bu yüzden sayfa sayfa çekeriz.
const PAGE_SIZE = 100;

// Appwrite'ın her belgeye otomatik eklediği sistem alanları.
// Yedekten geri yüklerken bunları ayıklamamız gerekir (yeniden yazılamazlar).
export const SYSTEM_FIELDS = [
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$collectionId",
  "$databaseId",
  "$sequence",
];

// ─── Dahili: tüm kayıtları sayfa sayfa çek ──────────────────────────────────
// Hafızayı (state) değiştirmez, sadece kitap dizisini döndürür.
// Hem normal yükleme hem de yedekleme bu fonksiyonu kullanır.
async function fetchAllPaginated() {
  const all = [];
  let cursor = null;

  while (true) {
    const queries = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const res = await databases.listDocuments(DATABASE_ID, TABLE_ID, queries);
    all.push(...res.documents);

    // Gelen kayıt sayısı sayfa boyutundan azsa, son sayfaya geldik demektir.
    if (res.documents.length < PAGE_SIZE) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }

  return all;
}

// ─── Kitapları yükle ────────────────────────────────────────────────────────
// Tüm kitapları çekip hafızaya (state.books) koyar. "Yükleniyor" animasyonunu yönetir.
// Çizim YAPMAZ — yükleme bittikten sonra router.js ilgili sayfayı çizer.
export async function loadBooks() {
  showLoading(true);
  try {
    state.books = await fetchAllPaginated();
  } catch (err) {
    showToast("Kitaplar yüklenemedi: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

// ─── Yedek için tüm kayıtları getir ─────────────────────────────────────────
// Hafızaya dokunmadan tüm kitapları dizi olarak döndürür (yedek dosyası yazmak için).
export async function fetchAllBooks() {
  return fetchAllPaginated();
}

// ─── Tek kayıt güncelle ─────────────────────────────────────────────────────
// Başarılıysa Appwrite'ın döndürdüğü güncel belgeyi verir; hata olursa fırlatır.
export async function updateBookRecord(id, updates) {
  return databases.updateDocument(DATABASE_ID, TABLE_ID, id, updates);
}

// ─── Tek kayıt sil ──────────────────────────────────────────────────────────
export async function deleteBookRecord(id) {
  return databases.deleteDocument(DATABASE_ID, TABLE_ID, id);
}

// ─── Yeni kayıt oluştur ─────────────────────────────────────────────────────
// Yedekten geri yükleme için kullanılır. id verilmezse Appwrite kendi üretir.
export async function createBookRecord(id, data) {
  return databases.createDocument(DATABASE_ID, TABLE_ID, id || ID.unique(), data);
}

// ─── Sistem alanlarını ayıkla ───────────────────────────────────────────────
// Bir belgeden $id, $createdAt gibi sistem alanlarını çıkarıp temiz veri döndürür.
export function stripSystemFields(doc) {
  const data = {};
  for (const key of Object.keys(doc)) {
    if (!SYSTEM_FIELDS.includes(key)) data[key] = doc[key];
  }
  return data;
}