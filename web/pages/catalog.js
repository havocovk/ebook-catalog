// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — Katalog sayfası mantığı.
//
// Mevcut tek-sayfa uygulamasının çekirdeği: arama, filtreler, sıralama ve kitap
// listesi. 3A ile eklenenler:
//   • Sayfalama: her sayfada 50 kitap, altta önceki / numaralar / sonraki
//   • Görünüm geçişi: ızgara (kart) ↔ liste (satır)
//
// Filtre/arama/sıralama durumu yalnızca bu sayfayı ilgilendirir, yerel tutulur.
//
// Dışa açık iki fonksiyon:
//   renderCatalog() → router her ziyarette çağırır (sayfayı korur)
//   initCatalog()   → olayları bir kez bağlar (app.js başlangıçta çağırır)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml, statusLabel } from "../ui/common.js";

// Her sayfada gösterilecek kitap sayısı.
const PER_PAGE = 50;

// Katalog'a özel arayüz durumu (yalnızca bu dosyada kullanılır).
const ui = {
  search: "",
  filters: { format: "", status: "", author: "", series: "" },
  sort: "added_at_desc",
  view: "grid", // "grid" | "list"
  page: 1,
};

// Filtrelenmiş + sıralanmış güncel liste (tüm sayfalar).
let filtered = [];

// ─── Sayfa çizimi (router her ziyarette çağırır) ────────────────────────────
export function renderCatalog() {
  populateFilterOptions();
  recompute(false); // mevcut sayfayı koru (düzenleme sonrası geri sıçramasın)
}

// ─── Filtrele + sırala, sonra çiz ───────────────────────────────────────────
// resetPage=true → sayfa 1'e döner (arama/filtre/sıralama değişince).
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

// Sadece çizim (filtre değişmeden): sayfalama tıklaması ve görünüm geçişi kullanır.
function render() {
  renderBooks();
  renderPagination();
  updateResultCount();
  updateViewToggle();
}

function clampPage() {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (ui.page > totalPages) ui.page = totalPages;
  if (ui.page < 1) ui.page = 1;
}

function sortBooks(books, sortKey) {
  const sorted = [...books];
  switch (sortKey) {
    case "title_asc":
      return sorted.sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr"));
    case "author_asc":
      return sorted.sort((a, b) => (a.author || "").localeCompare(b.author || "", "tr"));
    case "series_asc":
      return sorted.sort((a, b) => {
        const s = (a.series || "").localeCompare(b.series || "", "tr");
        if (s !== 0) return s;
        return (a.series_order || 0) - (b.series_order || 0);
      });
    case "added_at_desc":
    default:
      return sorted.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));
  }
}

// ─── Yazar / Seri filtre seçeneklerini kitaplardan doldur ───────────────────
function populateFilterOptions() {
  const authors = [...new Set(state.books.map((b) => b.author).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr")
  );
  const series = [...new Set(state.books.map((b) => b.series).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr")
  );
  populateSelect("filter-author", authors);
  populateSelect("filter-series", series);
}

function populateSelect(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value; // mevcut seçimi koru
  el.innerHTML = `<option value="">Tümü</option>`;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    el.appendChild(o);
  });
  el.value = current;
}

// ─── Geçerli sayfayı seçili görünümde çiz ───────────────────────────────────
function renderBooks() {
  const grid = document.getElementById("books-grid");
  if (!grid) return;

  // Liste görünümünde ızgara, dikey listeye döner (CSS sınıfıyla).
  grid.classList.toggle("list-view", ui.view === "list");
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  const start = (ui.page - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  const fragment = document.createDocumentFragment();
  if (ui.view === "list") {
    pageItems.forEach((book) => fragment.appendChild(createBookRow(book)));
  } else {
    pageItems.forEach((book) => fragment.appendChild(createBookCard(book)));
  }
  grid.appendChild(fragment);
}

// Liste görünümü satırı: küçük kapak + başlık + yazar + format + durum.
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

// ─── Sayfalama kontrolleri ──────────────────────────────────────────────────
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  // Tek sayfa varsa sayfalama gösterme.
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  html += `<button class="page-btn" data-page="prev" ${ui.page === 1 ? "disabled" : ""}>‹</button>`;

  for (const p of pageNumbers(ui.page, totalPages)) {
    if (p === "...") {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += `<button class="page-btn ${p === ui.page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }
  }

  html += `<button class="page-btn" data-page="next" ${ui.page === totalPages ? "disabled" : ""}>›</button>`;
  container.innerHTML = html;
}

// 1 … (geçerli-1) geçerli (geçerli+1) … son  biçiminde sayfa numaraları üretir.
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

function updateResultCount() {
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${filtered.length} kitap`;
}

function updateViewToggle() {
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === ui.view);
  });
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initCatalog() {
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      ui.search = e.target.value;
      recompute(true);
    });
  }

  bindFilter("filter-format", "format");
  bindFilter("filter-status", "status");
  bindFilter("filter-author", "author");
  bindFilter("filter-series", "series");

  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      ui.sort = e.target.value;
      recompute(true);
    });
  }

  // Görünüm geçişi (ızgara / liste).
  const viewToggle = document.querySelector(".view-toggle");
  if (viewToggle) {
    viewToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".view-btn");
      if (!btn) return;
      ui.view = btn.dataset.view;
      render();
    });
  }

  // Sayfalama tıklaması.
  const pagination = document.getElementById("pagination");
  if (pagination) {
    pagination.addEventListener("click", (e) => {
      const btn = e.target.closest(".page-btn");
      if (!btn || btn.disabled) return;

      const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
      const val = btn.dataset.page;
      if (val === "prev") ui.page = Math.max(1, ui.page - 1);
      else if (val === "next") ui.page = Math.min(totalPages, ui.page + 1);
      else ui.page = parseInt(val);

      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Kart/satır tıklaması: tüm ızgaraya tek dinleyici (ızgara ve liste için ortak).
  const grid = document.getElementById("books-grid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const el = e.target.closest(".book-card, .book-row");
      if (el && el.dataset.id) openModal(el.dataset.id);
    });
  }
}

function bindFilter(elementId, filterKey) {
  const el = document.getElementById(elementId);
  if (el) {
    el.addEventListener("change", (e) => {
      ui.filters[filterKey] = e.target.value;
      recompute(true);
    });
  }
}