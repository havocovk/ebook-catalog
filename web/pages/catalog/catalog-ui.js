// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-UI — Görünüm katmanı: kitap kartı/satırı çizimi, sayfalama,
// favori toggle, sonuç sayacı ve görünüm (grid/liste) yönetimi.
//
// catalog.js'den ayrıldı (Adım 2-6, Faza 2 parçalanması).
//
// ── DAİRESEL BAĞIMLILIK (filters ↔ ui, bulk ↔ ui) ───────────────────────────
// Bu dosya catalog-filters.js'den (PER_PAGE, filtered, ui, recompute) ve
// catalog-bulk.js'den (selectedIds, updateSelectAllButton) import EDER.
// O iki dosya ise render()/updateFavoriteOnlyChip()'i DOĞRUDAN import etmez —
// onun yerine catalog/index.js, bu dosyadaki render'ı onlara
// setRecomputeCallback(render) ve setRenderCallback(render) ile enjekte eder
// (bkz. Adım 2-4 ve 2-5). Böylece import yönü tek taraflı kalır ve modül
// yükleme sırasına bağlı "Cannot access before initialization" hatası oluşmaz.
//
// İSTİSNA: catalog-filters.js'deki clearFilters(), bu dosyadaki
// updateFavoriteOnlyChip()'i runtime'da çağırıyor (import ediyor). Bu zararsız
// bir kenar — çağrı modül yüklenirken değil, kullanıcı "Temizle"ye basınca
// gerçekleşiyor (bkz. catalog-filters.js başındaki açıklama).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { createBookCard } from "../../ui/components.js";
import { escapeHtml, statusLabel, showToast } from "../../ui/common.js";
import { updateBookRecord } from "../../core/api.js";
import { PER_PAGE, filtered, ui, recompute } from "./catalog-filters.js";
import { selectedIds, updateSelectAllButton } from "./catalog-bulk.js";

// ── Adım 17: Favori durumunu tıkla-kaydet ────────────────────────────────
// Yıldız puanlama (modal.js'deki applyUpdate) ile aynı mantık: tıklanınca
// anında Appwrite'a yazılır, hafızadaki (state.books) kopya güncellenir,
// sayfa yeniden çizilir. Modal açmaya gerek yok — kart/satır üzerinden
// tek tıkla favori durumu değiştirilebilir.
// ── Adım 17: "Sadece Favoriler" chip'inin aktif/pasif görselini senkronize et ─
// syncChipGroup'tan farkı: tek bir buton, dizi değil boolean yönetiyor.
export function updateFavoriteOnlyChip() {
  const btn = document.getElementById("filter-favorite-only");
  if (!btn) return;
  btn.classList.toggle("active", Boolean(ui.filters.favoriteOnly));
}

export async function toggleFavorite(bookId) {
  const book = state.books.find((b) => b.$id === bookId);
  if (!book) return;

  const newValue = !book.favorite;

  try {
    await updateBookRecord(bookId, { favorite: newValue });
    book.favorite = newValue; // hafızadaki kopyayı güncelle
    // recompute (render değil): "Sadece Favoriler" filtresi aktifken
    // favorisi kaldırılan bir kitabın listeden anında kaybolması gerekir.
    // resetPage=false: kullanıcı hangi sayfadaysa orada kalsın.
    recompute(false);
  } catch (err) {
    showToast("Favori durumu güncellenemedi: " + (err?.message || err), "error");
  }
}
// ── Adım 17 sonu ──────────────────────────────────────────────────────────

// ─── Çiz (orkestrasyon) ──────────────────────────────────────────────────────
// recompute() (catalog-filters.js) bu fonksiyonu callback olarak çağırır;
// seçim fonksiyonları (catalog-bulk.js) da aynı callback'i kullanır.
export function render() {
  renderBooks();
  renderPagination();
  updateResultCount();
  updateViewToggle();
  updateFilterBadge();
  updateSelectAllButton(); // ── Adım 24: "Sayfadaki Tümünü Seç" butonunu senkronize et
}

