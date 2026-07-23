// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-FILTERS — Giriş noktası (barrel / re-export).
//
// Bu dosya artık iş mantığı içermez. Tüm mantık 5 alt modüle taşındı:
//
//   filter-state.js     → ui, PER_PAGE, filtered, getYearBounds,
//                          setRecomputeCallback (paylaşılan durum + callback)
//   filter-core.js      → recompute (filtreleme + sıralama motoru)
//   filter-populate.js  → _collectFilterOptions, populate* fonksiyonları,
//                          year slider, series options
//   filter-sync.js      → syncChips, syncChipGroup (chip senkronizasyonu)
//   filter-panel.js     → clearFilters, openFilterPanel, closeFilterPanel
//
// Dışarıdan bu dosyayı import eden HİÇBİR DOSYA DEĞİŞMEZ:
//   catalog-ui.js       → recompute, ui, filtered, PER_PAGE           ✅ çalışır
//   bulk-selection.js   → ui, filtered, PER_PAGE                       ✅ çalışır
//   bulk-operations.js  → recompute                                    ✅ çalışır
//   index.js            → ui, recompute, setRecomputeCallback, ...      ✅ çalışır
// ─────────────────────────────────────────────────────────────────────────────

// ── Paylaşılan durum + sabitler + callback ──────────────────────────────────
export {
  ui,
  PER_PAGE,
  filtered,
  getYearBounds,
  setRecomputeCallback,
} from "./filter-state.js";

// ── Filtreleme + sıralama motoru ────────────────────────────────────────────
export { recompute } from "./filter-core.js";

// ── Chip / select doldurma ──────────────────────────────────────────────────
export {
  _collectFilterOptions,
  populateTagChips,
  populateCategoryChips,
  populateGenreDropdown,
  _syncGenreDropdown,
  populateSubcategoryChips,
  populateTopicChips,
  populateYearSlider,
  updateYearRangeUI,
  populateSelectOptions,
  updateSeriesOptions,
} from "./filter-populate.js";

// ── Chip senkronizasyonu ────────────────────────────────────────────────────
export {
  syncChips,
  syncChipGroup,
} from "./filter-sync.js";

// ── Panel işlemleri ─────────────────────────────────────────────────────────
export {
  clearFilters,
  openFilterPanel,
  closeFilterPanel,
} from "./filter-panel.js";