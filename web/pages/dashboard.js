// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD — Panel sayfası.
//
// Adım 5 (V5) yeniden yapılandırması:
//   KALDIRILDI: Koleksiyon sayaç kartları, Okuma Durumu halka grafiği +
//               ilerleme çubuğu, Çeşitlilik kartları, Dil dağılımı
//               → bunlar İstatistikler sayfasına (Adım 6-11) taşındı.
//
//   KALDI:      Şu An Okunuyor, Son Eklenenler, Eksik Bilgi Merkezi,
//               Tam Yedekleme, Veritabanı Bakımı
//
//   YENİ:       Rastgele Öneri — okunmadı/sırada kitaplardan 5 rastgele,
//               "Yenile" butonuyla değişir, tıklayınca modal açılır.
//
// Güncelleme (Adım 5 revizyon):
//   - Tüm bölümler dash-container (çerçeveli kutu) içinde — Grimmory tarzı
//   - Şu An Okunuyor: her zaman görünür, kitap yoksa grid boş kalır
//   - Son Eklenenler: her zaman görünür
//   - Tüm kapaklar büyük dikey kart boyutunda (öneri kartı ile aynı stil)
//   - Veritabanı Bakımı ve Yedekleme bölümleri renklendirme
//
// Bölüm Reconcile: Eşleştirme Yönetimi paneli eklendi.
//   - "Kütüphaneyi Tara" butonu ile tetiklenir (her yüklemede otomatik çalışmaz)
//   - Birebir eşleşmeler → checkbox'lı modal listesi + seçili grupları eşleştir
//   - Fuzzy (%90+) eşleşmeler → modal listesi (sadece inceleme, otomatik işlem yok)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { navigate } from "../core/router.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml, showToast } from "../ui/common.js";
import { findAndDeleteOrphans, findAndDeleteOrphanCovers } from "../core/api.js";
import { renderBackupSection, bindBackupSection } from "./dashboard-backup.js";
import {
  scanLibrary,
  bulkAutoMatch,
  createProgressToast,
  renderReconcilePanel,
  renderExactMatchModalContent,
  renderFuzzyMatchModalContent,
  clearReconcileCache,
} from "./dashboard-reconcile.js";

let _lastStatsKey = null;

// Tarama sonuçları — null ise henüz taranmadı
let _scanResult = null;

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

function compute() {
  const books = state.books;
  const reading = books.filter((b) => b.status === "okunuyor");
  const recent = [...books]
    .sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt))
    .slice(0, 12);
  const missingAuthor    = books.filter((b) => !b.author).length;
  const missingPublisher = books.filter((b) => !b.publisher).length;
  const missingCover     = books.filter((b) => !b.cover_url).length;
  const missingYear      = books.filter((b) => !b.year).length;
  const suggestPool = books.filter(
    (b) => b.status === "okunmadi" || b.status === "sirada"
  );
  return { reading, recent, missingAuthor, missingPublisher, missingCover, missingYear, suggestPool };
}

function pickRandom(pool, n = 6) {
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

// ─── Ortak büyük kapak kartı HTML'i ─────────────────────────────────────────
function bookCard(b, extraClass = "") {
  const cover = b.cover_url
    ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title || "")}" loading="lazy" />`
    : `<div class="dash-card-placeholder">${escapeHtml((b.title || "?")[0].toUpperCase())}</div>`;
  return `
    <div class="dash-card ${extraClass}" data-id="${b.$id}" title="${escapeHtml(b.title || "")}">
      <div class="dash-card-cover">${cover}</div>
      <div class="dash-card-info">
        <span class="dash-card-title">${escapeHtml(b.title || "Başlıksız")}</span>
        <span class="dash-card-author">${escapeHtml(b.author || "")}</span>
      </div>
    </div>
  `;
}

