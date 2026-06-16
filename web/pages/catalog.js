// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — Katalog sayfası mantığı.
//
// Mevcut tek-sayfa uygulamasının çekirdeği buraya taşındı: arama, filtreler,
// sıralama ve kitap ızgarasının çizimi. Filtre/arama/sıralama durumu yalnızca
// bu sayfayı ilgilendirdiği için global hafızada değil, burada yerel tutulur.
//
// İki dışa açık fonksiyon var:
//   renderCatalog() → router her katalog ziyaretinde bunu çağırır (yeniden çizer)
//   initCatalog()   → olayları bir kez bağlar (app.js başlangıçta çağırır)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";

// Katalog'a özel arayüz durumu (yalnızca bu dosyada kullanılır).
const ui = {
  search: "",
  filters: { format: "", status: "", author: "", series: "" },
  sort: "added_at_desc",
};

// Filtrelenmiş + sıralanmış güncel liste.
let filtered = [];

// ─── Sayfa çizimi (router her ziyarette çağırır) ────────────────────────────
export function renderCatalog() {
  populateFilterOptions();
  applyFilters();
}

// ─── Filtre + sıralama + çizim ──────────────────────────────────────────────
function applyFilters() {
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

  renderBooks();
  updateResultCount();
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

// ─── Kitap ızgarasını çiz ───────────────────────────────────────────────────
function renderBooks() {
  const grid = document.getElementById("books-grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  // DocumentFragment: tüm kartları bellekte hazırlayıp tek seferde ekler (hızlı).
  const fragment = document.createDocumentFragment();
  filtered.forEach((book) => fragment.appendChild(createBookCard(book)));
  grid.appendChild(fragment);
}

function updateResultCount() {
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${filtered.length} kitap`;
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initCatalog() {
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      ui.search = e.target.value;
      applyFilters();
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
      applyFilters();
    });
  }

  // Kart tıklaması: her karta ayrı dinleyici yerine tüm ızgaraya tek dinleyici.
  const grid = document.getElementById("books-grid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".book-card");
      if (card && card.dataset.id) openModal(card.dataset.id);
    });
  }
}

function bindFilter(elementId, filterKey) {
  const el = document.getElementById(elementId);
  if (el) {
    el.addEventListener("change", (e) => {
      ui.filters[filterKey] = e.target.value;
      applyFilters();
    });
  }
}