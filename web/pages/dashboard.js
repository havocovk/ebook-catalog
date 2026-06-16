// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD — Panel sayfası.
//
// 4A: İstatistik kartları.
//   • Kitap kartları   : Toplam, EPUB, PDF
//   • Okuma kartları   : Okunmadı, Sırada, Okunuyor, Okundu
//   • Koleksiyon kartları: Yazar, Yayınevi, Seri
//   • Dil kartları     : Türkçe, İngilizce, Diğer
//
// Tüm veriler state.books'tan anlık hesaplanır — ek Appwrite çağrısı yapılmaz.
// router her Panel ziyaretinde renderDashboard()'ı çağırır; böylece katalogda
// yeni ekleme/silme yapılırsa panel de güncel kalır.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderDashboard() {
  const stats = compute();
  renderStatCards(stats);
}

// ─── Tüm istatistikleri hesapla ─────────────────────────────────────────────
function compute() {
  const books = state.books;
  const total = books.length;

  // Format
  const epub = books.filter((b) => b.format === "epub").length;
  const pdf  = books.filter((b) => b.format === "pdf").length;

  // Okuma durumu
  const okunmadi = books.filter((b) => b.status === "okunmadi").length;
  const sirada   = books.filter((b) => b.status === "sirada").length;
  const okunuyor = books.filter((b) => b.status === "okunuyor").length;
  const okundu   = books.filter((b) => b.status === "okundu").length;

  // Benzersiz koleksiyonlar
  const authorCount    = new Set(books.map((b) => b.author).filter(Boolean)).size;
  const publisherCount = new Set(books.map((b) => b.publisher).filter(Boolean)).size;
  const seriesCount    = new Set(books.map((b) => b.series).filter(Boolean)).size;

  // Dil dağılımı
  const langTr    = books.filter((b) => b.language === "tr").length;
  const langEn    = books.filter((b) => b.language === "en").length;
  const langOther = books.filter(
    (b) => b.language && b.language !== "tr" && b.language !== "en"
  ).length;

  return {
    total, epub, pdf,
    okunmadi, sirada, okunuyor, okundu,
    authorCount, publisherCount, seriesCount,
    langTr, langEn, langOther,
  };
}

// ─── Kartları çiz ───────────────────────────────────────────────────────────
function renderStatCards(s) {
  const container = document.getElementById("dashboard-content");
  if (!container) return;

  // Okunma yüzdesi (gösterge çubuğu için)
  const readPct = s.total > 0 ? Math.round((s.okundu / s.total) * 100) : 0;

  container.innerHTML = `

    <!-- ── Kitap Sayıları ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:library"></iconify-icon> Koleksiyon
      </h2>
      <div class="stat-grid">
        ${card("lucide:book-copy",      "Toplam Kitap",  s.total,          "accent")}
        ${card("lucide:file-text",      "EPUB",          s.epub,           "neutral")}
        ${card("lucide:file-type-2",    "PDF",           s.pdf,            "neutral")}
      </div>
    </div>

    <!-- ── Okuma Durumu ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:bookmark"></iconify-icon> Okuma Durumu
      </h2>

      <!-- Genel ilerleme çubuğu -->
      <div class="progress-bar-wrap">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${readPct}%"></div>
        </div>
        <span class="progress-bar-label">${s.okundu} / ${s.total} kitap okundu — %${readPct}</span>
      </div>

      <div class="stat-grid">
        ${card("lucide:circle",              "Okunmadı",  s.okunmadi, "neutral")}
        ${card("lucide:clock",               "Sırada",    s.sirada,   "warning")}
        ${card("lucide:book-open",           "Okunuyor",  s.okunuyor, "accent")}
        ${card("lucide:check-circle",        "Okundu",    s.okundu,   "success")}
      </div>
    </div>

    <!-- ── Koleksiyon Çeşitliliği ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:layers"></iconify-icon> Çeşitlilik
      </h2>
      <div class="stat-grid">
        ${card("lucide:user",        "Yazar",      s.authorCount,    "neutral")}
        ${card("lucide:building-2",  "Yayınevi",   s.publisherCount, "neutral")}
        ${card("lucide:layers",      "Seri",       s.seriesCount,    "neutral")}
      </div>
    </div>

    <!-- ── Dil Dağılımı ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:languages"></iconify-icon> Dil
      </h2>
      <div class="stat-grid">
        ${card("lucide:flag",   "Türkçe",    s.langTr,    "neutral")}
        ${card("lucide:globe",  "İngilizce", s.langEn,    "neutral")}
        ${card("lucide:globe-2","Diğer",     s.langOther, "neutral")}
      </div>
    </div>

  `;
}

// ─── Tek istatistik kartı HTML'i üret ───────────────────────────────────────
// icon    : Lucide ikon adı
// label   : Kartın alt yazısı
// value   : Gösterilecek sayı
// variant : "accent" | "success" | "warning" | "neutral"
function card(icon, label, value, variant = "neutral") {
  return `
    <div class="stat-card stat-card--${variant}">
      <div class="stat-card-icon">
        <iconify-icon icon="${icon}"></iconify-icon>
      </div>
      <div class="stat-card-value">${value}</div>
      <div class="stat-card-label">${label}</div>
    </div>
  `;
}