function renderLayout(s) {
  const container = document.getElementById("dashboard-content");
  if (!container) return;
  const suggestions = pickRandom(s.suggestPool);

  container.innerHTML = `
    <div class="dashboard-wrap">

    <!-- ── Şu An Okunuyor — her zaman görünür ── -->
    <div class="dash-container">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:book-open"></iconify-icon> Şu An Okunuyor
        </h2>
      </div>
      <div class="dash-book-grid" id="reading-grid">
        ${s.reading.length > 0
          ? s.reading.map((b) => bookCard(b)).join("")
          : `<p class="dash-empty">Şu an okunan kitap yok.</p>`}
      </div>
    </div>

    <!-- ── Rastgele Öneri ── -->
    ${s.suggestPool.length > 0 ? `
    <div class="dash-container">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:shuffle"></iconify-icon> Rastgele Öneri
          <span class="dash-container-sub">${s.suggestPool.length} kitap arasından</span>
        </h2>
        <button id="suggest-refresh-btn" class="btn btn-sm btn-primary" title="Yeni öneriler getir">
          <iconify-icon icon="lucide:refresh-cw"></iconify-icon>
          <span class="btn-label">Yenile</span>
        </button>
      </div>
      <div class="dash-book-grid" id="suggest-grid">
        ${suggestions.map((b) => bookCard(b, "suggest-item")).join("")}
      </div>
    </div>
    ` : ""}

    <!-- ── Son Eklenenler — her zaman görünür ── -->
    <div class="dash-container">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:clock"></iconify-icon> Son Eklenenler
        </h2>
      </div>
      <div class="dash-book-grid" id="recent-grid">
        ${s.recent.length > 0
          ? s.recent.map((b) => bookCard(b)).join("")
          : `<p class="dash-empty">Henüz kitap eklenmemiş.</p>`}
      </div>
    </div>

    <!-- ── Eksik Bilgi Merkezi ── -->
    ${renderMissingInfoSection(s)}

    <!-- ── Eşleştirme Yönetimi ── -->
    ${renderReconcilePanel(_scanResult)}

    <!-- ── Veritabanı Bakımı ── -->
    <div class="dash-container dash-container--maintenance">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:shield-check"></iconify-icon> Veritabanı Bakımı
        </h2>
      </div>
      <p class="dash-maintenance-desc">
        Bir kitap sildiğinde, o kitaba ait yazar/yayınevi/seri/koleksiyon
        artık başka hiçbir kitapta kullanılmıyorsa otomatik olarak silinir.
        Bu araç, her ihtimale karşı, veritabanında öyle bir kalıntı kalıp
        kalmadığını tarar ve varsa temizler.
      </p>
      <div class="dash-maintenance-actions">
        <button id="scan-orphans-btn" class="btn btn-sm btn-maintenance-orphan">
          <iconify-icon icon="lucide:shield-check"></iconify-icon>
          <span class="btn-label">Yetim Kayıtları Tara ve Temizle</span>
        </button>
        <button id="scan-orphan-covers-btn" class="btn btn-sm btn-maintenance-cover">
          <iconify-icon icon="lucide:image-off"></iconify-icon>
          <span class="btn-label">Fazla Kapakları Tara ve Temizle</span>
        </button>
      </div>
      <div id="orphan-scan-result"   class="dash-scan-result hidden"></div>
      <div id="orphan-covers-result" class="dash-scan-result hidden"></div>
    </div>

    <!-- ── Tam Yedekleme ── -->
    <div class="dash-container dash-container--backup">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:hard-drive-download"></iconify-icon> Tam Yedekleme
        </h2>
      </div>
      ${renderBackupSection()}
    </div>

    </div>

    <!-- ── Eşleştirme Modal Overlay'i ─────────────────────────────────────── -->
    <div id="reconcile-modal-overlay" class="reconcile-modal-overlay hidden">
      <div class="reconcile-modal">
        <div class="reconcile-modal-header">
          <h3 class="reconcile-modal-title" id="reconcile-modal-title"></h3>
          <button class="reconcile-modal-close" id="reconcile-modal-close" title="Kapat">
            <iconify-icon icon="lucide:x"></iconify-icon>
          </button>
        </div>
        <div class="reconcile-modal-body" id="reconcile-modal-body"></div>
        <div class="reconcile-modal-footer" id="reconcile-modal-footer"></div>
      </div>
    </div>
  `;
}

