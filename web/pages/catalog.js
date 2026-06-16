// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — Katalog sayfası mantığı.
//
// 3A: sayfalama (50/sayfa) + ızgara↔liste görünüm geçişi
// 3B: filtreler üstten sol yana taşındı. Format/Durum chip buton,
//     Yazar/Seri <select>. Mobilde drawer (çekmece), masaüstünde kalıcı panel.
//     Aktif filtre sayısı "Filtrele (N)" butonunda gösterilir.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml, statusLabel } from "../ui/common.js";

const PER_PAGE = 50;

const ui = {
  search: "",
  filters: { format: "", status: "", author: "", series: "" },
  sort: "added_at_desc",
  view: "grid",
  page: 1,
};

let filtered = [];

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderCatalog() {
  populateSelectOptions();
  syncChips();
  recompute(false);
}

// ─── Filtrele + sırala + çiz ────────────────────────────────────────────────
function recompute(resetPage = false) {
  let result = [...state.books];

  if (ui.search) {
    const q = ui.search.toLowerCase();
    result = result.filter(
      (b) =>
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.series?.toLowerCase().includes(q) ||
        b.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (ui.filters.format) result = result.filter((b) => b.format === ui.filters.format);
  if (ui.filters.status) result = result.filter((b) => b.status === ui.filters.status);
  if (ui.filters.author) result = result.filter((b) => b.author === ui.filters.author);
  if (ui.filters.series) result = result.filter((b) => b.series === ui.filters.series);

  filtered = sortBooks(result, ui.sort);
  if (resetPage) ui.page = 1;
  clampPage();
  render();
}

function render() {
  renderBooks();
  renderPagination();
  updateResultCount();
  updateViewToggle();
  updateFilterBadge();
}

function clampPage() {
  const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  ui.page = Math.min(Math.max(1, ui.page), total);
}

function sortBooks(books, key) {
  const s = [...books];
  if (key === "title_asc")
    return s.sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr"));
  if (key === "author_asc")
    return s.sort((a, b) => (a.author || "").localeCompare(b.author || "", "tr"));
  if (key === "series_asc")
    return s.sort((a, b) => {
      const c = (a.series || "").localeCompare(b.series || "", "tr");
      return c !== 0 ? c : (a.series_order || 0) - (b.series_order || 0);
    });
  // added_at_desc (varsayılan)
  return s.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));
}

// ─── Yazar / Seri <select> seçeneklerini doldur ─────────────────────────────
function populateSelectOptions() {
  const authors = [...new Set(state.books.map((b) => b.author).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr")
  );
  const series = [...new Set(state.books.map((b) => b.series).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr")
  );
  fillSelect("filter-author", authors, ui.filters.author);
  fillSelect("filter-series", series, ui.filters.series);
}

function fillSelect(id, options, current) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">Tümü</option>`;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    el.appendChild(o);
  });
  el.value = current; // seçimi koru
}

// ─── Chip butonlarını mevcut ui.filters değeriyle senkronize et ─────────────
function syncChips() {
  syncChipGroup("filter-format-chips", ui.filters.format);
  syncChipGroup("filter-status-chips", ui.filters.status);
}

function syncChipGroup(containerId, activeValue) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.value === activeValue);
  });
}

// ─── Kitapları çiz ──────────────────────────────────────────────────────────
function renderBooks() {
  const grid = document.getElementById("books-grid");
  if (!grid) return;
  grid.classList.toggle("list-view", ui.view === "list");
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  const start = (ui.page - 1) * PER_PAGE;
  const fragment = document.createDocumentFragment();
  filtered.slice(start, start + PER_PAGE).forEach((book) => {
    fragment.appendChild(ui.view === "list" ? createBookRow(book) : createBookCard(book));
  });
  grid.appendChild(fragment);
}

