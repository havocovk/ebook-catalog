// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS — Tekrar kullanılan görsel parçalar.
//
// Kitap kartı ve yıldız puanı gibi birden çok sayfada lazım olabilecek parçalar
// burada tek bir yerde üretilir. İleride dashboard'daki "son eklenenler" veya
// yazar detayında da aynı kart kullanılacak; o yüzden burada duruyorlar.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtml, statusLabel, confidenceLevel } from "./common.js";

// 1–5 yıldız çizer.
//   interactive=false → sadece gösterim (kartlarda)
//   interactive=true  → tıklanabilir (modal'da puan vermek için), bookId gerekir
export function renderStars(rating, interactive = false, bookId = null) {
  let html = "";
  for (let i = 1; i <= 5; i++) {
    const filled = rating && i <= rating;
    if (interactive) {
      html += `<span class="star ${filled ? "filled" : ""}" data-rating="${i}" data-book-id="${bookId}">★</span>`;
    } else {
      html += `<span class="star ${filled ? "filled" : ""}">★</span>`;
    }
  }
  return html;
}

// Tek bir kitap kartını (DOM elementi olarak) üretir.
//
// ÖNEMLİ: Tıklama olayı BURADA bağlanmaz. Bunun yerine kart üzerine
// data-id="<kitap id>" yazılır; katalog sayfası tüm karta tek bir olay
// dinleyici ekleyip (event delegation) tıklananın id'sini okur. Bu yöntem
// binlerce kartta tek tek dinleyici eklemekten çok daha verimlidir.
export function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.dataset.id = book.$id;

  const statusClass = `status-${book.status || "okunmadi"}`;
  const ratingHtml = renderStars(book.rating, false);

  // ── Adım 3: Güven skoru rozeti (sağ üst köşe) ──────────────────────────
  const confLevel = confidenceLevel(book.confidence_score);
  const confBadgeHtml = confLevel
    ? `<span class="confidence-badge confidence-${confLevel}" title="Güven Skoru: ${book.confidence_score}/100">${book.confidence_score}</span>`
    : "";

  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" loading="lazy" />`
    : `<div class="cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  card.innerHTML = `
    <div class="book-cover">
      ${coverHtml}
      <span class="book-format">${book.format || ""}</span>
      ${confBadgeHtml}
      <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHtml(book.title || "Başlıksız")}</h3>
      <p class="book-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</p>
      ${
        book.series
          ? `<p class="book-series">${escapeHtml(book.series)}${book.series_order ? " #" + book.series_order : ""}</p>`
          : ""
      }
      <div class="book-rating">${ratingHtml}</div>
    </div>
  `;

  return card;
}