function renderMissingInfoSection(s) {
  const total = s.missingAuthor + s.missingPublisher + s.missingCover + s.missingYear;
  if (total === 0) return "";
  return `
    <div class="dash-container dash-container--warning">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:alert-circle"></iconify-icon> Eksik Bilgi Merkezi
        </h2>
      </div>
      <div class="stat-grid" id="missing-info-grid">
        ${missingCard("lucide:user-x",     "Yazar Eksik",    s.missingAuthor,    "author")}
        ${missingCard("lucide:building-2", "Yayınevi Eksik", s.missingPublisher, "publisher")}
        ${missingCard("lucide:image-off",  "Kapak Eksik",    s.missingCover,     "cover_url")}
        ${missingCard("lucide:calendar-x", "Yıl Eksik",      s.missingYear,      "year")}
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

// ─────────────────────────────────────────────────────────────────────────────
// MODAL YARDIMCILARI
// ─────────────────────────────────────────────────────────────────────────────
function _openReconcileModal(title, bodyHtml, footerHtml = "") {
  const overlay  = document.getElementById("reconcile-modal-overlay");
  const titleEl  = document.getElementById("reconcile-modal-title");
  const bodyEl   = document.getElementById("reconcile-modal-body");
  const footerEl = document.getElementById("reconcile-modal-footer");

  if (!overlay) return;
  if (titleEl)  titleEl.textContent = title;
  if (bodyEl)   bodyEl.innerHTML    = bodyHtml;
  if (footerEl) footerEl.innerHTML  = footerHtml;

  overlay.classList.remove("hidden");
}

function _closeReconcileModal() {
  const overlay = document.getElementById("reconcile-modal-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKBOX STATE YÖNETİMİ
//
// Modal içindeki checkbox'ları okuyarak hangi grupların seçili olduğunu
// döndürür. exactGroups dizisiyle key bazlı karşılaştırma yapar.
// ─────────────────────────────────────────────────────────────────────────────

// Seçili grup sayısını ve dosya sayısını hesapla, footer butonunu güncelle
function _updateExactModalFooter(exactGroups) {
  const checkboxes = document.querySelectorAll(".reconcile-group-checkbox");
  const checkedKeys = new Set();
  checkboxes.forEach((cb) => {
    if (cb.checked) checkedKeys.add(cb.dataset.groupKey);
  });

  const selectedGroups = exactGroups.filter((g) => checkedKeys.has(g.key));
  const selectedFiles  = selectedGroups.reduce((s, g) => s + g.books.length, 0);
  const total          = exactGroups.length;
  const selectedCount  = selectedGroups.length;

  // Footer butonunu güncelle
  const matchBtn = document.getElementById("reconcile-modal-match-btn");
  const summaryEl = document.getElementById("reconcile-modal-summary");

  if (summaryEl) {
    summaryEl.textContent = selectedCount === 0
      ? "Hiçbir grup seçilmedi"
      : `${selectedCount}/${total} grup seçili — ${selectedFiles} dosya eşleştirilecek`;
  }

  if (matchBtn) {
    matchBtn.disabled = selectedCount === 0;
    matchBtn.innerHTML = `
      <iconify-icon icon="lucide:wand-2"></iconify-icon>
      <span>Seçilileri Eşleştir (${selectedCount} grup)</span>
    `;
    // Seçim yoksa buton soluk görünsün
    matchBtn.style.opacity = selectedCount === 0 ? "0.45" : "";
  }

  return selectedGroups;
}

// "Tümünü seç / kaldır" checkbox mantığı
function _bindSelectAll(exactGroups) {
  const selectAllCb = document.getElementById("reconcile-select-all");
  if (!selectAllCb) return;

  selectAllCb.addEventListener("change", () => {
    const checkboxes = document.querySelectorAll(".reconcile-group-checkbox");
    checkboxes.forEach((cb) => { cb.checked = selectAllCb.checked; });
    _updateExactModalFooter(exactGroups);
  });
}

// Grup checkbox'larının tıklanmasını dinle; "Tümünü seç" checkbox'ını senkronla
function _bindGroupCheckboxes(exactGroups) {
  const body = document.getElementById("reconcile-modal-body");
  if (!body) return;

  body.addEventListener("change", (e) => {
    if (!e.target.classList.contains("reconcile-group-checkbox")) return;

    // "Tümünü seç" checkbox durumunu senkronla
    const allCbs     = document.querySelectorAll(".reconcile-group-checkbox");
    const allChecked = [...allCbs].every((cb) => cb.checked);
    const someChecked = [...allCbs].some((cb) => cb.checked);
    const selectAllCb = document.getElementById("reconcile-select-all");
    if (selectAllCb) {
      selectAllCb.checked       = allChecked;
      selectAllCb.indeterminate = !allChecked && someChecked;
    }

    _updateExactModalFooter(exactGroups);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EŞLEŞTİRME PANELİNİ GÜNCELLEYEREK YENİDEN ÇİZ
// ─────────────────────────────────────────────────────────────────────────────
function _refreshReconcilePanel() {
  const oldPanel = document.getElementById("reconcile-panel");
  if (!oldPanel) return;

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = renderReconcilePanel(_scanResult);
  const newPanel = tempDiv.firstElementChild;
  if (newPanel) {
    oldPanel.replaceWith(newPanel);
    _bindReconcileEvents();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EŞLEŞTİRME EVENT'LERİ
// ─────────────────────────────────────────────────────────────────────────────
function _bindReconcileEvents() {
  // ── "Kütüphaneyi Tara" / "Yeniden Tara" butonu ──────────────────────────
  const scanBtn = document.getElementById("reconcile-scan-btn");
  scanBtn?.addEventListener("click", () => {
    const isRescan = !!_scanResult;
    scanBtn.disabled = true;
    scanBtn.innerHTML = `<iconify-icon icon="lucide:loader-2" style="animation:spin 1s linear infinite"></iconify-icon> <span>Taranıyor...</span>`;

    setTimeout(() => {
      try {
        _scanResult = scanLibrary(isRescan);
        _refreshReconcilePanel();
        showToast(
          _scanResult.fromCache
            ? "Önceki tarama sonuçları yüklendi."
            : "Tarama tamamlandı.",
          "success"
        );
      } catch (err) {
        console.error("[Reconcile] Tarama hatası:", err);
        showToast("Tarama sırasında hata oluştu.", "error");
        if (scanBtn) {
          scanBtn.disabled = false;
          scanBtn.innerHTML = `<iconify-icon icon="lucide:scan-search"></iconify-icon> <span>Kütüphaneyi Tara</span>`;
        }
      }
    }, 50);
  });

  // ── Birebir eşleşmeleri listele (checkbox'lı modal) ─────────────────────
  document.getElementById("reconcile-exact-view-btn")?.addEventListener("click", () => {
    if (!_scanResult) return;
    const { exact } = _scanResult;
    const totalFiles = exact.reduce((s, g) => s + g.books.length, 0);

    // Footer: özet metni + eşleştir butonu
    const footerHtml = `
      <div class="reconcile-modal-footer-inner">
        <span id="reconcile-modal-summary" class="reconcile-modal-summary">
          ${exact.length}/${exact.length} grup seçili — ${totalFiles} dosya eşleştirilecek
        </span>
        <button id="reconcile-modal-match-btn" class="btn btn-sm btn-reconcile-match">
          <iconify-icon icon="lucide:wand-2"></iconify-icon>
          <span>Seçilileri Eşleştir (${exact.length} grup)</span>
        </button>
      </div>
    `;

    _openReconcileModal(
      `Birebir Eşleşmeler — ${exact.length} grup, ${totalFiles} dosya`,
      renderExactMatchModalContent(exact),
      footerHtml
    );

    // Checkbox event'lerini bağla
    _bindSelectAll(exact);
    _bindGroupCheckboxes(exact);

    // Footer "Seçilileri Eşleştir" butonuna tıklama
    document.getElementById("reconcile-modal-match-btn")?.addEventListener("click", () => {
      // Hangi gruplar seçili?
      const checkboxes = document.querySelectorAll(".reconcile-group-checkbox");
      const checkedKeys = new Set();
      checkboxes.forEach((cb) => { if (cb.checked) checkedKeys.add(cb.dataset.groupKey); });
      const selectedGroups = exact.filter((g) => checkedKeys.has(g.key));

      if (selectedGroups.length === 0) {
        showToast("Hiçbir grup seçilmedi.", "warning");
        return;
      }

      _closeReconcileModal();
      _startBulkMatch(selectedGroups);
    });
  });

  // ── Paneldeki direkt "Hepsini Eşleştir" (modal açmadan) ─────────────────
  document.getElementById("reconcile-exact-match-btn")?.addEventListener("click", () => {
    if (!_scanResult) return;
    _startBulkMatch(_scanResult.exact);
  });

  // ── Fuzzy eşleşmeleri listele ───────────────────────────────────────────
  document.getElementById("reconcile-fuzzy-view-btn")?.addEventListener("click", () => {
    if (!_scanResult) return;
    const { fuzzy } = _scanResult;
    _openReconcileModal(
      `Yakın Benzerlikler — ${fuzzy.length} çift`,
      renderFuzzyMatchModalContent(fuzzy)
    );
  });

  // ── Modal kapat ─────────────────────────────────────────────────────────
  document.getElementById("reconcile-modal-close")?.addEventListener("click", _closeReconcileModal);
  document.getElementById("reconcile-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "reconcile-modal-overlay") _closeReconcileModal();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPLU EŞLEŞTİRMEYİ BAŞLAT
// Sadece seçili grupları işler. Panel butonu veya modal butonu üzerinden gelir.
// ─────────────────────────────────────────────────────────────────────────────
async function _startBulkMatch(groupsToMatch) {
  if (!groupsToMatch || groupsToMatch.length === 0) {
    showToast("Eşleştirilecek grup bulunamadı.", "warning");
    return;
  }

  const panelMatchBtn = document.getElementById("reconcile-exact-match-btn");
  if (panelMatchBtn) panelMatchBtn.disabled = true;

  const progress = createProgressToast(`Eşleştirme başlıyor... (0/${groupsToMatch.length})`);

  try {
    const { groupCount, fileCount } = await bulkAutoMatch(
      groupsToMatch,
      (current, total) => {
        progress.update(`${current}/${total} grup eşleştirildi...`);
      }
    );

    progress.dismiss();
    showToast(`${groupCount} grup (${fileCount} dosya) başarıyla eşleştirildi.`, "success");

    // State değişti — tarama sonucunu sıfırla
    _scanResult = null;
    clearReconcileCache();
    _refreshReconcilePanel();

  } catch (err) {
    progress.dismiss();
    console.error("[Reconcile] Toplu eşleştirme hatası:", err);
    showToast("Eşleştirme sırasında hata oluştu.", "error");
    if (panelMatchBtn) panelMatchBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TÜM EVENT BAĞLAMA
// ─────────────────────────────────────────────────────────────────────────────
function bindClicks() {
  // Şu an okunuyor
  document.getElementById("reading-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".dash-card");
    if (card?.dataset.id) openModal(card.dataset.id);
  });

  // Son eklenenler
  document.getElementById("recent-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".dash-card");
    if (card?.dataset.id) openModal(card.dataset.id);
  });

  // Rastgele öneri — kart tıklama
  document.getElementById("suggest-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".dash-card");
    if (card?.dataset.id) openModal(card.dataset.id);
  });

  // Rastgele öneri — Yenile butonu
  document.getElementById("suggest-refresh-btn")?.addEventListener("click", () => {
    const pool = state.books.filter(
      (b) => b.status === "okunmadi" || b.status === "sirada"
    );
    const grid = document.getElementById("suggest-grid");
    if (!grid) return;
    grid.innerHTML = pickRandom(pool).map((b) => bookCard(b, "suggest-item")).join("");
  });

  // Eksik Bilgi Merkezi
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

  // Eşleştirme Yönetimi
  _bindReconcileEvents();

  // Tam Yedekleme
  bindBackupSection();

  // Yetim Kayıt Tarayıcı
  const scanBtn = document.getElementById("scan-orphans-btn");
  scanBtn?.addEventListener("click", async () => {
    scanBtn.disabled = true;
    const resultBox = document.getElementById("orphan-scan-result");
    if (resultBox) { resultBox.classList.remove("hidden"); resultBox.textContent = "Taranıyor..."; }
    try {
      const removed = await findAndDeleteOrphans();
      const totalRemoved = removed.authors.length + removed.publishers.length +
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
    } finally { scanBtn.disabled = false; }
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
    } finally { scanCoversBtn.disabled = false; }
  });
}