// ─── Kitapları çiz ───────────────────────────────────────────────────────────
function renderBooks() {
  const grid = document.getElementById("books-grid");
  if (!grid) return;
  grid.classList.toggle("list-view", ui.view === "list");
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  const start    = (ui.page - 1) * PER_PAGE;
  const fragment = document.createDocumentFragment();
  filtered.slice(start, start + PER_PAGE).forEach((book) => {
    const isSelected = selectedIds.has(book.$id);
    fragment.appendChild(
      ui.view === "list" ? createBookRow(book, isSelected) : createBookCard(book, isSelected)
    );
  });
  grid.appendChild(fragment);
}

function createBookRow(book, isSelected = false) {
  const row = document.createElement("div");
  row.className  = "book-row";
  row.dataset.id = book.$id;
  const statusClass = `status-${book.status || "okunmadi"}`;
  const coverHtml   = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" loading="lazy" />`
    : `<div class="row-cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  // ── Adım 18: Toplu işlem seçim checkbox'ı (liste görünümü) ───────────────
  const selectBtnHtml = `
    <button class="select-btn select-btn-row ${isSelected ? "active" : ""}" title="${isSelected ? "Seçimi kaldır" : "Seç"}">
      <iconify-icon icon="${isSelected ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline"}"></iconify-icon>
    </button>
  `;
  // ── Adım 18 sonu ──────────────────────────────────────────────────────────

  // ── Adım 17: Favori butonu (liste görünümü) ──────────────────────────────
  // DÜZELTME: lucide:heart sadece çerçeve (stroke) çiziyor, fill desteklemiyor
  // — bu yüzden mdi setinden gerçekten dolu bir ikon kullanılıyor.
  // (Aynı düzeltme components.js'deki createBookCard'da da yapıldı.)
  const isFavorite = Boolean(book.favorite);
  const heartIcon = isFavorite ? "mdi:heart" : "mdi:heart-outline";
  const favoriteBtnHtml = `
    <button class="favorite-btn favorite-btn-row ${isFavorite ? "active" : ""}" title="${isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}">
      <iconify-icon icon="${heartIcon}"></iconify-icon>
    </button>
  `;
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  row.innerHTML = `
    ${selectBtnHtml}
    <div class="row-cover">${coverHtml}</div>
    <div class="row-main">
      <span class="row-title">${escapeHtml(book.title  || "Başlıksız")}</span>
      <span class="row-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</span>
    </div>
    <span class="badge row-format">${(book.format || "").toUpperCase()}</span>
    <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
    ${favoriteBtnHtml}
  `;
  return row;
}

// ─── Sayfalama ───────────────────────────────────────────────────────────────
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;
  const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (total <= 1) { container.innerHTML = ""; return; }

  let html = `<button class="page-btn" data-page="prev" ${ui.page === 1 ? "disabled" : ""}>‹</button>`;
  for (const p of pageNumbers(ui.page, total)) {
    html += p === "..."
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${p === ui.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" data-page="next" ${ui.page === total ? "disabled" : ""}>›</button>`;
  container.innerHTML = html;
}

function pageNumbers(current, total) {
  const range = [];
  const left  = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  range.push(1);
  if (left  > 2)          range.push("...");
  for (let i = left; i <= right; i++) range.push(i);
  if (right < total - 1)  range.push("...");
  if (total > 1)           range.push(total);
  return range;
}

// ─── Aktif filtre rozeti ─────────────────────────────────────────────────────
// Adım 9 ÖNEMLİ DÜZELTME: language/tag artık dizi. Boolean([]) JavaScript'te
// "true" döner (boş dizi de "truthy" sayılır) — bu yüzden basit Boolean()
// kontrolü diziler için YANLIŞ sonuç verirdi (hiç seçim yokken bile "aktif
// filtre" sayardı). Dizi ise .length > 0 kontrolü, değilse eski Boolean()
// kontrolü kullanılır.
function updateFilterBadge() {
  const count = Object.values(ui.filters).filter((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v)
  ).length;
  const badge = document.getElementById("filter-badge");
  const btn   = document.getElementById("filter-toggle");
  if (!badge || !btn) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
    btn.classList.add("has-filters");
  } else {
    badge.classList.add("hidden");
    btn.classList.remove("has-filters");
  }
}

function updateResultCount() {
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${filtered.length} kitap`;
}

function updateViewToggle() {
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === ui.view);
  });
}