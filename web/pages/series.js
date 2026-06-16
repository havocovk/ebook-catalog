// ─────────────────────────────────────────────────────────────────────────────
// SERIES — Seriler sayfası.
//
// 7A: Seri listesi — Popüler Seriler öne çıkarılmış + alfabetik tam liste.
//     Her seride: ad, yazar, toplam kitap sayısı, okunan sayısı, ilerleme çubuğu.
//
// 7B: Seri detay — kitaplar series_order'a göre sıralı, okuma durumu renk kodlu.
//     Geri butonu ile seri listesine dönülür.
//
// Liste / detay alt-görünüm; router'a ekstra rota eklenmez.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { openModal } from "../ui/modal.js";

// Popüler Seriler bölümünde gösterilecek maksimum seri sayısı.
const POPULAR_COUNT = 6;

// Şu an detayda gösterilen seri adı. Liste görünümünde null.
let activeSeries = null;

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderSeries() {
  if (activeSeries) {
    renderSeriesDetail(activeSeries);
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
      </div>
    `;
    return;
  }

  // Popüler Seriler: kitap sayısına göre azalan, en fazla POPULAR_COUNT tane.
  const popular = [...seriesData]
    .sort((a, b) => b.total - a.total)
    .slice(0, POPULAR_COUNT);

  // Tam liste: alfabetik.
  const allSorted = [...seriesData]
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  container.innerHTML = `

    <!-- ── Popüler Seriler ── -->
    <div class="series-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:flame"></iconify-icon> Popüler Seriler
      </h2>
      <div class="series-popular-grid">
        ${popular.map((s) => popularCardHtml(s)).join("")}
      </div>
    </div>

    <!-- ── Tüm Seriler ── -->
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

// ─── Seri verilerini state.books'tan hesapla ─────────────────────────────────
function buildSeriesData() {
  const map = {};

  for (const book of state.books) {
    const name = (book.series || "").trim();
    if (!name) continue;

    if (!map[name]) {
      map[name] = {
        name,
        author: book.author || "",
        total:  0,
        read:   0,
        books:  [],
      };
    }
    map[name].total++;
    map[name].books.push(book);
    if (book.status === "okundu") map[name].read++;
  }

  return Object.values(map);
}

// ─── Popüler seri kartı (büyük kart) ─────────────────────────────────────────
function popularCardHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;
  return `
    <div class="series-popular-card" data-series="${escAttr(s.name)}">
      <div class="series-popular-name">${esc(s.name)}</div>
      <div class="series-popular-author">${esc(s.author)}</div>
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

// ─── Seri listesi satırı ─────────────────────────────────────────────────────
function seriesRowHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;
  return `
    <div class="series-row" data-series="${escAttr(s.name)}">
      <div class="series-row-main">
        <span class="series-row-name">${esc(s.name)}</span>
        <span class="series-row-author">${esc(s.author)}</span>
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

function renderSeriesDetail(seriesName) {
  const container = document.getElementById("series-content");
  if (!container) return;

  // Bu serinin kitaplarını series_order'a göre sırala, sırası olmayanlar sona.
  const books = state.books
    .filter((b) => b.series === seriesName)
    .sort((a, b) => {
      const ao = a.series_order ?? 9999;
      const bo = b.series_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || "").localeCompare(b.title || "", "tr");
    });

  const readCount  = books.filter((b) => b.status === "okundu").length;
  const totalCount = books.length;
  const pct        = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;
  const author     = books[0]?.author || "";

  const bookRows = books.map((b) => detailBookRowHtml(b)).join("");

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="series-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Serilere Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(seriesName)}</h2>
        <span class="detail-subtitle">${esc(author)}</span>
      </div>
    </div>

    <!-- Genel ilerleme -->
    <div class="series-detail-progress">
      <div class="series-progress-track">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-bar-label">${readCount} / ${totalCount} kitap okundu — %${pct}</span>
    </div>

    <!-- Kitap sırası -->
    <div class="series-book-list" id="series-book-list">
      ${bookRows}
    </div>
  `;

  // Geri butonu
  document.getElementById("series-back-btn")?.addEventListener("click", () => {
    activeSeries = null;
    renderSeriesList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Detay kitap satırı: sıra no + kapak + başlık + yazar + durum ────────────
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

function statusLabelLocal(status) {
  const map = { okunmadi: "Okunmadı", sirada: "Sırada", okunuyor: "Okunuyor", okundu: "Okundu" };
  return map[status] || "Okunmadı";
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA (yalnızca bir kez)
// ═══════════════════════════════════════════════════════════════

export function initSeries() {
  document.getElementById("series-content")?.addEventListener("click", (e) => {

    // Popüler kart veya liste satırı → detay görünümüne geç
    const seriesEl = e.target.closest("[data-series]");
    if (seriesEl && seriesEl.dataset.series) {
      activeSeries = seriesEl.dataset.series;
      renderSeriesDetail(activeSeries);
      return;
    }

    // Detaydaki kitap satırı → pop-up aç
    const bookRow = e.target.closest(".series-book-row");
    if (bookRow && bookRow.dataset.id) {
      openModal(bookRow.dataset.id);
      return;
    }
  });
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}