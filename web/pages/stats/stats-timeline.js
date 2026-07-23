// ─────────────────────────────────────────────────────────────────────────────
// STATS-TIMELINE — Publication Timeline (Grimmory birebir).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs } from "./stats-core.js";

// ── Grimmory publication-timeline-chart.ts'den birebir on yıl renkleri ───────
const DECADE_COLORS = {
  'pre1900': '#92400e',
  '1900s':   '#b45309',
  '1910s':   '#c2410c',
  '1920s':   '#d97706',
  '1930s':   '#e5932d',
  '1940s':   '#eab308',
  '1950s':   '#a3e635',
  '1960s':   '#4ade80',
  '1970s':   '#22d3ee',
  '1980s':   '#38bdf8',
  '1990s':   '#60a5fa',
  '2000s':   '#818cf8',
  '2010s':   '#a78bfa',
  '2020s':   '#c084fc',
};

// ── On yıl sırası (Grimmory ile aynı) ────────────────────────────────────────
const DECADE_ORDER = [
  'pre1900','1900s','1910s','1920s','1930s','1940s',
  '1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s'
];

// ── On yıl label (Grimmory: "2020s" → Türkçe: "2020'ler") ───────────────────
const DECADE_LABELS = {
  'pre1900': '1900 Öncesi',
  '1900s':   "1900'ler",
  '1910s':   "1910'lar",
  '1920s':   "1920'ler",
  '1930s':   "1930'lar",
  '1940s':   "1940'lar",
  '1950s':   "1950'ler",
  '1960s':   "1960'lar",
  '1970s':   "1970'ler",
  '1980s':   "1980'ler",
  '1990s':   "1990'lar",
  '2000s':   "2000'ler",
  '2010s':   "2010'lar",
  '2020s':   "2020'ler",
};

