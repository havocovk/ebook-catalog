// ─────────────────────────────────────────────────────────────────────────────
// AUTHORS — Yazarlar sayfası.
//
// 5A: Alfabetik yazar listesi + A–Z harf çubuğu.
// 5B: Yazar detay görünümü — bir yazara tıklayınca o yazarın kitapları açılır.
//     Geri butonu ile yazar listesine dönülür.
// 5C: Detay görünümünde toplu seçim + "Aynı Kitap Olarak Tanımla" aksiyonu.
//     Katalog sayfasındaki mevcut select-btn + toggleSelection mekanizması
//     yazarlar sayfasında da aktif edilir — ekstra overlay eklenmez.
//
// Bölüm 4: Canonical (Eşleştirilmiş Kitap) rozeti + popover.
//   • createBookCard, showCanonicalBadge:true ile çağrılır.
//   • Rozete tıklanınca aynı canonical_id'ye sahip tüm dosyalar popover'da listelenir.
//   • setCanonicalId artık zincirleme grup birleştirme yapar (api-books.js'te).
//     authors.js sadece hangi kitapların seçildiğini bildirir; genişleme orada olur.
//
// Bölüm 4B: "Otomatik Eşleştir" butonu.
//   • Yazarın tüm kitaplarını tarar.
//   • Birebir aynı yazar + aynı başlığa sahip olup canonical_id'si boş olanları
//     otomatik olarak gruplar ve her gruba canonical_id atar.
//   • Daha önce manuel eşleştirilmiş gruplara (canonical_id dolu) DOKUNMAZ.
//   • Sadece yazarlar sayfasında, detay görünümünde bulunur.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { escapeHtmlBasic as esc, escapeHtml } from "../ui/common.js";
import { showToast } from "../ui/common.js";
import { groupByLetter, renderAlphaBar, renderGroups, scrollToGroup } from "../ui/alpha-list.js";
import { observeLazyImages } from "./catalog/catalog-ui.js";
import { setCanonicalId } from "../core/api.js";
import { _showConfirm } from "../ui/modal.js";
import { selectedIds, toggleSelection } from "./catalog/bulk-selection.js";

const ID_PREFIX = "author";

// Şu an detayda gösterilen yazar adı. Liste görünümünde null.
let activeAuthor = null;

// Şu an açık olan canonical popover DOM elementi. Tek seferde sadece 1 açık olabilir.
let _activePopover = null;

