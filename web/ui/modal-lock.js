// ─────────────────────────────────────────────────────────────────────────────
// MODAL-LOCK — Kitap başına kilit (salt okunur) sistemi.
//
// Adım 4 (V5): Modal'daki "Kilitle / Kilidi Aç" butonu bu modül tarafından
// yönetilir. Kilit durumu localStorage'da saklanır — sayfa yenilenince korunur.
//
// Export edilen fonksiyonlar:
//   _getLock(bookId)           → boolean
//   _setLock(bookId, locked)   → void
//   _applyLockState(locked)    → void   (DOM'u günceller)
//   _buildLockedView(book)     → void   (salt okunur HTML oluşturur)
//
// Bu modül yalnızca modal-core.js tarafından kullanılır.
// Dışarıya doğrudan export edilmez — modal.js re-export etmez.
// ─────────────────────────────────────────────────────────────────────────────

import { confidenceLevel, confidenceLabel, escapeHtml } from "./common.js";

// ── Kilit durumu — kitap başına Map<bookId, boolean> localStorage'da saklanır.
const _LOCK_KEY = "ebook_modal_locks";

function _getLocks() {
  try { return JSON.parse(localStorage.getItem(_LOCK_KEY) || "{}"); } catch { return {}; }
}

export function _getLock(bookId) {
  return _getLocks()[bookId] ?? false;
}

export function _setLock(bookId, locked) {
  const locks = _getLocks();
  if (locked) { locks[bookId] = true; } else { delete locks[bookId]; }
  localStorage.setItem(_LOCK_KEY, JSON.stringify(locks));
}

// ── Adım 4 (V5): Kilit durumunu uygula ───────────────────────────────────────
// locked=true  → form katmanı gizlenir, kilitli view gösterilir, buton "Kilidi Aç" olur
// locked=false → form katmanı gösterilir, kilitli view gizlenir, buton "Kilitle" olur
export function _applyLockState(locked) {
  const fields     = document.getElementById("modal-fields");
  const footer     = document.getElementById("modal-footer");
  const coverWrap  = document.getElementById("modal-cover-wrap");  // ── Resim Yükle butonu dahil
  const lockedView = document.getElementById("modal-locked-view");
  const lockBtn    = document.getElementById("modal-lock-btn");

  if (fields)     fields.classList.toggle("hidden", locked);
  if (footer)     footer.classList.toggle("hidden", locked);
  if (coverWrap)  coverWrap.classList.toggle("hidden", locked);   // ── Kilitliyken sol kapak alanı gizle
  if (lockedView) lockedView.classList.toggle("hidden", !locked);

  if (lockBtn) {
    if (locked) {
      lockBtn.innerHTML = `<iconify-icon icon="lucide:lock-open"></iconify-icon> Kilidi Aç`;
      lockBtn.title = "Düzenleme moduna geç";
    } else {
      lockBtn.innerHTML = `<iconify-icon icon="lucide:lock"></iconify-icon> Kilitle`;
      lockBtn.title = "Salt okunur görünüme geç";
    }
  }
}

