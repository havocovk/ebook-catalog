// ─────────────────────────────────────────────────────────────────────────────
// SERIES — Seriler sayfası.
//
// Her seri (yayınevi + ad) çiftiyle tanımlanır. Aynı adlı iki seri farklı
// yayınevlerine aitse ayrı ayrı listelenir.
//
// activeSeries: { name, publisher } — hangi seri detayda gösteriliyor.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { openModal } from "../ui/modal.js";
import { escapeHtmlBasic as esc, escapeAttr as escAttr, statusLabel as statusLabelLocal } from "../ui/common.js";

const POPULAR_COUNT = 6;

// Şu an detayda gösterilen seri. Liste görünümünde null.
// { name: string, publisher: string } formatında.
let activeSeries = null;

// ─── Dışa açık ──────────────────────────────────────────────────────────────
export function renderSeries() {
  if (activeSeries) {
    renderSeriesDetail(activeSeries.name, activeSeries.publisher);
  } else {
    renderSeriesList();
  }
}

// ═══════════════════════════════════════════════════════════════
// SERİ LİSTESİ
// ═══════════════════════════════════════════════════════════════

function renderSeriesList() {
  const container = document.getElementById("series-content");
  if (!container) return;

  const seriesData = buildSeriesData();

  if (seriesData.length === 0) {
    container.innerHTML = `
      <div class="empty-page-state">
        <iconify-icon icon="lucide:layers"></iconify-icon>
        <p>Henüz seri bilgisi olan kitap yok.</p>
        <p class="empty-page-hint">Kitaplarda seri bilgisi varsa Google Books'tan çekilecektir.</p>
      </div>`;
    return;
  }

  // Popüler Seriler: kitap sayısına göre azalan.
  const popular = [...seriesData]
    .sort((a, b) => b.total - a.total)
    .slice(0, POPULAR_COUNT);

  // Tam liste: önce seri adına, sonra yayınevine göre alfabetik.
  const allSorted = [...seriesData].sort((a, b) => {
    const nameComp = a.name.localeCompare(b.name, "tr", { sensitivity: "base" });
    if (nameComp !== 0) return nameComp;
    return (a.publisher || "").localeCompare(b.publisher || "", "tr", { sensitivity: "base" });
  });

  container.innerHTML = `
    <div class="series-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:flame"></iconify-icon> Popüler Seriler
      </h2>
      <div class="series-popular-grid">
        ${popular.map((s) => popularCardHtml(s)).join("")}
      </div>
    </div>

    <div class="series-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:layers"></iconify-icon>
        Tüm Seriler
        <span class="detail-sub-count">${seriesData.length} seri</span>
      </h2>
      <div class="series-list" id="series-list">
        ${allSorted.map((s) => seriesRowHtml(s)).join("")}
      </div>
    </div>
  `;
}

// ─── Seri verilerini (yayınevi + ad) çiftine göre grupla ────────────────────
function buildSeriesData() {
  // Anahtar: "yayınevi|||seri adı" — aynı adlı iki seri farklı yayınevindeyse
  // farklı gruplar oluşturur.
  const map = {};

  for (const book of state.books) {
    const name      = (book.series    || "").trim();
    const publisher = (book.publisher || "").trim();
    if (!name) continue;

    const key = `${publisher}|||${name}`;

    if (!map[key]) {
      map[key] = {
        name,
        publisher,
        total : 0,
        read  : 0,
        books : [],
      };
    }
    map[key].total++;
    map[key].books.push(book);
    if (book.status === "okundu") map[key].read++;
  }

  return Object.values(map);
}

// ─── Görüntü adı: "Seri Adı — Yayınevi" (yayınevi varsa) ────────────────────
function displayName(s) {
  return s.publisher ? `${s.name} — ${s.publisher}` : s.name;
}

