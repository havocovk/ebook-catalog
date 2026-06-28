// ─────────────────────────────────────────────────────────────────────────────
// API-COLLECTIONS — Koleksiyonlar, ayrı koleksiyon (collections), Adım 19.
//
// Yazarlar/Yayınevleri ile aynı temel mantık (ayrı bir "ad listesi" tablosu),
// AMA ilişki ÇOKLU: bir kitabın books.collections alanı bir DİZİdir (tags
// alanı gibi), book.author === name (tekil) değil
// (book.collections || []).includes(name) (çoklu) ile eşleşme yapılır.
// Bu yüzden yeniden adlandırma/silme, dizinin İÇİNDEKİ bir elemanı
// değiştirmek/çıkarmak şeklinde çalışır — tüm alanın üzerine yazmaz.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, ID, DATABASE_ID, TABLE_ID, COLLECTIONS_ID } from "../../appwrite.js";
import { state } from "../state.js";
import { showLoading, showToast } from "../../ui/common.js";
import { fetchAllPaginated } from "./api-shared.js";

// ─── Koleksiyonları yükle + kitaplarla senkronize et ────────────────────────
// Açılışta bir kez çağrılır (auth.js → Promise.all grubunda, Yazarlar/
// Yayınevleri ile birlikte — Seriler'in aksine başka bir tabloya bağımlı
// değil, bağımsız çalışabilir).
export async function bootstrapCollections() {
  try {
    const existing = await fetchAllPaginated(COLLECTIONS_ID);
    state.collections = existing;

    const existingNames = new Set(existing.map((c) => (c.name || "").trim()));

    // Kitaplardaki benzersiz, dolu koleksiyon adları (dizi olduğu için
    // flatMap ile tüm kitapların collections dizilerini düzleştiriyoruz).
    const bookCollections = new Set();
    for (const b of state.books) {
      for (const name of b.collections || []) {
        const clean = (name || "").trim();
        if (clean) bookCollections.add(clean);
      }
    }

    const toAdd = [...bookCollections].filter((n) => !existingNames.has(n));
    for (const name of toAdd) {
      try {
        const doc = await databases.createDocument(
          DATABASE_ID, COLLECTIONS_ID, ID.unique(), { name }
        );
        state.collections.push(doc);
      } catch {
        /* tek bir koleksiyon eklenemese de devam et */
      }
    }
  } catch (err) {
    showToast("Koleksiyon listesi yüklenemedi: " + (err?.message || err), "error");
  }
}

// ─── Yeni koleksiyon ekle ────────────────────────────────────────────────────
// Aynı adlı koleksiyon zaten varsa onu döndürür (çift kayıt oluşturmaz).
export async function createCollection(name) {
  const clean = (name || "").trim();
  if (!clean) return null;

  const lower = clean.toLocaleLowerCase("tr");
  const existing = state.collections.find(
    (c) => (c.name || "").toLocaleLowerCase("tr") === lower
  );
  if (existing) return existing;

  const doc = await databases.createDocument(
    DATABASE_ID, COLLECTIONS_ID, ID.unique(), { name: clean }
  );
  state.collections.push(doc);
  return doc;
}

// ─── Koleksiyonu yeniden adlandır (her yerde) ───────────────────────────────
// collections kaydını günceller VE bu koleksiyona ait TÜM kitapların
// collections dizisindeki o ELEMANI değiştirir (tüm diziyi değil — kitabın
// ait olduğu diğer koleksiyonlar korunur).
export async function renameCollectionEverywhere(collectionId, oldName, newName) {
  const clean = (newName || "").trim();
  if (!clean) return;

  showLoading(true);
  try {
    // 1) collections kaydını güncelle.
    await databases.updateDocument(DATABASE_ID, COLLECTIONS_ID, collectionId, { name: clean });
    const c = state.collections.find((x) => x.$id === collectionId);
    if (c) c.name = clean;

    // 2) Bu koleksiyona ait kitapların collections dizisindeki elemanı değiştir.
    const affected = state.books.filter((b) => (b.collections || []).includes(oldName));
    for (const b of affected) {
      const newList = (b.collections || []).map((n) => (n === oldName ? clean : n));
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { collections: newList });
      b.collections = newList;
    }
  } catch (err) {
    showToast("Koleksiyon güncellenemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}

// ─── Koleksiyonu sil (her yerde) ─────────────────────────────────────────────
// collections kaydını siler VE bu koleksiyona ait kitapların collections
// dizisinden o İSMİ çıkarır (diziyi boşaltmaz — diğer koleksiyonlar kalır).
export async function deleteCollectionEverywhere(collectionId, name) {
  showLoading(true);
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS_ID, collectionId);
    state.collections = state.collections.filter((x) => x.$id !== collectionId);

    const affected = state.books.filter((b) => (b.collections || []).includes(name));
    for (const b of affected) {
      const newList = (b.collections || []).filter((n) => n !== name);
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { collections: newList });
      b.collections = newList;
    }
  } catch (err) {
    showToast("Koleksiyon silinemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}