function createBookRow(book) {
  const row = document.createElement("div");
  row.className = "book-row";
  row.dataset.id = book.$id;
  const statusClass = `status-${book.status || "okunmadi"}`;
  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" loading="lazy" />`
    : `<div class="row-cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  row.innerHTML = `
    <div class="row-cover">${coverHtml}</div>
    <div class="row-main">
      <span class="row-title">${escapeHtml(book.title || "Başlıksız")}</span>
      <span class="row-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</span>
    </div>
    <span class="badge row-format">${(book.format || "").toUpperCase()}</span>
    <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
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
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  range.push(1);
  if (left > 2) range.push("...");
  for (let i = left; i <= right; i++) range.push(i);
  if (right < total - 1) range.push("...");
  if (total > 1) range.push(total);
  return range;
}

// ─── Aktif filtre sayısını butona ve rozete yaz ──────────────────────────────
function updateFilterBadge() {
  const count = Object.values(ui.filters).filter(Boolean).length;
  const badge = document.getElementById("filter-badge");
  const btn = document.getElementById("filter-toggle");
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

// ─── Tüm filtreleri sıfırla ──────────────────────────────────────────────────
function clearFilters() {
  ui.filters = { format: "", status: "", author: "", series: "" };
  syncChips();
  const authorEl = document.getElementById("filter-author");
  const seriesEl = document.getElementById("filter-series");
  if (authorEl) authorEl.value = "";
  if (seriesEl) seriesEl.value = "";
  recompute(true);
}

// ─── Mobil drawer aç / kapat ─────────────────────────────────────────────────
function openFilterPanel() {
  document.getElementById("filter-panel")?.classList.add("open");
  document.getElementById("filter-overlay")?.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // arka planı kilitle
}

function closeFilterPanel() {
  document.getElementById("filter-panel")?.classList.remove("open");
  document.getElementById("filter-overlay")?.classList.add("hidden");
  document.body.style.overflow = "";
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initCatalog() {
  // Arama
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    ui.search = e.target.value;
    recompute(true);
  });

  // Sıralama
  document.getElementById("sort-select")?.addEventListener("change", (e) => {
    ui.sort = e.target.value;
    recompute(true);
  });

  // Görünüm geçişi
  document.querySelector(".view-toggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn) return;
    ui.view = btn.dataset.view;
    render();
  });

  // Chip filtreler (format + durum): panel içindeki tüm chip'lere tek dinleyici
  document.getElementById("filter-panel")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const filterKey = chip.dataset.filter;
    const value = chip.dataset.value;
    if (!filterKey) return;

    ui.filters[filterKey] = value;
    syncChipGroup(`filter-${filterKey}-chips`, value);
    recompute(true);
  });

  // Yazar <select>
  document.getElementById("filter-author")?.addEventListener("change", (e) => {
    ui.filters.author = e.target.value;
    recompute(true);
  });

  // Seri <select>
  document.getElementById("filter-series")?.addEventListener("change", (e) => {
    ui.filters.series = e.target.value;
    recompute(true);
  });

  // Filtreleri temizle butonu
  document.getElementById("filter-clear")?.addEventListener("click", clearFilters);

  // Mobil: filtre butonu paneli açar
  document.getElementById("filter-toggle")?.addEventListener("click", openFilterPanel);

  // Mobil: arka plan karartısına tıklayınca kapat
  document.getElementById("filter-overlay")?.addEventListener("click", closeFilterPanel);

  // Sayfalama
  document.getElementById("pagination")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (!btn || btn.disabled) return;
    const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const val = btn.dataset.page;
    if (val === "prev") ui.page = Math.max(1, ui.page - 1);
    else if (val === "next") ui.page = Math.min(total, ui.page + 1);
    else ui.page = parseInt(val);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Kart / satır tıklaması
  document.getElementById("books-grid")?.addEventListener("click", (e) => {
    const el = e.target.closest(".book-card, .book-row");
    if (el?.dataset.id) openModal(el.dataset.id);
  });
}