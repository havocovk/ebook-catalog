// ─────────────────────────────────────────────────────────────────────────────
// PUBLISHERS — Yayınevleri sayfası.
//
// 6A: Alfabetik yayınevi listesi + A–Z harf çubuğu.
// 6B: Yayınevi detay görünümü — seriler + bağımsız kitaplar.
//
// Yazarlar sayfasıyla aynı mimari: liste / detay alt-görünüm, router'a ekstra
// rota eklenmez. Aktif yayınevi yerel state'te tutulur.
//
// NOT: publisher alanı 1A'dan itibaren dolmaya başladı. Alanı boş olan kitaplar
// bu sayfada görünmez — bu beklenen davranış.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";

const ALPHABET = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ".split("");

// Şu an detayda gösterilen yayınevi adı. Liste görünümünde null.
let activePublisher = null;

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderPublishers() {
  if (activePublisher) {
    renderPublisherDetail(activePublisher);
  } else {
    renderPublisherList();
  }
}

// ═══════════════════════════════════════════════════════════════
// YAYINEVİ LİSTESİ
// ═══════════════════════════════════════════════════════════════

function renderPublisherList() {
  const grouped   = groupByLetter();
  const activeLetters = new Set(Object.keys(grouped));
  const container = document.getElementById("publishers-content");
  if (!container) return;

  const totalPublishers = Object.values(grouped).flat().length;

  // Hiç yayınevi verisi yoksa özel mesaj göster.
  if (totalPublishers === 0) {
    container.innerHTML = `
      <div class="empty-page-state">
        <iconify-icon icon="lucide:building-2"></iconify-icon>
        <p>Henüz yayınevi bilgisi olan kitap yok.</p>
        <p class="empty-page-hint">Kitapları yeniden tararken Google Books'tan yayınevi bilgisi çekilecektir.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${renderAlphaBar(activeLetters)}
    <div class="publisher-list" id="publisher-list">
      ${renderGroups(grouped)}
    </div>
  `;
}

// ─── Yayınevlerini ilk harfe göre grupla ────────────────────────────────────
function groupByLetter() {
  const countMap = {};
  for (const book of state.books) {
    const name = (book.publisher || "").trim();
    if (!name) continue;
    countMap[name] = (countMap[name] || 0) + 1;
  }

  const grouped = {};
  for (const [name, count] of Object.entries(countMap)) {
    const firstChar = name.charAt(0).toLocaleUpperCase("tr-TR");
    const letter    = ALPHABET.includes(firstChar) ? firstChar : "#";
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push({ name, count });
  }

  for (const letter of Object.keys(grouped)) {
    grouped[letter].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }
  return grouped;
}

// ─── Harf çubuğu ─────────────────────────────────────────────────────────────
function renderAlphaBar(activeLetters) {
  const buttons = ALPHABET.map((letter) => {
    const active = activeLetters.has(letter);
    return `<button
      class="alpha-btn ${active ? "" : "alpha-btn--empty"}"
      ${active ? `data-letter="${letter}"` : "disabled"}
      title="${letter}"
    >${letter}</button>`;
  }).join("");
  return `<div class="alpha-bar" id="alpha-bar">${buttons}</div>`;
}

// ─── Harf grupları ────────────────────────────────────────────────────────────
function renderGroups(grouped) {
  const sortedLetters = ALPHABET.filter((l) => grouped[l]);
  if (grouped["#"]) sortedLetters.push("#");

  return sortedLetters.map((letter) => {
    const publishers = grouped[letter];
    const rows = publishers.map((p) => `
      <div class="author-row" data-publisher="${escAttr(p.name)}">
        <span class="author-name">${esc(p.name)}</span>
        <span class="author-count">${p.count} kitap</span>
        <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
      </div>
    `).join("");

    return `
      <div class="author-group" id="publisher-group-${letter}">
        <div class="author-group-header">
          <span class="author-group-letter">${letter}</span>
          <span class="author-group-line"></span>
        </div>
        <div class="author-rows">${rows}</div>
      </div>
    `;
  }).join("");
}

// ─── Harf grubuna smooth-scroll ──────────────────────────────────────────────
function scrollToGroup(letter) {
  const target = document.getElementById(`publisher-group-${letter}`);
  if (!target) return;
  const offset = 56 + 52 + 8;
  const top    = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
}

// ═══════════════════════════════════════════════════════════════
// YAYINEVİ DETAY GÖRÜNÜMÜ (6B)
// ═══════════════════════════════════════════════════════════════

function renderPublisherDetail(publisherName) {
  const container = document.getElementById("publishers-content");
  if (!container) return;

  // Bu yayınevine ait tüm kitaplar
  const allBooks = state.books.filter((b) => b.publisher === publisherName);

  // Serilere göre grupla
  const seriesMap  = {};
  const standalone = [];   // serisi olmayan kitaplar

  for (const book of allBooks) {
    if (book.series) {
      if (!seriesMap[book.series]) seriesMap[book.series] = [];
      seriesMap[book.series].push(book);
    } else {
      standalone.push(book);
    }
  }

  // Her seri içinde seri sırasına göre sırala
  for (const s of Object.keys(seriesMap)) {
    seriesMap[s].sort((a, b) => (a.series_order || 0) - (b.series_order || 0));
  }

  // Seri adlarını alfabetik sırala
  const sortedSeries = Object.keys(seriesMap).sort((a, b) => a.localeCompare(b, "tr"));

  // Bağımsız kitapları alfabetik sırala
  standalone.sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr"));

  // HTML
  let sectionsHtml = "";

  // Seri grupları
  for (const seriesName of sortedSeries) {
    const books   = seriesMap[seriesName];
    const cards   = books.map((b) => cardHtml(b)).join("");
    sectionsHtml += `
      <div class="detail-sub-section">
        <h3 class="detail-sub-title">
          <iconify-icon icon="lucide:layers"></iconify-icon>
          ${esc(seriesName)}
          <span class="detail-sub-count">${books.length} kitap</span>
        </h3>
        <div class="books-grid author-books-grid" data-grid-id="series-${escAttr(seriesName)}">${cards}</div>
      </div>
    `;
  }

  // Seriye ait olmayan kitaplar
  if (standalone.length > 0) {
    const cards   = standalone.map((b) => cardHtml(b)).join("");
    sectionsHtml += `
      <div class="detail-sub-section">
        <h3 class="detail-sub-title">
          <iconify-icon icon="lucide:book-copy"></iconify-icon>
          Seriye Ait Olmayan Kitaplar
          <span class="detail-sub-count">${standalone.length} kitap</span>
        </h3>
        <div class="books-grid author-books-grid">${cards}</div>
      </div>
    `;
  }

  if (!sectionsHtml) {
    sectionsHtml = `<div class="empty-state">Bu yayınevine ait kitap bulunamadı.</div>`;
  }

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="publisher-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Yayınevlerine Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(publisherName)}</h2>
        <span class="detail-subtitle">${allBooks.length} kitap</span>
      </div>
    </div>
    ${sectionsHtml}
  `;

  // Geri butonu
  document.getElementById("publisher-back-btn")?.addEventListener("click", () => {
    activePublisher = null;
    renderPublisherList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Kart HTML'i (DOM elementi değil string — innerHTML içine gidiyor)
function cardHtml(book) {
  const statusClass = `status-${book.status || "okunmadi"}`;
  const coverHtml   = book.cover_url
    ? `<img src="${esc(book.cover_url)}" alt="${esc(book.title || "")}" loading="lazy" />`
    : `<div class="cover-placeholder">${esc((book.title || "?")[0].toUpperCase())}</div>`;

  return `
    <div class="book-card" data-id="${esc(book.$id)}">
      <div class="book-cover">
        ${coverHtml}
        <span class="book-format">${book.format || ""}</span>
        <span class="book-status-badge ${statusClass}">${statusLabelLocal(book.status)}</span>
      </div>
      <div class="book-info">
        <h3 class="book-title">${esc(book.title || "Başlıksız")}</h3>
        <p class="book-author">${esc(book.author || "Yazar bilinmiyor")}</p>
        ${book.series
          ? `<p class="book-series">${esc(book.series)}${book.series_order ? " #" + book.series_order : ""}</p>`
          : ""}
      </div>
    </div>
  `;
}

function statusLabelLocal(status) {
  const map = { okunmadi: "Okunmadı", sirada: "Sırada", okunuyor: "Okunuyor", okundu: "Okundu" };
  return map[status] || "Okunmadı";
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA (yalnızca bir kez)
// ═══════════════════════════════════════════════════════════════

export function initPublishers() {
  document.getElementById("publishers-content")?.addEventListener("click", (e) => {

    // Harf çubuğu → o gruba kaydır
    const alphaBtn = e.target.closest(".alpha-btn");
    if (alphaBtn && alphaBtn.dataset.letter) {
      scrollToGroup(alphaBtn.dataset.letter);
      return;
    }

    // Yayınevi satırı → detay görünümüne geç
    const publisherRow = e.target.closest("[data-publisher]");
    if (publisherRow && publisherRow.dataset.publisher) {
      activePublisher = publisherRow.dataset.publisher;
      renderPublisherDetail(activePublisher);
      return;
    }

    // Detaydaki kitap kartı → pop-up aç
    const bookCard = e.target.closest(".book-card");
    if (bookCard && bookCard.dataset.id) {
      openModal(bookCard.dataset.id);
      return;
    }
  });
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}