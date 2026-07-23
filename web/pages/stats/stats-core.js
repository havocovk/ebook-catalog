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

// ── Başlık normalizasyonu — küçük harf, trim, çoklu boşluk temizle ──────────
// Türkçe karakterler korunur (toLocaleLowerCase("tr"))
export function normalizeTitle(title) {
  if (!title) return "";
  return title.toLocaleLowerCase("tr").trim().replace(/\s+/g, " ");
}

// ── Yazar+başlık bazlı tekilleştirilmiş kitap listesi ────────────────────────
// Öncelik sırası:
// 1. canonical_id varsa → aynı canonical_id'ye sahip kitaplar = aynı kitap
// 2. canonical_id yoksa → aynı yazar + normalize başlık = aynı kitap
export function deduplicateBooks(books) {
  const seen = new Map();
  for (const b of books) {
    let key;
    if (b.canonical_id && b.canonical_id.trim()) {
      key = `canonical:${b.canonical_id.trim()}`;
    } else {
      key = `title:${(b.author || "").toLocaleLowerCase("tr").trim()}|||${normalizeTitle(b.title)}`;
    }
    if (!seen.has(key)) {
      seen.set(key, b);
    } else {
      const existing = seen.get(key);
      if ((b.page_count || 0) > (existing.page_count || 0)) {
        seen.set(key, b);
      }
    }
  }
  return Array.from(seen.values());
}

export function compute() {
  const books      = state.books;
  // Tekilleştirilmiş kitap listesi — yazar+başlık bazlı
  const uniqueBooks = deduplicateBooks(books);

  const total          = uniqueBooks.length;
  const authorCount    = new Set(uniqueBooks.map((b) => b.author).filter(Boolean)).size;
  const seriesCount    = new Set(uniqueBooks.map((b) => b.series).filter(Boolean)).size;
  const publisherCount = new Set(uniqueBooks.map((b) => b.publisher).filter(Boolean)).size;
  const totalBytes     = books.reduce((sum, b) => sum + (b.file_size || 0), 0);
  const totalPages     = uniqueBooks.reduce((sum, b) => sum + (b.page_count || 0), 0);

  // Format dağılımı: tekilleştirilmiş değil, veritabanındaki TÜM dosyalar sayılır.
  // (Aynı kitabın hem PDF hem EPUB versiyonu varsa her biri ayrı sayılır.)
  const epub     = books.filter((b) => b.format === "epub").length;
  const pdf      = books.filter((b) => b.format === "pdf").length;
  const fmtOther = books.length - epub - pdf;

  const langTr    = uniqueBooks.filter((b) => b.language === "tr").length;
  const langEn    = uniqueBooks.filter((b) => b.language === "en").length;
  const langOther = uniqueBooks.filter((b) => b.language && b.language !== "tr" && b.language !== "en").length;
  const langNone  = total - langTr - langEn - langOther;

  // Dinamik dil listesi — top 15, Grimmory gibi
  const langCountMap = new Map();
  uniqueBooks.forEach((b) => {
    const raw = (b.language || "").trim().toLowerCase();
    if (raw) langCountMap.set(raw, (langCountMap.get(raw) || 0) + 1);
  });
  const dynamicLangs = Array.from(langCountMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Güven skoru — Grimmory ile birebir 5 kategori
  // Mükemmel (90-100), İyi (70-89), Orta (50-69), Düşük (25-49), Çok Düşük (0-24)
  const CONF_RANGES = [
    { key: "confExcellent", label: "Mükemmel (90-100)", min: 90,  max: 100, color: "#16A34A" },
    { key: "confGood",      label: "İyi (70-89)",        min: 70,  max: 89,  color: "#22C55E" },
    { key: "confFair",      label: "Orta (50-69)",        min: 50,  max: 69,  color: "#F59E0B" },
    { key: "confPoor",      label: "Düşük (25-49)",       min: 25,  max: 49,  color: "#F97316" },
    { key: "confVeryPoor",  label: "Çok Düşük (0-24)",    min: 0,   max: 24,  color: "#DC2626" },
  ];
  const confScores = uniqueBooks.filter((b) => b.confidence_score != null);
  const confNone   = uniqueBooks.filter((b) => b.confidence_score == null).length;
  const confData   = CONF_RANGES.map((r) => ({
    label: r.label,
    color: r.color,
    count: confScores.filter((b) => b.confidence_score >= r.min && b.confidence_score <= r.max).length,
  })).filter((r) => r.count > 0);

  const booksWithPages = uniqueBooks.filter((b) => b.page_count > 0);
  // Grimmory page-count-chart.ts'den birebir renk ve aralıklar
  const pageRanges = [
    { label: "0-100",    min: 0,    max: 100,      color: "#06B6D4" },
    { label: "101-200",  min: 101,  max: 200,      color: "#0EA5E9" },
    { label: "201-300",  min: 201,  max: 300,      color: "#3B82F6" },
    { label: "301-500",  min: 301,  max: 500,      color: "#6366F1" },
    { label: "501-750",  min: 501,  max: 750,      color: "#8B5CF6" },
    { label: "751-1000", min: 751,  max: 1000,     color: "#A855F7" },
    { label: "1000+",    min: 1001, max: Infinity,  color: "#D946EF" },
  ];
  const pageDistLabels = pageRanges.map((r) => r.label);
  const pageDistColors = pageRanges.map((r) => r.color);
  const pageDistValues = pageRanges.map((r) =>
    booksWithPages.filter((b) => b.page_count >= r.min && b.page_count <= r.max).length
  );

  return {
    total, authorCount, seriesCount, publisherCount, totalBytes, totalPages,
    epub, pdf, fmtOther,
    langTr, langEn, langOther, langNone, dynamicLangs,
    confNone, confData,
    booksWithPages: booksWithPages.length,
    pageDistLabels, pageDistValues, pageDistColors,
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

export function _drawPie(canvasId, allLabels, filteredValues, allColors, isDoughnut, tooltipBorderColor = "#ffffff", legendSize = 12) {
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
        borderColor: "#000000",
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: isDoughnut ? "60%" : "0%",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, bottom: 10 }
      },
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: {
            font: {
              family: "'Inter', sans-serif",
              size: legendSize
            },
            usePointStyle: true,
            pointStyle: "circle",
            padding: 15,
            color: "#a89080",
          }
        },
        tooltip: {
          borderColor: tooltipBorderColor,
          borderWidth: 2,
          cornerRadius: 8,
          padding: 12,
          titleFont: { size: 14, weight: "bold" },
          bodyFont: { size: 12 },
          callbacks: {
            label: (ctx) => {
              const val   = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${val} kitap (%${pct})`;
            },
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}