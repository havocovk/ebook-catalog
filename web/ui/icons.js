// ─────────────────────────────────────────────────────────────────────────────
// ICONS — Iconify ikon yardımcısı.
//
// Iconify, internetten ikon çeken ücretsiz bir kütüphanedir. <iconify-icon>
// web bileşeni index.html içinde tek satırla yüklenir; bu bileşen sayfaya
// sonradan eklenen ikonları da otomatik olarak çizer (kitap kartları gibi).
//
// İkon isimleri "set:isim" biçimindedir. Örnekler:
//   lucide:book-open, lucide:users, lucide:building-2, tabler:device-floppy
// Tüm ikonlara şuradan bakabilirsin: https://icon-sets.iconify.design
// ─────────────────────────────────────────────────────────────────────────────

// Tek bir ikonun HTML kodunu döndürür.
//   icon("lucide:book-open")            -> <iconify-icon icon="lucide:book-open"></iconify-icon>
//   icon("lucide:star", "star-large")   -> class eklenmiş hali
export function icon(name, extraClass = "") {
  const classAttr = extraClass ? ` class="${extraClass}"` : "";
  return `<iconify-icon icon="${name}"${classAttr} aria-hidden="true"></iconify-icon>`;
}