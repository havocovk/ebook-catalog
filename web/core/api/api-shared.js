// ─────────────────────────────────────────────────────────────────────────────
// API-SHARED — Birden fazla api-*.js parçası tarafından kullanılan ortak
// yardımcı fonksiyonlar.
//
// Bu dosya api.js'in parçalanması sırasında (Adım 1-1'de) ortaya çıktı:
// fetchAllPaginated ve publisherIdByName tek bir parçaya ait değil, birden
// fazla parça (api-books, api-authors, api-publishers, api-series,
// api-collections, api-cascade) bunları kullanıyor. Kod tekrarı yapmamak
// için tek bir ortak yere taşındı.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, Query, DATABASE_ID, TABLE_ID } from "../../appwrite.js";
import { state } from "../state.js";

// Appwrite tek bir istekte en fazla 100 kayıt döndürür; bu yüzden sayfa sayfa çekeriz.
const PAGE_SIZE = 100;

// ─── Bir koleksiyondaki tüm kayıtları sayfa sayfa çek ───────────────────────
// Hafızayı (state) değiştirmez, sadece belge dizisini döndürür.
// Varsayılan koleksiyon kitaplardır; yazar/yayınevi/seri/koleksiyon için de kullanılır.
export async function fetchAllPaginated(collectionId = TABLE_ID) {
  const all = [];
  let cursor = null;

  while (true) {
    const queries = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const res = await databases.listDocuments(DATABASE_ID, collectionId, queries);
    all.push(...res.documents);

    // Gelen kayıt sayısı sayfa boyutundan azsa, son sayfaya geldik demektir.
    if (res.documents.length < PAGE_SIZE) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }

  return all;
}

// ─── Yayınevi adından publishers $id bul (yoksa null) ───────────────────────
// Seriler (publisher_id, name) çiftiyle tanımlandığı için, bir kitabın
// yayınevi ADINDAN publishers koleksiyonundaki belge ID'sini bulmaya
// yarar. api-series.js (seri oluştururken) ve api-cascade.js (yetim seri
// kontrolünde) tarafından kullanılır.
export function publisherIdByName(name) {
  const clean = (name || "").trim();
  if (!clean) return null;
  const p = state.publishers.find((x) => x.name === clean);
  return p ? p.$id : null;
}