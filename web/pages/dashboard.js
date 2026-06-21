// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD — Panel sayfası.
//
// 4A: İstatistik kartları (Koleksiyon, Okuma Durumu, Çeşitlilik, Dil)
// 4B: Halka grafik (Chart.js) + Son eklenenler şeridi + Şu an okunuyor bölümü
//
// Chart.js dinamik olarak yüklenir (CDN); bir kez yüklendikten sonra önbelleğe
// alınır. Grafik nesnesi de saklanır, sekme değiştirince önceki yok edilir.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { navigate } from "../core/router.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml } from "../ui/common.js";

// Chart.js yükleme durumu ve mevcut grafik nesnesi.
let chartJsReady = false;
let activeChart  = null;

// ── Adım J9: Yeniden çizim önleme ───────────────────────────────────────────
// Dashboard'a her geçişte sıfırdan çizim yapmak yerine istatistikler
// değişmediyse mevcut HTML ve grafik korunur.
//
// _lastStatsKey: bir önceki ziyarette hesaplanan istatistiklerin özeti.
// compute() çıktısının JSON'u bu anahtarla karşılaştırılır.
// Eşleşiyorsa → yeniden çizim yok. Değişti → normal çizim yapılır.
let _lastStatsKey = null;

function _statsKey(stats) {
  // recent ve reading listelerindeki kitap ID sırası değişmiş olabilir;
  // bunları da özete dahil ediyoruz ki bir kitabın durumu değişince
  // dashboard da tazelenir.
  return JSON.stringify({
    total:          stats.total,
    epub:           stats.epub,
    pdf:            stats.pdf,
    okunmadi:       stats.okunmadi,
    sirada:         stats.sirada,
    okunuyor:       stats.okunuyor,
    okundu:         stats.okundu,
    authorCount:    stats.authorCount,
    publisherCount: stats.publisherCount,
    seriesCount:    stats.seriesCount,
    langTr:         stats.langTr,
    langEn:         stats.langEn,
    langOther:      stats.langOther,
    recentIds:      stats.recent.map((b) => b.$id),
    readingIds:     stats.reading.map((b) => b.$id),
    // ── Adım 14: eksik bilgi sayıları değişirse de yeniden çizim tetiklensin
    missingAuthor:    stats.missingAuthor,
    missingPublisher: stats.missingPublisher,
    missingCover:     stats.missingCover,
    missingYear:      stats.missingYear,
  });
}
// ── Adım J9 sonu ─────────────────────────────────────────────────────────────

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export async function renderDashboard() {
  const stats = compute();

  // ── Adım J9: İstatistikler değişmemişse yeniden çizme ───────────────────
  const key = _statsKey(stats);
  if (key === _lastStatsKey && document.getElementById("dashboard-content")?.hasChildNodes()) {
    // Veri aynı ve DOM zaten dolu → sadece tıklama olaylarını yenile
    // (router sayfayı tekrar monte edince listener'lar sıfırlanır)
    bindRecentClicks();
    return;
  }
  _lastStatsKey = key;
  // ── Adım J9 sonu ────────────────────────────────────────────────────────

  renderLayout(stats);     // HTML iskeletini hemen çiz
  bindRecentClicks();      // Son eklenenler tıklama olayları
  await loadChartJs();     // Chart.js yüklenmesini bekle
  drawDonutChart(stats);   // Grafik çiz
}

// ─── Tüm istatistikleri hesapla ─────────────────────────────────────────────
function compute() {
  const books = state.books;
  const total = books.length;

  const epub = books.filter((b) => b.format === "epub").length;
  const pdf  = books.filter((b) => b.format === "pdf").length;

  const okunmadi = books.filter((b) => b.status === "okunmadi").length;
  const sirada   = books.filter((b) => b.status === "sirada").length;
  const okunuyor = books.filter((b) => b.status === "okunuyor").length;
  const okundu   = books.filter((b) => b.status === "okundu").length;

  const authorCount    = new Set(books.map((b) => b.author).filter(Boolean)).size;
  const publisherCount = new Set(books.map((b) => b.publisher).filter(Boolean)).size;
  const seriesCount    = new Set(books.map((b) => b.series).filter(Boolean)).size;

  const langTr    = books.filter((b) => b.language === "tr").length;
  const langEn    = books.filter((b) => b.language === "en").length;
  const langOther = books.filter(
    (b) => b.language && b.language !== "tr" && b.language !== "en"
  ).length;

  // Son eklenen 10 kitap ($createdAt azalan)
  const recent = [...books]
    .sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt))
    .slice(0, 10);

  // Şu an okunan kitaplar
  const reading = books.filter((b) => b.status === "okunuyor");

  const readPct = total > 0 ? Math.round((okundu / total) * 100) : 0;

  // ── Adım 14: Eksik Bilgi Merkezi — hangi alanlardan kaç kitapta eksik ────
  // Boş string, null veya undefined hepsi "eksik" sayılır.
  const missingAuthor    = books.filter((b) => !b.author).length;
  const missingPublisher = books.filter((b) => !b.publisher).length;
  const missingCover     = books.filter((b) => !b.cover_url).length;
  const missingYear      = books.filter((b) => !b.year).length;
  // ── Adım 14 sonu ──────────────────────────────────────────────────────────

  return {
    total, epub, pdf,
    okunmadi, sirada, okunuyor, okundu,
    authorCount, publisherCount, seriesCount,
    langTr, langEn, langOther,
    readPct, recent, reading,
    missingAuthor, missingPublisher, missingCover, missingYear,
  };
}