// ─── Popüler seri kartı ───────────────────────────────────────────────────────
function popularCardHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;
  return `
    <div class="series-popular-card"
         data-series="${escAttr(s.name)}"
         data-publisher="${escAttr(s.publisher)}">
      <div class="series-popular-name">${esc(s.name)}</div>
      ${s.publisher
        ? `<div class="series-popular-publisher">${esc(s.publisher)}</div>`
        : ""}
      <div class="series-popular-stats">
        <span>${s.total} kitap</span>
        <span class="series-read-label">${s.read} okundu</span>
      </div>
      <div class="series-progress-track">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

// ─── Seri listesi satırı ──────────────────────────────────────────────────────
function seriesRowHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;
  return `
    <div class="series-row"
         data-series="${escAttr(s.name)}"
         data-publisher="${escAttr(s.publisher)}">
      <div class="series-row-main">
        <span class="series-row-name">${esc(s.name)}</span>
        <span class="series-row-author">${esc(s.publisher || "")}</span>
      </div>
      <div class="series-row-right">
        <span class="series-row-count">${s.read}/${s.total}</span>
        <div class="series-progress-track series-progress-track--sm">
          <div class="series-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// SERİ DETAY GÖRÜNÜMÜ
// ═══════════════════════════════════════════════════════════════

function renderSeriesDetail(seriesName, publisher) {
  const container = document.getElementById("series-content");
  if (!container) return;

  // Hem seri adı hem yayınevi eşleşmeli — aynı adlı serilerin karışmaması için.
  const books = state.books
    .filter((b) => {
      const nameMatch = b.series === seriesName;
      // Yayınevi boşsa: kitabın da yayınevinin boş olması gerekir.
      const pubMatch  = (b.publisher || "") === (publisher || "");
      return nameMatch && pubMatch;
    })
    .sort((a, b) => {
      const ao = a.series_order ?? 9999;
      const bo = b.series_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" });
    });

  const readCount  = books.filter((b) => b.status === "okundu").length;
  const totalCount = books.length;
  const pct        = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="series-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Serilere Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(seriesName)}</h2>
        ${publisher
          ? `<span class="detail-subtitle">${esc(publisher)}</span>`
          : ""}
      </div>
    </div>

    <div class="series-detail-progress">
      <div class="series-progress-track">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-bar-label">${readCount} / ${totalCount} kitap okundu — %${pct}</span>
    </div>

    <div class="series-book-list" id="series-book-list">
      ${books.map((b) => detailBookRowHtml(b)).join("")}
    </div>
  `;

  document.getElementById("series-back-btn")?.addEventListener("click", () => {
    activeSeries = null;
    renderSeriesList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Detay kitap satırı ───────────────────────────────────────────────────────
function detailBookRowHtml(book) {
  const statusClass = `status-${book.status || "okunmadi"}`;
  const statusText  = statusLabelLocal(book.status);
  const orderLabel  = book.series_order ? `#${book.series_order}` : "—";

  const coverHtml = book.cover_url
    ? `<img src="${esc(book.cover_url)}" alt="${esc(book.title || "")}" loading="lazy" />`
    : `<div class="row-cover-placeholder">${esc((book.title || "?")[0].toUpperCase())}</div>`;

  return `
    <div class="series-book-row" data-id="${esc(book.$id)}">
      <span class="series-book-order">${orderLabel}</span>
      <div class="row-cover series-book-cover">${coverHtml}</div>
      <div class="row-main">
        <span class="row-title">${esc(book.title || "Başlıksız")}</span>
        <span class="row-author">${esc(book.author || "")}</span>
      </div>
      <span class="book-status-badge ${statusClass}">${statusText}</span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA
// ═══════════════════════════════════════════════════════════════

export function initSeries() {
  document.getElementById("series-content")?.addEventListener("click", (e) => {

    // Popüler kart veya liste satırı → detay
    const seriesEl = e.target.closest("[data-series]");
    if (seriesEl && seriesEl.dataset.series) {
      activeSeries = {
        name      : seriesEl.dataset.series,
        publisher : seriesEl.dataset.publisher || "",
      };
      renderSeriesDetail(activeSeries.name, activeSeries.publisher);
      return;
    }

    // Detaydaki kitap satırı → pop-up
    const bookRow = e.target.closest(".series-book-row");
    if (bookRow && bookRow.dataset.id) {
      openModal(bookRow.dataset.id);
      return;
    }
  });
}