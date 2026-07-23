// ─────────────────────────────────────────────────────────────────────────────
// STATS-OVERVIEW — Üst özet pill bar + 4 pasta/çubuk grafik (Adım 7).
// ─────────────────────────────────────────────────────────────────────────────

import {
  _activeCharts, _loadChartJs,
  compute, _fmtBytes,
  pillStat, _drawPie,
} from "./stats-core.js";

// ── Grimmory'den alınan format renkleri ──────────────────────────────────────
const FORMAT_COLORS = {
  'PDF':  '#E11D48',   // Rose
  'EPUB': '#0D9488',   // Teal
  'CBX':  '#7C3AED',   // Violet
  'FB2':  '#F59E0B',   // Amber
  'MOBI': '#2563EB',   // Blue
  'AZW3': '#16A34A',   // Green
  'Diğer': '#6B7280',  // Gray
};

// ── Dil dağılımı renk paleti (Grimmory — sıralı, dile göre değil sıraya göre) ─
const LANGUAGE_PALETTE = [
  '#2563EB',  // 1  Blue
  '#0D9488',  // 2  Teal
  '#7C3AED',  // 3  Violet
  '#DC2626',  // 4  Red
  '#F59E0B',  // 5  Amber
  '#16A34A',  // 6  Green
  '#EC4899',  // 7  Pink
  '#8B5CF6',  // 8  Purple
  '#06B6D4',  // 9  Cyan
  '#ff8904',  // 10 Orange
  '#6366F1',  // 11 Indigo
  '#14B8A6',  // 12 Teal-500
  '#F43F5E',  // 13 Rose
  '#84CC16',  // 14 Lime
  '#A855F7',  // 15 Purple-500
];

// ── Dil kodu → Türkçe görünen ad eşleştirmesi ───────────────────────────────
const LANG_DISPLAY_NAMES = {
  'tr': 'Türkçe', 'tur': 'Türkçe', 'turkish': 'Türkçe',
  'en': 'İngilizce', 'eng': 'İngilizce', 'english': 'İngilizce',
  'de': 'Almanca', 'deu': 'Almanca', 'german': 'Almanca',
  'fr': 'Fransızca', 'fra': 'Fransızca', 'french': 'Fransızca',
  'es': 'İspanyolca', 'spa': 'İspanyolca', 'spanish': 'İspanyolca',
  'it': 'İtalyanca', 'ita': 'İtalyanca', 'italian': 'İtalyanca',
  'pt': 'Portekizce', 'por': 'Portekizce', 'portuguese': 'Portekizce',
  'ru': 'Rusça', 'rus': 'Rusça', 'russian': 'Rusça',
  'zh': 'Çince', 'zho': 'Çince', 'chinese': 'Çince',
  'ja': 'Japonca', 'jpn': 'Japonca', 'japanese': 'Japonca',
  'ko': 'Korece', 'kor': 'Korece', 'korean': 'Korece',
  'ar': 'Arapça', 'ara': 'Arapça', 'arabic': 'Arapça',
  'pl': 'Lehçe', 'pol': 'Lehçe', 'polish': 'Lehçe',
  'nl': 'Flemenkçe', 'nld': 'Flemenkçe', 'dutch': 'Flemenkçe',
  'sv': 'İsveççe', 'swe': 'İsveççe', 'swedish': 'İsveççe',
  'hi': 'Hintçe', 'hin': 'Hintçe', 'hindi': 'Hintçe',
  'el': 'Yunanca', 'ell': 'Yunanca', 'greek': 'Yunanca',
  'he': 'İbranice', 'heb': 'İbranice', 'hebrew': 'İbranice',
  'hu': 'Macarca', 'hun': 'Macarca', 'hungarian': 'Macarca',
  'ro': 'Rumence', 'ron': 'Rumence', 'romanian': 'Rumence',
  'cs': 'Çekçe', 'ces': 'Çekçe', 'czech': 'Çekçe',
  'uk': 'Ukraynaca', 'ukr': 'Ukraynaca', 'ukrainian': 'Ukraynaca',
};

