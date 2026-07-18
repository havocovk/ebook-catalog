// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD — Panel sayfası.
//
// Adım 5 (V5) yeniden yapılandırması:
//   KALDIRILDI: Koleksiyon sayaç kartları, Okuma Durumu halka grafiği +
//               ilerleme çubuğu, Çeşitlilik kartları, Dil dağılımı
//               → bunlar İstatistikler sayfasına (Adım 6-11) taşındı.
//
//   KALDI:      Şu An Okunuyor, Son Eklenenler, Eksik Bilgi Merkezi,
//               Tam Yedekleme
//
//   YENİ:       Rastgele Öneri — okunmadı/sırada kitaplardan 5 rastgele,
//               "Yenile" butonuyla değişir, tıklayınca modal açılır.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { navigate } from "../core/router.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml, showToast } from "../ui/common.js";
import { findAndDeleteOrphans, findAndDeleteOrphanCovers } from "../core/api.js";
import { renderBackupSection, bindBackupSection } from "./dashboard-backup.js";

// ── Adım J9: Yeniden çizim önleme ───────────────────────────────────────────
let _lastStatsKey = null;

function _statsKey(stats) {
  return JSON.stringify({
    readingIds:       stats.reading.map((b) => b.$id),
    recentIds:        stats.recent.map((b) => b.$id),
    missingAuthor:    stats.missingAuthor,
    missingPublisher: stats.missingPublisher,
    missingCover:     stats.missingCover,
    missingYear:      stats.missingYear,
    suggestPool:      stats.suggestPool.length,
  });
}
// ── Adım J9 sonu ─────────────────────────────────────────────────────────────

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export async function renderDashboard() {
  const stats = compute();

  const key = _statsKey(stats);
  if (key === _lastStatsKey && document.getElementById("dashboard-content")?.hasChildNodes()) {
    bindClicks();
    return;
  }
  _lastStatsKey = key;

  renderLayout(stats);
  bindClicks();
}

// ─── İstatistikleri hesapla ──────────────────────────────────────────────────
function compute() {
  const books = state.books;

  // Şu an okunan kitaplar
  const reading = books.filter((b) => b.status === "okunuyor");

  // Son eklenen 10 kitap
  const recent = [...books]
    .sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt))
    .slice(0, 10);

  // Eksik bilgi
  const missingAuthor    = books.filter((b) => !b.author).length;
  const missingPublisher = books.filter((b) => !b.publisher).length;
  const missingCover     = books.filter((b) => !b.cover_url).length;
  const missingYear      = books.filter((b) => !b.year).length;

  // Rastgele öneri havuzu: okunmadı veya sırada
  const suggestPool = books.filter(
    (b) => b.status === "okunmadi" || b.status === "sirada"
  );

  return { reading, recent, missingAuthor, missingPublisher, missingCover, missingYear, suggestPool };
}

// ─── 5 rastgele kitap seç ────────────────────────────────────────────────────
function pickRandom(pool, n = 5) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// ─── Tüm sayfayı çiz ────────────────────────────────────────────────────────
function renderLayout(s) {
  const container = document.getElementById("dashboard-content");
  if (!container) return;

  const suggestions = pickRandom(s.suggestPool);

  container.innerHTML = `

    <!-- ── Şu An Okunuyor ── -->
    ${s.reading.length > 0 ? renderReadingSection(s.reading) : ""}

    <!-- ── Rastgele Öneri ── -->
    ${renderSuggestSection(suggestions, s.suggestPool.length)}

    <!-- ── Son Eklenenler ── -->
    ${s.recent.length > 0 ? renderRecentSection(s.recent) : ""}

    <!-- ── Eksik Bilgi Merkezi ── -->
    ${renderMissingInfoSection(s)}

    <!-- ── Veritabanı Bakımı ── -->
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:shield-check"></iconify-icon> Veritabanı Bakımı
      </h2>
      <div class="db-maintenance-box">
        <p class="db-maintenance-desc">
          Bir kitap sildiğinde, o kitaba ait yazar/yayınevi/seri/koleksiyon
          artık başka hiçbir kitapta kullanılmıyorsa otomatik olarak silinir.
          Bu araç, her ihtimale karşı, veritabanında öyle bir kalıntı kalıp
          kalmadığını tarar ve varsa temizler.
        </p>
        <div class="db-maintenance-actions">
          <button id="scan-orphans-btn" class="btn btn-sm">
            <iconify-icon icon="lucide:shield-check"></iconify-icon>
            <span class="btn-label">Yetim Kayıtları Tara ve Temizle</span>
          </button>
          <button id="scan-orphan-covers-btn" class="btn btn-sm">
            <iconify-icon icon="lucide:image-off"></iconify-icon>
            <span class="btn-label">Fazla Kapakları Tara ve Temizle</span>
          </button>
        </div>
        <div id="orphan-scan-result" class="orphan-scan-result hidden"></div>
        <div id="orphan-covers-result" class="orphan-scan-result hidden"></div>
      </div>
    </div>

    <!-- ── Tam Yedekleme ── -->
    ${renderBackupSection()}

  `;
}

