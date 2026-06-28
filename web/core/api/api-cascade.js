// ─────────────────────────────────────────────────────────────────────────────
// API-CASCADE — Yetim kayıt temizliği.
//
// İki tamamlayıcı mekanizma:
//   1) cascadeDeleteOrphans() — bir kitap silinirken/güncellenirken ÇALIŞAN,
//      anlık temizlik. api-books.js (deleteBookRecord, updateBookRecordWithCascade)
//      tarafından çağrılır.
//   2) findAndDeleteOrphans() — Dashboard'dan elle tetiklenen, TÜM katalogu
//      tarayan toplu tarayıcı (güvenlik ağı).
//
// NOT: cascadeDeleteOrphans, orijinal api.js'de export EDİLMEMİŞTİ (sadece
// dosya içi kullanım). Parçalama sırasında api-books.js'in bunu import
// edebilmesi için export EKLENDİ — tek mantıksal değişiklik bu, davranış
// aynı kaldı.
// ─────────────────────────────────────────────────────────────────────────────

import {
  databases,
  DATABASE_ID,
  AUTHORS_ID,
  PUBLISHERS_ID,
  SERIES_ID,
  COLLECTIONS_ID,
} from "../../appwrite.js";
import { state } from "../state.js";
import { showLoading, showToast } from "../../ui/common.js";
import { publisherIdByName } from "./api-shared.js";

// ─── Cascade delete: yetim kalan author/publisher/series/collection'ları sil ─
// Bir kitap silindikten SONRA çağrılır (state.books o kitabı içermeyecek
// şekilde güncellenmiş olmalı — api-books.js'deki deleteBookRecord bunu garanti eder).
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
// ═══════════════════════════════════════════════════════════════════════════
// ── Adım 34: cascadeDeleteOrphans GENELLEŞTİRİLDİ ───────────────────────────
//
// ÖNCEDEN: Bu fonksiyon sadece "bir kitap SİLİNDİĞİNDE" çağrılıyordu —
// parametre olarak "silinen kitabın kendisi" (deletedBook) alıyordu.
//
// SORUN (yeni keşfedilen kapsam boşluğu): Bir kitap SİLİNMEDEN, sadece
// GÜNCELLENDİĞİNDE de (örn. kart üzerinden bir koleksiyon adı kaldırılırsa,
// ya da yazar/yayınevi/seri değiştirilirse) AYNI "yetim kalma" riski var —
// eski değer artık hiçbir kitapta kullanılmıyor olabilir, ama bunu kontrol
// eden hiçbir mekanizma yoktu (applyUpdate/bulkSetCategory/bulkAddCollection
// sadece updateDocument çağırıp duruyordu, eski değerlere hiç bakmıyordu).
//
// ÇÖZÜM: Fonksiyon artık "silinen kitap" değil, "kontrol edilmesi istenen
// eski değerler" (staleValues: { author, publisher, series, collections })
// alıyor. İÇ MANTIK DEĞİŞMEDİ (zaten doğru çalıştığını test ettik) — sadece
// parametre kaynağı genelleşti: silme senaryosunda staleValues = silinen
// kitabın kendisi; güncelleme senaryosunda staleValues = güncelleme
// ÖNCESİNDEKİ eski author/publisher/series/collections değerleri (bkz.
// applyUpdate ve bulkSetCategory/bulkAddCollection'daki yeni çağrılar).
//
// staleValues.publisher, seri kontrolü için HÂLÂ GEREKLİ: eğer publisher
// DEĞİŞMEDİYSE ama series değiştiyse, seri kontrolünün hangi yayınevine
// göre yapılacağını bilmesi gerekiyor — bu yüzden çağıran taraf, publisher
// alanı değişmemiş olsa bile staleValues.publisher'a kitabın (güncelleme
// öncesindeki) yayınevini koymalı.
export async function cascadeDeleteOrphans(staleValues) {
  // ── Yazar ──────────────────────────────────────────────────────────────
  const authorName = (staleValues.author || "").trim();
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
  // Seri kontrolü, staleValues.publisher adından publisherIdByName() ile bir
  // ID buluyor — bu arama state.publishers İÇİNDE yapılıyor. Eğer yayınevi
  // bloğu BU bloktan ÖNCE çalışıp yayınevini state.publishers'tan silmiş
  // olsaydı (silinen/değişen kitap o yayınevinin de SON kitabıysa),
  // publisherIdByName artık o yayınevini BULAMAZ ve null döner — bu da seri
  // kaydının (gerçek publisher_id'si hâlâ duran) state.series içinde
  // eşleşmemesine, dolayısıyla YANLIŞLIKLA BULUNAMAMASINA ve silinmemesine
  // yol açardı. Bu yüzden seri kontrolü, yayınevi state.publishers'ta HÂLÂ
  // DURURKEN yapılmalı.
  const seriesName = (staleValues.series || "").trim();
  if (seriesName) {
    const seriesPublisherId = publisherIdByName(staleValues.publisher);
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
          // yapar. Burada ilgili kitap(lar) zaten güncellenmiş/silinmiş
          // durumda, kitaplara dokunmaya gerek yok; sadece yetim kalan seri
          // kaydını doğrudan sil.
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
  const publisherName = (staleValues.publisher || "").trim();
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
  // olabilir) — bu yüzden staleValues.collections İÇİNDEKİ HER isim için
  // ayrı ayrı "hâlâ kullanılıyor mu?" kontrolü yapılır. Yayınevi/seriden
  // bağımsız olduğu için sıra burada önemli değil.
  const staleCollections = staleValues.collections || [];
  for (const collectionName of staleCollections) {
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
// ── Adım 34 sonu ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

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