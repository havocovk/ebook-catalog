// ─────────────────────────────────────────────────────────────────────────────
// STATS — İstatistikler sayfası.
//
// Adım 6: Sayfa iskeleti
// Adım 7: Üst Özet Bar + Pasta/Halka Grafikler (Format, Dil, Confidence)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";

// Chart.js yükleme durumu ve aktif grafik nesneleri
let _chartJsReady = false;
const _activeCharts = {};

function _loadChartJs() {
  if (_chartJsReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    // Zaten başka sayfa yüklediyse (dashboard) window.Chart mevcuttur
    if (typeof window.Chart !== "undefined") {
      _chartJsReady = true;
      return resolve();
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    script.onload  = () => { _chartJsReady = true; resolve(); };
    script.onerror = () => reject(new Error("Chart.js yüklenemedi"));
    document.head.appendChild(script);
  });
}

function _destroyCharts() {
  Object.values(_activeCharts).forEach((c) => c?.destroy());
  Object.keys(_activeCharts).forEach((k) => delete _activeCharts[k]);
}

// ─── Veri hesapla ────────────────────────────────────────────────────────────
function compute() {
  const books = state.books;

  const total         = books.length;
  const authorCount   = new Set(books.map((b) => b.author).filter(Boolean)).size;
  const seriesCount   = new Set(books.map((b) => b.series).filter(Boolean)).size;
  const publisherCount= new Set(books.map((b) => b.publisher).filter(Boolean)).size;

  // Toplam dosya boyutu (bytes)
  const totalBytes = books.reduce((sum, b) => sum + (b.file_size || 0), 0);

  // Format dağılımı
  const epub = books.filter((b) => b.format === "epub").length;
  const pdf  = books.filter((b) => b.format === "pdf").length;
  const fmtOther = total - epub - pdf;

  // Dil dağılımı
  const langTr    = books.filter((b) => b.language === "tr").length;
  const langEn    = books.filter((b) => b.language === "en").length;
  const langOther = books.filter((b) => b.language && b.language !== "tr" && b.language !== "en").length;
  const langNone  = total - langTr - langEn - langOther;

  // Confidence dağılımı
  const confHigh   = books.filter((b) => b.confidence_score >= 80).length;
  const confMedium = books.filter((b) => b.confidence_score >= 50 && b.confidence_score < 80).length;
  const confLow    = books.filter((b) => b.confidence_score != null && b.confidence_score < 50).length;
  const confNone   = books.filter((b) => b.confidence_score == null).length;

  return {
    total, authorCount, seriesCount, publisherCount, totalBytes,
    epub, pdf, fmtOther,
    langTr, langEn, langOther, langNone,
    confHigh, confMedium, confLow, confNone,
  };
}

