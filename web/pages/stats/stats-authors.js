// ─────────────────────────────────────────────────────────────────────────────
// STATS-AUTHORS — Top Items (6 tip dropdown) + Yazar Evreni (Grimmory birebir).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { _activeCharts, _loadChartJs, normalizeTitle } from "./stats-core.js";

// ── Grimmory DATA_TYPE_DEFS ──────────────────────────────────────────────────
// top-items-chart.component.ts → DATA_TYPE_DEFS dizisinden birebir alındı
const DATA_TYPE_DEFS = [
  { value: "authors",   labelTR: "Yazarlar",    icon: "lucide:layout-grid", color: "#2563EB" },
  { value: "category",  labelTR: "Kategoriler", icon: "lucide:user",        color: "#0D9488" },
  { value: "series",    labelTR: "Seriler",     icon: "lucide:tag",         color: "#DB2777" },
  { value: "publisher", labelTR: "Yayınevleri", icon: "lucide:building-2",  color: "#7C3AED" },
  { value: "tags",      labelTR: "Etiketler",   icon: "lucide:bookmark",    color: "#EAB308" },
  { value: "genre",     labelTR: "Türler",      icon: "lucide:heart",       color: "#ff8904" },
];

// ── Grimmory READ_STATUS renkleri ─────────────────────────────────────────────
const STATUS_DEFS = [
  { key: "okundu",   labelTR: "Okundu",            color: "#22c55e" },
  { key: "okunuyor", labelTR: "Okunuyor",           color: "#3b82f6" },
  { key: "okunmadi", labelTR: "Okunmadı / Sırada",  color: "#6b7280" },
  { key: "sirada",   labelTR: "Sırada",             color: "#f59e0b" },
];

// ── Grimmory author-universe-chart.component.ts → COMPLETION_COLORS ──────────
const COMPLETION_COLORS = {
  high:    "#22c55e",   // 75-100% read - green
  medium:  "#f59e0b",   // 50-74% read - amber
  low:     "#3b82f6",   // 25-49% read - blue
  minimal: "#8b5cf6",   // 1-24% read - purple
  unread:  "#6b7280",   // 0% read - gray
};

// ── Grimmory SCSS: top-items chart-wrapper height: 450px ─────────────────────
const TOP_ITEMS_CHART_H = 450;
// ── Grimmory SCSS: author-universe chart-wrapper height: 350px ───────────────
const BUBBLE_CHART_H    = 350;

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getCompletionColor(pct) {
  if (pct >= 75) return COMPLETION_COLORS.high;
  if (pct >= 50) return COMPLETION_COLORS.medium;
  if (pct >= 25) return COMPLETION_COLORS.low;
  if (pct >= 1)  return COMPLETION_COLORS.minimal;
  return COMPLETION_COLORS.unread;
}

function truncate(str, max) {
  return str && str.length > max ? str.substring(0, max) + "…" : (str || "");
}

// ── Kitaptan item listesi çıkar ───────────────────────────────────────────────
function getItemsFromBook(book, dataType) {
  switch (dataType) {
    case "authors":   return book.author    ? [book.author]    : [];
    case "genre":     return book.genre     ? [book.genre]     : [];
    case "series":    return book.series    ? [book.series]    : [];
    case "publisher": return book.publisher ? [book.publisher] : [];
    case "category":  return book.category  ? [book.category]  : [];
    case "tags":
      if (!book.tags) return [];
      if (Array.isArray(book.tags)) return book.tags.filter(Boolean);
      if (typeof book.tags === "string") return book.tags.split(",").map(t => t.trim()).filter(Boolean);
      return [];
    default: return [];
  }
}

