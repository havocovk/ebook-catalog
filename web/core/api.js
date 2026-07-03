// ─────────────────────────────────────────────────────────────────────────────
// API — Re-export hub.
//
// Bu dosya artık iş mantığı İÇERMEZ — sadece aşağıdaki parçalardan gelen
// fonksiyonları tek bir yerden export eder. Diğer dosyalar (app.js, auth.js,
// catalog.js, collections.js, dashboard.js, modal.js) HİÇBİR import satırını
// değiştirmeden `import { ... } from "./api.js"` kullanmaya devam eder.
//
// Mimari (web/core/api/ klasörü altında):
//   - api-shared.js      → Ortak yardımcılar (fetchAllPaginated, publisherIdByName)
//                          — bilerek burada re-export EDİLMİYOR, sadece diğer
//                          parçaların kendi içinde kullandığı internal yardımcılar.
//   - api-books.js       → Kitap CRUD + kapak yükleme
//   - api-cascade.js      → Yetim kayıt temizliği (cascade delete + toplu tarayıcı)
//   - api-authors.js      → Yazar CRUD
//   - api-publishers.js   → Yayınevi CRUD
//   - api-series.js       → Seri CRUD
//   - api-collections.js  → Koleksiyon CRUD
//
// Bu dosyanın eski hâli (api.js, 1119 satır) Adım 1-1 — 1-8 arasında bu 7
// parçaya bölündü. Davranışta hiçbir değişiklik yok — sadece dosya
// organizasyonu değişti.
// ─────────────────────────────────────────────────────────────────────────────

// ── Kitap CRUD + kapak ───────────────────────────────────────────────────────
export {
  SYSTEM_FIELDS,
  loadBooks,
  fetchAllBooks,
  updateBookRecord,
  updateBookRecordWithCascade,
  extractCoverFileId,
  deleteBookRecord,
  createBookRecord,
  stripSystemFields,
  uploadBookCover,
} from "./api/api-books.js";

// ── Yetim temizliği ──────────────────────────────────────────────────────────
// NOT: cascadeDeleteOrphans BİLEREK re-export edilmiyor — eski api.js'de de
// export edilmemişti (internal kullanım, sadece deleteBookRecord ve
// updateBookRecordWithCascade tarafından çağrılıyordu). Sadece
// findAndDeleteOrphans dışarıya açık (dashboard.js'in Yetim Kayıt Tarayıcısı
// butonu bunu kullanıyor).
export {
  findAndDeleteOrphans,
  findAndDeleteOrphanCovers,
} from "./api/api-cascade.js";

// ── Yazarlar ─────────────────────────────────────────────────────────────────
export {
  bootstrapAuthors,
  createAuthor,
  renameAuthorEverywhere,
  deleteAuthorEverywhere,
} from "./api/api-authors.js";

// ── Yayınevleri ──────────────────────────────────────────────────────────────
export {
  bootstrapPublishers,
  createPublisher,
  renamePublisherEverywhere,
  deletePublisherEverywhere,
} from "./api/api-publishers.js";

// ── Seriler ──────────────────────────────────────────────────────────────────
export {
  bootstrapSeries,
  createSeries,
  renameSeriesEverywhere,
  deleteSeriesEverywhere,
} from "./api/api-series.js";

// ── Koleksiyonlar ────────────────────────────────────────────────────────────
export {
  bootstrapCollections,
  createCollection,
  renameCollectionEverywhere,
  deleteCollectionEverywhere,
} from "./api/api-collections.js";