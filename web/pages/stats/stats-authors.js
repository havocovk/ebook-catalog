// ─────────────────────────────────────────────────────────────────────────────
// STATS-AUTHORS — Top Yazarlar + Author Universe (Adım 10).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs, authorCard } from "./stats-core.js";

function computeAuthors() {
  const books     = state.books;
  const authorMap = {};
  books.forEach((b) => {
    if (!b.author) return;
    if (!authorMap[b.author]) authorMap[b.author] = { name: b.author, books: [] };
    authorMap[b.author].books.push(b);
  });
  const authors = Object.values(authorMap);

  const top15     = [...authors].sort((a, b) => b.books.length - a.books.length).slice(0, 15);
  const top15Data = top15.map((a) => ({
    name:     a.name,
    okunmadi: a.books.filter((b) => b.status === "okunmadi" || b.status === "sirada").length,
    okunuyor: a.books.filter((b) => b.status === "okunuyor").length,
    okundu:   a.books.filter((b) => b.status === "okundu").length,
  }));

  const topAuthor = top15[0] || null;

  const ratedAuthors = authors
    .map((a) => {
      const rated = a.books.filter((b) => b.rating);
      if (rated.length < 2) return null;
      const avg = rated.reduce((s, b) => s + b.rating, 0) / rated.length;
      return { name: a.name, avg: Math.round(avg * 10) / 10 };
    })
    .filter(Boolean).sort((a, b) => b.avg - a.avg);
  const topRated = ratedAuthors[0] || null;

  const topBacklog = authors
    .map((a) => ({ name: a.name, backlog: a.books.filter((b) => b.status === "okunmadi" || b.status === "sirada").length }))
    .sort((a, b) => b.backlog - a.backlog)[0] || null;

  const topVersatile = authors
    .map((a) => ({ name: a.name, genres: new Set(a.books.map((b) => b.genre).filter(Boolean)).size }))
    .sort((a, b) => b.genres - a.genres)[0] || null;

  const unreadAuthorCount = authors.filter(
    (a) => a.books.every((b) => b.status === "okunmadi" || b.status === "sirada")
  ).length;

  const topPageAuthor = authors
    .map((a) => ({ name: a.name, pages: a.books.reduce((s, b) => s + (b.page_count || 0), 0) }))
    .filter((a) => a.pages > 0).sort((a, b) => b.pages - a.pages)[0] || null;

  const allPageTotals = authors.filter((a) => a.books.length >= 2)
    .map((a) => a.books.reduce((s, b) => s + (b.page_count || 0), 0));
  const maxPageTotal  = Math.max(...allPageTotals, 1);
  const usePageRadius = allPageTotals.some((p) => p > 0);

  const bubbleData = authors.filter((a) => a.books.length >= 2).map((a) => {
    const rated       = a.books.filter((b) => b.rating);
    const avgRating   = rated.length > 0
      ? Math.round((rated.reduce((s, b) => s + b.rating, 0) / rated.length) * 10) / 10 : 0;
    const finishedPct = Math.round((a.books.filter((b) => b.status === "okundu").length / a.books.length) * 100);
    const totalPages  = a.books.reduce((s, b) => s + (b.page_count || 0), 0);
    const r = usePageRadius
      ? Math.max(5, Math.min((totalPages / maxPageTotal) * 40, 35))
      : Math.max(5, Math.min(a.books.length * 2.5, 30));
    return { label: a.name, x: a.books.length, y: avgRating, r, finishedPct, totalPages };
  });

  const bubbleColors = bubbleData.map((d) => {
    if (d.finishedPct >= 70) return "rgba(34,197,94,0.75)";
    if (d.finishedPct >= 30) return "rgba(245,158,11,0.75)";
    return "rgba(234,88,12,0.75)";
  });

  return {
    top15Data, topAuthor, topRated, topBacklog, topVersatile,
    unreadAuthorCount, topPageAuthor, usePageRadius, bubbleData, bubbleColors,
  };
}