// ─── Dosya boyutu formatla ────────────────────────────────────────────────────
function _fmtBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── Dışa açık: router her ziyarette çağırır ─────────────────────────────────
export async function renderStats() {
  const container = document.getElementById("stats-content");
  if (!container) return;

  _destroyCharts();

  const s = compute();

  container.innerHTML = `
    <div class="stats-wrap">

      <!-- ── Sayfa başlığı ── -->
      <div class="stats-header">
        <h1 class="stats-title">
          <iconify-icon icon="lucide:bar-chart-2"></iconify-icon> İstatistikler
        </h1>
        <p class="stats-sub">${s.total} kitap üzerinden hesaplanıyor</p>
      </div>

      <!-- ── Üst Özet Bar ── -->
      <div class="stats-summary-bar">
        ${summaryCard("lucide:book-copy",   "Toplam Kitap",   s.total,              "accent")}
        ${summaryCard("lucide:users",       "Yazar",          s.authorCount,         "neutral")}
        ${summaryCard("lucide:layers",      "Seri",           s.seriesCount,         "neutral")}
        ${summaryCard("lucide:building-2",  "Yayınevi",       s.publisherCount,      "neutral")}
        ${summaryCard("lucide:hard-drive",  "Toplam Boyut",   _fmtBytes(s.totalBytes), "neutral", true)}
      </div>

      <!-- ── Pasta / Halka Grafikler ── -->
      <div class="stats-charts-row">

        <!-- Format Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Format Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-format"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(224,92,92,0.85)",  "PDF",  s.pdf,  s.total)}
            ${legendItem("rgba(76,175,130,0.85)", "EPUB", s.epub, s.total)}
            ${s.fmtOther > 0 ? legendItem("rgba(92,95,114,0.85)", "Diğer", s.fmtOther, s.total) : ""}
          </div>
        </div>

        <!-- Dil Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Dil Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-lang"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(124,106,247,0.85)", "Türkçe",    s.langTr,    s.total)}
            ${legendItem("rgba(76,175,130,0.85)",  "İngilizce", s.langEn,    s.total)}
            ${s.langOther > 0 ? legendItem("rgba(224,168,74,0.85)", "Diğer", s.langOther, s.total) : ""}
            ${s.langNone  > 0 ? legendItem("rgba(92,95,114,0.85)",  "Belirtilmemiş", s.langNone, s.total) : ""}
          </div>
        </div>

        <!-- Confidence Skoru Dağılımı -->
        <div class="stats-chart-box">
          <h2 class="stats-chart-title">Güven Skoru Dağılımı</h2>
          <div class="stats-chart-wrap">
            <canvas id="chart-conf"></canvas>
          </div>
          <div class="stats-chart-legend">
            ${legendItem("rgba(76,175,130,0.85)",  "Yüksek (80+)",  s.confHigh,   s.total)}
            ${legendItem("rgba(224,168,74,0.85)",  "Orta (50-79)",  s.confMedium, s.total)}
            ${legendItem("rgba(224,92,92,0.85)",   "Düşük (0-49)",  s.confLow,    s.total)}
            ${s.confNone > 0 ? legendItem("rgba(92,95,114,0.85)", "Belirsiz", s.confNone, s.total) : ""}
          </div>
        </div>

      </div>
    </div>
  `;

  // Chart.js yükle ve grafikleri çiz
  try {
    await _loadChartJs();
    _drawPie("chart-format", ["PDF", "EPUB", "Diğer"],
      [s.pdf, s.epub, s.fmtOther].filter((v) => v > 0),
      ["rgba(224,92,92,0.85)", "rgba(76,175,130,0.85)", "rgba(92,95,114,0.85)"],
      false
    );
    _drawPie("chart-lang",
      ["Türkçe", "İngilizce", "Diğer", "Belirtilmemiş"],
      [s.langTr, s.langEn, s.langOther, s.langNone].filter((v) => v > 0),
      ["rgba(124,106,247,0.85)", "rgba(76,175,130,0.85)", "rgba(224,168,74,0.85)", "rgba(92,95,114,0.85)"],
      false
    );
    _drawPie("chart-conf",
      ["Yüksek (80+)", "Orta (50-79)", "Düşük (0-49)", "Belirsiz"],
      [s.confHigh, s.confMedium, s.confLow, s.confNone].filter((v) => v > 0),
      ["rgba(76,175,130,0.85)", "rgba(224,168,74,0.85)", "rgba(224,92,92,0.85)", "rgba(92,95,114,0.85)"],
      true  // halka
    );
  } catch (err) {
    console.error("[Stats] Chart.js yüklenemedi:", err);
  }

  // ── Adım 8: Publication Timeline bölümünü ekle ──────────────────────────
  await renderTimelineSection();
  // ── Adım 8 sonu ───────────────────────────────────────────────────────────

  // ── Adım 9: Reading Journey bölümünü ekle ────────────────────────────────
  await renderJourneySection();
  // ── Adım 9 sonu ───────────────────────────────────────────────────────────
}

