// ─────────────────────────────────────────────────────────────────────────────
// FILTER-SYNC — Filtre chip'lerinin görsel durumunu senkronize eder.
//
// "Senkronize etmek" = ui.filters'taki gerçek duruma bakıp, ekrandaki chip
// butonlarının "active" (dolu) veya pasif (boş) görünmesini sağlamak.
//
// Sorumluluklar:
//   • syncChips()      — TÜM chip gruplarını tek seferde senkronize et
//   • syncChipGroup()  — tek bir chip grubunu senkronize et (tekil VEYA çoklu seçim)
//
// Bağımlılıklar:
//   ← filter-state.js  (ui — hangi filtrelerin aktif olduğunu okur)
//
// NOT: filter-populate.js her chip grubunu doldurduktan sonra syncChipGroup()
// çağırır, bu yüzden bu modül populate'ten bağımsız (alt katman) tutuldu.
// ─────────────────────────────────────────────────────────────────────────────

import { ui } from "./filter-state.js";

// ─── Chip butonlarını senkronize et ─────────────────────────────────────────
export function syncChips() {
  syncChipGroup("filter-format-chips", ui.filters.format);
  syncChipGroup("filter-status-chips", ui.filters.status);
  // Adım J4
  syncChipGroup("filter-language-chips", ui.filters.language);
  syncChipGroup("filter-tag-chips", ui.filters.tag);
  // Adım 3: Güven skoru
  syncChipGroup("filter-confidence-chips", ui.filters.confidence);
  // Adım 11: Kategori (çoklu seçim)
  syncChipGroup("filter-category-chips", ui.filters.category);
  syncChipGroup("filter-subcategory-chips", ui.filters.subcategory);
  syncChipGroup("filter-topic-chips", ui.filters.topic);
  // Bölüm 2: Tür (çoklu seçim)
  syncChipGroup("filter-genre-chips", ui.filters.genre);
  // Adım 37: Kategori Durumu (tek seçim)
  syncChipGroup("filter-categoryStatus-chips", ui.filters.categoryStatus);
  // Kapak Resmi Durumu (tek seçim)
  syncChipGroup("filter-coverStatus-chips", ui.filters.coverStatus);
}

// Adım 9: activeValue artık ya tek bir string (Format/Durum/Güven gibi
// tek-seçim filtreler) ya da bir dizi (Dil/Etiket gibi çoklu-seçim filtreler)
// olabilir. Hangisi geldiyse ona göre "bu chip aktif mi?" kontrolü yapılır.
export function syncChipGroup(containerId, activeValue) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const isMulti = Array.isArray(activeValue);
  el.querySelectorAll(".chip").forEach((chip) => {
    const isActive = isMulti
      ? (chip.dataset.value === "" ? activeValue.length === 0 : activeValue.includes(chip.dataset.value))
      : chip.dataset.value === activeValue;
    chip.classList.toggle("active", isActive);
  });
}