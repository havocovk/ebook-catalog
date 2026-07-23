// ─────────────────────────────────────────────────────────────────────────────
// STATS-TREND — Publication Trend (Grimmory birebir).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs } from "./stats-core.js";

function computeTrend() {
  const books    = state.books;
  const withYear = books.filter((b) => b.year && b.year > 0);
  if (withYear.length === 0) return null;

  const years       = withYear.map((b) => b.year);
  const yearMap     = {};
  const yearPageMap = {};
  withYear.forEach((b) => {
    yearMap[b.year]     = (yearMap[b.year]     || 0) + 1;
    yearPageMap[b.year] = (yearPageMap[b.year] || 0) + (b.page_count || 0);
  });

  const sortedYears  = Object.keys(yearMap).map(Number).sort((a, b) => a - b);
  const sortedCounts = sortedYears.map((y) => yearMap[y]);

  const total       = withYear.length;
  const uniqueYears = sortedYears.length;

  // Peak year
  const peakEntry = Object.entries(yearMap).sort((a, b) => b[1] - a[1])[0];
  const peakYear  = peakEntry ? Number(peakEntry[0]) : null;
  const peakCount = peakEntry ? peakEntry[1] : 0;

  // Last 10 years
  const cutoff10    = new Date().getFullYear() - 10;
  const last10Count = years.filter((y) => y >= cutoff10).length;
  const last10Pct   = Math.round((last10Count / total) * 100);

  // Avg per year
  const avgPerYear = uniqueYears > 0 ? (total / uniqueYears).toFixed(1) : 0;

  // Best 5-year span
  let best5Start = sortedYears[0], best5Count = 0;
  for (let i = 0; i < sortedYears.length; i++) {
    const cnt = years.filter((y) => y >= sortedYears[i] && y <= sortedYears[i] + 4).length;
    if (cnt > best5Count) { best5Count = cnt; best5Start = sortedYears[i]; }
  }

  // Time span
  const span = sortedYears.length > 1 ? sortedYears[sortedYears.length - 1] - sortedYears[0] : 0;

  // 21st century
  const century21Count = years.filter((y) => y >= 2000).length;
  const century21Pct   = Math.round((century21Count / total) * 100);

  // Classics pre-1970
  const classicCount = years.filter((y) => y < 1970).length;
  const classicPct   = Math.round((classicCount / total) * 100);

  // Oldest / newest decades
  const oldestYear   = sortedYears[0];
  const newestYear   = sortedYears[sortedYears.length - 1];
  const oldestDecade = oldestYear < 1900 ? "1900 öncesi" : `${Math.floor(oldestYear / 10) * 10}'ler`;
  const newestDecade = `${Math.floor(newestYear / 10) * 10}'ler`;

  // Year range badge
  const yearRange = `${sortedYears[0]} - ${sortedYears[sortedYears.length - 1]}`;

  return {
    sortedYears, sortedCounts, total, uniqueYears,
    peakYear, peakCount,
    last10Count, last10Pct,
    avgPerYear,
    best5Start, best5Count,
    span,
    century21Count, century21Pct,
    classicCount, classicPct,
    oldestDecade, newestDecade,
    yearRange,
  };
}

// ── 8 Chip HTML — Grimmory .insight-item yapısı, ikon yok ────────────────────
// Grimmory SCSS: .insight-item → neutral-surface (bg:#0a0a0a, border:#1f1f1f, radius:8px)
// .insight-label: 0.6125rem / uppercase / #a89080
// .insight-value: 1.3125rem / 600 / renk chip'e göre
// .insight-detail: xs / #a89080
function chip(label, value, detail, colorHex, smallValue = false) {
  const fontSize = smallValue ? "1.0938rem" : "1.3125rem";
  return `
    <div class="pt-insight-item">
      <span class="pt-insight-label">${label}</span>
      <span class="pt-insight-value" style="color:${colorHex};font-size:${fontSize};">${value}</span>
      <span class="pt-insight-detail">${detail}</span>
    </div>`;
}

