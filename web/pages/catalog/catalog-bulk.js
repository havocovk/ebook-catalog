// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-BULK — Giriş noktası (barrel / re-export).
//
// Bu dosya artık iş mantığı içermez. Tüm mantık 2 alt modüle taşındı:
//
//   bulk-selection.js   → selectedIds, toggleSelection, clearSelection,
//                          toggleSelectAllOnPage, updateSelectAllButton,
//                          getCurrentPageBooks, updateBulkBar, setRenderCallback
//
//   bulk-operations.js  → bulkOperationInProgress, runBulkOperation,
//                          bulkDelete, bulkChangeStatus, bulkAddTag,
//                          bulkSetCategory, bulkSetGenre, bulkAddCollection,
//                          bulkSetFavorite
//
// Dışarıdan bu dosyayı import eden HİÇBİR DOSYA DEĞİŞMEZ:
//   catalog-ui.js  → selectedIds, updateSelectAllButton              ✅ çalışır
//   index.js       → selectedIds, toggleSelection, clearSelection ... ✅ çalışır
// ─────────────────────────────────────────────────────────────────────────────

export {
  selectedIds,
  setRenderCallback,
  toggleSelection,
  clearSelection,
  toggleSelectAllOnPage,
  updateSelectAllButton,
  getCurrentPageBooks,
  updateBulkBar,
} from "./bulk-selection.js";

export {
  runBulkOperation,
  bulkDelete,
  bulkChangeStatus,
  bulkAddTag,
  bulkSetCategory,
  bulkSetGenre,
  bulkAddCollection,
  bulkSetFavorite,
} from "./bulk-operations.js";