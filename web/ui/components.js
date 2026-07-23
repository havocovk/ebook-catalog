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
//
// isSelected (Adım 18): seçim durumu catalog.js'deki selectedIds Set'inde
// tutulur (bu modülün dışında); components.js o Set'e erişemez, bu yüzden
// çağıran taraf (catalog.js) o bilgiyi parametre olarak buraya geçirir.
//
// options.showCanonicalBadge (Bölüm 4):
//   true  → yazarlar sayfasında, eşleştirilmiş kitapların kartında 🔗 rozeti gösterilir.
//   false → katalog dahil diğer tüm sayfalarda rozet çıkmaz (varsayılan).
//   Rozetin popover içeriği (hangi kitaplarla eşleştirilmiş) authors.js'e geçirilmek
//   üzere data-canonical-id attribute'u olarak karta yazılır; event binding authors.js'te.
export function createBookCard(book, isSelected = false, options = {}) {
  const { showCanonicalBadge = false } = options;

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

  // ── Adım 37: Manuel lazy loading (Intersection Observer) ────────────────
  // Native loading="lazy" kaldırıldı — tarayıcı "yakın olabilir" tahminiyle
  // bir sayfadaki 50 karttan çoğunu aynı anda indirmeye kalkışıyordu (165
  // eşzamanlı istek, 43s açılış). Bunun yerine src yerine data-src yazılır;
  // gerçek yükleme catalog-ui.js'deki IntersectionObserver, kart GERÇEKTEN
  // viewport'a girdiğinde data-src'yi src'ye kopyalayarak başlatır.
  const coverHtml = book.cover_url
    ? `<img data-src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" class="lazy-cover" />`
    : `<div class="cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  // ── Adım 37 sonu ──────────────────────────────────────────────────────────

  // ── Adım 18: Toplu işlem seçim checkbox'ı (sol üst köşe) ─────────────────
  // Format rozeti zaten sol üstte (book-format) — checkbox onun ÜSTÜNE değil,
  // YANINA/biraz daha sol-üste konumlanacak şekilde CSS'te ayarlanacak.
  // Gerçek bir <input type="checkbox"> değil, tıklanabilir bir <button> —
  // favori butonuyla aynı kalıp (event delegation + closest() ile yakalanır).
  const selectBtnHtml = `
    <button class="select-btn ${isSelected ? "active" : ""}" title="${isSelected ? "Seçimi kaldır" : "Seç"}">
      <iconify-icon icon="${isSelected ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline"}"></iconify-icon>
    </button>
  `;
  // ── Adım 18 sonu ──────────────────────────────────────────────────────────

  // ── Adım 17: Favori butonu (sol alt köşe — diğer üç köşe zaten dolu) ────
  // data-id zaten kartın kendisinde var; butona ayrıca eklemeye gerek yok,
  // catalog.js'deki event delegation closest(".favorite-btn") ile kartın
  // dataset.id'sini okuyacak.
  //
  // DÜZELTME: Lucide'da resmi "dolu kalp" ikonu yok (sadece stroke/çerçeve
  // çiziyor, fill desteklemiyor — Iconify de CSS ile fill zorlamayı önermiyor
  // çünkü her ikon seti bunu desteklemez). Bu yüzden dolu/boş ayrımı için
  // Material Design Icons (mdi) setinden GERÇEKTEN dolu olan bir ikon
  // kullanılıyor: mdi:heart (dolu) / mdi:heart-outline (boş). Renk hâlâ
  // CSS'teki .active sınıfıyla (color: var(--danger)) yönetiliyor.
  const isFavorite = Boolean(book.favorite);
  const heartIcon = isFavorite ? "mdi:heart" : "mdi:heart-outline";
  const favoriteBtnHtml = `
    <button class="favorite-btn ${isFavorite ? "active" : ""}" title="${isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}">
      <iconify-icon icon="${heartIcon}"></iconify-icon>
    </button>
  `;
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  // ── Adım 3 (V5): PDF/EPUB chip renk ayrımı ──────────────────────────────
  // format değeri "pdf" veya "epub" (küçük harf) olarak gelir.
  // CSS sınıfı format-pdf → kırmızı, format-epub → yeşil.
  // Bilinmeyen format varsa nötr arka plan kalır (sadece book-format sınıfı).
  const fmt = (book.format || "").toLowerCase();
  const formatClass = fmt === "pdf" ? "format-pdf" : fmt === "epub" ? "format-epub" : "";
  // ── Adım 3 (V5) sonu ──────────────────────────────────────────────────────

  // ── Bölüm 4: Canonical (Eşleştirilmiş Kitap) rozeti ──────────────────────
  // Sadece yazarlar sayfasında (showCanonicalBadge=true) VE kitabın
  // canonical_id'si varsa gösterilir. Rozete tıklanınca authors.js'teki
  // event delegation bir popover açar — event binding burada değil.
  // data-canonical-id: popover'ın hangi grubu göstereceğini bulmak için
  // authors.js'e gereken anahtar bilgiyi taşır.
  const canonicalId = (book.canonical_id || "").trim();
  const canonicalBadgeHtml = (showCanonicalBadge && canonicalId)
    ? `<button
         class="canonical-badge"
         data-canonical-id="${escapeHtml(canonicalId)}"
         data-book-id="${escapeHtml(book.$id)}"
         title="Bu kitap diğer dosyalarla eşleştirilmiş — detay için tıkla"
         aria-label="Eşleştirilmiş kitap"
       >
         <iconify-icon icon="lucide:link"></iconify-icon>
       </button>`
    : "";
  // ── Bölüm 4 sonu ──────────────────────────────────────────────────────────

  card.innerHTML = `
    <div class="book-cover">
      ${coverHtml}
      ${selectBtnHtml}
      <span class="book-format ${formatClass}">${(book.format || "").toUpperCase()}</span>
      ${confBadgeHtml}
      ${canonicalBadgeHtml}
      <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
      ${favoriteBtnHtml}
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHtml(book.title || "Başlıksız")}</h3>
      <p class="book-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</p>
      ${
        book.series
          ? `<p class="book-series">${escapeHtml(book.series)}${book.series_order ? " #" + book.series_order : ""}</p>`
          : ""
      }
      ${book.genre ? `<p class="book-genre">${escapeHtml(book.genre)}</p>` : ""}
      <div class="book-rating">${ratingHtml}</div>
    </div>
  `;

  return card;
}