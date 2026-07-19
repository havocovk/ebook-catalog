// ─────────────────────────────────────────────────────────────────────────────
// STATS-JOURNEY — Reading Journey (Adım 9).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs, miniCard } from "./stats-core.js";

function _monthLabel(date) {
  const M = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
  return `${M[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

function _keyToLabel(key) {
  const [y, m] = key.split("-");
  const M = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
  return `${M[parseInt(m, 10) - 1]} ${y}`;
}

function computeJourney() {
  const books    = state.books;
  const backlog  = books.filter((b) => b.status === "okunmadi" || b.status === "sirada").length;
  const finished = books.filter((b) => b.status === "okundu");
  const completionPct = books.length > 0 ? Math.round((finished.length / books.length) * 100) : 0;

  const durations = finished
    .filter((b) => b.$createdAt && b.finished_at)
    .map((b) => Math.max(0, Math.round((new Date(b.finished_at) - new Date(b.$createdAt)) / 86400000)))
    .filter((d) => d >= 0 && d < 3650);
  const avgDays = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const now    = new Date();
  const months = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: _monthLabel(d) });
  }

  const addedPerMonth    = {};
  const finishedPerMonth = {};
  books.forEach((b) => {
    if (!b.$createdAt) return;
    const d = new Date(b.$createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    addedPerMonth[k] = (addedPerMonth[k] || 0) + 1;
  });
  finished.forEach((b) => {
    if (!b.finished_at) return;
    const d = new Date(b.finished_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    finishedPerMonth[k] = (finishedPerMonth[k] || 0) + 1;
  });

  let cumAdded = 0, cumFinished = 0;
  const addedCum = [], finishedCum = [];
  months.forEach(({ key }) => {
    cumAdded    += addedPerMonth[key]    || 0;
    cumFinished += finishedPerMonth[key] || 0;
    addedCum.push(cumAdded);
    finishedCum.push(cumFinished);
  });

  const bestReadEntry = Object.entries(finishedPerMonth).sort((a, b) => b[1] - a[1])[0];
  const bestReadMonth = bestReadEntry ? _keyToLabel(bestReadEntry[0]) + ` (${bestReadEntry[1]} kitap)` : "—";
  const bestAddEntry  = Object.entries(addedPerMonth).sort((a, b) => b[1] - a[1])[0];
  const bestAddMonth  = bestAddEntry ? _keyToLabel(bestAddEntry[0]) + ` (${bestAddEntry[1]} kitap)` : "—";

  const totalFinished24  = months.reduce((s, { key }) => s + (finishedPerMonth[key] || 0), 0);
  const avgMonthlyFinish = (totalFinished24 / 24).toFixed(1);

  const last3Keys     = months.slice(-3).map((m) => m.key);
  const last3Added    = last3Keys.reduce((s, k) => s + (addedPerMonth[k]    || 0), 0);
  const last3Finished = last3Keys.reduce((s, k) => s + (finishedPerMonth[k] || 0), 0);
  const last3Activity = `+${last3Added} eklendi / ${last3Finished} okundu`;

  let maxStreak = 0, curStreak = 0;
  months.forEach(({ key }) => {
    if ((finishedPerMonth[key] || 0) > 0) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
    else curStreak = 0;
  });

  const finishedPages     = finished.reduce((s, b) => s + (b.page_count || 0), 0);
  const backlogBooks      = books.filter((b) => b.status === "okunmadi" || b.status === "sirada");
  const backlogPages      = backlogBooks.reduce((s, b) => s + (b.page_count || 0), 0);
  const finishedWithPages = finished.filter((b) => b.page_count);
  const avgPagesPerBook   = finishedWithPages.length > 0
    ? Math.round(finishedWithPages.reduce((s, b) => s + b.page_count, 0) / finishedWithPages.length) : null;

  return {
    backlog, completionPct, avgDays, bestReadMonth, bestAddMonth,
    avgMonthlyFinish, last3Activity, maxStreak,
    finishedPages, backlogPages, avgPagesPerBook,
    chartLabels: months.map((m) => m.label),
    addedCum, finishedCum,
  };
}

export async function renderJourneySection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const j = computeJourney();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-journey-section";

  sectionEl.innerHTML = `
    <div class="stats-section-box">
      <h2 class="stats-section-title">
        <iconify-icon icon="lucide:route"></iconify-icon> Okuma Yolculuğu
        <span class="stats-section-sub">son 24 ay</span>
      </h2>
      <div class="stats-mini-grid">
        ${miniCard("lucide:inbox",       "Backlog",              j.backlog,                                        "neutral")}
        ${miniCard("lucide:timer",       "Ort. Tamamlama",       j.avgDays !== null ? `${j.avgDays} gün` : "—",   "neutral")}
        ${miniCard("lucide:trophy",      "En İyi Okuma Ayı",     j.bestReadMonth,                                  "warning")}
        ${miniCard("lucide:plus-circle", "En Çok Eklenen Ay",    j.bestAddMonth,                                   "accent")}
        ${miniCard("lucide:calendar",    "Aylık Ort. Tamamlama", `${j.avgMonthlyFinish} kitap`,                    "neutral")}
        ${miniCard("lucide:flame",       "En Uzun Seri",         `${j.maxStreak} ay`,                              "success")}
        ${miniCard("lucide:activity",    "Son 3 Ay",             j.last3Activity,                                  "neutral")}
        ${miniCard("lucide:percent",     "Tamamlanma Oranı",     `%${j.completionPct}`,                            "accent")}
        ${j.finishedPages > 0 ? miniCard("lucide:book-check", "Okunan Sayfa",     j.finishedPages.toLocaleString("tr-TR"), "success") : ""}
        ${j.backlogPages  > 0 ? miniCard("lucide:book-x",     "Bekleyen Sayfa",   j.backlogPages.toLocaleString("tr-TR"),  "neutral") : ""}
        ${j.avgPagesPerBook   ? miniCard("lucide:book-open",  "Ort. Sayfa/Kitap", j.avgPagesPerBook,                       "neutral") : ""}
      </div>
      <div class="stats-bar-chart-wrap stats-line-chart-wrap">
        <canvas id="chart-journey"></canvas>
      </div>
      <div class="stats-chart-legend stats-journey-legend">
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(59,130,246,0.85)"></span>
          <span class="stats-legend-label">Eklenen Kitaplar (kümülatif)</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(34,197,94,0.85)"></span>
          <span class="stats-legend-label">Tamamlanan Kitaplar (kümülatif)</span>
        </div>
      </div>
    </div>
  `;

  wrap.appendChild(sectionEl);

  try {
    await _loadChartJs();
    _drawJourney(j);
  } catch (err) {
    console.error("[Stats] Journey grafik hatası:", err);
  }
}

function _drawJourney(j) {
  const canvas = document.getElementById("chart-journey");
  if (!canvas || typeof window.Chart === "undefined") return;

  const tickLabels = j.chartLabels.map((l, i) => i % 4 === 0 ? l : "");

  _activeCharts["chart-journey"] = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: j.chartLabels,
      datasets: [
        {
          label: "Eklenen (kümülatif)",
          data:  j.addedCum,
          borderColor: "rgba(59,130,246,0.9)", backgroundColor: "rgba(59,130,246,0.12)",
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3,
        },
        {
          label: "Tamamlanan (kümülatif)",
          data:  j.finishedCum,
          borderColor: "rgba(34,197,94,0.9)", backgroundColor: "rgba(34,197,94,0.08)",
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} kitap` } },
      },
      scales: {
        x: {
          ticks: { color: "#a89080", font: { size: 10 }, callback: (_, i) => tickLabels[i], maxRotation: 0 },
          grid:  { color: "rgba(51,39,32,0.4)" },
        },
        y: {
          ticks: { color: "#a89080", font: { size: 11 } },
          grid:  { color: "rgba(51,39,32,0.6)" },
          beginAtZero: true,
        },
      },
      animation: { duration: 400 },
    },
  });
}
