// ─────────────────────────────────────────────────────────────────────────────
// STATS-TIMELINE — Publication Timeline (Adım 8).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs, miniCard } from "./stats-core.js";

function computeTimeline() {
  const books    = state.books;
  const withYear = books.filter((b) => b.year && b.year > 0);
  if (withYear.length === 0) return null;

  const years   = withYear.map((b) => b.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const avgYear = Math.round(years.reduce((a, b) => a + b, 0) / years.length);

  const yearMap = {};
  years.forEach((y) => { yearMap[y] = (yearMap[y] || 0) + 1; });
  const peakYear = Object.entries(yearMap).sort((a, b) => b[1] - a[1])[0];

  const decadeMap     = {};
  const decadePageMap = {};
  withYear.forEach((b) => {
    const decade = Math.floor(b.year / 10) * 10;
    decadeMap[decade]     = (decadeMap[decade]     || 0) + 1;
    decadePageMap[decade] = (decadePageMap[decade] || 0) + (b.page_count || 0);
  });
  const peakDecade = Object.entries(decadeMap).sort((a, b) => b[1] - a[1])[0];

  const classicCount = years.filter((y) => y < 1970).length;
  const classicPct   = Math.round((classicCount / withYear.length) * 100);
  const modernCount  = years.filter((y) => y >= 2000).length;
  const modernPct    = Math.round((modernCount / withYear.length) * 100);
  const span         = maxYear - minYear;

  const sortedDecades = Object.entries(decadeMap).sort((a, b) => Number(a[0]) - Number(b[0]));
  const decadeLabels  = sortedDecades.map(([d]) => `${d}'ler`);
  const decadeValues  = sortedDecades.map(([, v]) => v);
  const decadePages   = sortedDecades.map(([d]) => decadePageMap[Number(d)] || 0);

  const peakPageDecadeEntry = sortedDecades
    .map(([d]) => ({ decade: Number(d), pages: decadePageMap[Number(d)] || 0 }))
    .sort((a, b) => b.pages - a.pages)[0] || null;

  return {
    minYear, maxYear, avgYear,
    peakYear: peakYear ? Number(peakYear[0]) : null,
    peakYearCount: peakYear ? peakYear[1] : 0,
    peakDecade: peakDecade ? Number(peakDecade[0]) : null,
    peakPageDecade: peakPageDecadeEntry && peakPageDecadeEntry.pages > 0 ? peakPageDecadeEntry : null,
    span, classicPct, modernPct,
    decadeLabels, decadeValues, decadePages,
    withYearCount: withYear.length,
  };
}

export async function renderTimelineSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const t = computeTimeline();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-timeline-section";

  if (!t) {
    sectionEl.innerHTML = `
      <div class="stats-section-box">
        <h2 class="stats-section-title">
          <iconify-icon icon="lucide:calendar-range"></iconify-icon> Yayın Zaman Çizelgesi
        </h2>
        <p class="stats-empty">Yıl bilgisi olan kitap bulunamadı.</p>
      </div>`;
    wrap.appendChild(sectionEl);
    return;
  }

  sectionEl.innerHTML = `
    <div class="stats-section-box">
      <h2 class="stats-section-title">
        <iconify-icon icon="lucide:calendar-range"></iconify-icon> Yayın Zaman Çizelgesi
        <span class="stats-section-sub">${t.withYearCount} kitap</span>
      </h2>
      <div class="stats-mini-grid">
        ${miniCard("lucide:book-open",      "En Eski Kitap",  t.minYear,                                                    "neutral")}
        ${miniCard("lucide:sparkles",       "En Yeni Kitap",  t.maxYear,                                                    "accent")}
        ${miniCard("lucide:calculator",     "Ortalama Yıl",   t.avgYear,                                                    "neutral")}
        ${miniCard("lucide:trophy",         "En Yaygın Yıl",  t.peakYear ? `${t.peakYear} (${t.peakYearCount} kitap)` : "—","warning")}
        ${miniCard("lucide:move-horizontal","Zaman Aralığı",  `${t.span} yıl`,                                              "neutral")}
        ${miniCard("lucide:bar-chart-4",    "Zirve On Yıl",   t.peakDecade ? `${t.peakDecade}'ler` : "—",                  "success")}
        ${miniCard("lucide:clock",          "Klasik Oranı",   `%${t.classicPct}`,                                           "neutral")}
        ${miniCard("lucide:zap",            "21. Yüzyıl",     `%${t.modernPct}`,                                            "accent")}
        ${t.peakPageDecade ? miniCard("lucide:book-marked", "En Hacimli On Yıl", `${t.peakPageDecade.decade}'ler (${t.peakPageDecade.pages.toLocaleString("tr-TR")} s.)`, "success") : ""}
      </div>
      <div class="stats-bar-chart-wrap">
        <canvas id="chart-timeline"></canvas>
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
      labels: t.decadeLabels,
      datasets: [{
        label: "Kitap Sayısı",
        data:  t.decadeValues,
        backgroundColor: "rgba(234,88,12,0.75)",
        borderColor:     "rgba(234,88,12,1)",
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pages = t.decadePages[ctx.dataIndex];
              const ps    = pages > 0 ? ` · ${pages.toLocaleString("tr-TR")} sayfa` : "";
              return ` ${ctx.parsed.x} kitap${ps}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#a89080", font: { size: 11 } }, grid: { color: "rgba(51,39,32,0.6)" } },
        y: { ticks: { color: "#a89080", font: { size: 12 } }, grid: { display: false } },
      },
      animation: { duration: 400 },
    },
  });
}
