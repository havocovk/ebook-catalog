// ─────────────────────────────────────────────────────────────────────────────
// catalog.js — Re-export hub
//
// Tüm katalog modülleri buradan export edilir.
// app.js sadece `import { renderCatalog, initCatalog } from "./pages/catalog.js"`
// yapar ve hiç değişmez (Adım 2-8'de doğrulanacak).
//
// Mimari:
//   - catalog/catalog-search.js       → Fuzzy arama (Fuse.js, Türkçe normalize)
//   - catalog/catalog-smart-lists.js  → Akıllı filtreler + localStorage tercihleri
//   - catalog/catalog-filters.js      → Filtre mantığı (recompute, ANA dosya)
//   - catalog/catalog-bulk.js         → Toplu işlemler + seçim yönetimi
//   - catalog/catalog-ui.js           → Kart/satır render, sayfalama, favori
//   - catalog/index.js                → Orkestratör (renderCatalog, initCatalog)
// ─────────────────────────────────────────────────────────────────────────────

export { renderCatalog, initCatalog } from "./catalog/index.js";