// ─────────────────────────────────────────────────────────────────────────────
// AUTHORS — Yazarlar sayfası.
//
// 5A: Alfabetik yazar listesi + A–Z harf çubuğu.
// 5B: Yazar detay görünümü — bir yazara tıklayınca o yazarın kitapları açılır.
//     Geri butonu ile yazar listesine dönülür.
//
// Görünüm durumu (liste / detay) bu dosyada yerel tutulur; router'a ekstra
// rota eklenmez çünkü bu bir alt-görünümdür.
//
// Adım 6: A-Z harf çubuğu + alfabetik gruplama mantığı artık burada DEĞİL —
// publishers.js ile birebir aynı olduğu için ../ui/alpha-list.js'e taşındı.
// Bu dosyada sadece yazara özel kısım kaldı: detay görünümü (kitap kartları).
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { escapeHtmlBasic as esc } from "../ui/common.js";
import { groupByLetter, renderAlphaBar, renderGroups, scrollToGroup } from "../ui/alpha-list.js";
import { observeLazyImages } from "./catalog/catalog-ui.js";

const ID_PREFIX = "author";

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
  const grouped = groupByLetter(state.books, "author");
  const activeLetters = new Set(Object.keys(grouped));
  const container = document.getElementById("authors-content");
  if (!container) return;

  container.innerHTML = `
    ${renderAlphaBar(activeLetters)}
    <div class="author-list" id="author-list">
      ${renderGroups(grouped, { idPrefix: ID_PREFIX, emptyMessage: "Henüz yazar bilgisi olan kitap yok." })}
    </div>
  `;
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
    // Adım 37: data-src → src dönüşümünü tetikle (lazy loading)
    observeLazyImages(grid);
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
      scrollToGroup(alphaBtn.dataset.letter, ID_PREFIX);
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