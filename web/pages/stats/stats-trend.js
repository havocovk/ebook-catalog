// ─────────────────────────────────────────────────────────────────────────────
// STATS-TREND — Publication Trend (Adım 11).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs, miniCard } from "./stats-core.js";

function computeTrend() {
  const books    = state.books;
  const withYear = books.filter((b) => b.year && b.year > 0);
  if (withYear.length === 0) return null;

  const years        = withYear.map((b) => b.year);
  const yearMap      = {};
  const yearPageMap  = {};
  withYear.forEach((b) => {
    yearMap[b.year]     = (yearMap[b.year]     || 0) + 1;
    yearPageMap[b.year] = (yearPageMap[b.year] || 0) + (b.page_count || 0);
  });

  const sortedYears  = Object.keys(yearMap).map(Number).sort((a, b) => a - b);
  const sortedCounts = sortedYears.map((y) => yearMap[y]);
  const sortedPages  = sortedYears.map((y) => yearPageMap[y] || 0);

  const peakPageEntry = Object.entries(yearPageMap).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0] || null;
  const peakPageYear  = peakPageEntry ? Number(peakPageEntry[0]) : null;
  const peakPageCount = peakPageEntry ? peakPageEntry[1] : 0;

  const total       = withYear.length;
  const uniqueYears = sortedYears.length;
  const peakEntry   = Object.entries(yearMap).sort((a, b) => b[1] - a[1])[0];
  const peakYear    = peakEntry ? Number(peakEntry[0]) : null;
  const peakCount   = peakEntry ? peakEntry[1] : 0;

  const cutoff10    = new Date().getFullYear() - 10;
  const last10Count = years.filter((y) => y >= cutoff10).length;
  const last10Pct   = Math.round((last10Count / total) * 100);
  const avgPerYear  = uniqueYears > 0 ? (total / uniqueYears).toFixed(1) : 0;

  let best5Start = sortedYears[0], best5Count = 0;
  for (let i = 0; i < sortedYears.length; i++) {
    const cnt = years.filter((y) => y >= sortedYears[i] && y <= sortedYears[i] + 4).length;
    if (cnt > best5Count) { best5Count = cnt; best5Start = sortedYears[i]; }
  }

  const span         = sortedYears.length > 1 ? sortedYears[sortedYears.length - 1] - sortedYears[0] + 1 : 1;
  const modernPct    = Math.round((years.filter((y) => y >= 2000).length / total) * 100);
  const classicPct   = Math.round((years.filter((y) => y < 1970).length / total) * 100);

  return {
    sortedYears, sortedCounts, sortedPages, total, uniqueYears,
    peakYear, peakCount, last10Pct, avgPerYear,
    best5Start, best5Count, span, modernPct, classicPct,
    peakPageYear, peakPageCount,
  };
}

export async function renderTrendSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const t = computeTrend();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-trend-section";

  if (!t) {
    sectionEl.innerHTML = `
      <div class="stats-section-box">
        <h2 class="stats-section-title">
          <iconify-icon icon="lucide:trending-up"></iconify-icon> Yayın Trendi
        </h2>
        <p class="stats-empty">Yıl bilgisi olan kitap bulunamadı.</p>
      </div>`;
    wrap.appendChild(sectionEl);
    return;
  }

  sectionEl.innerHTML = `
    <div class="stats-section-box">
      <h2 class="stats-section-title">
        <iconify-icon icon="lucide:trending-up"></iconify-icon> Yayın Trendi
        <span class="stats-section-sub">${t.total} kitap · ${t.uniqueYears} farklı yıl</span>
      </h2>
      <div class="stats-mini-grid">
        ${miniCard("lucide:trophy",          "Zirve Yıl",        t.peakYear ? `${t.peakYear} (${t.peakCount} kitap)` : "—",       "warning")}
        ${miniCard("lucide:calendar-check",  "Son 10 Yıl Oranı", `%${t.last10Pct}`,                                               "accent")}
        ${miniCard("lucide:calculator",      "Yıl Başına Ort.",   `${t.avgPerYear} kitap`,                                         "neutral")}
        ${miniCard("lucide:flame",           "En İyi 5 Yıl",     `${t.best5Start}–${t.best5Start + 4} (${t.best5Count})`,         "success")}
        ${miniCard("lucide:move-horizontal", "Kapsanan Süre",     `${t.span} yıl`,                                                 "neutral")}
        ${miniCard("lucide:zap",             "21. Yüzyıl",        `%${t.modernPct}`,                                               "accent")}
        ${miniCard("lucide:clock",           "Klasik Oranı",      `%${t.classicPct}`,                                              "neutral")}
        ${miniCard("lucide:hash",            "Benzersiz Yıl",     t.uniqueYears,                                                   "neutral")}
        ${t.peakPageYear ? miniCard("lucide:book-marked", "En Hacimli Yıl", `${t.peakPageYear} (${t.peakPageCount.toLocaleString("tr-TR")} s.)`, "success") : ""}
      </div>
      <div class="stats-bar-chart-wrap stats-trend-wrap">
        <canvas id="chart-trend"></canvas>
      </div>
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
        borderColor:     "rgba(234,88,12,0.9)",
        backgroundColor: "rgba(234,88,12,0.15)",
        borderWidth: 2,
        pointRadius: t.sortedYears.length > 40 ? 0 : 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const ps = t.sortedPages[ctx.dataIndex] > 0
                ? ` · ${t.sortedPages[ctx.dataIndex].toLocaleString("tr-TR")} sayfa` : "";
              return ` ${ctx.parsed.y} kitap${ps}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#a89080", font: { size: 11 }, maxTicksLimit: 15, maxRotation: 45 }, grid: { color: "rgba(51,39,32,0.4)" } },
        y: { ticks: { color: "#a89080", font: { size: 11 } }, grid: { color: "rgba(51,39,32,0.6)" }, beginAtZero: true },
      },
      animation: { duration: 400 },
    },
  });
}