// Yazar listesindeki scroll pozisyonu — detaya girince kaydedilir, geri dönünce geri yüklenir.
let _savedScrollY = 0;

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

  // Önceki seçimleri ve açık popover'ı temizle
  selectedIds.clear();
  _closePopover();

  const books = state.books
    .filter((b) => b.author === authorName)
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" }));

  // Tekilleştirilmiş kitap sayısı
  const uniqueKeys = new Set(
    books.map((b) => {
      if (b.canonical_id && b.canonical_id.trim()) return `canonical:${b.canonical_id.trim()}`;
      return `title:${(b.title || "").toLocaleLowerCase("tr").trim()}`;
    })
  );

  // Bölüm 4B: Otomatik eşleştirilebilecek dosya çifti var mı?
  // canonical_id'si boş olan kitapları başlığa göre grupla; 2+ olan var ise buton aktif.
  const autoMatchCount = _countAutoMatchable(books);

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="author-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Yazarlara Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(authorName)}</h2>
        <span class="detail-subtitle">${uniqueKeys.size} farklı kitap · ${books.length} dosya</span>
      </div>
      ${autoMatchCount > 0 ? `
      <button id="author-auto-match-btn" class="btn btn-sm author-auto-match-btn"
        title="${autoMatchCount} dosya aynı başlık+yazar eşleşmesiyle otomatik gruplandırılabilir">
        <iconify-icon icon="lucide:wand-2"></iconify-icon>
        <span>Otomatik Eşleştir (${autoMatchCount})</span>
      </button>` : ""}
    </div>

    <!-- Toplu işlem çubuğu — seçim yapılınca görünür -->
    <div id="author-bulk-bar" class="author-bulk-bar hidden">
      <span id="author-bulk-count" class="author-bulk-count">0 seçili</span>
      <button id="author-bulk-same" class="btn btn-sm" style="background:#ff8904;border-color:#ff8904;color:#fff;">
        <iconify-icon icon="lucide:link"></iconify-icon>
        <span>Aynı Kitap Olarak Tanımla</span>
      </button>
      <button id="author-bulk-unlink" class="btn btn-sm" style="background:#0d9488;border-color:#0d9488;color:#fff;">
        <iconify-icon icon="lucide:unlink"></iconify-icon>
        <span>Bağlantıyı Kaldır</span>
      </button>
      <button id="author-bulk-clear" class="btn btn-sm">
        <iconify-icon icon="lucide:x"></iconify-icon>
        <span>Seçimi Temizle</span>
      </button>
    </div>

    <div class="books-grid author-books-grid" id="author-books-grid"></div>
  `;

  // Bölüm 4: Kitap kartlarını showCanonicalBadge:true ile ekle
  const grid = document.getElementById("author-books-grid");
  if (grid && books.length > 0) {
    const fragment = document.createDocumentFragment();
    books.forEach((b) => fragment.appendChild(
      createBookCard(b, false, { showCanonicalBadge: true })
    ));
    grid.appendChild(fragment);
    observeLazyImages(grid);
  } else if (grid) {
    grid.innerHTML = `<div class="empty-state">Bu yazara ait kitap bulunamadı.</div>`;
  }

  _bindDetailEvents(books);

  document.getElementById("author-back-btn")?.addEventListener("click", () => {
    activeAuthor = null;
    selectedIds.clear();
    _closePopover();
    renderAuthorList();
    // Listeyi render ettikten sonra DOM güncellenmesini bekleyip
    // kaydedilen pozisyona dön (requestAnimationFrame garantiyle)
    requestAnimationFrame(() => {
      window.scrollTo({ top: _savedScrollY, behavior: "instant" });
    });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Toplu işlem çubuğunu güncelle ───────────────────────────────────────────
function _updateBulkBar() {
  const bar     = document.getElementById("author-bulk-bar");
  const countEl = document.getElementById("author-bulk-count");
  if (bar)     bar.classList.toggle("hidden", selectedIds.size === 0);
  if (countEl) countEl.textContent = `${selectedIds.size} seçili`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Bölüm 4B — Otomatik Eşleştirme Yardımcıları
// ══════════════════════════════════════════════════════════════════════════════

// canonical_id'si boş olan kitapları yazar+başlığa göre gruplar;
// 2+ dosyası olan grup sayısını döndürür (buton badge'i için).
function _countAutoMatchable(books) {
  const map = {};
  for (const b of books) {
    if (b.canonical_id && b.canonical_id.trim()) continue; // dolu olanları atla
    const key = `${(b.author || "").toLocaleLowerCase("tr").trim()}|||${(b.title || "").toLocaleLowerCase("tr").trim()}`;
    if (!key.startsWith("|||")) { // yazar veya başlık boşsa güvenilir değil
      map[key] = (map[key] || 0) + 1;
    }
  }
  return Object.values(map).filter((count) => count >= 2).length;
}

// ── İlerleme toast'ı — yerinde güncellenir, her adımda yeni toast açılmaz ──
// Döndürdüğü nesnenin .update(msg) ile metni, .dismiss() ile toast kaldırılır.
function _createProgressToast(initialMessage) {
  const container = document.getElementById("toast-container");
  if (!container) return { update: () => {}, dismiss: () => {} };

  const toast = document.createElement("div");
  toast.className = "toast toast-success visible";
  toast.textContent = initialMessage;
  container.appendChild(toast);

  return {
    update(msg) { toast.textContent = msg; },
    dismiss() {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    },
  };
}

// canonical_id'si boş olan birebir aynı başlıklı kitapları gruplar ve
// her gruba yeni bir canonical_id atar. Dolu olanlar hiç değiştirilmez.
// Dönüş: { groupCount, fileCount } — kaç grup ve kaç dosya işlendi.
async function _autoMatchBooks(books) {
  // canonical_id'si boş olanları yazar+başlığa göre grupla
  const map = {};
  for (const b of books) {
    if (b.canonical_id && b.canonical_id.trim()) continue;
    const key = `${(b.author || "").toLocaleLowerCase("tr").trim()}|||${(b.title || "").toLocaleLowerCase("tr").trim()}`;
    if (!key.replace(/^\|\|\|/, "")) continue; // yazar ve başlık her ikisi de boşsa atla
    if (!map[key]) map[key] = [];
    map[key].push(b.$id);
  }

  // Sadece 2+ dosyası olan gruplar işlenir
  const groups = Object.values(map).filter((ids) => ids.length >= 2);
  if (groups.length === 0) return { groupCount: 0, fileCount: 0 };

  // İlerleme toast'ını başlat
  const progress = _createProgressToast(`Eşleştirme başlıyor... (0/${groups.length})`);

  let totalFiles = 0;
  for (let i = 0; i < groups.length; i++) {
    const groupIds = groups[i];
    const newId = `canon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await setCanonicalId(groupIds, newId);
    totalFiles += groupIds.length;
    progress.update(`${i + 1}/${groups.length} grup eşleştirildi...`);
    // Zaman damgası çakışmasını önlemek için gruplar arasında kısa bekleme
    await new Promise((r) => setTimeout(r, 5));
  }

  progress.dismiss();
  return { groupCount: groups.length, fileCount: totalFiles };
}

