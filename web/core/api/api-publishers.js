// ─────────────────────────────────────────────────────────────────────────────
// API-PUBLISHERS — Yayınevleri, ayrı koleksiyon (publishers).
//
// Yazarlarla birebir aynı mantık: books.publisher bir metindir; publishers
// koleksiyonu yayınevi adlarının ana listesidir. Eşleşme AD üzerinden olur.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, ID, DATABASE_ID, TABLE_ID, PUBLISHERS_ID } from "../../appwrite.js";
import { state } from "../state.js";
import { showLoading, showToast } from "../../ui/common.js";
import { fetchAllPaginated } from "./api-shared.js";

// ─── Yayınevlerini yükle + kitaplarla senkronize et ─────────────────────────
export async function bootstrapPublishers() {
  try {
    const existing = await fetchAllPaginated(PUBLISHERS_ID);
    state.publishers = existing;

    const existingNames = new Set(existing.map((p) => (p.name || "").trim()));

    const bookPublishers = new Set();
    for (const b of state.books) {
      const n = (b.publisher || "").trim();
      if (n) bookPublishers.add(n);
    }

    const toAdd = [...bookPublishers].filter((n) => !existingNames.has(n));
    for (const name of toAdd) {
      try {
        const doc = await databases.createDocument(
          DATABASE_ID, PUBLISHERS_ID, ID.unique(), { name }
        );
        state.publishers.push(doc);
      } catch {
        /* tek bir yayınevi eklenemese de devam et */
      }
    }
  } catch (err) {
    showToast("Yayınevi listesi yüklenemedi: " + (err?.message || err), "error");
  }
}

// ─── Yeni yayınevi ekle ─────────────────────────────────────────────────────
export async function createPublisher(name) {
  const clean = (name || "").trim();
  if (!clean) return null;

  const lower = clean.toLocaleLowerCase("tr");
  const existing = state.publishers.find(
    (p) => (p.name || "").toLocaleLowerCase("tr") === lower
  );
  if (existing) return existing;

  const doc = await databases.createDocument(
    DATABASE_ID, PUBLISHERS_ID, ID.unique(), { name: clean }
  );
  state.publishers.push(doc);
  return doc;
}

// ─── Yayınevini yeniden adlandır (her yerde) ────────────────────────────────
export async function renamePublisherEverywhere(publisherId, oldName, newName) {
  const clean = (newName || "").trim();
  if (!clean) return;

  showLoading(true);
  try {
    await databases.updateDocument(DATABASE_ID, PUBLISHERS_ID, publisherId, { name: clean });
    const p = state.publishers.find((x) => x.$id === publisherId);
    if (p) p.name = clean;

    const affected = state.books.filter((b) => b.publisher === oldName);
    for (const b of affected) {
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { publisher: clean });
      b.publisher = clean;
    }
  } catch (err) {
    showToast("Yayınevi güncellenemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}

// ─── Yayınevini sil (her yerde) ─────────────────────────────────────────────
export async function deletePublisherEverywhere(publisherId, name) {
  showLoading(true);
  try {
    await databases.deleteDocument(DATABASE_ID, PUBLISHERS_ID, publisherId);
    state.publishers = state.publishers.filter((x) => x.$id !== publisherId);

    const affected = state.books.filter((b) => b.publisher === name);
    for (const b of affected) {
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { publisher: null });
      b.publisher = null;
    }
  } catch (err) {
    showToast("Yayınevi silinemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}