function getDecadeKey(year) {
  if (year < 1900) return 'pre1900';
  if (year >= 2020) return '2020s';
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

function computeTimeline() {
  const books    = state.books;
  const withYear = books.filter((b) => b.year && b.year > 0);
  if (withYear.length === 0) return null;

  const years = withYear.map((b) => b.year).sort((a, b) => a - b);

  // En eski / en yeni
  const oldestBook = withYear.reduce((prev, b) => (!prev || b.year < prev.year) ? b : prev, null);
  const newestBook = withYear.reduce((prev, b) => (!prev || b.year > prev.year) ? b : prev, null);

  // Ortalama yıl
  const avgYear = Math.round(years.reduce((a, b) => a + b, 0) / years.length);

  // Medyan yıl
  const medianYear = years[Math.floor(years.length / 2)];

  // En yaygın yıl
  const yearCountMap = {};
  years.forEach((y) => { yearCountMap[y] = (yearCountMap[y] || 0) + 1; });
  const mostCommonEntry = Object.entries(yearCountMap).sort((a, b) => b[1] - a[1])[0];
  const mostCommonYear  = mostCommonEntry ? Number(mostCommonEntry[0]) : null;
  const mostCommonCount = mostCommonEntry ? mostCommonEntry[1] : 0;

  // Zaman aralığı
  const timeSpan = years[years.length - 1] - years[0];

  // On yıl haritası
  const decadeCountMap = {};
  withYear.forEach((b) => {
    const key = getDecadeKey(b.year);
    decadeCountMap[key] = (decadeCountMap[key] || 0) + 1;
  });

  // Zirve on yıl
  const peakDecadeEntry = Object.entries(decadeCountMap).sort((a, b) => b[1] - a[1])[0];
  const peakDecadeKey   = peakDecadeEntry ? peakDecadeEntry[0] : null;
  const peakDecadeLabel = peakDecadeKey ? DECADE_LABELS[peakDecadeKey] : '—';
  const peakDecadeCount = peakDecadeEntry ? peakDecadeEntry[1] : 0;

  // Golden Era: en iyi 20 yıllık pencere
  let goldenEra = { start: 0, end: 0, count: 0 };
  for (const windowStart of years) {
    const windowEnd   = windowStart + 19;
    const windowCount = years.filter((y) => y >= windowStart && y <= windowEnd).length;
    if (windowCount > goldenEra.count) {
      goldenEra = { start: windowStart, end: windowEnd, count: windowCount };
    }
  }

  // Rarity Score: 3'ten az kitabı olan on yıllardaki kitapların yüzdesi
  let rareBooks = 0;
  for (const count of Object.values(decadeCountMap)) {
    if (count < 3) rareBooks += count;
  }
  const rarityScore = Math.round((rareBooks / withYear.length) * 100);

  // Grafik için sıralı on yıllar
  const sortedDecadeKeys   = DECADE_ORDER.filter((k) => decadeCountMap[k] > 0);
  const decadeChartLabels  = sortedDecadeKeys.map((k) => DECADE_LABELS[k]);
  const decadeChartValues  = sortedDecadeKeys.map((k) => decadeCountMap[k]);
  const decadeChartColors  = sortedDecadeKeys.map((k) => DECADE_COLORS[k]);

  return {
    withYearCount: withYear.length,
    oldestBook,
    newestBook,
    avgYear,
    medianYear,
    mostCommonYear,
    mostCommonCount,
    timeSpan,
    peakDecadeLabel,
    peakDecadeCount,
    goldenEra,
    rarityScore,
    decadeChartLabels,
    decadeChartValues,
    decadeChartColors,
  };
}

// ── Chip HTML üretici ─────────────────────────────────────────────────────────
function insightChip(cssClass, label, value, detail = "") {
  return `
    <div class="tl-insight-item tl-insight-item--${cssClass}">
      <span class="tl-insight-label">${label}</span>
      <span class="tl-insight-value">${value}</span>
      ${detail ? `<span class="tl-insight-detail">${detail}</span>` : ""}
    </div>
  `;
}

export async function renderTimelineSection() {
  const wrap = document.querySelector(".stats-tl-journey-row") || document.querySelector(".stats-wrap");
  if (!wrap) return;

  const t = computeTimeline();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-timeline-section";
  sectionEl.className = "stats-tl-journey-col";

  if (!t) {
    sectionEl.innerHTML = `
      <div class="stats-section-box">
        <div class="tl-header">
          <div class="tl-header-left">
            <iconify-icon icon="lucide:calendar-range" class="tl-header-icon"></iconify-icon>
            <div>
              <h2 class="tl-title">Yayın Zaman Çizelgesi</h2>
              <p class="tl-desc">Kitaplarınız ne zaman yayımlandı?</p>
            </div>
          </div>
        </div>
        <p class="stats-empty">Yıl bilgisi olan kitap bulunamadı.</p>
      </div>`;
    wrap.appendChild(sectionEl);
    return;
  }

  // Chip değerleri
  const oldestVal   = t.oldestBook ? t.oldestBook.year : "—";
  const oldestDetail= t.oldestBook ? (t.oldestBook.title || "") : "";
  const newestVal   = t.newestBook ? t.newestBook.year : "—";
  const newestDetail= t.newestBook ? (t.newestBook.title || "") : "";
  const avgVal      = t.avgYear;
  const avgDetail   = `Medyan: ${t.medianYear}`;
  const commonVal   = t.mostCommonYear || "—";
  const commonDetail= t.mostCommonYear ? `${t.mostCommonCount} kitap` : "";
  const spanVal     = `${t.timeSpan}`;
  const spanDetail  = "yıllık edebiyat";
  const peakVal     = t.peakDecadeLabel;
  const peakDetail  = `${t.peakDecadeCount} kitap`;
  const goldenVal   = t.goldenEra.count > 0 ? `${t.goldenEra.start}-${t.goldenEra.end}` : "—";
  const goldenDetail= t.goldenEra.count > 0 ? `${t.goldenEra.count} kitap` : "";
  const rarityVal   = `%${t.rarityScore}`;
  const rarityDetail= "nadir seçimler";

  sectionEl.innerHTML = `
    <div class="stats-section-box">

      <!-- Başlık satırı: sol (ikon+başlık+açıklama) + sağ (badge) -->
      <div class="tl-header">
        <div class="tl-header-left">
          <iconify-icon icon="lucide:calendar-range" class="tl-header-icon"></iconify-icon>
          <div>
            <h2 class="tl-title">Yayın Zaman Çizelgesi</h2>
            <p class="tl-desc">Kitaplarınız ne zaman yayımlandı?</p>
          </div>
        </div>
        <div class="tl-badge">${t.withYearCount} tarihli kitap</div>
      </div>

      <!-- Grafik -->
      <div class="tl-chart-wrap">
        <canvas id="chart-timeline"></canvas>
      </div>

      <!-- Chip satırı 1 -->
      <div class="tl-insights-row">
        ${insightChip("oldest",      "En Eski Kitap",    oldestVal, oldestDetail)}
        ${insightChip("average",     "Ortalama Yıl",     avgVal,    avgDetail)}
        ${insightChip("newest",      "En Yeni Kitap",    newestVal, newestDetail)}
        ${insightChip("common-year", "En Yaygın Yıl",    commonVal, commonDetail)}
      </div>

      <!-- Chip satırı 2 -->
      <div class="tl-insights-row">
        ${insightChip("timespan",    "Zaman Aralığı",    spanVal,   spanDetail)}
        ${insightChip("peak",        "Zirve On Yıl",     peakVal,   peakDetail)}
        ${insightChip("golden-era",  "Altın Çağ",        goldenVal, goldenDetail)}
        ${insightChip("rarity",      "Nadirlik Skoru",   rarityVal, rarityDetail)}
      </div>

    </div>
  `;

  wrap.appendChild(sectionEl);

  try {
    await _loadChartJs();
    _drawTimeline(t);
  } catch (err) {
    console.error("[Stats] Timeline grafik hatası:", err);
  }
}

function _drawTimeline(t) {
  const canvas = document.getElementById("chart-timeline");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-timeline"] = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: t.decadeChartLabels,
      datasets: [{
        data:            t.decadeChartValues,
        backgroundColor: t.decadeChartColors,
        borderColor:     t.decadeChartColors,
        borderWidth:     1,
        borderRadius:    4,
        barPercentage:   0.8,
        categoryPercentage: 0.85,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, right: 20, bottom: 10, left: 10 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          borderColor: "#a78bfa",
          borderWidth: 2,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", size: 13, weight: "bold" },
          bodyFont:  { family: "'Inter', sans-serif", size: 11 },
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.x;
              return v === 1 ? ` ${v} kitap` : ` ${v} kitap`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            font: { family: "'Inter', sans-serif", size: 11 },
            color: "#a89080",
            precision: 0,
            stepSize: 1,
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
          border: { display: false },
          title: {
            display: true,
            text: "Kitap Sayısı",
            font: { family: "'Inter', sans-serif", size: 12, weight: "500" },
            color: "#a89080",
          },
        },
        y: {
          ticks: {
            font: { family: "'Inter', sans-serif", size: 11 },
            color: "#a89080",
          },
          grid: { display: false },
          border: { display: false },
        },
      },
      animation: { duration: 400 },
    },
  });
}