// ── Güven skoru renkleri — Grimmory birebir 5 kategori ─────────────────────
// compute() içinden confData dizisi olarak geliyor, burada ayrı tanım gerekmez.

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

        <!-- FORMAT DAĞILIMI -->
        <div class="stats-chart-box">
          <div class="stats-chart-header">
            <iconify-icon icon="lucide:file" class="stats-chart-header-icon" style="color:${FORMAT_COLORS['PDF']}"></iconify-icon>
            <div>
              <h2 class="stats-chart-title">Format Dağılımı</h2>
              <p class="stats-chart-desc">Kitaplığınızdaki dosya türlerinin dağılımı</p>
            </div>
          </div>
          <div class="stats-chart-wrap">
            <canvas id="chart-format"></canvas>
          </div>
        </div>

        <!-- DİL DAĞILIMI -->
        <div class="stats-chart-box">
          <div class="stats-chart-header">
            <iconify-icon icon="lucide:globe" class="stats-chart-header-icon" style="color:#2563EB"></iconify-icon>
            <div>
              <h2 class="stats-chart-title">Dil Dağılımı</h2>
              <p class="stats-chart-desc">Kitaplığınızdaki dillerin dağılımı</p>
            </div>
          </div>
          <div class="stats-chart-wrap">
            <canvas id="chart-lang"></canvas>
          </div>
        </div>

        <!-- GÜVEN SKORU DAĞILIMI -->
        <div class="stats-chart-box">
          <div class="stats-chart-header">
            <iconify-icon icon="lucide:shield-check" class="stats-chart-header-icon" style="color:#16A34A"></iconify-icon>
            <div>
              <h2 class="stats-chart-title">Güven Skoru Dağılımı</h2>
              <p class="stats-chart-desc">Kitaplığınızdaki metadata kalitesi</p>
            </div>
          </div>
          <div class="stats-chart-wrap">
            <canvas id="chart-conf"></canvas>
          </div>
        </div>

        <!-- SAYFA SAYISI DAĞILIMI -->
        <div class="stats-chart-box">
          <div class="stats-chart-header">
            <iconify-icon icon="lucide:layout-list" class="stats-chart-header-icon" style="color:#7C3AED"></iconify-icon>
            <div>
              <h2 class="stats-chart-title">Sayfa Sayısı Dağılımı</h2>
              <p class="stats-chart-desc">Kitaplığınızdaki kitap uzunluklarının dağılımı</p>
            </div>
          </div>
          <div class="stats-chart-wrap stats-chart-wrap--bar">
            <canvas id="chart-pagecount"></canvas>
          </div>
        </div>

      </div>
    </div>
  `;

  try {
    await _loadChartJs();

    // Format dağılımı — sadece sıfır olmayanları dahil et
    const fmtLabels = ["PDF", "EPUB", "Diğer"];
    const fmtValues = [s.pdf, s.epub, s.fmtOther];
    const fmtColors = [FORMAT_COLORS['PDF'], FORMAT_COLORS['EPUB'], FORMAT_COLORS['Diğer']];
    const fmtFiltered = fmtLabels
      .map((l, i) => ({ label: l, value: fmtValues[i], color: fmtColors[i] }))
      .filter(x => x.value > 0);
    _drawPie(
      "chart-format",
      fmtFiltered.map(x => x.label),
      fmtFiltered.map(x => x.value),
      fmtFiltered.map(x => x.color),
      false,
      "#E11D48"
    );

    // Dil dağılımı — Grimmory gibi dinamik, top 15, sıralı renk paleti
    const langFiltered = s.dynamicLangs.map((item, index) => ({
      label: LANG_DISPLAY_NAMES[item.code] || (item.code.charAt(0).toUpperCase() + item.code.slice(1)),
      value: item.count,
      color: LANGUAGE_PALETTE[index % LANGUAGE_PALETTE.length],
    }));
    _drawPie(
      "chart-lang",
      langFiltered.map(x => x.label),
      langFiltered.map(x => x.value),
      langFiltered.map(x => x.color),
      false,
      "#2563EB"
    );

    // Güven skoru dağılımı — Grimmory birebir 5 kategori (doughnut, cutout 60%)
    // s.confData: compute() içinde hesaplanan { label, color, count } dizisi
    // legendSize: 11, tooltipBorder: #16A34A — Grimmory metadata-score-chart.ts'den
    _drawPie(
      "chart-conf",
      s.confData.map(x => x.label),
      s.confData.map(x => x.count),
      s.confData.map(x => x.color),
      true,
      "#16A34A",
      11
    );

    _drawPageCount(s);
  } catch (err) {
    console.error("[Stats] Chart.js yüklenemedi:", err);
  }
}

function _drawPageCount(s) {
  const canvas = document.getElementById("chart-pagecount");
  if (!canvas || typeof window.Chart === "undefined") return;

  // Grimmory page-count-chart.ts ile birebir aynı yapı
  _activeCharts["chart-pagecount"] = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: s.pageDistLabels,
      datasets: [{
        data:            s.pageDistValues,
        backgroundColor: s.pageDistColors,
        borderWidth:     1,
        borderRadius:    4,
        barPercentage:   0.8,
        categoryPercentage: 0.7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, bottom: 10 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          borderColor: "#8B5CF6",
          borderWidth: 2,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", size: 13, weight: "bold" },
          bodyFont:  { family: "'Inter', sans-serif", size: 11 },
          callbacks: {
            title: (ctx) => `${ctx[0].label} sayfa`,
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v === 1 ? ` ${v} kitap` : ` ${v} kitap`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Sayfa Sayısı",
            font: { family: "'Inter', sans-serif", size: 11 },
            color: "#a89080",
          },
          ticks: {
            font: { family: "'Inter', sans-serif", size: 10 },
            color: "#a89080",
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          title: {
            display: true,
            text: "Kitaplar",
            font: { family: "'Inter', sans-serif", size: 11 },
            color: "#a89080",
          },
          beginAtZero: true,
          ticks: {
            font: { family: "'Inter', sans-serif", size: 10 },
            color: "#a89080",
            stepSize: 1,
            maxTicksLimit: 6,
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
          border: { display: false },
        },
      },
      animation: { duration: 400 },
    },
  });
}