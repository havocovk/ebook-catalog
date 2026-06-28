// ─────────────────────────────────────────────────────────────────────────────
// API-AUTHORS — Yazarlar, ayrı koleksiyon (authors).
//
// Mantık: books.author hâlâ bir metindir (yazarın adı). authors koleksiyonu
// ise yazar adlarının "ana listesi"dir; modal'daki açılır menü buradan beslenir.
// İki taraf yazar ADI üzerinden eşleşir (ID değil) — bu yüzden bir yazar
// yeniden adlandırılınca o ada sahip tüm kitaplar da güncellenir.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, ID, DATABASE_ID, TABLE_ID, AUTHORS_ID } from "../../appwrite.js";
import { state } from "../state.js";
import { showLoading, showToast } from "../../ui/common.js";
import { fetchAllPaginated } from "./api-shared.js";

// ─── Yazarları yükle + kitaplarla senkronize et ────────────────────────────
// Açılışta bir kez çağrılır. authors koleksiyonunu çeker, sonra kitaplarda
// geçen ama listede olmayan yazar adlarını listeye ekler (eksik tamamlama).
// Böylece eski kitapların yazarları da açılır menüde görünür.
export async function bootstrapAuthors() {
  try {
    const existing = await fetchAllPaginated(AUTHORS_ID);
    state.authors = existing;

    const existingNames = new Set(existing.map((a) => (a.name || "").trim()));

    // Kitaplarda geçen benzersiz, dolu yazar adları.
    const bookAuthors = new Set();
    for (const b of state.books) {
      const n = (b.author || "").trim();
      if (n) bookAuthors.add(n);
    }

    // Listede olmayanları ekle.
    const toAdd = [...bookAuthors].filter((n) => !existingNames.has(n));
    for (const name of toAdd) {
      try {
        const doc = await databases.createDocument(
          DATABASE_ID, AUTHORS_ID, ID.unique(), { name }
        );
        state.authors.push(doc);
      } catch {
        /* tek bir yazar eklenemese de devam et */
      }
    }
  } catch (err) {
    showToast("Yazar listesi yüklenemedi: " + (err?.message || err), "error");
  }
}

// ─── Yeni yazar ekle ────────────────────────────────────────────────────────
// Aynı adlı yazar zaten varsa onu döndürür (çift kayıt oluşturmaz).
export async function createAuthor(name) {
  const clean = (name || "").trim();
  if (!clean) return null;

  const lower = clean.toLocaleLowerCase("tr");
  const existing = state.authors.find(
    (a) => (a.name || "").toLocaleLowerCase("tr") === lower
  );
  if (existing) return existing;

  const doc = await databases.createDocument(
    DATABASE_ID, AUTHORS_ID, ID.unique(), { name: clean }
  );
  state.authors.push(doc);
  return doc;
}

// ─── Yazarı yeniden adlandır (her yerde) ────────────────────────────────────
// authors kaydını günceller VE bu yazara ait tüm kitapların author alanını
// yeni adla değiştirir (veritabanı + hafıza).
export async function renameAuthorEverywhere(authorId, oldName, newName) {
  const clean = (newName || "").trim();
  if (!clean) return;

  showLoading(true);
  try {
    // 1) authors kaydını güncelle.
    await databases.updateDocument(DATABASE_ID, AUTHORS_ID, authorId, { name: clean });
    const a = state.authors.find((x) => x.$id === authorId);
    if (a) a.name = clean;

    // 2) Bu yazara ait kitapları güncelle.
    const affected = state.books.filter((b) => b.author === oldName);
    for (const b of affected) {
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { author: clean });
      b.author = clean;
    }
  } catch (err) {
    showToast("Yazar güncellenemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}

// ─── Yazarı sil (her yerde) ─────────────────────────────────────────────────
// authors kaydını siler VE bu yazara ait kitapların author alanını boşaltır.
export async function deleteAuthorEverywhere(authorId, name) {
  showLoading(true);
  try {
    await databases.deleteDocument(DATABASE_ID, AUTHORS_ID, authorId);
    state.authors = state.authors.filter((x) => x.$id !== authorId);

    const affected = state.books.filter((b) => b.author === name);
    for (const b of affected) {
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { author: null });
      b.author = null;
    }
  } catch (err) {
    showToast("Yazar silinemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}