// ─── Pasta / Halka grafik çiz ─────────────────────────────────────────────────
function _drawPie(canvasId, allLabels, filteredValues, allColors, isDoughnut) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof window.Chart === "undefined") return;
  if (filteredValues.every((v) => v === 0)) return;

  // Sıfır olmayan değerlere karşılık gelen etiket ve renkleri filtrele
  const labels = [];
  const colors = [];
  let vi = 0;
  allLabels.forEach((label, i) => {
    if (allColors[i] !== undefined && filteredValues[vi] !== undefined) {
      labels.push(label);
      colors.push(allColors[i]);
      vi++;
    }
  });

  _activeCharts[canvasId] = new window.Chart(canvas, {
    type: isDoughnut ? "doughnut" : "pie",
    data: {
      labels,
      datasets: [{
        data: filteredValues,
        backgroundColor: colors,
        borderColor: "#1a1d24",
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: isDoughnut ? "65%" : "0%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${val} kitap (%${pct})`;
            },
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ─── Yardımcı: özet kart HTML'i ──────────────────────────────────────────────
function summaryCard(icon, label, value, variant, isText = false) {
  return `
    <div class="stats-summary-card stats-summary-card--${variant}">
      <div class="stats-summary-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stats-summary-value ${isText ? "stats-summary-value--sm" : ""}">${value}</div>
      <div class="stats-summary-label">${label}</div>
    </div>
  `;
}

// ─── Yardımcı: grafik legend satırı ──────────────────────────────────────────
function legendItem(color, label, count, total) {
  if (count === 0) return "";
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="stats-legend-item">
      <span class="stats-legend-dot" style="background:${color}"></span>
      <span class="stats-legend-label">${label}</span>
      <span class="stats-legend-val">${count} <span class="stats-legend-pct">%${pct}</span></span>
    </div>
  `;
}

// ═════════════════════════════════════════════════════════════════════════════
// Adım 8 — Publication Timeline
// ═════════════════════════════════════════════════════════════════════════════

// ─── Yayın yılı istatistiklerini hesapla ─────────────────────────────────────
function computeTimeline() {
  const books = state.books;
  const withYear = books.filter((b) => b.year && b.year > 0);
  if (withYear.length === 0) return null;

  const years = withYear.map((b) => b.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const avgYear = Math.round(years.reduce((a, b) => a + b, 0) / years.length);

  // Yıl → kitap sayısı haritası
  const yearMap = {};
  years.forEach((y) => { yearMap[y] = (yearMap[y] || 0) + 1; });

  // En yaygın yıl
  const peakYear = Object.entries(yearMap).sort((a, b) => b[1] - a[1])[0];

  // On yıllık gruplar
  const decadeMap = {};
  years.forEach((y) => {
    const decade = Math.floor(y / 10) * 10;
    decadeMap[decade] = (decadeMap[decade] || 0) + 1;
  });
  const peakDecade = Object.entries(decadeMap).sort((a, b) => b[1] - a[1])[0];

  // Klasik oranı (1970 öncesi)
  const classicCount  = years.filter((y) => y < 1970).length;
  const classicPct    = Math.round((classicCount / withYear.length) * 100);

  // 21. yüzyıl oranı (2000+)
  const modernCount   = years.filter((y) => y >= 2000).length;
  const modernPct     = Math.round((modernCount / withYear.length) * 100);

  // Zaman aralığı
  const span = maxYear - minYear;

  // On yıllık gruplar: sıralı etiket + değer dizisi (grafik için)
  const sortedDecades = Object.entries(decadeMap).sort((a, b) => Number(a[0]) - Number(b[0]));
  const decadeLabels  = sortedDecades.map(([d]) => `${d}'ler`);
  const decadeValues  = sortedDecades.map(([, v]) => v);

  return {
    minYear, maxYear, avgYear,
    peakYear: peakYear ? Number(peakYear[0]) : null,
    peakYearCount: peakYear ? peakYear[1] : 0,
    peakDecade: peakDecade ? Number(peakDecade[0]) : null,
    span, classicPct, modernPct,
    decadeLabels, decadeValues,
    withYearCount: withYear.length,
  };
}

// ─── Timeline bölümünü render et ve mevcut sayfaya ekle ─────────────────────
export async function renderTimelineSection() {
  const wrap = document.querySelector(".stats-wrap");
  if (!wrap) return;

  const t = computeTimeline();

  // Timeline HTML bloğunu oluştur
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

      <!-- 8 özet kart -->
      <div class="stats-mini-grid">
        ${miniCard("lucide:book-open",    "En Eski Kitap",    t.minYear,                    "neutral")}
        ${miniCard("lucide:sparkles",     "En Yeni Kitap",    t.maxYear,                    "accent")}
        ${miniCard("lucide:calculator",   "Ortalama Yıl",     t.avgYear,                    "neutral")}
        ${miniCard("lucide:trophy",       "En Yaygın Yıl",    t.peakYear ? `${t.peakYear} (${t.peakYearCount} kitap)` : "—", "warning")}
        ${miniCard("lucide:move-horizontal","Zaman Aralığı",  `${t.span} yıl`,               "neutral")}
        ${miniCard("lucide:bar-chart-4",  "Zirve On Yıl",    t.peakDecade ? `${t.peakDecade}'ler` : "—", "success")}
        ${miniCard("lucide:clock",        "Klasik Oranı",     `%${t.classicPct}`,            "neutral")}
        ${miniCard("lucide:zap",          "21. Yüzyıl",       `%${t.modernPct}`,             "accent")}
      </div>

      <!-- Yatay çubuk grafik -->
      <div class="stats-bar-chart-wrap">
        <canvas id="chart-timeline"></canvas>
      </div>
    </div>
  `;

  wrap.appendChild(sectionEl);

  // Grafik çiz
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
        data: t.decadeValues,
        backgroundColor: "rgba(124,106,247,0.75)",
        borderColor: "rgba(124,106,247,1)",
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",   // yatay çubuk
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.x} kitap`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9195a8", font: { size: 11 } },
          grid:  { color: "rgba(46,50,64,0.6)" },
        },
        y: {
          ticks: { color: "#9195a8", font: { size: 12 } },
          grid:  { display: false },
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ─── Yardımcı: mini özet kart ────────────────────────────────────────────────
function miniCard(icon, label, value, variant) {
  return `
    <div class="stats-mini-card stats-mini-card--${variant}">
      <div class="stats-mini-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stats-mini-value">${value}</div>
      <div class="stats-mini-label">${label}</div>
    </div>
  `;
}

// ═════════════════════════════════════════════════════════════════════════════
// Adım 9 — Reading Journey
// ═════════════════════════════════════════════════════════════════════════════

function computeJourney() {
  const books = state.books;

  // ── Backlog: okunmamış + sırada ──────────────────────────────────────────
  const backlog = books.filter(
    (b) => b.status === "okunmadi" || b.status === "sirada"
  ).length;

  // ── Tamamlanma oranı ─────────────────────────────────────────────────────
  const finished     = books.filter((b) => b.status === "okundu");
  const completionPct = books.length > 0
    ? Math.round((finished.length / books.length) * 100)
    : 0;

  // ── Ortalama tamamlama süresi (gün) ──────────────────────────────────────
  // $createdAt → finished_at arasındaki fark, her ikisi de dolu olan kitaplar
  const durations = finished
    .filter((b) => b.$createdAt && b.finished_at)
    .map((b) => {
      const diff = new Date(b.finished_at) - new Date(b.$createdAt);
      return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
    })
    .filter((d) => d >= 0 && d < 3650); // 10 yılı aşan değerleri filtrele
  const avgDays = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  // ── Ay bazlı veriler ──────────────────────────────────────────────────────
  // Son 24 ayı kapsayan pencere
  const now       = new Date();
  const months    = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: _monthLabel(d) });
  }

  // Eklenen kitaplar (kümülatif)
  const addedPerMonth = {};
  books.forEach((b) => {
    if (!b.$createdAt) return;
    const d   = new Date(b.$createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    addedPerMonth[key] = (addedPerMonth[key] || 0) + 1;
  });

  // Tamamlanan kitaplar (kümülatif)
  const finishedPerMonth = {};
  finished.forEach((b) => {
    if (!b.finished_at) return;
    const d   = new Date(b.finished_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    finishedPerMonth[key] = (finishedPerMonth[key] || 0) + 1;
  });

  // Kümülatif diziler (sadece son 24 ay)
  let cumAdded = 0, cumFinished = 0;
  const addedCum    = [];
  const finishedCum = [];
  months.forEach(({ key }) => {
    cumAdded    += addedPerMonth[key]    || 0;
    cumFinished += finishedPerMonth[key] || 0;
    addedCum.push(cumAdded);
    finishedCum.push(cumFinished);
  });

  // ── En iyi okuma ayı (en çok tamamlanan) ─────────────────────────────────
  const bestReadEntry = Object.entries(finishedPerMonth)
    .sort((a, b) => b[1] - a[1])[0];
  const bestReadMonth = bestReadEntry
    ? _keyToLabel(bestReadEntry[0]) + ` (${bestReadEntry[1]} kitap)`
    : "—";

  // ── En çok kitap eklenen ay ───────────────────────────────────────────────
  const bestAddEntry = Object.entries(addedPerMonth)
    .sort((a, b) => b[1] - a[1])[0];
  const bestAddMonth = bestAddEntry
    ? _keyToLabel(bestAddEntry[0]) + ` (${bestAddEntry[1]} kitap)`
    : "—";

  // ── Aylık ortalama tamamlama (son 24 ay) ─────────────────────────────────
  const totalFinished24 = months.reduce(
    (sum, { key }) => sum + (finishedPerMonth[key] || 0), 0
  );
  const avgMonthlyFinish = (totalFinished24 / 24).toFixed(1);

  // ── Son 3 ay aktivitesi ───────────────────────────────────────────────────
  const last3Keys = months.slice(-3).map((m) => m.key);
  const last3Added    = last3Keys.reduce((s, k) => s + (addedPerMonth[k]    || 0), 0);
  const last3Finished = last3Keys.reduce((s, k) => s + (finishedPerMonth[k] || 0), 0);
  const last3Activity = `+${last3Added} eklendi / ${last3Finished} okundu`;

  // ── En uzun okuma serisi (üst üste ay tamamlama) ─────────────────────────
  let maxStreak = 0, curStreak = 0;
  months.forEach(({ key }) => {
    if ((finishedPerMonth[key] || 0) > 0) {
      curStreak++;
      maxStreak = Math.max(maxStreak, curStreak);
    } else {
      curStreak = 0;
    }
  });

  return {
    backlog, completionPct, avgDays, bestReadMonth, bestAddMonth,
    avgMonthlyFinish, last3Activity, maxStreak,
    chartLabels:    months.map((m) => m.label),
    addedCum, finishedCum,
  };
}

function _monthLabel(date) {
  const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
  return `${MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

function _keyToLabel(key) {
  const [y, m] = key.split("-");
  const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
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

      <!-- 8 mini kart -->
      <div class="stats-mini-grid">
        ${miniCard("lucide:inbox",         "Backlog",              j.backlog,                        "neutral")}
        ${miniCard("lucide:timer",         "Ort. Tamamlama",       j.avgDays !== null ? `${j.avgDays} gün` : "—", "neutral")}
        ${miniCard("lucide:trophy",        "En İyi Okuma Ayı",     j.bestReadMonth,                  "warning")}
        ${miniCard("lucide:plus-circle",   "En Çok Eklenen Ay",    j.bestAddMonth,                   "accent")}
        ${miniCard("lucide:calendar",      "Aylık Ort. Tamamlama", `${j.avgMonthlyFinish} kitap`,    "neutral")}
        ${miniCard("lucide:flame",         "En Uzun Seri",         `${j.maxStreak} ay`,              "success")}
        ${miniCard("lucide:activity",      "Son 3 Ay",             j.last3Activity,                  "neutral")}
        ${miniCard("lucide:percent",       "Tamamlanma Oranı",     `%${j.completionPct}`,            "accent")}
      </div>

      <!-- Kümülatif çizgi grafik -->
      <div class="stats-bar-chart-wrap stats-line-chart-wrap">
        <canvas id="chart-journey"></canvas>
      </div>

      <!-- Grafik legend -->
      <div class="stats-chart-legend stats-journey-legend">
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(124,106,247,0.85)"></span>
          <span class="stats-legend-label">Eklenen Kitaplar (kümülatif)</span>
        </div>
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:rgba(76,175,130,0.85)"></span>
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

  // Her 4 ayda bir etiket göster (kalabalık olmasın)
  const tickLabels = j.chartLabels.map((l, i) => i % 4 === 0 ? l : "");

  _activeCharts["chart-journey"] = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: j.chartLabels,
      datasets: [
        {
          label: "Eklenen (kümülatif)",
          data: j.addedCum,
          borderColor: "rgba(124,106,247,0.9)",
          backgroundColor: "rgba(124,106,247,0.12)",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
        {
          label: "Tamamlanan (kümülatif)",
          data: j.finishedCum,
          borderColor: "rgba(76,175,130,0.9)",
          backgroundColor: "rgba(76,175,130,0.08)",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} kitap`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9195a8",
            font: { size: 10 },
            callback: (_, i) => tickLabels[i],
            maxRotation: 0,
          },
          grid: { color: "rgba(46,50,64,0.4)" },
        },
        y: {
          ticks: { color: "#9195a8", font: { size: 11 } },
          grid:  { color: "rgba(46,50,64,0.6)" },
          beginAtZero: true,
        },
      },
      animation: { duration: 400 },
    },
  });
}