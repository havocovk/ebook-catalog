// ─────────────────────────────────────────────────────────────────────────────
// ALPHA LIST — Yazarlar ve Yayınevleri sayfalarının ortak A–Z liste mantığı.
//
// Adım 6: authors.js ve publishers.js'de birebir aynı olan harf çubuğu +
// alfabetik gruplama + smooth-scroll kodu buraya taşındı. series.js bu
// modülü KULLANMAZ — o sayfa farklı bir tasarıma (popüler kartlar + ilerleme
// çubukları) sahip, A-Z harf çubuğu yok; zorla aynı kalıba sokmak yerine
// kendi haline bırakıldı.
//
// Bu modül "saf" fonksiyonlar sağlar — hangi alanı grupladığını (author/
// publisher) ve HTML id öneklerini çağıran sayfa belirler. Böylece
// authors.js ve publishers.js sadece kendilerine özel detay görünümünü
// yazar, ortak liste mantığını burada bir kez tanımlarız.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtmlBasic as esc, escapeAttr } from "./common.js";

export const ALPHABET = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ".split("");

// ─── Kitapları belirtilen alana (author/publisher) göre ilk harfe grupla ────
// field: "author" | "publisher" — state.books üzerindeki hangi alan gruplanacak.
// Dönüş: { "A": [{name, count}, ...], "B": [...], ..., "#": [...] }
export function groupByLetter(books, field) {
  const countMap = {};
  for (const book of books) {
    const name = (book[field] || "").trim();
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

// ─── Harf çubuğu HTML'i ──────────────────────────────────────────────────────
// activeLetters: Set<string> — hangi harflerin en az 1 kaydı var (tıklanabilir).
export function renderAlphaBar(activeLetters) {
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

// ─── Harf grupları HTML'i ────────────────────────────────────────────────────
// opts.idPrefix    : "author" | "publisher" — id ve data-* attribute öneki.
// opts.emptyMessage: hiç kayıt yoksa gösterilecek mesaj.
export function renderGroups(grouped, opts) {
  const { idPrefix, emptyMessage } = opts;
  const sortedLetters = ALPHABET.filter((l) => grouped[l]);
  if (grouped["#"]) sortedLetters.push("#");

  if (sortedLetters.length === 0) {
    return `<div class="empty-state">${emptyMessage}</div>`;
  }

  return sortedLetters.map((letter) => {
    const items = grouped[letter];
    const rows = items.map((item) => `
      <div class="author-row" data-${idPrefix}="${escapeAttr(item.name)}">
        <span class="author-name">${esc(item.name)}</span>
        <span class="author-count">${item.count} kitap</span>
        <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
      </div>
    `).join("");

    return `
      <div class="author-group" id="${idPrefix}-group-${letter}">
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
export function scrollToGroup(letter, idPrefix) {
  const target = document.getElementById(`${idPrefix}-group-${letter}`);
  if (!target) return;
  const offset = 56 + 52 + 8;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: "smooth" });
}