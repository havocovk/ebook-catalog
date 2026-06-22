// ─────────────────────────────────────────────────────────────────────────────
// API — Tüm Appwrite veritabanı işlemleri tek yerde.
//
// "Veri katmanı" burasıdır: kitapları çekmek, güncellemek, silmek, yedek için
// hepsini almak gibi işler. Bilerek SADE tutuldu — burada ekran/çizim mantığı
// yoktur. Çizimi sayfalar (catalog.js vb.) ve router.js üstlenir. Böylece veri
// işleri ile görsel işler birbirine karışmaz.
// ─────────────────────────────────────────────────────────────────────────────

import {
  databases,
  storage,
  Query,
  ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  DATABASE_ID,
  TABLE_ID,
  BUCKET_ID,
  AUTHORS_ID,
  PUBLISHERS_ID,
  SERIES_ID,
  COLLECTIONS_ID,
} from "../appwrite.js";
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

// ─── Dahili: bir koleksiyondaki tüm kayıtları sayfa sayfa çek ───────────────
// Hafızayı (state) değiştirmez, sadece belge dizisini döndürür.
// Varsayılan koleksiyon kitaplardır; yazar/yayınevi/seri için de kullanılır.
async function fetchAllPaginated(collectionId = TABLE_ID) {
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

// ═══════════════════════════════════════════════════════════════════════════
// YAZARLAR — ayrı koleksiyon (authors).
//
// Mantık: books.author hâlâ bir metindir (yazarın adı). authors koleksiyonu
// ise yazar adlarının "ana listesi"dir; modal'daki açılır menü buradan beslenir.
// İki taraf yazar ADI üzerinden eşleşir (ID değil) — bu yüzden bir yazar
// yeniden adlandırılınca o ada sahip tüm kitaplar da güncellenir.
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// YAYINEVLERİ — ayrı koleksiyon (publishers).
//
// Yazarlarla birebir aynı mantık: books.publisher bir metindir; publishers
// koleksiyonu yayınevi adlarının ana listesidir. Eşleşme AD üzerinden olur.
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// SERİLER — ayrı koleksiyon (series), YAYINEVİNE bağlı.
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
// ═══════════════════════════════════════════════════════════════════════════

// Yardımcı: yayınevi adından publishers $id bul (yoksa null).
function publisherIdByName(name) {
  const clean = (name || "").trim();
  if (!clean) return null;
  const p = state.publishers.find((x) => x.name === clean);
  return p ? p.$id : null;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// KİTAP KAPAĞI — manuel yükleme (Kitap Ayıklayıcı / modal'dan).
//
// Tarayıcı kapak resmini dosyadan çıkaramadığında, kullanıcı kendi bulduğu
// resmi buradan yükleyebilir. Her yükleme YENİ ve BENZERSİZ bir dosya ID'si
// alır (bkz. uploadBookCover altındaki not — eski dosya kasıtlı olarak
// silinmez, çünkü silme izni client tarafında yok).
// ═══════════════════════════════════════════════════════════════════════════

// ─── Storage dosyası için herkese açık görüntüleme adresini kur ────────────
// Python tarafındaki _build_public_url ile birebir aynı format kullanılır.
function buildPublicCoverUrl(fileId) {
  return (
    `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}` +
    `/files/${fileId}/view?project=${APPWRITE_PROJECT_ID}`
  );
}

// ─── Bir kitabın kapak resmini yükle/değiştir ───────────────────────────────
// ÖNEMLİ: Eski kapak dosyası SİLİNMEYE ÇALIŞILMAZ. Sebep: Python tarayıcısı
// kapak dosyalarını server API key ile (izin belirtmeden) yüklüyor; bu da
// dosyayı sadece o API key'in silebileceği anlamına geliyor. Tarayıcıdan
// (kullanıcı oturumuyla) o dosyayı silmeye çalışmak HTTP 401 (yetkisiz)
// hatası verir — bu da yüklemenin tamamını bozar (409 "ID already exists").
//
// Bu yüzden her yükleme YENİ ve BENZERSİZ bir dosya ID'si (ID.unique()) ile
// yapılır. Eski dosya storage'da kalır (silinmez) ama kitabın cover_url alanı
// her zaman en güncel resme işaret eder — yani kullanıcı için kapak değişimi
// sınırsız sayıda ve sorunsuz çalışır.
//
// Dönüş: yeni cover_url (başarılıysa), hata olursa fırlatır.
export async function uploadBookCover(bookId, file) {
  const fileId = ID.unique(); // Her yüklemede yepyeni, çakışmayan bir ID

  // 1) Yeni dosyayı storage'a yükle.
  await storage.createFile(BUCKET_ID, fileId, file);

  // 2) Yeni adresi kitabın kaydına yaz (eski kapak referansının üzerine yazılır).
  const coverUrl = buildPublicCoverUrl(fileId);
  await databases.updateDocument(DATABASE_ID, TABLE_ID, bookId, { cover_url: coverUrl });

  // Hafızadaki kopyayı da güncelle (sayfa yeniden çekmeden anında görünsün).
  const idx = state.books.findIndex((b) => b.$id === bookId);
  if (idx !== -1) state.books[idx] = { ...state.books[idx], cover_url: coverUrl };

  return coverUrl;
}

// ═══════════════════════════════════════════════════════════════════════════
// KOLEKSİYONLAR — ayrı koleksiyon (collections), Adım 19.
//
// Yazarlar/Yayınevleri ile aynı temel mantık (ayrı bir "ad listesi" tablosu),
// AMA ilişki ÇOKLU: bir kitabın books.collections alanı bir DİZİdir (tags
// alanı gibi), book.author === name (tekil) değil
// (book.collections || []).includes(name) (çoklu) ile eşleşme yapılır.
// Bu yüzden yeniden adlandırma/silme, dizinin İÇİNDEKİ bir elemanı
// değiştirmek/çıkarmak şeklinde çalışır — tüm alanın üzerine yazmaz.
// ═══════════════════════════════════════════════════════════════════════════

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