export async function renderAuthorsSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const a = computeAuthors();
  const sectionEl = document.createElement("div");
  sectionEl.id = "stats-authors-section";

  sectionEl.innerHTML = `
    <div class="stats-section-box">
      <h2 class="stats-section-title">
        <iconify-icon icon="lucide:users"></iconify-icon> Yazar Analizi
      </h2>
      <div class="stats-author-cards">
        ${authorCard("lucide:crown",   "En Çok Kitap",    a.topAuthor    ? `${a.topAuthor.name} (${a.topAuthor.books ? a.topAuthor.books.length : ""})` : "—", "accent")}
        ${authorCard("lucide:star",    "En Yüksek Puan",  a.topRated     ? `${a.topRated.name} (${a.topRated.avg}★)` : "—",                                   "warning")}
        ${authorCard("lucide:inbox",   "En Büyük Backlog",a.topBacklog   ? `${a.topBacklog.name} (${a.topBacklog.backlog})` : "—",                             "neutral")}
        ${authorCard("lucide:library", "Most Versatile",  a.topVersatile ? `${a.topVersatile.name} (${a.topVersatile.genres} tür)` : "—",                     "success")}
        ${authorCard("lucide:book-x",  "Hiç Okunmamış",   `${a.unreadAuthorCount} yazar`,                                                                      "neutral")}
        ${a.topPageAuthor ? authorCard("lucide:book-open", "En Hacimli Yazar", `${a.topPageAuthor.name} (${a.topPageAuthor.pages.toLocaleString("tr-TR")} s.)`, "success") : ""}
      </div>

      <h3 class="stats-subsection-title">Top 15 Yazar</h3>
      <div class="stats-bar-chart-wrap stats-top-authors-wrap">
        <canvas id="chart-top-authors"></canvas>
      </div>
      <div class="stats-chart-legend" style="flex-direction:row;flex-wrap:wrap;gap:1rem;margin-top:0.25rem;">
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(100,116,139,0.85)"></span>
          <span class="stats-legend-label">Okunmadı / Sırada</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(234,88,12,0.85)"></span>
          <span class="stats-legend-label">Okunuyor</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(34,197,94,0.85)"></span>
          <span class="stats-legend-label">Okundu</span>
        </div>
      </div>

      <h3 class="stats-subsection-title">Author Universe
        <span class="stats-section-sub">kabarcık = ${a.usePageRadius ? "toplam sayfa" : "kitap sayısı"} · renk = tamamlanma oranı</span>
      </h3>
      <div class="stats-bar-chart-wrap stats-bubble-wrap">
        <canvas id="chart-bubble"></canvas>
      </div>
      <div class="stats-chart-legend" style="flex-direction:row;flex-wrap:wrap;gap:1rem;margin-top:0.25rem;">
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(34,197,94,0.75)"></span>
          <span class="stats-legend-label">Yüksek tamamlanma (%70+)</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(245,158,11,0.75)"></span>
          <span class="stats-legend-label">Orta tamamlanma (%30-69)</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(234,88,12,0.75)"></span>
          <span class="stats-legend-label">Düşük tamamlanma (%0-29)</span>
        </div>
      </div>
    </div>
  `;

  wrap.appendChild(sectionEl);

  try {
    await _loadChartJs();
    _drawTopAuthors(a);
    _drawBubble(a);
  } catch (err) {
    console.error("[Stats] Authors grafik hatası:", err);
  }
}

function _drawTopAuthors(a) {
  const canvas = document.getElementById("chart-top-authors");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-top-authors"] = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: a.top15Data.map((d) => d.name),
      datasets: [
        { label: "Okunmadı/Sırada", data: a.top15Data.map((d) => d.okunmadi), backgroundColor: "rgba(100,116,139,0.85)", borderRadius: 0 },
        { label: "Okunuyor",        data: a.top15Data.map((d) => d.okunuyor), backgroundColor: "rgba(234,88,12,0.85)",   borderRadius: 0 },
        { label: "Okundu",          data: a.top15Data.map((d) => d.okundu),   backgroundColor: "rgba(34,197,94,0.85)",   borderRadius: 4 },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x}` } },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#a89080", font: { size: 11 } }, grid: { color: "rgba(51,39,32,0.6)" } },
        y: { stacked: true, ticks: { color: "#a89080", font: { size: 11 } }, grid: { display: false } },
      },
      animation: { duration: 400 },
    },
  });
}

function _drawBubble(a) {
  const canvas = document.getElementById("chart-bubble");
  if (!canvas || typeof window.Chart === "undefined") return;

  _activeCharts["chart-bubble"] = new window.Chart(canvas, {
    type: "bubble",
    data: {
      datasets: a.bubbleData.map((d, i) => ({
        label: d.label,
        data:  [{ x: d.x, y: d.y, r: d.r }],
        backgroundColor: a.bubbleColors[i],
        borderColor:     a.bubbleColors[i].replace("0.75", "1"),
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d  = ctx.raw;
              const bd = a.bubbleData[ctx.datasetIndex];
              const ps = bd && bd.totalPages > 0 ? `, ${bd.totalPages.toLocaleString("tr-TR")} sayfa` : "";
              return ` ${ctx.dataset.label} — ${d.x} kitap${ps}, ${d.y > 0 ? d.y + "★" : "puan yok"}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Kitap Sayısı", color: "#a89080", font: { size: 11 } },
          ticks: { color: "#a89080", font: { size: 11 } },
          grid:  { color: "rgba(51,39,32,0.6)" },
          beginAtZero: true,
        },
        y: {
          title: { display: true, text: "Ort. Puan", color: "#a89080", font: { size: 11 } },
          ticks: { color: "#a89080", font: { size: 11 } },
          grid:  { color: "rgba(51,39,32,0.4)" },
          min: 0, max: 5,
        },
      },
      animation: { duration: 400 },
    },
  });
}