// ─── Tüm sayfayı çiz ────────────────────────────────────────────────────────
function renderLayout(s) {
  const container = document.getElementById("dashboard-content");
  if (!container) return;

  // Mevcut grafik varsa yok et (hafıza sızıntısı önleme).
  if (activeChart) { activeChart.destroy(); activeChart = null; }

  container.innerHTML = `

    <!-- ── Şu An Okunuyor ── -->
    ${s.reading.length > 0 ? renderReadingSection(s.reading) : ""}

    <!-- ── Koleksiyon ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:library"></iconify-icon> Koleksiyon
      </h2>
      <div class="stat-grid">
        ${card("lucide:book-copy",   "Toplam Kitap", s.total, "accent")}
        ${card("lucide:file-text",   "EPUB",         s.epub,  "neutral")}
        ${card("lucide:file-type-2", "PDF",          s.pdf,   "neutral")}
      </div>
    </div>

    <!-- ── Adım 14: Eksik Bilgi Merkezi ── -->
    ${renderMissingInfoSection(s)}

    <!-- ── Okuma Durumu ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:bookmark"></iconify-icon> Okuma Durumu
      </h2>
      <div class="reading-status-wrap">
        <!-- Sol: kartlar + ilerleme çubuğu -->
        <div class="reading-status-left">
          <div class="progress-bar-wrap">
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width:${s.readPct}%"></div>
            </div>
            <span class="progress-bar-label">${s.okundu} / ${s.total} kitap okundu — %${s.readPct}</span>
          </div>
          <div class="stat-grid stat-grid--2">
            ${card("lucide:circle",       "Okunmadı",  s.okunmadi, "neutral")}
            ${card("lucide:clock",        "Sırada",    s.sirada,   "warning")}
            ${card("lucide:book-open",    "Okunuyor",  s.okunuyor, "accent")}
            ${card("lucide:check-circle", "Okundu",    s.okundu,   "success")}
          </div>
        </div>
        <!-- Sağ: halka grafik -->
        <div class="donut-wrap">
          <canvas id="status-chart" width="180" height="180"></canvas>
        </div>
      </div>
    </div>

    <!-- ── Son Eklenenler ── -->
    ${s.recent.length > 0 ? renderRecentSection(s.recent) : ""}

    <!-- ── Çeşitlilik ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:layers"></iconify-icon> Çeşitlilik
      </h2>
      <div class="stat-grid">
        ${card("lucide:user",       "Yazar",    s.authorCount,    "neutral")}
        ${card("lucide:building-2", "Yayınevi", s.publisherCount, "neutral")}
        ${card("lucide:layers",     "Seri",     s.seriesCount,    "neutral")}
      </div>
    </div>

    <!-- ── Dil ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:languages"></iconify-icon> Dil
      </h2>
      <div class="stat-grid">
        ${card("lucide:flag",    "Türkçe",    s.langTr,    "neutral")}
        ${card("lucide:globe",   "İngilizce", s.langEn,    "neutral")}
        ${card("lucide:globe-2", "Diğer",     s.langOther, "neutral")}
      </div>
    </div>

  `;
}

// ── Adım 14: "Eksik Bilgi Merkezi" bölümü ───────────────────────────────────
// Hiçbir alanda eksik yoksa (4 kart da 0) bölüm hiç gösterilmez — katalog
// tertemizse Dashboard'da gereksiz bir "0, 0, 0, 0" görüntüsü çıkmaz.
function renderMissingInfoSection(s) {
  const total = s.missingAuthor + s.missingPublisher + s.missingCover + s.missingYear;
  if (total === 0) return "";

  return `
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:alert-circle"></iconify-icon> Eksik Bilgi Merkezi
      </h2>
      <div class="stat-grid" id="missing-info-grid">
        ${missingCard("lucide:user-x",      "Yazar Eksik",    s.missingAuthor,    "author")}
        ${missingCard("lucide:building-2",  "Yayınevi Eksik", s.missingPublisher, "publisher")}
        ${missingCard("lucide:image-off",   "Kapak Eksik",    s.missingCover,     "cover_url")}
        ${missingCard("lucide:calendar-x",  "Yıl Eksik",      s.missingYear,      "year")}
      </div>
    </div>
  `;
}

// Eksik bilgi kartı — tıklanınca katalog sayfasına ilgili filtreyle yönlendirir.
function missingCard(icon, label, value, field) {
  return `
    <div class="stat-card stat-card--missing" data-missing-field="${field}" role="button" tabindex="0">
      <div class="stat-card-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stat-card-value">${value}</div>
      <div class="stat-card-label">${label}</div>
    </div>
  `;
}
// ── Adım 14 sonu ─────────────────────────────────────────────────────────────

