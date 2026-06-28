// ─────────────────────────────────────────────────────────────────────────────
// API-SERIES — Seriler, ayrı koleksiyon (series), YAYINEVİNE bağlı.
//
// Yazar/yayınevinden farkı: bir seri bir yayınevine aittir (publisher_id).
// Böylece aynı adlı iki seri farklı yayınevlerinde çakışmadan durabilir
// (örn. "Bilim Serisi" hem İş Bankası hem Metis için ayrı kayıttır).
//
// books.series hâlâ seri ADIdır; bir kitabın hangi seriye ait olduğu
// (publisher + series) çiftiyle belirlenir. Bu yüzden bir seri yeniden
// adlandırılınca/silinince yalnızca AYNI YAYINEVİNE ait kitaplar etkilenir.
//
// publisher_id, publishers koleksiyonundaki belge $id'sidir (yayınevi adı değil).
//
// NOT: publisherIdByName artık burada YAZILMIYOR — api-shared.js'den import
// ediliyor (api-cascade.js de aynı fonksiyonu kullanıyor, kod tekrarını
// önlemek için Adım 1-2'de paylaşılan dosyaya taşındı).
// ─────────────────────────────────────────────────────────────────────────────

import { databases, ID, DATABASE_ID, TABLE_ID, SERIES_ID } from "../appwrite.js";
import { state } from "./state.js";
import { showLoading, showToast } from "../ui/common.js";
import { fetchAllPaginated, publisherIdByName } from "./api-shared.js";

// ─── Serileri yükle + kitaplarla senkronize et ──────────────────────────────
// ÖNEMLİ: bootstrapPublishers'tan SONRA çağrılmalı (yayınevi ID'leri gerekir).
// Kitaplardaki her benzersiz (yayınevi, seri) çifti için bir seri kaydı oluşur.
export async function bootstrapSeries() {
  try {
    const existing = await fetchAllPaginated(SERIES_ID);
    state.series = existing;

    // Var olan (publisher_id | name) anahtarları.
    const existingKeys = new Set(
      existing.map((s) => `${s.publisher_id || ""}|||${(s.name || "").trim()}`)
    );

    // Kitaplardaki benzersiz (yayınevi, seri) çiftleri.
    const pairs = new Map(); // key -> { name, publisherId }
    for (const b of state.books) {
      const sName = (b.series || "").trim();
      if (!sName) continue;
      const pubId = publisherIdByName(b.publisher);
      const key = `${pubId || ""}|||${sName}`;
      if (!pairs.has(key)) pairs.set(key, { name: sName, publisherId: pubId });
    }

    // Eksik olanları ekle.
    for (const [key, { name, publisherId }] of pairs) {
      if (existingKeys.has(key)) continue;
      try {
        const doc = await databases.createDocument(
          DATABASE_ID, SERIES_ID, ID.unique(),
          { name, publisher_id: publisherId }
        );
        state.series.push(doc);
      } catch {
        /* tek bir seri eklenemese de devam et */
      }
    }
  } catch (err) {
    showToast("Seri listesi yüklenemedi: " + (err?.message || err), "error");
  }
}

// ─── Yeni seri ekle (bir yayınevine bağlı) ──────────────────────────────────
// Aynı yayınevinde aynı adlı seri varsa onu döndürür.
export async function createSeries(name, publisherId) {
  const clean = (name || "").trim();
  if (!clean) return null;

  const lower = clean.toLocaleLowerCase("tr");
  const existing = state.series.find(
    (s) =>
      (s.publisher_id || null) === (publisherId || null) &&
      (s.name || "").toLocaleLowerCase("tr") === lower
  );
  if (existing) return existing;

  const doc = await databases.createDocument(
    DATABASE_ID, SERIES_ID, ID.unique(),
    { name: clean, publisher_id: publisherId || null }
  );
  state.series.push(doc);
  return doc;
}

// ─── Seriyi yeniden adlandır (aynı yayınevindeki kitaplarda) ────────────────
export async function renameSeriesEverywhere(seriesId, oldName, newName, publisherId) {
  const clean = (newName || "").trim();
  if (!clean) return;

  showLoading(true);
  try {
    await databases.updateDocument(DATABASE_ID, SERIES_ID, seriesId, { name: clean });
    const s = state.series.find((x) => x.$id === seriesId);
    if (s) s.name = clean;

    // Yalnızca bu yayınevine ait, bu seriye sahip kitapları güncelle.
    const pub = state.publishers.find((p) => p.$id === publisherId);
    const pubName = pub ? pub.name : null;
    const affected = state.books.filter(
      (b) => b.series === oldName && (b.publisher || null) === (pubName || null)
    );
    for (const b of affected) {
      await databases.updateDocument(DATABASE_ID, TABLE_ID, b.$id, { series: clean });
      b.series = clean;
    }
  } catch (err) {
    showToast("Seri güncellenemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}

// ─── Seriyi sil (aynı yayınevindeki kitaplarda seri bilgisini boşalt) ───────
export async function deleteSeriesEverywhere(seriesId, name, publisherId) {
  showLoading(true);
  try {
    await databases.deleteDocument(DATABASE_ID, SERIES_ID, seriesId);
    state.series = state.series.filter((x) => x.$id !== seriesId);

    const pub = state.publishers.find((p) => p.$id === publisherId);
    const pubName = pub ? pub.name : null;
    const affected = state.books.filter(
      (b) => b.series === name && (b.publisher || null) === (pubName || null)
    );
    for (const b of affected) {
      await databases.updateDocument(
        DATABASE_ID, TABLE_ID, b.$id, { series: null, series_order: null }
      );
      b.series = null;
      b.series_order = null;
    }
  } catch (err) {
    showToast("Seri silinemedi: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}