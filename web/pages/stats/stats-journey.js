// ─────────────────────────────────────────────────────────────────────────────
// STATS-JOURNEY — Reading Journey (Grimmory birebir).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs } from "./stats-core.js";

// ── Ay etiket yardımcıları ────────────────────────────────────────────────────
const TR_MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];

function _monthLabel(date) {
  return `${TR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function _keyToLabel(key) {
  const [y, m] = key.split("-");
  return `${TR_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

// ── Veri hesaplama ────────────────────────────────────────────────────────────
function computeJourney() {
  const books    = state.books;
  const finished = books.filter((b) => b.status === "okundu");
  const backlog  = books.filter((b) => b.status === "okunmadi" || b.status === "sirada").length;
  const backlogPct = books.length > 0 ? Math.round((backlog / books.length) * 100) : 0;

  // Ortalama bitirme süresi (gün)
  const durations = finished
    .filter((b) => b.$createdAt && b.finished_at)
    .map((b) => Math.max(0, Math.round((new Date(b.finished_at) - new Date(b.$createdAt)) / 86400000)))
    .filter((d) => d < 3650);
  const avgDays = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Tüm kitapların eklenme ve bitirilme tarihlerinden ay haritası
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

  // Tüm ay anahtarlarını birleştir, sırala
  const allKeys = Array.from(
    new Set([...Object.keys(addedPerMonth), ...Object.keys(finishedPerMonth)])
  ).sort();

  // Boşlukları doldur (tam aralık)
  const firstKey = allKeys[0];
  const lastKey  = allKeys[allKeys.length - 1];
  const monthRange = [];
  if (firstKey && lastKey) {
    let [y, m] = firstKey.split("-").map(Number);
    const [ey, em] = lastKey.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      monthRange.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  // Kümülatif değerler
  let cumAdded = 0, cumFinished = 0;
  const addedCum = [], finishedCum = [];
  monthRange.forEach((k) => {
    cumAdded    += addedPerMonth[k]    || 0;
    cumFinished += finishedPerMonth[k] || 0;
    addedCum.push(cumAdded);
    finishedCum.push(cumFinished);
  });

  const chartLabels = monthRange.map(_keyToLabel);

  // Tarih aralığı badge
  const dateRangeLabel = monthRange.length > 0
    ? `${_keyToLabel(monthRange[0])} - ${_keyToLabel(monthRange[monthRange.length - 1])}`
    : "";

  // En iyi okuma ayı
  const bestReadEntry = Object.entries(finishedPerMonth).sort((a, b) => b[1] - a[1])[0];
  const bestReadMonth = bestReadEntry ? _keyToLabel(bestReadEntry[0]) : "N/A";
  const bestReadCount = bestReadEntry ? bestReadEntry[1] : 0;

  // En çok eklenen ay
  const bestAddEntry = Object.entries(addedPerMonth).sort((a, b) => b[1] - a[1])[0];
  const bestAddMonth = bestAddEntry ? _keyToLabel(bestAddEntry[0]) : "N/A";
  const bestAddCount = bestAddEntry ? bestAddEntry[1] : 0;

  // Bitirme oranı (aylık ortalama)
  const finishRate = monthRange.length > 0
    ? (finished.length / monthRange.length).toFixed(1) : 0;

  // Son 3 ay aktivitesi
  const last3Keys     = monthRange.slice(-3);
  const last3Finished = last3Keys.reduce((s, k) => s + (finishedPerMonth[k] || 0), 0);
  const last3Added    = last3Keys.reduce((s, k) => s + (addedPerMonth[k]    || 0), 0);
  const recentActivity = last3Finished > 0 ? `${last3Finished}` : "Son aktivite yok";
  const recentDetail   = last3Finished > 0 ? "son 3 ayda bitirildi" : "yakın zamanda bitirildi";

  // En uzun seri (art arda kitap bitirilen aylar)
  let maxStreak = 0, curStreak = 0;
  monthRange.forEach((k) => {
    if ((finishedPerMonth[k] || 0) > 0) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
    else curStreak = 0;
  });

  return {
    backlog, backlogPct,
    avgDays,
    bestReadMonth, bestReadCount,
    bestAddMonth, bestAddCount,
    finishRate,
    recentActivity, recentDetail,
    maxStreak,
    totalFinished: finished.length,
    totalAdded: books.length,
    dateRangeLabel,
    chartLabels,
    addedCum,
    finishedCum,
  };
}

// ── Chip HTML ─────────────────────────────────────────────────────────────────
function journeyChip(cssClass, label, value, detail = "") {
  return `
    <div class="rj-chip rj-chip--${cssClass}">
      <span class="rj-chip-label">${label}</span>
      <span class="rj-chip-value">${value}</span>
      ${detail ? `<span class="rj-chip-detail">${detail}</span>` : ""}
    </div>
  `;
}

// ── Render ────────────────────────────────────────────────────────────────────
export async function renderJourneySection() {
  const wrap = document.querySelector(".stats-tl-journey-row") || document.querySelector(".stats-wrap");
  if (!wrap) return;

  const j = computeJourney();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-journey-section";
  sectionEl.className = "stats-tl-journey-col";

  sectionEl.innerHTML = `
    <div class="stats-section-box rj-box">

      <!-- Başlık: sol ikon+başlık+açıklama, sağ badge -->
      <div class="rj-header">
        <div class="rj-header-left">
          <iconify-icon icon="lucide:route" class="rj-header-icon"></iconify-icon>
          <div>
            <h2 class="rj-title">Okuma Yolculuğu</h2>
            <p class="rj-desc">Eklenen ve okunan kitaplar — aradaki fark birikmiş listeniz</p>
          </div>
        </div>
        ${j.dateRangeLabel ? `<div class="rj-badge">${j.dateRangeLabel}</div>` : ""}
      </div>

      <!-- Grafik -->
      <div class="rj-chart-wrap">
        <canvas id="chart-journey"></canvas>
      </div>

      <!-- 8 chip (Grimmory: 2×4 grid) -->
      <div class="rj-chips-grid">
        ${journeyChip("backlog",     "Backlog",                 j.backlog,         `%${j.backlogPct} okunmamış`)}
        ${journeyChip("time",        "Ortalama Bitirme Süresi", j.avgDays > 0 ? j.avgDays : 0, "ekledikten sonra gün")}
        ${journeyChip("productive",  "En İyi Okuma Ayı",        j.bestReadCount > 0 ? j.bestReadCount : 0, j.bestReadCount > 0 ? j.bestReadMonth : "N/A")}
        ${journeyChip("acquisition", "En Çok Eklenen Ay",       j.bestAddCount > 0 ? j.bestAddCount : 0, j.bestAddCount > 0 ? j.bestAddMonth : "N/A")}
        ${journeyChip("rate",        "Bitirme Oranı",           j.finishRate,      "kitap/ay ort.")}
        ${journeyChip("streak",      "En Uzun Seri",            j.maxStreak,       "art arda ay")}
        ${journeyChip("recent",      "Son 3 Ay",                j.recentActivity,  j.recentDetail)}
        ${journeyChip("completion",  "Bitirme Oranı",           `${j.totalFinished}/${j.totalAdded}`, "kitap bitirildi")}
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

// ── Grafik çizimi ─────────────────────────────────────────────────────────────
function _drawJourney(j) {
  const canvas = document.getElementById("chart-journey");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-journey"] = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: j.chartLabels,
      datasets: [
        {
          label: "Eklenen Kitaplar",
          data:  j.addedCum,
          borderColor:     "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.1)",
          pointBackgroundColor: "#3b82f6",
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          order: 2,
        },
        {
          label: "Okunan Kitaplar",
          data:  j.finishedCum,
          borderColor:     "#10b981",
          backgroundColor: "rgba(16,185,129,0.2)",
          pointBackgroundColor: "#10b981",
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 20, right: 20, bottom: 10, left: 10 }
      },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            font: { family: "'Inter', sans-serif", size: 12 },
            padding: 20,
            usePointStyle: true,
            pointStyle: "circle",
            color: "#a89080",
          },
        },
        tooltip: {
          borderColor: "#10b981",
          borderWidth: 2,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", size: 13, weight: "bold" },
          bodyFont:  { family: "'Inter', sans-serif", size: 11 },
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} kitap`,
            afterBody: (ctx) => {
              const added    = ctx[0]?.chart.data.datasets[0].data[ctx[0].dataIndex] || 0;
              const finished = ctx[0]?.chart.data.datasets[1].data[ctx[0].dataIndex] || 0;
              return [`\nBirikmiş Liste: ${added - finished} kitap`];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            font: { family: "'Inter', sans-serif", size: 10 },
            color: "#a89080",
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 24,
          },
          grid: { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          title: {
            display: true,
            text: "Ay",
            font: { family: "'Inter', sans-serif", size: 12, weight: "500" },
            color: "#a89080",
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: { family: "'Inter', sans-serif", size: 11 },
            color: "#a89080",
            precision: 0,
          },
          grid: { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          title: {
            display: true,
            text: "Kümülatif Kitaplar",
            font: { family: "'Inter', sans-serif", size: 12, weight: "500" },
            color: "#a89080",
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}