export async function renderTrendSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const t         = computeTrend();
  const sectionEl = document.createElement("div");
  sectionEl.id    = "stats-trend-section";

  if (!t) {
    sectionEl.innerHTML = `
      <div class="stats-section-box">
        <div class="au-section-header">
          <div class="au-section-header-left">
            <iconify-icon icon="lucide:trending-up" class="au-header-icon" style="color:#06b6d4;"></iconify-icon>
            <div>
              <h2 class="au-title">Yayın Trendi</h2>
              <p class="au-desc">Yayın yılına göre kitaplar — koleksiyon trendlerini keşfedin</p>
            </div>
          </div>
        </div>
        <p class="stats-empty">Yıl bilgisi olan kitap bulunamadı.</p>
      </div>`;
    wrap.appendChild(sectionEl);
    return;
  }

  // 8 chip Türkçe etiketleri ve Grimmory renkleri
  // peak→#f59e0b, recent→#06b6d4, average→#a78bfa, productive→#4ade80,
  // timespan→#f472b6, century21→#38bdf8, classics→#fbbf24, unique→#c084fc
  const chips = `
    <div class="pt-insights-row">
      ${chip("Zirve Yıl",       t.peakYear || "—",                                   `${t.peakCount} kitap`,                   "#f59e0b")}
      ${chip("Son 10 Yıl",      `%${t.last10Pct}`,                                   `${t.last10Count} kitap`,                 "#06b6d4")}
      ${chip("Yıl Başına Ort.", `${t.avgPerYear}`,                                   "kitap/yıl",                              "#a78bfa")}
      ${chip("En İyi 5 Yıl",   `${t.best5Start}-${t.best5Start + 4}`,               "en çok kitap yayımlanan",                "#4ade80", true)}
      ${chip("Kapsanan Süre",   `${t.span}`,                                          "yıl kapsıyor",                           "#f472b6")}
      ${chip("21. Yüzyıl",      `%${t.century21Pct}`,                                `${t.century21Count} kitap`,              "#38bdf8")}
      ${chip("Klasikler",       `%${t.classicPct}`,                                  `${t.classicCount} 1970 öncesi`,          "#fbbf24")}
      ${chip("Benzersiz Yıl",   `${t.uniqueYears}`,                                  `${t.oldestDecade} - ${t.newestDecade}`,  "#c084fc")}
    </div>`;

  sectionEl.innerHTML = `
    <div class="stats-section-box">

      <!-- Başlık — Grimmory: ikon + başlık + açıklama + sağda yıl aralığı badge -->
      <div class="au-section-header">
        <div class="au-section-header-left">
          <iconify-icon icon="lucide:trending-up" class="au-header-icon" style="color:#06b6d4;"></iconify-icon>
          <div>
            <h2 class="au-title">Yayın Trendi</h2>
            <p class="au-desc">Yayın yılına göre kitaplar — koleksiyon trendlerini keşfedin</p>
          </div>
        </div>
        <!-- Grimmory: .year-range-badge — cyan accent -->
        <div class="pt-year-badge">${t.yearRange}</div>
      </div>

      <!-- Grafik — Grimmory: height 380px -->
      <div class="stats-bar-chart-wrap pt-chart-wrap">
        <canvas id="chart-trend"></canvas>
      </div>

      <!-- 8 Chip — grafiğin altında -->
      ${chips}

    </div>
  `;

  wrap.appendChild(sectionEl);

  try {
    await _loadChartJs();
    _drawTrend(t);
  } catch (err) {
    console.error("[Stats] Trend grafik hatası:", err);
  }
}

function _drawTrend(t) {
  const canvas = document.getElementById("chart-trend");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-trend"] = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: t.sortedYears,
      datasets: [{
        label: "Kitap Sayısı",
        data:  t.sortedCounts,
        // Grimmory: borderColor #06b6d4, backgroundColor rgba(6,182,212,0.1)
        borderColor:        "#06b6d4",
        backgroundColor:    "rgba(6,182,212,0.1)",
        pointBackgroundColor: "#06b6d4",
        borderWidth:   3,
        pointRadius:   t.sortedYears.length > 40 ? 0 : 4,
        pointHoverRadius: 7,
        pointBorderWidth: 2,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 20, bottom: 10, left: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          borderColor:  "#06b6d4",
          borderWidth:  2,
          cornerRadius: 8,
          padding:      12,
          titleFont: { size: 13, weight: "bold", family: "'Inter', sans-serif" },
          bodyFont:  { size: 11,                 family: "'Inter', sans-serif" },
          callbacks: {
            title: (ctx) => `${ctx[0].label} Yılı`,
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v === 1 ? ` ${v} kitap` : ` ${v} kitap`;
            },
          },
          interaction: { intersect: false, mode: "index" },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#a89080",
            font:  { family: "'Inter', sans-serif", size: 10 },
            maxRotation:  45,
            minRotation:  45,
            autoSkip:     true,
            maxTicksLimit: 20,
          },
          grid:   { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          title:  {
            display: true,
            text:    "Yayın Yılı",
            font:    { family: "'Inter', sans-serif", size: 12, weight: "500" },
            color:   "#a89080",
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#a89080",
            font:  { family: "'Inter', sans-serif", size: 11 },
            precision: 0,
            stepSize:  1,
          },
          grid:   { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          title:  {
            display: true,
            text:    "Kitaplar",
            font:    { family: "'Inter', sans-serif", size: 12, weight: "500" },
            color:   "#a89080",
          },
        },
      },
      elements: {
        line:  { tension: 0.3, borderWidth: 3 },
        point: { radius: 4, hoverRadius: 7, borderWidth: 2 },
      },
      interaction: { intersect: false, mode: "index" },
      animation:   { duration: 400 },
    },
  });
}