// ── Detay grid event'lerini bağla ───────────────────────────────────────────
function _bindDetailEvents(books) {
  const grid = document.getElementById("author-books-grid");
  if (!grid) return;

  // ── Bölüm 4B: Otomatik Eşleştir butonu ────────────────────────────────────
  document.getElementById("author-auto-match-btn")?.addEventListener("click", async () => {
    const confirmed = await _showConfirm(
      `Bu yazarın birebir aynı başlığa sahip eşleştirilmemiş dosyaları otomatik olarak gruplandırılacak. ` +
      `Daha önce manuel eşleştirdiğiniz kitaplara dokunulmayacak. Devam etmek istiyor musunuz?`
    );
    if (!confirmed) return;

    const btn = document.getElementById("author-auto-match-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<iconify-icon icon="lucide:loader-2" style="animation:spin 1s linear infinite"></iconify-icon> <span>Eşleştiriliyor...</span>`;
    }

    try {
      const { groupCount, fileCount } = await _autoMatchBooks(books);
      if (groupCount === 0) {
        showToast("Otomatik eşleştirilecek dosya bulunamadı.", "warning");
      } else {
        showToast(`${groupCount} grup (${fileCount} dosya) otomatik eşleştirildi.`, "success");
      }
      renderAuthorDetail(activeAuthor);
    } catch (err) {
      console.error("[Authors] Otomatik eşleştirme hatası:", err);
      showToast("Otomatik eşleştirme sırasında hata oluştu.", "error");
      if (btn) btn.disabled = false;
    }
  });

  grid.addEventListener("click", (e) => {
    // Bölüm 4: Canonical rozet tıklandı → popover aç
    const canonBtn = e.target.closest(".canonical-badge");
    if (canonBtn) {
      e.stopPropagation();
      _toggleCanonicalPopover(canonBtn, books);
      return;
    }

    // Popover kapatma butonu
    if (e.target.closest(".canonical-popover-close")) {
      _closePopover();
      return;
    }

    // select-btn tıklandı — katalog sayfasındaki ile aynı mekanizma
    const selBtn = e.target.closest(".select-btn");
    if (selBtn) {
      e.stopPropagation();
      const card = selBtn.closest(".book-card");
      if (card?.dataset.id) {
        toggleSelection(card.dataset.id);
        const isSelected = selectedIds.has(card.dataset.id);
        selBtn.classList.toggle("active", isSelected);
        selBtn.title = isSelected ? "Seçimi kaldır" : "Seç";
        const icon = selBtn.querySelector("iconify-icon");
        if (icon) icon.setAttribute("icon", isSelected ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline");
        _updateBulkBar();
      }
      return;
    }

    // Kart tıklandı — seçim yoksa modal aç
    const bookCard = e.target.closest(".book-card");
    if (bookCard && bookCard.dataset.id && selectedIds.size === 0) {
      openModal(bookCard.dataset.id);
    }
  });

  // ── Manuel: Aynı Kitap Olarak Tanımla ────────────────────────────────────
  // Seçilen kitap ID'lerini setCanonicalId'e ilet; zincirleme genişleme
  // api-books.js'teki setCanonicalId içinde otomatik yapılır.
  document.getElementById("author-bulk-same")?.addEventListener("click", async () => {
    const ids = [...selectedIds];
    if (ids.length < 2) {
      showToast("En az 2 kitap seçmelisiniz.", "warning");
      return;
    }

    const confirmed = await _showConfirm(
      `${ids.length} seçili kitap "aynı kitap" olarak işaretlenecek. ` +
      `Aynı başlıktaki veya daha önce bağlı gruplardan kalan dosyalar da otomatik olarak dahil edilecek. ` +
      `Devam etmek istiyor musunuz?`
    );
    if (!confirmed) return;

    // canonicalId olarak boş olmayan bir değer göndermemiz yeterli;
    // setCanonicalId zaten mevcut en eski canonical_id'yi bulup kullanacak
    // (veya hiç yoksa yeni üretecek). Buradaki değer sadece "boş string değil"
    // sinyali — zincirleme genişleme aktif olsun diye.
    const triggerCanonicalId = `canon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      await setCanonicalId(ids, triggerCanonicalId);
      showToast(`Kitaplar başarıyla eşleştirildi.`, "success");
      selectedIds.clear();
      renderAuthorDetail(activeAuthor);
    } catch (err) {
      console.error("[Authors] canonical_id güncelleme hatası:", err);
      showToast("İşlem sırasında hata oluştu.", "error");
    }
  });

  // ── Bağlantıyı Kaldır ────────────────────────────────────────────────────
  document.getElementById("author-bulk-unlink")?.addEventListener("click", async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const confirmed = await _showConfirm(
      `${ids.length} kitabın "aynı kitap" bağlantısı kaldırılacak. Devam etmek istiyor musunuz?`
    );
    if (!confirmed) return;

    try {
      await setCanonicalId(ids, "");
      showToast(`${ids.length} kitabın bağlantısı kaldırıldı.`, "success");
      selectedIds.clear();
      renderAuthorDetail(activeAuthor);
    } catch (err) {
      console.error("[Authors] canonical_id temizleme hatası:", err);
      showToast("İşlem sırasında hata oluştu.", "error");
    }
  });

  // ── Seçimi Temizle ───────────────────────────────────────────────────────
  document.getElementById("author-bulk-clear")?.addEventListener("click", () => {
    selectedIds.clear();
    grid.querySelectorAll(".select-btn.active").forEach((btn) => {
      btn.classList.remove("active");
      btn.title = "Seç";
      const icon = btn.querySelector("iconify-icon");
      if (icon) icon.setAttribute("icon", "mdi:checkbox-blank-outline");
    });
    _updateBulkBar();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Bölüm 4 — Canonical Popover: Aç / Kapat / Oluştur
// ══════════════════════════════════════════════════════════════════════════════

function _closePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
}

function _toggleCanonicalPopover(btn, books) {
  if (_activePopover && _activePopover.dataset.forBookId === btn.dataset.bookId) {
    _closePopover();
    return;
  }
  _closePopover();

  const canonicalId = btn.dataset.canonicalId;
  const currentBookId = btn.dataset.bookId;
  if (!canonicalId) return;

  const linkedBooks = state.books.filter(
    (b) => (b.canonical_id || "").trim() === canonicalId
  );

  const popover = _buildPopover(linkedBooks, currentBookId);
  document.body.appendChild(popover);
  _activePopover = popover;
  _positionPopover(popover, btn);
}

function _buildPopover(linkedBooks, currentBookId) {
  const popover = document.createElement("div");
  popover.className = "canonical-popover";
  popover.dataset.forBookId = currentBookId;

  const header = document.createElement("div");
  header.className = "canonical-popover-header";
  header.innerHTML = `
    <span class="canonical-popover-title">
      <iconify-icon icon="lucide:link"></iconify-icon>
      Eşleştirilmiş Dosyalar (${linkedBooks.length})
    </span>
    <button class="canonical-popover-close" title="Kapat">
      <iconify-icon icon="lucide:x"></iconify-icon>
    </button>
  `;
  popover.appendChild(header);

  const list = document.createElement("div");
  list.className = "canonical-popover-list";

  if (linkedBooks.length === 0) {
    list.innerHTML = `<div style="padding:0.75rem 0.85rem;font-size:0.78rem;color:var(--text-3);">Eşleştirilmiş dosya bulunamadı.</div>`;
  } else {
    linkedBooks.forEach((book) => {
      const isCurrent = book.$id === currentBookId;
      const fmt = (book.format || "").toLowerCase();
      const fmtClass = fmt === "pdf" ? "fmt-pdf" : fmt === "epub" ? "fmt-epub" : "fmt-other";
      const fmtLabel = (book.format || "?").toUpperCase();

      const item = document.createElement("div");
      item.className = `canonical-popover-item${isCurrent ? " is-current" : ""}`;
      item.innerHTML = `
        <span class="canonical-item-format ${fmtClass}">${escapeHtml(fmtLabel)}</span>
        <div class="canonical-item-info">
          <span class="canonical-item-title">${escapeHtml(book.title || "Başlıksız")}</span>
          <span class="canonical-item-publisher">${escapeHtml(book.publisher || "Yayınevi bilinmiyor")}</span>
        </div>
        ${isCurrent ? `<span class="canonical-item-self-tag">Bu dosya</span>` : ""}
      `;
      list.appendChild(item);
    });
  }
  popover.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "canonical-popover-footer";
  footer.textContent = "Bu dosyalar istatistiklerde tek kitap olarak sayılır.";
  popover.appendChild(footer);

  header.querySelector(".canonical-popover-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _closePopover();
  });

  return popover;
}

function _positionPopover(popover, btn) {
  const btnRect = btn.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  popover.style.visibility = "hidden";
  const popW = popover.offsetWidth  || 300;
  const popH = popover.offsetHeight || 250;

  let left = btnRect.right - popW;
  if (left < 8) left = 8;
  if (left + popW > viewportW - 8) left = viewportW - popW - 8;

  let top = btnRect.bottom + 6;
  if (top + popH > viewportH - 8) top = btnRect.top - popH - 6;
  if (top < 8) top = 8;

  popover.style.left       = `${left}px`;
  popover.style.top        = `${top}px`;
  popover.style.visibility = "visible";
}

// ══════════════════════════════════════════════════════════════════════════════
// Bölüm 4 sonu
// ══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA (yalnızca bir kez)
// ═══════════════════════════════════════════════════════════════

export function initAuthors() {
  document.getElementById("authors-content")?.addEventListener("click", (e) => {
    const alphaBtn = e.target.closest(".alpha-btn");
    if (alphaBtn && alphaBtn.dataset.letter) {
      scrollToGroup(alphaBtn.dataset.letter, ID_PREFIX);
      return;
    }

    const authorRow = e.target.closest(".author-row");
    if (authorRow && authorRow.dataset.author) {
      _savedScrollY = window.scrollY;
      activeAuthor = authorRow.dataset.author;
      renderAuthorDetail(activeAuthor);
      return;
    }
  });

  // Bölüm 4: Sayfa dışına tıklanırsa popover'ı kapat
  document.addEventListener("click", (e) => {
    if (!_activePopover) return;
    if (!e.target.closest(".canonical-popover") && !e.target.closest(".canonical-badge")) {
      _closePopover();
    }
  });

  // Escape tuşu ile kapat
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _activePopover) {
      _closePopover();
    }
  });
}