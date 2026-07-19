// ─────────────────────────────────────────────────────────────────────────────
// STATS-OVERVIEW — Üst özet pill bar + 4 pasta/çubuk grafik (Adım 7).
// ─────────────────────────────────────────────────────────────────────────────

import {
  _activeCharts, _loadChartJs,
  compute, _fmtBytes,
  pillStat, legendItem, _drawPie,
} from "./stats-core.js";

export async function renderOverview() {
  const container = document.getElementById("stats-content");
  if (!container) return;

  const s = compute();

  container.innerHTML = `
    <div class="stats-wrap">
      <div class="stats-header">
        <h1 class="stats-title">
          <iconify-icon icon="lucide:bar-chart-2"></iconify-icon> İstatistikler
        </h1>
        <p class="stats-sub">${s.total} kitap üzerinden hesaplanıyor</p>
      </div>

      <div class="stats-pill-bar">
        ${pillStat("lucide:book-copy",  "Kitap",    s.total)}
        ${pillStat("lucide:users",      "Yazar",    s.authorCount)}
        ${pillStat("lucide:layers",     "Seri",     s.seriesCount)}
        ${pillStat("lucide:building-2", "Yayınevi", s.publisherCount)}
        ${pillStat("lucide:hard-drive", "Boyut",    _fmtBytes(s.totalBytes))}
        ${s.totalPages > 0 ? pillStat("lucide:book-open", "Sayfa", s.totalPages.toLocaleString("tr-TR")) : ""}
      </div>

      <div class="stats-charts-row stats-charts-row--4">
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Format Dağılımı</h2>
          <div class="stats-chart-wrap"><canvas id="chart-format"></canvas></div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(239,68,68,0.85)",  "PDF",  s.pdf,  s.total)}
            ${legendItem("rgba(34,197,94,0.85)",  "EPUB", s.epub, s.total)}
            ${s.fmtOther > 0 ? legendItem("rgba(100,116,139,0.85)", "Diğer", s.fmtOther, s.total) : ""}
          </div>
        </div>

        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Dil Dağılımı</h2>
          <div class="stats-chart-wrap"><canvas id="chart-lang"></canvas></div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(59,130,246,0.85)",   "Türkçe",        s.langTr,    s.total)}
            ${legendItem("rgba(34,197,94,0.85)",    "İngilizce",     s.langEn,    s.total)}
            ${s.langOther > 0 ? legendItem("rgba(245,158,11,0.85)",  "Diğer",          s.langOther, s.total) : ""}
            ${s.langNone  > 0 ? legendItem("rgba(100,116,139,0.85)", "Belirtilmemiş",  s.langNone,  s.total) : ""}
          </div>
        </div>

        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Güven Skoru Dağılımı</h2>
          <div class="stats-chart-wrap"><canvas id="chart-conf"></canvas></div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(34,197,94,0.85)",   "Yüksek (80+)", s.confHigh,   s.total)}
            ${legendItem("rgba(245,158,11,0.85)",  "Orta (50-79)", s.confMedium, s.total)}
            ${legendItem("rgba(239,68,68,0.85)",   "Düşük (0-49)", s.confLow,    s.total)}
            ${s.confNone > 0 ? legendItem("rgba(100,116,139,0.85)", "Belirsiz", s.confNone, s.total) : ""}
          </div>
        </div>

        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Sayfa Sayısı Dağılımı</h2>
          <div class="stats-chart-wrap stats-chart-wrap--bar">
            <canvas id="chart-pagecount"></canvas>
          </div>
          <p class="stats-chart-sub">Sayfa sayısı olan ${s.booksWithPages} kitap</p>
        </div>
      </div>
    </div>
  `;

  try {
    await _loadChartJs();
    _drawPie("chart-format",
      ["PDF", "EPUB", "Diğer"],
      [s.pdf, s.epub, s.fmtOther].filter((v) => v > 0),
      ["rgba(239,68,68,0.85)", "rgba(34,197,94,0.85)", "rgba(100,116,139,0.85)"],
      false
    );
    _drawPie("chart-lang",
      ["Türkçe", "İngilizce", "Diğer", "Belirtilmemiş"],
      [s.langTr, s.langEn, s.langOther, s.langNone].filter((v) => v > 0),
      ["rgba(59,130,246,0.85)", "rgba(34,197,94,0.85)", "rgba(245,158,11,0.85)", "rgba(100,116,139,0.85)"],
      false
    );
    _drawPie("chart-conf",
      ["Yüksek (80+)", "Orta (50-79)", "Düşük (0-49)", "Belirsiz"],
      [s.confHigh, s.confMedium, s.confLow, s.confNone].filter((v) => v > 0),
      ["rgba(34,197,94,0.85)", "rgba(245,158,11,0.85)", "rgba(239,68,68,0.85)", "rgba(100,116,139,0.85)"],
      true
    );
    _drawPageCount(s);
  } catch (err) {
    console.error("[Stats] Chart.js yüklenemedi:", err);
  }
}

function _drawPageCount(s) {
  const canvas = document.getElementById("chart-pagecount");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-pagecount"] = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: s.pageDistLabels,
      datasets: [{
        label: "Kitap Sayısı",
        data:  s.pageDistValues,
        backgroundColor: "rgba(234,88,12,0.75)",
        borderColor:     "rgba(234,88,12,1)",
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} kitap` } },
      },
      scales: {
        x: { ticks: { color: "#a89080", font: { size: 10 }, maxRotation: 30 }, grid: { color: "rgba(51,39,32,0.6)" } },
        y: { ticks: { color: "#a89080", font: { size: 10 } }, grid: { color: "rgba(51,39,32,0.6)" }, beginAtZero: true },
      },
      animation: { duration: 400 },
    },
  });
}