// ─── "Şu An Okunuyor" bölümü ─────────────────────────────────────────────────
function renderReadingSection(books) {
  const items = books.map((b) => `
    <div class="reading-card" data-id="${b.$id}">
      <div class="reading-card-cover">
        ${b.cover_url
          ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title || "")}" loading="lazy" />`
          : `<div class="cover-placeholder">${escapeHtml((b.title || "?")[0].toUpperCase())}</div>`}
      </div>
      <div class="reading-card-info">
        <span class="reading-card-title">${escapeHtml(b.title || "Başlıksız")}</span>
        <span class="reading-card-author">${escapeHtml(b.author || "")}</span>
      </div>
    </div>
  `).join("");

  return `
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:book-open"></iconify-icon> Şu An Okunuyor
      </h2>
      <div class="reading-cards" id="reading-cards">${items}</div>
    </div>
  `;
}

// ─── "Son Eklenenler" yatay şerit ────────────────────────────────────────────
function renderRecentSection(books) {
  const items = books.map((b) => `
    <div class="recent-item" data-id="${b.$id}" title="${escapeHtml(b.title || "")}">
      ${b.cover_url
        ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title || "")}" loading="lazy" />`
        : `<div class="recent-placeholder">${escapeHtml((b.title || "?")[0].toUpperCase())}</div>`}
    </div>
  `).join("");

  return `
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:clock"></iconify-icon> Son Eklenenler
      </h2>
      <div class="recent-strip" id="recent-strip">${items}</div>
    </div>
  `;
}

// ─── Kart tıklama olaylarını bağla ──────────────────────────────────────────
function bindRecentClicks() {
  // Okunuyor kartları
  document.getElementById("reading-cards")?.addEventListener("click", (e) => {
    const card = e.target.closest(".reading-card");
    if (card?.dataset.id) openModal(card.dataset.id);
  });
  // Son eklenenler şeridi
  document.getElementById("recent-strip")?.addEventListener("click", (e) => {
    const item = e.target.closest(".recent-item");
    if (item?.dataset.id) openModal(item.dataset.id);
  });
  // ── Adım 14: Eksik Bilgi Merkezi kartları ────────────────────────────────
  // Bir karta tıklanınca (veya Enter/Space ile klavyeden seçilince), ilgili
  // alanı eksik olan kitapları gösteren bir filtre isteği state'e yazılır
  // ve katalog sayfasına yönlendirilir. catalog.js bu isteği renderCatalog()
  // içinde okuyup uygular.
  const missingGrid = document.getElementById("missing-info-grid");
  missingGrid?.addEventListener("click", (e) => {
    const card = e.target.closest(".stat-card--missing");
    if (!card) return;
    state.pendingCatalogFilter = { missingField: card.dataset.missingField };
    navigate("catalog");
  });
  missingGrid?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".stat-card--missing");
    if (!card) return;
    e.preventDefault();
    state.pendingCatalogFilter = { missingField: card.dataset.missingField };
    navigate("catalog");
  });
  // ── Adım 14 sonu ──────────────────────────────────────────────────────────
}

// ─── Chart.js CDN'den dinamik yükle ─────────────────────────────────────────
function loadChartJs() {
  if (chartJsReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    script.onload  = () => { chartJsReady = true; resolve(); };
    script.onerror = () => reject(new Error("Chart.js yüklenemedi"));
    document.head.appendChild(script);
  });
}

// ─── Halka grafik çiz ────────────────────────────────────────────────────────
function drawDonutChart(s) {
  const canvas = document.getElementById("status-chart");
  if (!canvas || typeof Chart === "undefined") return;

  // Tüm sıfırsa grafik çizme, boş alan kalsın.
  if (s.okunmadi === 0 && s.sirada === 0 && s.okunuyor === 0 && s.okundu === 0) return;

  activeChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Okunmadı", "Sırada", "Okunuyor", "Okundu"],
      datasets: [{
        data: [s.okunmadi, s.sirada, s.okunuyor, s.okundu],
        backgroundColor: [
          "rgba(92,95,114,0.85)",   // okunmadı — gri
          "rgba(224,168,74,0.85)",  // sırada   — sarı
          "rgba(124,106,247,0.85)", // okunuyor — mor (accent)
          "rgba(76,175,130,0.85)",  // okundu   — yeşil
        ],
        borderColor: "#1a1d24",   // --bg-2 rengi
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: "68%",
      plugins: {
        legend: { display: false },       // Özel renk göstergesi aşağıda
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
      animation: { duration: 500 },
    },
  });
}

// ─── Yardımcı: tek istatistik kartı HTML'i ──────────────────────────────────
function card(icon, label, value, variant = "neutral") {
  return `
    <div class="stat-card stat-card--${variant}">
      <div class="stat-card-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stat-card-value">${value}</div>
      <div class="stat-card-label">${label}</div>
    </div>
  `;
}