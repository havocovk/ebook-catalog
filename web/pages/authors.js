// ─────────────────────────────────────────────────────────────────────────────
// AUTHORS — Yazarlar sayfası.
//
// 5A: Alfabetik yazar listesi + A–Z harf çubuğu.
// 5B: Yazar detay görünümü — bir yazara tıklayınca o yazarın kitapları açılır.
//     Geri butonu ile yazar listesine dönülür.
//
// Görünüm durumu (liste / detay) bu dosyada yerel tutulur; router'a ekstra
// rota eklenmez çünkü bu bir alt-görünümdür.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";

const ALPHABET = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ".split("");

// Şu an detayda gösterilen yazar adı. Liste görünümünde null.
let activeAuthor = null;

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderAuthors() {
  if (activeAuthor) {
    renderAuthorDetail(activeAuthor);
  } else {
    renderAuthorList();
  }
}

// ═══════════════════════════════════════════════════════════════
// YAZAR LİSTESİ
// ═══════════════════════════════════════════════════════════════

function renderAuthorList() {
  const grouped = groupByLetter();
  const activeLetters = new Set(Object.keys(grouped));
  const container = document.getElementById("authors-content");
  if (!container) return;

  container.innerHTML = `
    ${renderAlphaBar(activeLetters)}
    <div class="author-list" id="author-list">
      ${renderGroups(grouped)}
    </div>
  `;
}

// ─── Yazarları ilk harfe göre grupla ────────────────────────────────────────
function groupByLetter() {
  const countMap = {};
  for (const book of state.books) {
    const name = (book.author || "").trim();
    if (!name) continue;
    countMap[name] = (countMap[name] || 0) + 1;
  }

  const grouped = {};
  for (const [name, count] of Object.entries(countMap)) {
    const firstChar = name.charAt(0).toLocaleUpperCase("tr-TR");
    const letter = ALPHABET.includes(firstChar) ? firstChar : "#";
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push({ name, count });
  }

  for (const letter of Object.keys(grouped)) {
    grouped[letter].sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
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

  if (sortedLetters.length === 0) {
    return `<div class="empty-state">Henüz yazar bilgisi olan kitap yok.</div>`;
  }

  return sortedLetters.map((letter) => {
    const authors = grouped[letter];
    const rows = authors.map((a) => `
      <div class="author-row" data-author="${escAttr(a.name)}">
        <span class="author-name">${esc(a.name)}</span>
        <span class="author-count">${a.count} kitap</span>
        <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
      </div>
    `).join("");

    return `
      <div class="author-group" id="author-group-${letter}">
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
  const target = document.getElementById(`author-group-${letter}`);
  if (!target) return;
  const offset = 56 + 52 + 8;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
}

// ═══════════════════════════════════════════════════════════════
// YAZAR DETAY GÖRÜNÜMÜ
// ═══════════════════════════════════════════════════════════════

function renderAuthorDetail(authorName) {
  const container = document.getElementById("authors-content");
  if (!container) return;

  const books = state.books
    .filter((b) => b.author === authorName)
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" }));

  // Başlık bölümü
  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="author-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Yazarlara Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(authorName)}</h2>
        <span class="detail-subtitle">${books.length} kitap</span>
      </div>
    </div>
    <div class="books-grid author-books-grid" id="author-books-grid"></div>
  `;

  // Kitap kartlarını ekle
  const grid = document.getElementById("author-books-grid");
  if (grid && books.length > 0) {
    const fragment = document.createDocumentFragment();
    books.forEach((b) => fragment.appendChild(createBookCard(b)));
    grid.appendChild(fragment);
  } else if (grid) {
    grid.innerHTML = `<div class="empty-state">Bu yazara ait kitap bulunamadı.</div>`;
  }

  // Geri butonu
  document.getElementById("author-back-btn")?.addEventListener("click", () => {
    activeAuthor = null;
    renderAuthorList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA (yalnızca bir kez)
// ═══════════════════════════════════════════════════════════════

export function initAuthors() {
  document.getElementById("authors-content")?.addEventListener("click", (e) => {

    // Harf çubuğu → o gruba kaydır
    const alphaBtn = e.target.closest(".alpha-btn");
    if (alphaBtn && alphaBtn.dataset.letter) {
      scrollToGroup(alphaBtn.dataset.letter);
      return;
    }

    // Yazar satırı → detay görünümüne geç
    const authorRow = e.target.closest(".author-row");
    if (authorRow && authorRow.dataset.author) {
      activeAuthor = authorRow.dataset.author;
      renderAuthorDetail(activeAuthor);
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