// ── Grimmory calculateStats mantığı — yazar+başlık tekilleştirmeli ───────────
function calculateTopItems(books, dataType) {
  if (!books || books.length === 0) return [];

  // Yazarlar için: aynı yazar+başlık kombinasyonunu tek say
  // Diğer tipler (genre, series, publisher, tags, category) için tekilleştirme yok
  const booksToUse = dataType === "authors"
    ? (() => {
        const seen = new Map();
        for (const b of books) {
          const key = `${(b.author || "").toLocaleLowerCase("tr").trim()}|||${normalizeTitle(b.title)}`;
          if (!seen.has(key)) seen.set(key, b);
        }
        return Array.from(seen.values());
      })()
    : books;

  const itemMap = new Map();

  for (const book of booksToUse) {
    const items      = getItemsFromBook(book, dataType);
    const bookStatus = book.status || "okunmadi";

    for (const item of items) {
      if (!item || !item.trim()) continue;
      const name = item.trim();
      if (!itemMap.has(name)) {
        itemMap.set(name, { name, count: 0, statusBreakdown: { okundu: 0, okunuyor: 0, okunmadi: 0, sirada: 0 } });
      }
      const entry = itemMap.get(name);
      entry.count++;
      if (entry.statusBreakdown[bookStatus] !== undefined) {
        entry.statusBreakdown[bookStatus]++;
      } else {
        entry.statusBreakdown["okunmadi"]++;
      }
    }
  }

  return Array.from(itemMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

// ── Grimmory generateInsights mantığı (top-items) ────────────────────────────
function generateTopItemsInsights(stats, typeDef, allBooks) {
  const insights = [];
  if (stats.length === 0) return insights;

  const typeName = typeDef.labelTR.replace(/evleri$|lar$|ler$/, "").toLowerCase();

  // 1. En çok temsil edilen
  const top = stats[0];
  insights.push({ icon: "lucide:trophy",      label: `En çok ${typeName}`,                    value: `${top.name} — ${top.count} kitap` });

  // 2. En yüksek tamamlanma (min 2 kitap)
  const withReads = stats.filter(s => s.count >= 2);
  if (withReads.length > 0) {
    const mostRead = withReads.reduce((best, curr) =>
      (curr.statusBreakdown.okundu / curr.count) > (best.statusBreakdown.okundu / best.count) ? curr : best
    );
    const readPct = Math.round((mostRead.statusBreakdown.okundu / mostRead.count) * 100);
    if (readPct > 0) {
      insights.push({ icon: "lucide:check-circle", label: "En çok tamamlanan",                 value: `${mostRead.name} — %${readPct} okundu` });
    }
  }

  // 3. İlk 5 konsantrasyon
  if (stats.length >= 5) {
    const top5Books = stats.slice(0, 5).reduce((sum, s) => sum + s.count, 0);
    if (allBooks.length > 0) {
      const concentration = Math.round((top5Books / allBooks.length) * 100);
      insights.push({ icon: "lucide:pie-chart",    label: `İlk 5 ${typeDef.labelTR.toLowerCase()} kapsamı`, value: `Koleksiyonun %${concentration}'i` });
    }
  }

  // 4. Ortalama kitap / item
  if (stats.length > 0) {
    const total = stats.reduce((s, i) => s + i.count, 0);
    insights.push({ icon: "lucide:book-open",    label: `${typeDef.labelTR} başına ort.`,       value: `${(total / stats.length).toFixed(1)} kitap` });
  }

  return insights;
}

// ── Yazar evreni hesapla — yazar+başlık tekilleştirmeli ──────────────────────
function computeAuthors(books) {
  // Önce yazar+başlık bazlı tekilleştir
  const seen = new Map();
  for (const b of books) {
    if (!b.author) continue;
    const key = `${b.author.toLocaleLowerCase("tr").trim()}|||${normalizeTitle(b.title)}`;
    if (!seen.has(key)) seen.set(key, b);
  }
  const uniqueBooks = Array.from(seen.values());

  // Sonra yazar bazlı grupla
  const authorMap = {};
  uniqueBooks.forEach(b => {
    if (!b.author) return;
    if (!authorMap[b.author]) authorMap[b.author] = { name: b.author, books: [] };
    authorMap[b.author].books.push(b);
  });
  return Object.values(authorMap);
}

function computeBubbleData(books) {
  const authors       = computeAuthors(books);
  const allPageTotals = authors.map(a => a.books.reduce((s, b) => s + (b.page_count || 0), 0));
  const maxPageTotal  = Math.max(...allPageTotals, 1);
  const usePageRadius = allPageTotals.some(p => p > 0);

  return authors.filter(a => a.books.length >= 1).map(a => {
    const rated       = a.books.filter(b => b.rating);
    const avgRating   = rated.length > 0
      ? Math.round((rated.reduce((s, b) => s + b.rating, 0) / rated.length) * 100) / 100 : 0;
    const readCount   = a.books.filter(b => b.status === "okundu").length;
    const finishedPct = Math.round((readCount / a.books.length) * 100);
    const totalPages  = a.books.reduce((s, b) => s + (b.page_count || 0), 0);
    const r = usePageRadius
      ? Math.max(5, Math.min((totalPages / maxPageTotal) * 40, 35))
      : Math.max(5, Math.min(a.books.length * 2.5, 30));
    return { label: a.name, x: a.books.length, y: avgRating, r, finishedPct, totalPages, readCount, color: getCompletionColor(finishedPct) };
  });
}

// ── Grimmory author-universe generateInsights mantığı ────────────────────────
function computeAuthorInsights(books) {
  const authors  = computeAuthors(books);
  const insights = [];
  if (authors.length === 0) return insights;

  // En çok kitaplı
  const top = [...authors].sort((a, b) => b.books.length - a.books.length)[0];
  if (top) insights.push(`En çok kitap: ${top.name} — ${top.books.length} kitap`);

  // En yüksek puan (min 2 kitap)
  const rated = authors.map(a => {
    const rb = a.books.filter(b => b.rating);
    if (rb.length < 2) return null;
    return { name: a.name, avg: Math.round((rb.reduce((s, b) => s + b.rating, 0) / rb.length) * 10) / 10 };
  }).filter(Boolean).sort((a, b) => b.avg - a.avg);
  if (rated[0]) insights.push(`En yüksek puan: ${rated[0].name} (${rated[0].avg}★)`);

  // En çok sayfa
  const topPage = authors.map(a => ({ name: a.name, pages: a.books.reduce((s, b) => s + (b.page_count || 0), 0) }))
    .filter(a => a.pages > 0).sort((a, b) => b.pages - a.pages)[0];
  if (topPage) insights.push(`En çok sayfa: ${topPage.name} — ${topPage.pages.toLocaleString("tr-TR")} sayfa`);

  // En büyük backlog
  const topBacklog = authors.map(a => ({
    name: a.name,
    backlog: a.books.filter(b => b.status === "okunmadi" || b.status === "sirada").length
  })).sort((a, b) => b.backlog - a.backlog)[0];
  if (topBacklog && topBacklog.backlog >= 2) insights.push(`En büyük backlog: ${topBacklog.name} — ${topBacklog.backlog} okunmamış kitap`);

  // En çok yönlü (min 3 tür)
  const topVersatile = authors.map(a => ({
    name: a.name, genres: new Set(a.books.map(b => b.genre).filter(Boolean)).size
  })).sort((a, b) => b.genres - a.genres)[0];
  if (topVersatile && topVersatile.genres >= 3) insights.push(`En çok yönlü: ${topVersatile.name} — ${topVersatile.genres} farklı tür`);

  // Hiç okunmayan (min 2 kitap)
  const unread = authors.filter(a => a.books.every(b => b.status === "okunmadi" || b.status === "sirada") && a.books.length >= 2)
    .sort((a, b) => b.books.length - a.books.length);
  if (unread[0]) insights.push(`Hiç okunmayan yazar: ${unread[0].name} — ${unread[0].books.length} okunmamış kitap`);

  // Genel ilerleme
  const totalP = authors.reduce((s, a) => s + a.books.reduce((ss, b) => ss + (b.page_count || 0), 0), 0);
  const totalR  = authors.reduce((s, a) => {
    const pct = a.books.length > 0 ? a.books.filter(b => b.status === "okundu").length / a.books.length : 0;
    return s + a.books.reduce((ss, b) => ss + (b.page_count || 0), 0) * pct;
  }, 0);
  if (totalP > 0) insights.push(`Genel ilerleme: tüm yazarlarda sayfaların %${Math.round((totalR / totalP) * 100)}'i okundu`);

  return insights;
}

// ── HTML yardımcılar ──────────────────────────────────────────────────────────
function authorInsightCard(text) {
  return `
    <div class="au-insight-card">
      <iconify-icon icon="mdi:star" class="au-insight-icon"></iconify-icon>
      <span class="au-insight-text">${text}</span>
    </div>`;
}

function tiInsightCard(ins, color) {
  return `
    <div class="ti-insight-card">
      <iconify-icon icon="${ins.icon}" class="ti-insight-icon" style="color:${color}"></iconify-icon>
      <div class="ti-insight-content">
        <span class="ti-insight-label">${ins.label}</span>
        <span class="ti-insight-value">${ins.value}</span>
      </div>
    </div>`;
}

// ── Modül state ───────────────────────────────────────────────────────────────
let _currentTypeIndex      = 0;
let _topItemsChartInstance = null;

// ── Top Items grafik ──────────────────────────────────────────────────────────
function _drawTopItems(stats, typeDef) {
  const canvas = document.getElementById("chart-top-items");
  if (!canvas || typeof window.Chart === "undefined") return;

  if (_topItemsChartInstance) {
    _topItemsChartInstance.destroy();
    delete _activeCharts["chart-top-items"];
  }
  if (stats.length === 0) return;

  const labels = stats.map(s => truncate(s.name, 30));

  // barPercentage: az item → kalın bar, çok item → ince bar. Container SABİT.
  const n              = stats.length;
  const barPercentage  = n <= 3 ? 0.4 : n <= 6 ? 0.55 : n <= 10 ? 0.7 : 0.85;

  const datasets = STATUS_DEFS
    .filter(sd => stats.some(s => (s.statusBreakdown[sd.key] || 0) > 0))
    .map(sd => ({
      label: sd.labelTR,
      data:  stats.map(s => s.statusBreakdown[sd.key] || 0),
      backgroundColor: sd.color,
      borderColor:     sd.color,
      borderWidth: 1,
      borderRadius: 4,
      barPercentage,
      categoryPercentage: 0.8,
      hoverBorderWidth: 2,
    }));

  _topItemsChartInstance = new window.Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10, right: 20, bottom: 10, left: 10 } },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          ticks:  { color: "#a89080", font: { family: "'Inter', sans-serif", size: 11 }, precision: 0, stepSize: 1 },
          grid:   { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          title:  { display: true, text: "Kitap Sayısı", font: { family: "'Inter', sans-serif", size: 12, weight: "500" }, color: "#a89080" },
        },
        y: {
          stacked: true,
          ticks:  { color: "#a89080", font: { family: "'Inter', sans-serif", size: 11 }, maxTicksLimit: 25 },
          grid:   { display: false },
          border: { display: false },
        },
      },
      plugins: {
        legend: {
          display: true, position: "bottom",
          labels: { font: { family: "'Inter', sans-serif", size: 11 }, padding: 15, usePointStyle: true, pointStyle: "rectRounded", color: "#a89080" },
        },
        tooltip: {
          enabled: true,
          // Grimmory: tooltip borderColor = seçili tipin rengi
          borderColor: typeDef.color,
          borderWidth: 2, cornerRadius: 8, displayColors: true, padding: 12,
          titleFont: { size: 14, weight: "bold", family: "'Inter', sans-serif" },
          bodyFont:  { size: 12,                 family: "'Inter', sans-serif" },
          callbacks: {
            title: ctx  => stats[ctx[0].dataIndex]?.name || "",
            label: ctx  => { const v = ctx.parsed.x; return v === 0 ? "" : ` ${ctx.dataset.label}: ${v} kitap`; },
          },
        },
      },
      interaction: { intersect: true, mode: "nearest", axis: "y" },
      animation:   { duration: 400 },
    },
  });
  _activeCharts["chart-top-items"] = _topItemsChartInstance;
}

