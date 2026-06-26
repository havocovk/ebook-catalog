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

// ─── Kapak URL'inden dosya ID'sini çıkar ────────────────────────────────────
// cover_url formatı (hem web hem Python tarafında aynı): .../buckets/{BUCKET_ID}
// /files/{FILE_ID}/view?... — bu fonksiyon /files/ ile bir sonraki / arasındaki
// segmenti çıkarır. Format eşleşmezse (örn. cover_url boş veya beklenmeyen bir
// yapıdaysa) null döner — çağıran taraf bunu "silinecek dosya yok" olarak ele alır.
function extractCoverFileId(coverUrl) {
  if (!coverUrl) return null;
  const match = coverUrl.match(/\/files\/([^/]+)\//);
  return match ? match[1] : null;
}

// ─── Tek kayıt sil ──────────────────────────────────────────────────────────
// Kitabı SİLMEDEN ÖNCE, eğer bir kapak resmi varsa storage'dan da siler.
// Bu olmazsa, silinen kitabın kapak dosyası storage'da "yetim" kalır — hem
// gereksiz yer kaplar hem de aynı kitap yeniden tarandığında Appwrite tarafı
// (Python uploader.py, book_id'den deterministik file_id ürettiği için) "A
// storage file with the requested ID already exists" hatası verir.
//
// Kapak silme işlemi BAŞARISIZ olsa bile (örn. dosya zaten storage'da yoksa,
// network hatası vb.) kitabın kendisinin silinmesi ENGELLENMEZ — kapak silme
// sessizce loglanır ve devam edilir; kullanıcı bir kitabı silmeye çalışırken
// "kapak silinemedi" diye takılıp kalmamalı.
//
// ── Adım 24: Cascade delete (yetim kayıt temizliği) ─────────────────────────
// NOT: Bu fonksiyon kitabı state.books'tan SİLER (çağıran taraf — modal.js,
// catalog.js — bunu artık kendisi yapmıyor). Cascade delete kontrolünün
// DOĞRU çalışması için state.books güncellemesi, Appwrite'tan silme başarılı
// olur olmaz, cascade kontrolünden ÖNCE yapılmalı — aksi halde "bu yazarın
// başka kitabı var mı?" kontrolü silinen kitabı da sayar ve yanlışlıkla
// "hâlâ kitabı var" sonucuna ulaşır.
export async function deleteBookRecord(id) {
  const book = state.books.find((b) => b.$id === id);
  const fileId = book ? extractCoverFileId(book.cover_url) : null;

  if (fileId) {
    try {
      await storage.deleteFile(BUCKET_ID, fileId);
    } catch (err) {
      // Dosya zaten yoksa (404) veya başka bir sebeple silinemiyorsa, kitap
      // silme işlemini bu yüzden durdurmuyoruz — sadece konsola not düşülür.
      console.warn(`[deleteBookRecord] Kapak dosyası silinemedi (${fileId}):`, err?.message || err);
    }
  }

  // ── Adım 29: "Doküman zaten yok" (404) hatası BAŞARISIZLIK değil, hedefe
  // zaten ulaşılmış demektir ─────────────────────────────────────────────────
  // SORUN: Appwrite'a giden bir DELETE isteği SUNUCU TARAFINDA başarıyla
  // tamamlanabilir, ama yanıt tarayıcıya dönerken bir network kesintisi/
  // gecikmesi yaşanırsa, bu fonksiyon "hata oldu" sanıp durur — state.books
  // güncellenmez, cascade delete hiç çalışmaz. Kitap ekranda "hayalet" olarak
  // kalır: Appwrite'ta YOK ama arayüzde HÂLÂ VAR görünür. Kullanıcı tekrar
  // silmeyi denediğinde Appwrite "böyle bir kayıt yok" (404) der — bu da
  // kafa karıştırıcı bir "silme hatası" olarak görünür, oysa kitap zaten
  // silinmişti.
  //
  // ÇÖZÜM: deleteDocument 404 ("document_not_found") hatasıyla başarısız
  // olursa, bunu GERÇEK bir hata olarak yukarı fırlatmak yerine "zaten
  // silinmiş, devam et" olarak ele alıyoruz. Böylece state.books güncellenir
  // ve cascade delete normal şekilde çalışır — sistem bir önceki başarısız
  // (ama sunucu tarafında aslında başarılı olmuş) denemeyi kendi kendine
  // düzeltir. Başka türlü bir hata (network kopması, yetkisiz erişim, vb.)
  // ise hâlâ olduğu gibi yukarı fırlatılır — sadece "zaten yok" durumu
  // toleranslı karşılanıyor.
  try {
    await databases.deleteDocument(DATABASE_ID, TABLE_ID, id);
  } catch (err) {
    const alreadyGone = err?.code === 404;
    if (!alreadyGone) throw err;
    console.warn(`[deleteBookRecord] Kitap zaten silinmiş (${id}) — hedefe ulaşıldı, devam ediliyor.`);
  }
  // ── Adım 29 sonu ─────────────────────────────────────────────────────────────

  // Kitap Appwrite'tan silindi (ya da zaten silinmişti) — hafızadaki kopyayı
  // da hemen çıkar. Cascade delete kontrolleri (aşağıda) state.books'a
  // bakarak "başka kitabı var mı" diye soracağı için, bu satır cascade
  // kontrolünden ÖNCE çalışmalı.
  state.books = state.books.filter((b) => b.$id !== id);

  if (book) {
    await cascadeDeleteOrphans(book);
  }
}

// ─── Cascade delete: yetim kalan author/publisher/series/collection'ları sil ─
// Bir kitap silindikten SONRA çağrılır (state.books o kitabı içermeyecek
// şekilde güncellenmiş olmalı — yukarıdaki deleteBookRecord bunu garanti eder).
//
// Mantık her dört varlık için aynıdır: "silinen kitabın sahip olduğu isim/ID,
// kalan kitaplardan herhangi birinde HÂLÂ geçiyor mu?" Geçmiyorsa, o yazar/
// yayınevi/seri/koleksiyon artık hiçbir kitapla ilişkili değildir — veritabanı
// temiz kalsın diye silinir.
//
// Tek bir varlığın silinmesi başarısız olursa (network hatası vb.) hata
// sessizce loglanır ve diğerleri için devam edilir — bir kitabı silme işlemi,
// arka plandaki temizlik adımlarından biri başarısız olduğu için kullanıcıya
// "silinemedi" diye görünmemeli; kitabın kendisi zaten silindi.
async function cascadeDeleteOrphans(deletedBook) {
  // ── Yazar ──────────────────────────────────────────────────────────────
  const authorName = (deletedBook.author || "").trim();
  if (authorName) {
    const stillUsed = state.books.some((b) => b.author === authorName);
    if (!stillUsed) {
      const author = state.authors.find((a) => a.name === authorName);
      if (author) {
        try {
          await databases.deleteDocument(DATABASE_ID, AUTHORS_ID, author.$id);
          state.authors = state.authors.filter((a) => a.$id !== author.$id);
        } catch (err) {
          console.warn(`[cascadeDelete] Yetim yazar silinemedi (${authorName}):`, err?.message || err);
        }
      }
    }
  }

  // ── Seri ───────────────────────────────────────────────────────────────
  // Bir seri (publisher_id, name) çiftiyle tanımlanır — aynı isimli seri
  // farklı yayınevlerinde ayrı kayıt olabilir (bkz. bootstrapSeries). Bu
  // yüzden "hâlâ kullanılıyor mu?" kontrolü, sadece seri ADINA değil, AYNI
  // YAYINEVİNE ait kitaplara bakarak yapılır.
  //
  // ── Adım 26: SIRA ÖNEMLİ — bu blok YAYINEVİ bloğundan ÖNCE çalışmalı. ─────
  // Seri kontrolü, deletedBook.publisher adından publisherIdByName() ile bir
  // ID buluyor — bu arama state.publishers İÇİNDE yapılıyor. Eğer yayınevi
  // bloğu BU bloktan ÖNCE çalışıp yayınevini state.publishers'tan silmiş
  // olsaydı (silinen kitap o yayınevinin de SON kitabıysa), publisherIdByName
  // artık o yayınevini BULAMAZ ve null döner — bu da seri kaydının (gerçek
  // publisher_id'si hâlâ duran) state.series içinde eşleşmemesine, dolayısıyla
  // YANLIŞLIKLA BULUNAMAMASINA ve silinmemesine yol açardı. Bu yüzden seri
  // kontrolü, yayınevi state.publishers'ta HÂLÂ DURURKEN yapılmalı.
  const seriesName = (deletedBook.series || "").trim();
  if (seriesName) {
    const seriesPublisherId = publisherIdByName(deletedBook.publisher);
    const stillUsed = state.books.some(
      (b) =>
        b.series === seriesName &&
        publisherIdByName(b.publisher) === seriesPublisherId
    );
    if (!stillUsed) {
      const series = state.series.find(
        (s) => s.name === seriesName && (s.publisher_id || null) === (seriesPublisherId || null)
      );
      if (series) {
        try {
          // NOT: deleteSeriesEverywhere() KASITLI olarak kullanılmıyor — o
          // fonksiyon "seriyi sil + ait kitaplardan referansı kaldır" işi
          // yapar. Burada kitap zaten silinmiş durumda, kitaplara dokunmaya
          // gerek yok; sadece yetim kalan seri kaydını doğrudan sil.
          await databases.deleteDocument(DATABASE_ID, SERIES_ID, series.$id);
          state.series = state.series.filter((s) => s.$id !== series.$id);
        } catch (err) {
          console.warn(`[cascadeDelete] Yetim seri silinemedi (${seriesName}):`, err?.message || err);
        }
      }
    }
  }
  // ── Adım 26 sonu ──────────────────────────────────────────────────────────

  // ── Yayınevi ───────────────────────────────────────────────────────────
  // NOT: Bu blok SERİ bloğundan SONRA gelmeli (yukarıdaki Adım 26 notuna bak).
  const publisherName = (deletedBook.publisher || "").trim();
  if (publisherName) {
    const stillUsed = state.books.some((b) => b.publisher === publisherName);
    if (!stillUsed) {
      const publisher = state.publishers.find((p) => p.name === publisherName);
      if (publisher) {
        try {
          await databases.deleteDocument(DATABASE_ID, PUBLISHERS_ID, publisher.$id);
          state.publishers = state.publishers.filter((p) => p.$id !== publisher.$id);
        } catch (err) {
          console.warn(`[cascadeDelete] Yetim yayınevi silinemedi (${publisherName}):`, err?.message || err);
        }
      }
    }
  }

  // ── Koleksiyonlar ──────────────────────────────────────────────────────
  // books.collections bir DİZİdir (bir kitap birden fazla koleksiyona ait
  // olabilir) — bu yüzden silinen kitabın AİT OLDUĞU HER koleksiyon için
  // ayrı ayrı "hâlâ kullanılıyor mu?" kontrolü yapılır. Yayınevi/seriden
  // bağımsız olduğu için sıra burada önemli değil.
  const bookCollections = deletedBook.collections || [];
  for (const collectionName of bookCollections) {
    const clean = (collectionName || "").trim();
    if (!clean) continue;

    const stillUsed = state.books.some((b) => (b.collections || []).includes(clean));
    if (!stillUsed) {
      const collection = state.collections.find((c) => c.name === clean);
      if (collection) {
        try {
          await databases.deleteDocument(DATABASE_ID, COLLECTIONS_ID, collection.$id);
          state.collections = state.collections.filter((c) => c.$id !== collection.$id);
        } catch (err) {
          console.warn(`[cascadeDelete] Yetim koleksiyon silinemedi (${clean}):`, err?.message || err);
        }
      }
    }
  }
}
// ── Adım 24 sonu ─────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════
// ── Adım 25: YETİM KAYIT TARAYICISI (güvenlik ağı) ──────────────────────────
//
// cascadeDeleteOrphans() (yukarıda) bir kitap silinirken ÇALIŞAN, "anlık"
// bir temizliktir — normal koşullarda yeterlidir. Bu fonksiyon ise BUNUN
// TAMAMLAYICISIDIR: herhangi bir sebepten (geçmişte oluşmuş eski yetim
// kayıtlar, ileride eklenecek başka bir silme yolunun cascade'i çağırmayı
// unutması, Appwrite konsolünden elle yapılan bir silme, vb.) veritabanında
// kalmış olabilecek yetim author/publisher/series/collection kayıtlarını
// İSTENİLDİĞİNDE (elle tetiklenerek) tarar ve temizler.
//
// "Yetim" tanımı, cascadeDeleteOrphans ile BİREBİR aynı mantığı kullanır:
// state.books içinde o ada/ID'ye sahip HİÇ kitap kalmamışsa, kayıt yetimdir.
//
// ÖNEMLİ: Bu fonksiyon SADECE okuma + silme yapar, kitaplara HİÇ dokunmaz —
// zaten yetim bir kayıt, tanımı itibarıyla hiçbir kitapla ilişkili değildir.
// ═══════════════════════════════════════════════════════════════════════════

// Dahili: bir varlık listesini (authors/publishers/collections — hepsi
// "name" alanıyla kitaplarda referans edilir) tarar, kullanılmayanları siler.
// getUsedNames: state.books'tan o varlığın kullanılan TÜM adlarını çıkaran
// fonksiyon (author için tekil alan, collections için dizi — bu yüzden
// çağıran taraf bu farkı kendi içinde halleder).
async function _pruneOrphanCollection(entityList, collectionId, getUsedNames, stateKey) {
  const usedNames = getUsedNames();
  const removed = [];

  for (const entity of entityList) {
    const name = (entity.name || "").trim();
    if (name && usedNames.has(name)) continue; // hâlâ kullanılıyor, dokunma

    try {
      await databases.deleteDocument(DATABASE_ID, collectionId, entity.$id);
      removed.push(entity.name);
    } catch (err) {
      console.warn(`[findAndDeleteOrphans] Silinemedi (${collectionId}, ${entity.name}):`, err?.message || err);
    }
  }

  if (removed.length > 0) {
    const removedIds = new Set(entityList.filter((e) => removed.includes(e.name)).map((e) => e.$id));
    state[stateKey] = state[stateKey].filter((e) => !removedIds.has(e.$id));
  }

  return removed;
}

// ─── Tüm katalogu tara, yetim kalmış author/publisher/series/collection ─────
// kayıtlarını bul ve sil. Dönüş: { authors, publishers, series, collections }
// — her biri SİLİNEN kayıtların isimlerini içeren bir dizi (rapor için).
// Hiçbir parametre almaz — her zaman state.books'un GÜNCEL/o anki hâline
// göre çalışır (fonksiyon çağrılmadan önce loadBooks() ile veriler taze
// olmalı; normal kullanımda sayfa zaten açıkken state.books güncel olur).
export async function findAndDeleteOrphans() {
  showLoading(true);
  try {
    // ── Yazarlar: book.author tekil bir isim ────────────────────────────
    const usedAuthorNames = new Set(
      state.books.map((b) => (b.author || "").trim()).filter(Boolean)
    );
    const removedAuthors = await _pruneOrphanCollection(
      state.authors, AUTHORS_ID, () => usedAuthorNames, "authors"
    );

    // ── Adım 26: Seriler — YAYINEVİ TEMİZLİĞİNDEN ÖNCE hesaplanır/silinir ──
    // (publisher_id, name) ÇİFTİYLE tanımlı — aynı isimli seri farklı
    // yayınevlerinde ayrı kayıt olabileceği için, "kullanılıyor mu?" kontrolü
    // sadece isme değil, (publisher_id, name) çiftine bakar; bu da
    // publisherIdByName() ile state.publishers içinde arama yapar.
    //
    // SIRA ÖNEMLİ: Bu blok yayınevi temizliğinden ÖNCE çalışmalı. Aksi
    // halde, eğer bir yayınevi temizlenip state.publishers'tan silinmiş
    // olsaydı, publisherIdByName o yayınevini artık BULAMAZ (null döner) —
    // bu da HEM "hâlâ kullanılan" serilerin yanlış hesaplanıp YANLIŞLIKLA
    // SİLİNMESİNE, HEM DE gerçekten yetim olan bir serinin (publisher_id'si
    // state.series'te hâlâ dururken) eşleşmeyip silinememesine yol açardı.
    const usedSeriesKeys = new Set();
    for (const b of state.books) {
      const sName = (b.series || "").trim();
      if (!sName) continue;
      const pubId = publisherIdByName(b.publisher);
      usedSeriesKeys.add(`${pubId || ""}|||${sName}`);
    }

    const removedSeries = [];
    for (const s of state.series) {
      const key = `${s.publisher_id || ""}|||${(s.name || "").trim()}`;
      if (usedSeriesKeys.has(key)) continue; // hâlâ kullanılıyor

      try {
        await databases.deleteDocument(DATABASE_ID, SERIES_ID, s.$id);
        removedSeries.push(s.name);
      } catch (err) {
        console.warn(`[findAndDeleteOrphans] Seri silinemedi (${s.name}):`, err?.message || err);
      }
    }
    if (removedSeries.length > 0) {
      const removedIds = new Set(
        state.series.filter((s) => removedSeries.includes(s.name)).map((s) => s.$id)
      );
      state.series = state.series.filter((s) => !removedIds.has(s.$id));
    }
    // ── Adım 26 sonu ──────────────────────────────────────────────────────────

    // ── Yayınevleri: book.publisher tekil bir isim ──────────────────────
    // NOT: Bu blok SERİ bloğundan SONRA gelmeli (yukarıdaki Adım 26 notuna bak).
    const usedPublisherNames = new Set(
      state.books.map((b) => (b.publisher || "").trim()).filter(Boolean)
    );
    const removedPublishers = await _pruneOrphanCollection(
      state.publishers, PUBLISHERS_ID, () => usedPublisherNames, "publishers"
    );

    // ── Koleksiyonlar: book.collections bir DİZİ ────────────────────────
    const usedCollectionNames = new Set();
    for (const b of state.books) {
      for (const name of b.collections || []) {
        const clean = (name || "").trim();
        if (clean) usedCollectionNames.add(clean);
      }
    }
    const removedCollections = await _pruneOrphanCollection(
      state.collections, COLLECTIONS_ID, () => usedCollectionNames, "collections"
    );

    return {
      authors: removedAuthors,
      publishers: removedPublishers,
      series: removedSeries,
      collections: removedCollections,
    };
  } catch (err) {
    showToast("Yetim kayıt taraması başarısız: " + (err?.message || err), "error");
    throw err;
  } finally {
    showLoading(false);
  }
}
// ── Adım 25 sonu ─────────────────────────────────────────────────────────────