// ─────────────────────────────────────────────────────────────────────────────
// FILTER-PANEL — Filtre panelinin işlemleri: sıfırlama + mobil drawer aç/kapa.
//
// Sorumluluklar:
//   • clearFilters()       — TÜM filtreleri sıfırla, chip/select/slider'ı tazele
//   • openFilterPanel()    — mobil filtre çekmecesini aç
//   • closeFilterPanel()   — mobil filtre çekmecesini kapat
//
// Bağımlılıklar:
//   ← filter-state.js     (ui)
//   ← filter-core.js      (recompute)
//   ← filter-sync.js      (syncChips)
//   ← filter-populate.js  (_collectFilterOptions, populateSubcategoryChips,
//                          populateTopicChips, populateYearSlider, updateSeriesOptions)
//   ← catalog-ui.js       (updateFavoriteOnlyChip) — KISMİ DAİRESEL IMPORT (aşağıya bak)
//
// ── DİKKAT — kısmi dairesel import (filter-panel ↔ catalog-ui) ───────────────
// clearFilters() updateFavoriteOnlyChip()'i çağırıyor; bu fonksiyon
// catalog-ui.js'de. catalog-ui.js de bu sistemden (filter-state → ui, vb.)
// import ediyor → dolaylı bir döngü. Bu ES modüllerinde GÜVENLİDİR çünkü
// updateFavoriteOnlyChip yalnızca clearFilters ÇALIŞTIĞINDA (runtime) çağrılıyor,
// modül YÜKLENİRKEN değil — yani "Cannot access before initialization" hatası
// oluşmaz. (Orijinal catalog-filters.js'de de aynı zararsız kenar mevcuttu.)
// ─────────────────────────────────────────────────────────────────────────────

import { ui } from "./filter-state.js";
import { recompute } from "./filter-core.js";
import { syncChips } from "./filter-sync.js";
import {
  _collectFilterOptions,
  populateSubcategoryChips,
  populateTopicChips,
  populateYearSlider,
  updateSeriesOptions,
} from "./filter-populate.js";
import { updateFavoriteOnlyChip } from "./catalog-ui.js";

// ─── Tüm filtreleri sıfırla ──────────────────────────────────────────────────
export function clearFilters() {
  ui.filters = { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: [], subcategory: [], topic: [], genre: [], confidence: "", yearMin: null, yearMax: null, missingField: "", favoriteOnly: false, categoryStatus: "", coverStatus: "" };
  syncChips();
  ["filter-author", "filter-publisher"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Adım 35: populateSubcategoryChips/populateYearSlider artık opts parametresi
  // bekliyor, burada da hazırlanması gerekiyor.
  const filterOpts = _collectFilterOptions();

  populateSubcategoryChips(filterOpts); // Adım 11: alt alan/konu grupları sıfırlanmış filtreyle yeniden çizilir
  populateTopicChips();                 // Adım 11
  populateYearSlider(filterOpts);       // Adım 4: slider'ı tam aralığa geri döndür
  updateSeriesOptions();                // seriyi pasif yap
  updateFavoriteOnlyChip();             // Adım 17: "Sadece Favoriler" chip'ini pasif göster
  recompute(true);
}

// ─── Mobil drawer ────────────────────────────────────────────────────────────
export function openFilterPanel() {
  document.getElementById("filter-panel")?.classList.add("open");
  document.getElementById("filter-overlay")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

export function closeFilterPanel() {
  document.getElementById("filter-panel")?.classList.remove("open");
  document.getElementById("filter-overlay")?.classList.add("hidden");
  document.body.style.overflow = "";
}