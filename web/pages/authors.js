// ─────────────────────────────────────────────────────────────────────────────
// AUTHORS — Yazarlar sayfası.
//
// 5A: Alfabetik yazar listesi + A–Z harf çubuğu.
//
// Yapı:
//   • Üstte tıklanabilir harf çubuğu (A–Z). Koleksiyonda olmayan harfler
//     soluk/pasif gösterilir.
//   • Her harf için bir grup: büyük harf başlığı + çizgi, altında o harfle
//     başlayan yazarlar (ad + kitap sayısı).
//   • Bir harfe tıklayınca sayfa o gruba smooth-scroll yapar.
//
// 5B'de eklenecek: yazar adına tıklayınca o yazarın kitapları açılır.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";

const ALPHABET = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ".split("");

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderAuthors() {
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
// Dönüş: { "A": [{name, count}, ...], "B": [...], ... }
function groupByLetter() {
  const countMap = {};

  for (const book of state.books) {
    const name = (book.author || "").trim();
    if (!name) continue;
    countMap[name] = (countMap[name] || 0) + 1;
  }

  const grouped = {};
  for (const [name, count] of Object.entries(countMap)) {
    // İlk harfi Türkçe büyük harfe çevir.
    const firstChar = name.charAt(0).toLocaleUpperCase("tr-TR");

    // Alfabemizde yoksa (rakam, özel karakter vs.) "#" grubuna koy.
    const letter = ALPHABET.includes(firstChar) ? firstChar : "#";

    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push({ name, count });
  }

  // Her grup içinde yazarları alfabetik sırala.
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
  // Grupları Türk alfabesi sırasına göre diziyoruz.
  const sortedLetters = ALPHABET.filter((l) => grouped[l]);
  if (grouped["#"]) sortedLetters.push("#"); // Özel karakterler en sona

  if (sortedLetters.length === 0) {
    return `<div class="empty-state">Henüz yazar bilgisi olan kitap yok.</div>`;
  }

  return sortedLetters.map((letter) => {
    const authors = grouped[letter];
    const rows = authors.map((a) => `
      <div class="author-row" data-author="${escAttr(a.name)}">
        <span class="author-name">${esc(a.name)}</span>
        <span class="author-count">${a.count} kitap</span>
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

// ─── Olayları bağla ─────────────────────────────────────────────────────────
// authors-content'e tek delegated listener — harf çubuğu + yazar satırları.
export function initAuthors() {
  document.getElementById("authors-content")?.addEventListener("click", (e) => {
    // Harf çubuğu tıklaması → o gruba kaydır
    const alphaBtn = e.target.closest(".alpha-btn");
    if (alphaBtn && alphaBtn.dataset.letter) {
      scrollToGroup(alphaBtn.dataset.letter);
      return;
    }

    // Yazar satırı tıklaması → 5B'de doldurulacak
    const authorRow = e.target.closest(".author-row");
    if (authorRow && authorRow.dataset.author) {
      // 5B: navigateToAuthor(authorRow.dataset.author);
    }
  });
}

// ─── Harf grubuna smooth-scroll ──────────────────────────────────────────────
function scrollToGroup(letter) {
  const target = document.getElementById(`author-group-${letter}`);
  if (!target) return;
  // Yapışık header yüksekliğini (56px) ve harf çubuğunu (52px) say.
  const offset = 56 + 52 + 8;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
}

// ─── Küçük yardımcılar ───────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}