// ── Adım 4 (V5): Kilitli görünüm HTML'ini oluştur ────────────────────────────
// state.books'taki EN SON KAYDEDİLMİŞ veriyi kullanır.
// Format chip renkleri Adım 3 (V5) ile eklenen CSS sınıflarını (format-pdf /
// format-epub) kullanır — aynı görsel dil korunur.
export function _buildLockedView(book) {
  const el = document.getElementById("modal-locked-view");
  if (!el) return;

  // Format chip
  const fmt      = (book.format || "").toLowerCase();
  const fmtClass = fmt === "pdf" ? "format-pdf" : fmt === "epub" ? "format-epub" : "";
  const fmtHtml  = book.format
    ? `<span class="locked-chip ${fmtClass}">${(book.format).toUpperCase()}</span>`
    : "";

  // Fiziksel kopya chip (sadece true ise göster)
  const physHtml = book.has_physical_copy
    ? `<span class="locked-chip locked-chip-physical">
         <iconify-icon icon="lucide:book-marked"></iconify-icon> Fiziksel Kopya
       </span>`
    : "";

  // Okuma durumu chip
  const statusMap = {
    okunmadi: { label: "Okunmadı",  cls: "locked-chip-status-okunmadi"  },
    sirada:   { label: "Sırada",    cls: "locked-chip-status-sirada"    },
    okunuyor: { label: "Okunuyor",  cls: "locked-chip-status-okunuyor"  },
    okundu:   { label: "Okundu",    cls: "locked-chip-status-okundu"    },
  };
  const st     = statusMap[book.status] || statusMap["okunmadi"];
  const stHtml = `<span class="locked-chip ${st.cls}">${st.label}</span>`;

  // Güven skoru badge
  const confLevel = confidenceLevel(book.confidence_score);
  const confHtml  = confLevel
    ? `<span class="confidence-badge-lg confidence-${confLevel}">
         ${confidenceLabel(confLevel)} Güven (${book.confidence_score}/100)
       </span>`
    : "";

  // Seri bloğu
  const seriesHtml = book.series
    ? `<div class="locked-series">
         <iconify-icon icon="lucide:layers"></iconify-icon>
         ${escapeHtml(book.series)}${book.series_order ? " #" + book.series_order : ""}
       </div>`
    : "";

  // Bilgi grid'i: yayınevi, yıl, baskı, dil, kategori, tür
  const langLabels = {
    tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca",
    es: "İspanyolca", it: "İtalyanca", ru: "Rusça", ar: "Arapça",
    ja: "Japonca", zh: "Çince", other: "Diğer",
  };
  const infoItems = [
    { icon: "lucide:building-2",  label: "Yayınevi", val: book.publisher },
    { icon: "lucide:calendar",    label: "Yıl",      val: book.year      },
    { icon: "lucide:layers-2",    label: "Baskı",    val: book.edition   },
    { icon: "lucide:languages",   label: "Dil",      val: langLabels[book.language] || book.language },
    { icon: "lucide:tags",        label: "Kategori", val: book.category  },
    { icon: "lucide:library",     label: "Tür",      val: book.genre     },
    { icon: "lucide:book-open",   label: "Sayfa",    val: book.page_count ? `${book.page_count} sayfa` : null },
  ].filter((i) => i.val);

  const infoGridHtml = infoItems.length
    ? `<div class="locked-info-grid">
         ${infoItems.map((i) => `
           <div class="locked-info-item">
             <span class="locked-info-label">
               <iconify-icon icon="${i.icon}"></iconify-icon> ${i.label}
             </span>
             <span class="locked-info-val">${escapeHtml(String(i.val))}</span>
           </div>`).join("")}
       </div>`
    : "";

  // Notlar
  const notesHtml = book.notes
    ? `<div class="locked-notes">
         <span class="locked-info-label">
           <iconify-icon icon="lucide:notebook-pen"></iconify-icon> Notlar
         </span>
         <p class="locked-notes-text">${escapeHtml(book.notes)}</p>
       </div>`
    : "";

  // Koleksiyonlar
  const collectionsHtml = (book.collections || []).length
    ? `<div class="locked-tags">
         <span class="locked-info-label" style="width:100%;margin-bottom:0.2rem;">
           <iconify-icon icon="lucide:folder-heart"></iconify-icon> Koleksiyonlar
         </span>
         ${book.collections.map((c) => `<span class="locked-tag">${escapeHtml(c)}</span>`).join("")}
       </div>`
    : "";

  // Etiketler
  const tagsHtml = (book.tags || []).length
    ? `<div class="locked-tags">
         <span class="locked-info-label" style="width:100%;margin-bottom:0.2rem;">
           <iconify-icon icon="lucide:tag"></iconify-icon> Etiketler
         </span>
         ${book.tags.map((t) => `<span class="locked-tag">${escapeHtml(t)}</span>`).join("")}
       </div>`
    : "";

  // Kapak
  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" class="locked-cover-img" />`
    : `<div class="cover-placeholder locked-cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  el.innerHTML = `
    <div class="locked-cover-wrap">${coverHtml}</div>
    <div class="locked-meta">
      <h2 class="locked-title">${escapeHtml(book.title || "Başlıksız")}</h2>
      <p class="locked-author">${escapeHtml(book.author || "")}</p>
      <div class="locked-chips">
        ${fmtHtml}
        ${stHtml}
        ${physHtml}
        ${confHtml}
      </div>
      ${seriesHtml}
      ${infoGridHtml}
      ${notesHtml}
      ${collectionsHtml}
      ${tagsHtml}
    </div>
  `;
}