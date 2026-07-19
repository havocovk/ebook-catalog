// ─────────────────────────────────────────────────────────────────────────────
// STATS-CORE — Paylaşılan altyapı.
// Chart.js yükleme, grafik yok etme, compute(), ortak yardımcılar.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";

let _chartJsReady = false;
export const _activeCharts = {};

export function _loadChartJs() {
  if (_chartJsReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (typeof window.Chart !== "undefined") {
      _chartJsReady = true;
      return resolve();
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    script.onload  = () => { _chartJsReady = true; resolve(); };
    script.onerror = () => reject(new Error("Chart.js yüklenemedi"));
    document.head.appendChild(script);
  });
}

export function _destroyCharts() {
  Object.values(_activeCharts).forEach((c) => c?.destroy());
  Object.keys(_activeCharts).forEach((k) => delete _activeCharts[k]);
}

export function compute() {
  const books = state.books;

  const total          = books.length;
  const authorCount    = new Set(books.map((b) => b.author).filter(Boolean)).size;
  const seriesCount    = new Set(books.map((b) => b.series).filter(Boolean)).size;
  const publisherCount = new Set(books.map((b) => b.publisher).filter(Boolean)).size;
  const totalBytes     = books.reduce((sum, b) => sum + (b.file_size || 0), 0);
  const totalPages     = books.reduce((sum, b) => sum + (b.page_count || 0), 0);

  const epub     = books.filter((b) => b.format === "epub").length;
  const pdf      = books.filter((b) => b.format === "pdf").length;
  const fmtOther = total - epub - pdf;

  const langTr    = books.filter((b) => b.language === "tr").length;
  const langEn    = books.filter((b) => b.language === "en").length;
  const langOther = books.filter((b) => b.language && b.language !== "tr" && b.language !== "en").length;
  const langNone  = total - langTr - langEn - langOther;

  const confHigh   = books.filter((b) => b.confidence_score >= 80).length;
  const confMedium = books.filter((b) => b.confidence_score >= 50 && b.confidence_score < 80).length;
  const confLow    = books.filter((b) => b.confidence_score != null && b.confidence_score < 50).length;
  const confNone   = books.filter((b) => b.confidence_score == null).length;

  const booksWithPages = books.filter((b) => b.page_count > 0);
  const pageRanges = [
    { label: "0-100",    min: 0,    max: 100      },
    { label: "101-200",  min: 101,  max: 200      },
    { label: "201-300",  min: 201,  max: 300      },
    { label: "301-500",  min: 301,  max: 500      },
    { label: "501-750",  min: 501,  max: 750      },
    { label: "751-1000", min: 751,  max: 1000     },
    { label: "1000+",    min: 1001, max: Infinity },
  ];
  const pageDistLabels = pageRanges.map((r) => r.label);
  const pageDistValues = pageRanges.map((r) =>
    booksWithPages.filter((b) => b.page_count >= r.min && b.page_count <= r.max).length
  );

  return {
    total, authorCount, seriesCount, publisherCount, totalBytes, totalPages,
    epub, pdf, fmtOther,
    langTr, langEn, langOther, langNone,
    confHigh, confMedium, confLow, confNone,
    booksWithPages: booksWithPages.length,
    pageDistLabels, pageDistValues,
  };
}

export function _fmtBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function pillStat(icon, label, value) {
  return `
    <div class="stats-pill">
      <iconify-icon icon="${icon}" class="stats-pill-icon"></iconify-icon>
      <span class="stats-pill-label">${label}</span>
      <span class="stats-pill-value">${value}</span>
    </div>
  `;
}

export function legendItem(color, label, count, total) {
  if (count === 0) return "";
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="stats-legend-item">
      <span class="stats-legend-dot" style="background:${color}"></span>
      <span class="stats-legend-label">${label}</span>
      <span class="stats-legend-val">${count} <span class="stats-legend-pct">%${pct}</span></span>
    </div>
  `;
}

export function miniCard(icon, label, value, variant) {
  return `
    <div class="stats-mini-card stats-mini-card--${variant}">
      <div class="stats-mini-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stats-mini-value">${value}</div>
      <div class="stats-mini-label">${label}</div>
    </div>
  `;
}

export function authorCard(icon, label, value, variant) {
  return `
    <div class="stats-author-card stats-mini-card--${variant}">
      <div class="stats-mini-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stats-author-value">${value}</div>
      <div class="stats-mini-label">${label}</div>
    </div>
  `;
}

export function _drawPie(canvasId, allLabels, filteredValues, allColors, isDoughnut) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof window.Chart === "undefined") return;
  if (filteredValues.every((v) => v === 0)) return;

  const labels = [];
  const colors = [];
  let vi = 0;
  allLabels.forEach((label, i) => {
    if (allColors[i] !== undefined && filteredValues[vi] !== undefined) {
      labels.push(label);
      colors.push(allColors[i]);
      vi++;
    }
  });

  _activeCharts[canvasId] = new window.Chart(canvas, {
    type: isDoughnut ? "doughnut" : "pie",
    data: {
      labels,
      datasets: [{
        data: filteredValues,
        backgroundColor: colors,
        borderColor: "#171210",
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: isDoughnut ? "65%" : "0%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val   = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${val} kitap (%${pct})`;
            },
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}