// ── Bubble grafik ─────────────────────────────────────────────────────────────
function _drawBubble(bubbleData) {
  const canvas = document.getElementById("chart-bubble");
  if (!canvas || typeof window.Chart === "undefined") return;

  const groups = {
    high:    { label: "Yüksek tamamlanma (%75+)",  color: COMPLETION_COLORS.high,    points: [] },
    medium:  { label: "Orta tamamlanma (%50-74)",   color: COMPLETION_COLORS.medium,  points: [] },
    low:     { label: "Düşük tamamlanma (%25-49)",  color: COMPLETION_COLORS.low,     points: [] },
    minimal: { label: "Minimal tamamlanma (%1-24)", color: COMPLETION_COLORS.minimal, points: [] },
    unread:  { label: "Okunmamış (%0)",             color: COMPLETION_COLORS.unread,  points: [] },
  };

  bubbleData.forEach(d => {
    const key = d.finishedPct >= 75 ? "high" : d.finishedPct >= 50 ? "medium" : d.finishedPct >= 25 ? "low" : d.finishedPct >= 1 ? "minimal" : "unread";
    groups[key].points.push({ x: d.x, y: d.y, r: d.r, _label: d.label, _pages: d.totalPages, _pct: d.finishedPct, _read: d.readCount, _total: d.x });
  });

  const datasets = Object.values(groups).filter(g => g.points.length > 0).map(g => ({
    label: g.label, data: g.points,
    backgroundColor: hexToRgba(g.color, 0.6),
    borderColor: g.color, borderWidth: 2, hoverBorderWidth: 3,
  }));

  _activeCharts["chart-bubble"] = new window.Chart(canvas, {
    type: "bubble",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 20, bottom: 20, left: 20 } },
      plugins: {
        legend: {
          display: true, position: "bottom",
          labels: { font: { family: "'Inter', sans-serif", size: 11 }, padding: 15, usePointStyle: true, pointStyle: "circle", color: "#a89080" },
        },
        tooltip: {
          borderColor: "#8B5CF6", borderWidth: 2, cornerRadius: 8, padding: 12,
          titleFont: { family: "'Inter', sans-serif", size: 13, weight: "bold" },
          bodyFont:  { family: "'Inter', sans-serif", size: 11 },
          callbacks: {
            title: ctx  => ctx[0].raw._label || "",
            label: ctx  => {
              const d = ctx.raw;
              return [
                ` ${d._total} kitap${d._pages > 0 ? `, ${d._pages.toLocaleString("tr-TR")} sayfa` : ""}${d.y > 0 ? `, ${d.y.toFixed(2)}★` : ", puan yok"}`,
                ` Okunan: ${d._read}/${d._total} (%${d._pct})`,
              ];
            },
          },
        },
      },
      interaction: { intersect: true, mode: "nearest" },
      scales: {
        x: {
          title:  { display: true, text: "Kitaplıktaki Kitaplar", font: { family: "'Inter', sans-serif", size: 12, weight: "500" }, color: "#a89080" },
          ticks:  { font: { family: "'Inter', sans-serif", size: 11 }, color: "#a89080", precision: 0, stepSize: 1 },
          grid:   { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          min: 0,
        },
        y: {
          title:  { display: true, text: "Ortalama Puan", font: { family: "'Inter', sans-serif", size: 12, weight: "500" }, color: "#a89080" },
          ticks:  { font: { family: "'Inter', sans-serif", size: 11 }, color: "#a89080", callback: v => v.toLocaleString() },
          grid:   { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
          min: 0, max: 5.5, beginAtZero: true,
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ── Top Items güncelle ────────────────────────────────────────────────────────
function _updateTopItems() {
  const books   = state.books;
  const typeDef = DATA_TYPE_DEFS[_currentTypeIndex];
  const stats   = calculateTopItems(books, typeDef.value);

  // Başlık + açıklama
  const titleEl = document.getElementById("ti-title");
  if (titleEl) titleEl.textContent = `En Çok Yer Alan 15 ${typeDef.labelTR}`;
  const descEl  = document.getElementById("ti-desc");
  if (descEl)  descEl.textContent  = `Kitaplığınızda en çok temsil edilen ${typeDef.labelTR.toLowerCase()}`;

  // İkon — dinamik
  const iconEl = document.getElementById("ti-header-icon");
  if (iconEl) { iconEl.setAttribute("icon", typeDef.icon); iconEl.style.color = typeDef.color; }

  // Badge — Grimmory: sayı + "SHOWN" etiketi, renksiz neutral yüzey
  // Veri yoksa badge'i gizle
  const badgeEl = document.getElementById("ti-badge");
  if (badgeEl) {
    if (stats.length > 0) {
      badgeEl.style.display = "";
      badgeEl.querySelector(".ti-badge-value").textContent = stats.length;
    } else {
      badgeEl.style.display = "none";
    }
  }

  // Grafik wrap — SABİT yükseklik (450px), veri yoksa canvas gizle, yazı göster
  const chartWrap = document.getElementById("ti-chart-wrap");
  const emptyEl   = document.getElementById("ti-empty");

  if (stats.length > 0) {
    if (chartWrap) chartWrap.style.display = "";
    if (emptyEl)   emptyEl.style.display   = "none";
    _drawTopItems(stats, typeDef);
  } else {
    if (_topItemsChartInstance) {
      _topItemsChartInstance.destroy();
      _topItemsChartInstance = null;
      delete _activeCharts["chart-top-items"];
    }
    // Container sabit boyutta kalır, sadece içerik değişir
    if (chartWrap) chartWrap.style.display = "none";
    if (emptyEl) {
      emptyEl.style.display = "flex";
      const txt = emptyEl.querySelector(".ti-empty-text");
      if (txt) txt.textContent = `Bu kitaplıkta henüz ${typeDef.labelTR.toLowerCase()} verisi bulunmuyor.`;
      const sub = emptyEl.querySelector(".ti-empty-sub");
      if (sub) sub.textContent = `${typeDef.labelTR} metadata'sının eklendiğinden emin olun.`;
    }
  }

  // Insight grid
  const grid = document.getElementById("ti-insights-grid");
  if (grid) {
    const insights = generateTopItemsInsights(stats, typeDef, books);
    if (insights.length > 0) {
      grid.innerHTML     = insights.map(ins => tiInsightCard(ins, typeDef.color)).join("");
      grid.style.display = "";
    } else {
      grid.style.display = "none";
    }
  }
}

// ── Custom dropdown oluştur (Grimmory stili) ─────────────────────────────────
function _buildDropdown() {
  const trigger = document.getElementById("ti-dropdown-trigger");
  const menu    = document.getElementById("ti-dropdown-menu");
  const label   = document.getElementById("ti-dropdown-label");
  if (!trigger || !menu || !label) return;

  // Seçenekleri oluştur
  DATA_TYPE_DEFS.forEach((def, i) => {
    const item = document.createElement("div");
    item.className = "ti-dropdown-item" + (i === _currentTypeIndex ? " ti-dropdown-item--active" : "");
    item.dataset.index = i;
    item.textContent = def.labelTR;
    item.addEventListener("click", () => {
      _currentTypeIndex = i;
      label.textContent = def.labelTR;
      menu.querySelectorAll(".ti-dropdown-item").forEach(el => el.classList.remove("ti-dropdown-item--active"));
      item.classList.add("ti-dropdown-item--active");
      _closeDropdown();
      _updateTopItems();
    });
    menu.appendChild(item);
  });

  // Trigger tıklanınca aç/kapat
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains("ti-dropdown-menu--open");
    isOpen ? _closeDropdown() : _openDropdown();
  });

  // Dışarı tıklanınca kapat
  document.addEventListener("click", () => _closeDropdown());
  menu.addEventListener("click", (e) => e.stopPropagation());
}

function _openDropdown() {
  const menu    = document.getElementById("ti-dropdown-menu");
  const trigger = document.getElementById("ti-dropdown-trigger");
  if (menu)    menu.classList.add("ti-dropdown-menu--open");
  if (trigger) trigger.classList.add("ti-dropdown-trigger--open");
}

function _closeDropdown() {
  const menu    = document.getElementById("ti-dropdown-menu");
  const trigger = document.getElementById("ti-dropdown-trigger");
  if (menu)    menu.classList.remove("ti-dropdown-menu--open");
  if (trigger) trigger.classList.remove("ti-dropdown-trigger--open");
}

// ── Ana render ────────────────────────────────────────────────────────────────
export async function renderAuthorsSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const books          = state.books;
  const bubbleData     = computeBubbleData(books);
  const totalAuthors   = new Set(books.map(b => b.author).filter(Boolean)).size;
  const authorInsights = computeAuthorInsights(books);
  const initDef        = DATA_TYPE_DEFS[_currentTypeIndex];

  const sectionEl = document.createElement("div");
  sectionEl.id    = "stats-authors-section";

  sectionEl.innerHTML = `
    <div class="stats-top-row">

      <!-- ═══ Sol: Top Items ═══ -->
      <div class="stats-section-box ti-box">

        <!-- Başlık -->
        <div class="au-section-header">
          <div class="au-section-header-left">
            <iconify-icon id="ti-header-icon" icon="${initDef.icon}" class="au-header-icon" style="color:${initDef.color}"></iconify-icon>
            <div>
              <h2 class="au-title" id="ti-title">En Çok Yer Alan 15 ${initDef.labelTR}</h2>
              <p  class="au-desc"  id="ti-desc">Kitaplığınızda en çok temsil edilen ${initDef.labelTR.toLowerCase()}</p>
            </div>
          </div>
          <!-- Grimmory: dropdown + badge yan yana -->
          <div class="ti-header-controls">
            <!-- Custom dropdown — Grimmory stili -->
            <div class="ti-dropdown">
              <button id="ti-dropdown-trigger" class="ti-dropdown-trigger" type="button">
                <span id="ti-dropdown-label">${initDef.labelTR}</span>
                <iconify-icon icon="lucide:chevron-down" class="ti-dropdown-chevron"></iconify-icon>
              </button>
              <div id="ti-dropdown-menu" class="ti-dropdown-menu"></div>
            </div>
            <!-- Badge — neutral yüzey, renksiz -->
            <div id="ti-badge" class="ti-badge">
              <span class="ti-badge-value">0</span>
              <span class="ti-badge-label">Gösterilen</span>
            </div>
          </div>
        </div>

        <!-- İçerik alanı — SABİT 450px, asla küçülmez/büyümez -->
        <div class="ti-content-area" style="position:relative;width:100%;height:${TOP_ITEMS_CHART_H}px;flex-shrink:0;">
          <!-- Grafik — position:absolute ile container'ı tamamen kaplar -->
          <div id="ti-chart-wrap" style="position:absolute;inset:0;width:100%;height:100%;display:none;">
            <canvas id="chart-top-items"></canvas>
          </div>
          <!-- Boş durum — position:absolute ile container içinde ortalanır -->
          <div id="ti-empty" style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;text-align:center;padding:1rem;">
            <iconify-icon icon="lucide:info" style="font-size:1.5rem;color:#a89080;"></iconify-icon>
            <p class="ti-empty-text" style="font-size:0.85rem;color:#a89080;font-family:'Inter',sans-serif;margin:0;">Bu kitaplıkta henüz veri bulunmuyor.</p>
            <small class="ti-empty-sub" style="font-size:0.75rem;color:#6b6b6b;font-family:'Inter',sans-serif;margin:0;">Metadata'nın eklendiğinden emin olun.</small>
          </div>
        </div>

        <!-- Insight kartlar -->
        <div id="ti-insights-grid" class="ti-insights-grid" style="display:none;"></div>

      </div>

      <!-- ═══ Sağ: Yazar Evreni ═══ -->
      <div class="stats-section-box au-universe-box">

        <!-- Başlık -->
        <div class="au-section-header">
          <div class="au-section-header-left">
            <iconify-icon icon="lucide:globe" class="au-header-icon" style="color:#8B5CF6"></iconify-icon>
            <div>
              <h2 class="au-title">Yazar Evreni</h2>
              <p  class="au-desc">Yazarlarınızı kitap, puan ve okuma ilerlemesiyle keşfedin</p>
            </div>
          </div>
          <div class="au-badge" style="background:rgba(139,92,246,0.15);color:#8B5CF6;border-color:rgba(139,92,246,0.3);">
            ${totalAuthors} yazar
          </div>
        </div>

        <!-- Bilgi notu -->
        <div class="au-legend-info">
          <iconify-icon icon="lucide:info" class="au-info-icon"></iconify-icon>
          <span>Kabarcık boyutu = toplam sayfa · Konum = kitap sayısı ve puana göre · Renk = tamamlanma %</span>
        </div>

        <!-- Bubble grafik — SABİT yükseklik (${BUBBLE_CHART_H}px) -->
        <div class="stats-bar-chart-wrap stats-bubble-wrap" style="height:${BUBBLE_CHART_H}px;">
          <canvas id="chart-bubble"></canvas>
        </div>

        <!-- Bubble legend (5 kategori) -->
        <div class="au-legend-row">
          <div class="au-legend-item"><span class="au-legend-dot" style="background:${hexToRgba(COMPLETION_COLORS.high,    0.8)}"></span><span class="au-legend-label">Yüksek tamamlanma (%75+)</span></div>
          <div class="au-legend-item"><span class="au-legend-dot" style="background:${hexToRgba(COMPLETION_COLORS.medium,  0.8)}"></span><span class="au-legend-label">Orta tamamlanma (%50-74)</span></div>
          <div class="au-legend-item"><span class="au-legend-dot" style="background:${hexToRgba(COMPLETION_COLORS.low,     0.8)}"></span><span class="au-legend-label">Düşük tamamlanma (%25-49)</span></div>
          <div class="au-legend-item"><span class="au-legend-dot" style="background:${hexToRgba(COMPLETION_COLORS.minimal, 0.8)}"></span><span class="au-legend-label">Minimal tamamlanma (%1-24)</span></div>
          <div class="au-legend-item"><span class="au-legend-dot" style="background:${hexToRgba(COMPLETION_COLORS.unread,  0.8)}"></span><span class="au-legend-label">Okunmamış (%0)</span></div>
        </div>

        <!-- Yazar Evreni insights -->
        ${authorInsights.length > 0 ? `
          <div class="au-insights-grid">
            ${authorInsights.map(txt => authorInsightCard(txt)).join("")}
          </div>` : ""}

      </div>
    </div>
  `;

  wrap.appendChild(sectionEl);
  _buildDropdown();

  try {
    await _loadChartJs();
    _updateTopItems();
    _drawBubble(bubbleData);
  } catch (err) {
    console.error("[Stats] Authors grafik hatası:", err);
  }
}