// ─── Rastgele Öneri bölümü ───────────────────────────────────────────────────
function renderSuggestSection(suggestions, poolSize) {
  if (poolSize === 0) return "";

  const items = suggestions.map((b) => `
    <div class="suggest-item" data-id="${b.$id}" title="${escapeHtml(b.title || "")}">
      <div class="suggest-cover">
        ${b.cover_url
          ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title || "")}" loading="lazy" />`
          : `<div class="suggest-placeholder">${escapeHtml((b.title || "?")[0].toUpperCase())}</div>`}
        <span class="suggest-status suggest-status--${b.status || "okunmadi"}">
          ${b.status === "sirada" ? "Sırada" : "Okunmadı"}
        </span>
      </div>
      <div class="suggest-info">
        <span class="suggest-title">${escapeHtml(b.title || "Başlıksız")}</span>
        <span class="suggest-author">${escapeHtml(b.author || "")}</span>
      </div>
    </div>
  `).join("");

  return `
    <div class="dash-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">
          <iconify-icon icon="lucide:shuffle"></iconify-icon> Rastgele Öneri
          <span class="dash-section-sub">${poolSize} kitap arasından</span>
        </h2>
        <button id="suggest-refresh-btn" class="btn btn-sm" title="Yeni öneriler getir">
          <iconify-icon icon="lucide:refresh-cw"></iconify-icon>
          <span class="btn-label">Yenile</span>
        </button>
      </div>
      <div class="suggest-grid" id="suggest-grid">${items}</div>
    </div>
  `;
}

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

// ─── "Eksik Bilgi Merkezi" bölümü ────────────────────────────────────────────
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

function missingCard(icon, label, value, field) {
  return `
    <div class="stat-card stat-card--missing" data-missing-field="${field}" role="button" tabindex="0">
      <div class="stat-card-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
      <div class="stat-card-value">${value}</div>
      <div class="stat-card-label">${label}</div>
    </div>
  `;
}

// ─── Tüm tıklama olaylarını bağla ────────────────────────────────────────────
function bindClicks() {
  // Şu an okunuyor
  document.getElementById("reading-cards")?.addEventListener("click", (e) => {
    const card = e.target.closest(".reading-card");
    if (card?.dataset.id) openModal(card.dataset.id);
  });

  // Son eklenenler
  document.getElementById("recent-strip")?.addEventListener("click", (e) => {
    const item = e.target.closest(".recent-item");
    if (item?.dataset.id) openModal(item.dataset.id);
  });

  // Rastgele öneri — kart tıklama
  document.getElementById("suggest-grid")?.addEventListener("click", (e) => {
    const item = e.target.closest(".suggest-item");
    if (item?.dataset.id) openModal(item.dataset.id);
  });

  // Rastgele öneri — Yenile butonu
  document.getElementById("suggest-refresh-btn")?.addEventListener("click", () => {
    const pool = state.books.filter(
      (b) => b.status === "okunmadi" || b.status === "sirada"
    );
    const suggestions = pickRandom(pool);
    const grid = document.getElementById("suggest-grid");
    if (!grid) return;
    grid.innerHTML = suggestions.map((b) => `
      <div class="suggest-item" data-id="${b.$id}" title="${escapeHtml(b.title || "")}">
        <div class="suggest-cover">
          ${b.cover_url
            ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title || "")}" loading="lazy" />`
            : `<div class="suggest-placeholder">${escapeHtml((b.title || "?")[0].toUpperCase())}</div>`}
          <span class="suggest-status suggest-status--${b.status || "okunmadi"}">
            ${b.status === "sirada" ? "Sırada" : "Okunmadı"}
          </span>
        </div>
        <div class="suggest-info">
          <span class="suggest-title">${escapeHtml(b.title || "Başlıksız")}</span>
          <span class="suggest-author">${escapeHtml(b.author || "")}</span>
        </div>
      </div>
    `).join("");
  });

  // Eksik Bilgi Merkezi kartları
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

  // Tam Yedekleme butonları
  bindBackupSection();

  // Yetim Kayıt Tarayıcı
  const scanBtn = document.getElementById("scan-orphans-btn");
  scanBtn?.addEventListener("click", async () => {
    scanBtn.disabled = true;
    const resultBox = document.getElementById("orphan-scan-result");
    if (resultBox) { resultBox.classList.remove("hidden"); resultBox.textContent = "Taranıyor..."; }
    try {
      const removed = await findAndDeleteOrphans();
      const totalRemoved =
        removed.authors.length + removed.publishers.length +
        removed.series.length + removed.collections.length;
      if (totalRemoved === 0) {
        showToast("Veritabanı temiz — yetim kayıt bulunamadı.");
        if (resultBox) resultBox.textContent = "Yetim kayıt bulunamadı. Veritabanı temiz. ✓";
      } else {
        const parts = [];
        if (removed.authors.length)     parts.push(`${removed.authors.length} yazar`);
        if (removed.publishers.length)  parts.push(`${removed.publishers.length} yayınevi`);
        if (removed.series.length)      parts.push(`${removed.series.length} seri`);
        if (removed.collections.length) parts.push(`${removed.collections.length} koleksiyon`);
        showToast(`Temizlendi: ${parts.join(", ")}.`);
        if (resultBox) resultBox.textContent = `Temizlenen: ${parts.join(", ")}.`;
      }
    } catch (err) {
      showToast("Tarama sırasında hata oluştu: " + (err?.message || err), "error");
      if (resultBox) resultBox.textContent = "Tarama başarısız oldu.";
    } finally {
      scanBtn.disabled = false;
    }
  });

  // Fazla Kapak Tarayıcı
  const scanCoversBtn = document.getElementById("scan-orphan-covers-btn");
  scanCoversBtn?.addEventListener("click", async () => {
    scanCoversBtn.disabled = true;
    const resultBox = document.getElementById("orphan-covers-result");
    if (resultBox) { resultBox.classList.remove("hidden"); resultBox.textContent = "Taranıyor..."; }
    try {
      const { total, used, deleted } = await findAndDeleteOrphanCovers();
      if (deleted.length === 0) {
        showToast("Kapak deposu temiz — fazla dosya bulunamadı.");
        if (resultBox) resultBox.textContent = `Kapak deposu temiz. Toplam: ${total}, Kullanılan: ${used}. ✓`;
      } else {
        showToast(`${deleted.length} fazla kapak dosyası silindi.`);
        if (resultBox) resultBox.textContent = `Silinen: ${deleted.length} dosya. Toplam: ${total}, Kullanılan: ${used}.`;
      }
    } catch (err) {
      showToast("Tarama sırasında hata oluştu: " + (err?.message || err), "error");
      if (resultBox) resultBox.textContent = "Tarama başarısız oldu.";
    } finally {
      scanCoversBtn.disabled = false;
    }
  });
}