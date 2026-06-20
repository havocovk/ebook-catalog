// ─────────────────────────────────────────────────────────────────────────────
// DEDUPE — Kitap Ayıklayıcı sayfası.
//
// Bu sayfa, veritabanında "aynı yazar + aynı kitap adı" olan ama farklı
// yayınevinden eklenmiş kitapları bulmaya yarar. Kullanıcı bu kitapları
// karşılaştırıp gerçekten aynı mı diye karar verir.
//
// EŞLEŞTİRME KURALI:
//   Yazar ve Kitap Adı karşılaştırılırken büyük/küçük harf farkı ve
//   baştaki/sondaki boşluklar yok sayılır. Örn: "Tolkien " ile "tolkien"
//   aynı yazar sayılır.
//
// GRUPLAMA:
//   Aynı yazar + aynı kitap adına sahip 2 veya daha fazla kitap varsa,
//   hepsi TEK bir grupta birlikte gösterilir (3, 4... kaç tane olursa olsun).
//
// TARAMA ZAMANI:
//   "Aynı Kitapları Bul" butonuna her basıldığında state.books yeniden
//   taranır — yani en güncel veriye göre sonuç üretilir.
//
// SİLME:
//   Bu sayfada ayrı bir "sil" butonu YOK. Kart tıklanınca proje genelinde
//   zaten var olan kitap detay modalı açılır; modaldaki "Sil" butonuyla
//   kayıt veritabanından silinir (aynı katalog/seriler sayfalarındaki gibi).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";

// ─── Karşılaştırma için anahtar üret: küçük harfe çevir + baş/son boşluğu sil ─
function normalizeKey(str) {
  return (str || "").trim().toLowerCase();
}

// ─── Dışa açık: sayfa her açıldığında çağrılır ──────────────────────────────
export function renderDedupe() {
  const container = document.getElementById("dedupe-content");
  if (!container) return;

  container.innerHTML = `
    <div class="dedupe-intro">
      <iconify-icon icon="lucide:copy-x" class="dedupe-intro-icon"></iconify-icon>
      <h2 class="dedupe-intro-title">Kitap Ayıklayıcı</h2>
      <p class="dedupe-intro-text">
        Bu sayfa kullanıcının isteğine bağlı olarak veritabanındaki birbirinin
        aynısı olan kitapları bulmak için tasarlanmıştır.
      </p>
      <button id="dedupe-scan-btn" class="btn btn-primary">
        <iconify-icon icon="lucide:search"></iconify-icon>
        Aynı Kitapları Bul
      </button>
    </div>
    <div id="dedupe-results"></div>
  `;
}

// ─── Veritabanını tara, "yazar+kitap adı+format" eşleşen grupları üret ──────
// Format da anahtara dahildir: bir kitabın PDF + EPUB sürümünü kasıtlı olarak
// saklamak normaldir, bu yüzden farklı formatlar "tekrar" sayılmaz.
// Sadece aynı yazar + aynı kitap adı + AYNI format (örn. PDF+PDF, EPUB+EPUB)
// olan kayıtlar bir grupta toplanır.
//
// Dönüş: [{ key, author, title, format, books: [book, book, ...] }, ...]
// Sadece 2 veya daha fazla kitabı olan gruplar döner (tek başına olanlar atlanır).
function findDuplicateGroups() {
  const map = {};

  for (const book of state.books) {
    const authorKey = normalizeKey(book.author);
    const titleKey  = normalizeKey(book.title);
    const formatKey = normalizeKey(book.format);

    // Yazar, başlık veya format boşsa güvenilir bir eşleştirme yapılamaz — atla.
    if (!authorKey || !titleKey || !formatKey) continue;

    const key = `${authorKey}|||${titleKey}|||${formatKey}`;

    if (!map[key]) {
      map[key] = {
        key,
        author: book.author,   // Gösterim için orijinal (normalize edilmemiş) yazı
        title:  book.title,
        format: book.format,
        books:  [],
      };
    }
    map[key].books.push(book);
  }

  // Sadece 2+ kitabı olan gruplar "tekrar" sayılır.
  return Object.values(map).filter((g) => g.books.length >= 2);
}

// ─── Tarama sonucunu ekrana çiz ──────────────────────────────────────────────
function runScanAndRender() {
  const resultsEl = document.getElementById("dedupe-results");
  if (!resultsEl) return;

  const groups = findDuplicateGroups();

  if (groups.length === 0) {
    resultsEl.innerHTML = `
      <div class="empty-page-state">
        <iconify-icon icon="lucide:check-circle-2"></iconify-icon>
        <p>Tekrarlanan kitap bulunamadı.</p>
        <p class="empty-page-hint">
          Aynı yazara ait, aynı isimli birden fazla kitap kaydı şu an veritabanında yok.
        </p>
      </div>`;
    return;
  }

  // Gruplari yazar adına göre alfabetik sırala (kullanıcı kolay tarasın).
  const sortedGroups = [...groups].sort((a, b) =>
    (a.author || "").localeCompare(b.author || "", "tr", { sensitivity: "base" })
  );

  resultsEl.innerHTML = `
    <div class="dedupe-summary">
      <iconify-icon icon="lucide:alert-triangle"></iconify-icon>
      <span>${sortedGroups.length} olası tekrar grubu bulundu.</span>
    </div>
    <div class="dedupe-group-list" id="dedupe-group-list"></div>
  `;

  const listEl = document.getElementById("dedupe-group-list");

  sortedGroups.forEach((group) => {
    const groupBox = document.createElement("div");
    groupBox.className = "dedupe-group-box";

    const header = document.createElement("div");
    header.className = "dedupe-group-header";
    header.innerHTML = `
      <span class="dedupe-group-title">${escapeHtml(group.title || "Başlıksız")}</span>
      <span class="dedupe-group-author">${escapeHtml(group.author || "")}</span>
      <span class="dedupe-group-format-badge">${escapeHtml((group.format || "").toUpperCase())}</span>
      <span class="dedupe-group-count">${group.books.length} kayıt</span>
    `;
    groupBox.appendChild(header);

    const cardsRow = document.createElement("div");
    cardsRow.className = "dedupe-group-cards";
    group.books.forEach((book) => {
      cardsRow.appendChild(createBookCard(book));
    });
    groupBox.appendChild(cardsRow);

    listEl.appendChild(groupBox);
  });
}

// ─── Dışa açık: olayları bir kez bağlamak için ──────────────────────────────
export function initDedupe() {
  document.getElementById("dedupe-content")?.addEventListener("click", (e) => {
    // Tara butonu
    if (e.target.closest("#dedupe-scan-btn")) {
      runScanAndRender();
      return;
    }

    // Bir kitap kartına tıklanırsa → mevcut kitap detay modalını aç.
    // (Modal içindeki "Sil" butonu zaten kaydı veritabanından siler.)
    const card = e.target.closest(".book-card");
    if (card?.dataset.id) {
      openModal(card.dataset.id);
      return;
    }
  });
}

// ─── Yardımcı: basit HTML kaçışı (XSS önleme) ───────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}