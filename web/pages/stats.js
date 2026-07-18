// ─────────────────────────────────────────────────────────────────────────────
// STATS — İstatistikler sayfası.
//
// Adım 6: Sayfa iskeleti
// Adım 7: Üst Özet Bar + Pasta/Halka Grafikler (Format, Dil, Confidence)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";

// Chart.js yükleme durumu ve aktif grafik nesneleri
let _chartJsReady = false;
const _activeCharts = {};

function _loadChartJs() {
  if (_chartJsReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    // Zaten başka sayfa yüklediyse (dashboard) window.Chart mevcuttur
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

function _destroyCharts() {
  Object.values(_activeCharts).forEach((c) => c?.destroy());
  Object.keys(_activeCharts).forEach((k) => delete _activeCharts[k]);
}

// ─── Veri hesapla ────────────────────────────────────────────────────────────
function compute() {
  const books = state.books;

  const total         = books.length;
  const authorCount   = new Set(books.map((b) => b.author).filter(Boolean)).size;
  const seriesCount   = new Set(books.map((b) => b.series).filter(Boolean)).size;
  const publisherCount= new Set(books.map((b) => b.publisher).filter(Boolean)).size;

  // Toplam dosya boyutu (bytes)
  const totalBytes = books.reduce((sum, b) => sum + (b.file_size || 0), 0);

  // Format dağılımı
  const epub = books.filter((b) => b.format === "epub").length;
  const pdf  = books.filter((b) => b.format === "pdf").length;
  const fmtOther = total - epub - pdf;

  // Dil dağılımı
  const langTr    = books.filter((b) => b.language === "tr").length;
  const langEn    = books.filter((b) => b.language === "en").length;
  const langOther = books.filter((b) => b.language && b.language !== "tr" && b.language !== "en").length;
  const langNone  = total - langTr - langEn - langOther;

  // Confidence dağılımı
  const confHigh   = books.filter((b) => b.confidence_score >= 80).length;
  const confMedium = books.filter((b) => b.confidence_score >= 50 && b.confidence_score < 80).length;
  const confLow    = books.filter((b) => b.confidence_score != null && b.confidence_score < 50).length;
  const confNone   = books.filter((b) => b.confidence_score == null).length;

  return {
    total, authorCount, seriesCount, publisherCount, totalBytes,
    epub, pdf, fmtOther,
    langTr, langEn, langOther, langNone,
    confHigh, confMedium, confLow, confNone,
  };
}

// ─── Dosya boyutu formatla ────────────────────────────────────────────────────
function _fmtBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── Dışa açık: router her ziyarette çağırır ─────────────────────────────────
export async function renderStats() {
  const container = document.getElementById("stats-content");
  if (!container) return;

  _destroyCharts();

  const s = compute();

  container.innerHTML = `
    <div class="stats-wrap">

      <!-- ── Sayfa başlığı ── -->
      <div class="stats-header">
        <h1 class="stats-title">
          <iconify-icon icon="lucide:bar-chart-2"></iconify-icon> İstatistikler
        </h1>
        <p class="stats-sub">${s.total} kitap üzerinden hesaplanıyor</p>
      </div>

      <!-- ── Üst Özet Bar ── -->
      <div class="stats-summary-bar">
        ${summaryCard("lucide:book-copy",   "Toplam Kitap",   s.total,              "accent")}
        ${summaryCard("lucide:users",       "Yazar",          s.authorCount,         "neutral")}
        ${summaryCard("lucide:layers",      "Seri",           s.seriesCount,         "neutral")}
        ${summaryCard("lucide:building-2",  "Yayınevi",       s.publisherCount,      "neutral")}
        ${summaryCard("lucide:hard-drive",  "Toplam Boyut",   _fmtBytes(s.totalBytes), "neutral", true)}
      </div>

      <!-- ── Pasta / Halka Grafikler ── -->
      <div class="stats-charts-row">

        <!-- Format Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Format Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-format"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(224,92,92,0.85)",  "PDF",  s.pdf,  s.total)}
            ${legendItem("rgba(76,175,130,0.85)", "EPUB", s.epub, s.total)}
            ${s.fmtOther > 0 ? legendItem("rgba(92,95,114,0.85)", "Diğer", s.fmtOther, s.total) : ""}
          </div>
        </div>

        <!-- Dil Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Dil Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-lang"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(124,106,247,0.85)", "Türkçe",    s.langTr,    s.total)}
            ${legendItem("rgba(76,175,130,0.85)",  "İngilizce", s.langEn,    s.total)}
            ${s.langOther > 0 ? legendItem("rgba(224,168,74,0.85)", "Diğer", s.langOther, s.total) : ""}
            ${s.langNone  > 0 ? legendItem("rgba(92,95,114,0.85)",  "Belirtilmemiş", s.langNone, s.total) : ""}
          </div>
        </div>

        <!-- Confidence Skoru Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Güven Skoru Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-conf"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(76,175,130,0.85)",  "Yüksek (80+)",  s.confHigh,   s.total)}
            ${legendItem("rgba(224,168,74,0.85)",  "Orta (50-79)",  s.confMedium, s.total)}
            ${legendItem("rgba(224,92,92,0.85)",   "Düşük (0-49)",  s.confLow,    s.total)}
            ${s.confNone > 0 ? legendItem("rgba(92,95,114,0.85)", "Belirsiz", s.confNone, s.total) : ""}
          </div>
        </div>

      </div>
    </div>
  `;

  // Chart.js yükle ve grafikleri çiz
  try {
    await _loadChartJs();
    _drawPie("chart-format", ["PDF", "EPUB", "Diğer"],
      [s.pdf, s.epub, s.fmtOther].filter((v) => v > 0),
      ["rgba(224,92,92,0.85)", "rgba(76,175,130,0.85)", "rgba(92,95,114,0.85)"],
      false
    );
    _drawPie("chart-lang",
      ["Türkçe", "İngilizce", "Diğer", "Belirtilmemiş"],
      [s.langTr, s.langEn, s.langOther, s.langNone].filter((v) => v > 0),
      ["rgba(124,106,247,0.85)", "rgba(76,175,130,0.85)", "rgba(224,168,74,0.85)", "rgba(92,95,114,0.85)"],
      false
    );
    _drawPie("chart-conf",
      ["Yüksek (80+)", "Orta (50-79)", "Düşük (0-49)", "Belirsiz"],
      [s.confHigh, s.confMedium, s.confLow, s.confNone].filter((v) => v > 0),
      ["rgba(76,175,130,0.85)", "rgba(224,168,74,0.85)", "rgba(224,92,92,0.85)", "rgba(92,95,114,0.85)"],
      true  // halka
    );
  } catch (err) {
    console.error("[Stats] Chart.js yüklenemedi:", err);
  }
}

// ─── Pasta / Halka grafik çiz ─────────────────────────────────────────────────
function _drawPie(canvasId, allLabels, filteredValues, allColors, isDoughnut) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof window.Chart === "undefined") return;
  if (filteredValues.every((v) => v === 0)) return;

  // Sıfır olmayan değerlere karşılık gelen etiket ve renkleri filtrele
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
        borderColor: "#1a1d24",
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
              const val = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${val} kitap (%${pct})`;
            },
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ─── Yardımcı: özet kart HTML'i ──────────────────────────────────────────────
function summaryCard(icon, label, value, variant, isText = false) {
  return `
    <div class="stats-summary-card stats-summary-card--${variant}">
      <div class="stats-summary-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stats-summary-value ${isText ? "stats-summary-value--sm" : ""}">${value}</div>
      <div class="stats-summary-label">${label}</div>
    </div>
  `;
}

// ─── Yardımcı: grafik legend satırı ──────────────────────────────────────────
function legendItem(color, label, count, total) {
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