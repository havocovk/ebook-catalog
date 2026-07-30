// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-QUICKFILL — Hızlı Kategori Doldurma Modu (Adım 38).
//
// AMAÇ: Kategorisi boş olan kitapları tek tek, hızlıca doldurmak için sade
// bir pop-up. Mevcut kitap detay modalından (modal.js) bağımsızdır — orada
// onlarca alan var (yazar, yayınevi, seri, notlar...), burada SADECE
// kategori alanına odaklanılır.
//
// NASIL ÇALIŞIR:
//   1) Kullanıcı "Kategori Durumu: Kategorisi Boş" filtresini seçer
//      (catalog-filters.js, Adım 37).
//   2) Toolbar'da "Hızlı Doldur" butonu görünür hale gelir (sadece bu filtre
//      aktifken — bkz. catalog-ui.js render() içindeki updateQuickFillButton).
//   3) Butona basınca bu modül, O ANKİ filtrelenmiş listeyi (catalog-filters.js
//      'tan `filtered`) bir kopya olarak alır ve ilk kitabı gösterir.
//   4) Kategori yazılıp Enter'a basılınca / "Kaydet ve Sonraki"ye tıklanınca:
//      veritabanına yazılır (api-books.js → updateBookRecordWithCascade),
//      hafızadaki (state.books) kopya güncellenir, sıradaki kitaba geçilir.
//   5) "Atla" → bu kitabı boş bırakıp sıradakine geçer (kaydetmeden).
//   6) Liste biterse veya kullanıcı kapatırsa: modal kapanır, katalog sayfası
//      yeniden çizilir (artık doldurulan kitaplar "Kategorisi Boş" filtresinden
//      düşmüş olacağı için liste otomatik güncellenir).
//
// NOT: "Seçenek A" tasarımı — bu modül diğer filtrelerle (seri, yazar vb.)
// birlikte uygulanmış filtreyi aynen kullanır. Kullanıcı önce "Seri = X" +
// "Kategorisi Boş" seçerse, Hızlı Doldur sadece o alt kümeyi (örn. 5 kitap)
// gezer; hiçbir ek filtre seçmezse kataloğun TÜMÜNDEKİ boş kategorili
// kitapları (örn. 52 kitap) gezer.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { updateBookRecordWithCascade } from "../../core/api.js";
import { showToast, escapeHtml } from "../../ui/common.js";
import { filtered, ui, recompute } from "./catalog-filters.js";

// ── Oturum durumu (modal açıkken) ───────────────────────────────────────────
let queue = [];        // gezilecek kitapların DONMUŞ kopyası (referans listesi, $id'ler)
let currentIndex = 0;  // queue içindeki şu anki kitabın sırası
let doneCount = 0;     // bu oturumda kaydedilen kitap sayısı (kapanışta özet için)

// ── Modal'ı aç ───────────────────────────────────────────────────────────────
// O anki filtrelenmiş listeyi (catalog-filters.js'deki `filtered`) kopyalar.
// Kopyalamak önemli: kullanıcı kategori girip kaydettikçe kitap listeden
// düşecek (filtre yeniden hesaplanınca), ama biz oturumun BAŞINDAKİ sırayı
// takip etmeliyiz — canlı `filtered` dizisine referans tutmuyoruz.
export function openQuickFill() {
  // Sadece $id'leri kopyalıyoruz; her adımda state.books'tan güncel halini
  // okuyacağız (kategori/tür dışındaki alanlar oturum sırasında değişmiş olabilir).
  // Kuyruk: kategorisi VEYA türü boş olan kitaplar
  queue = filtered
    .filter((b) => !b.category || !b.genre)
    .map((b) => b.$id);
  currentIndex = 0;
  doneCount = 0;

  if (queue.length === 0) {
    showToast("Kategori/türü boş kitap bulunamadı.", "error");
    return;
  }

  document.getElementById("quickfill-modal")?.classList.remove("hidden");
  document.getElementById("quickfill-modal")?.classList.add("visible");
  renderCurrentBook();
}

// ── Modal'ı kapat ────────────────────────────────────────────────────────────
function closeQuickFill() {
  document.getElementById("quickfill-modal")?.classList.remove("visible");
  document.getElementById("quickfill-modal")?.classList.add("hidden");
  queue = [];
  currentIndex = 0;

  // Kullanıcı en az 1 kitap kaydettiyse katalog listesini tazele — doldurulan
  // kitaplar "Kategorisi Boş" filtresinden düşer, ekran güncel kalsın.
  if (doneCount > 0) {
    recompute(false);
  }
}

// ── Şu anki kitabı ekrana çiz ────────────────────────────────────────────────
function renderCurrentBook() {
  // Kuyruk bitti mi? (son kitap kaydedildi/atlandı)
  if (currentIndex >= queue.length) {
    finishSession();
    return;
  }

  const bookId = queue[currentIndex];
  const book = state.books.find((b) => b.$id === bookId);

  // Kitap artık state.books'ta yoksa (örn. oturum sırasında silindi) atla.
  if (!book) {
    currentIndex++;
    renderCurrentBook();
    return;
  }

  // Kapak
  const coverEl = document.getElementById("quickfill-cover");
  if (coverEl) {
    coverEl.innerHTML = book.cover_url
      ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" />`
      : `<div class="cover-placeholder large">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  }

  // Başlık / yazar
  const titleEl  = document.getElementById("quickfill-title");
  const authorEl = document.getElementById("quickfill-author");
  if (titleEl)  titleEl.textContent  = book.title  || "(Başlıksız)";
  if (authorEl) authorEl.textContent = book.author || "Yazar bilinmiyor";

  // İlerleme göstergesi: "Kitap 3 / 52"
  const progressEl = document.getElementById("quickfill-progress");
  if (progressEl) {
    progressEl.textContent = `Kitap ${currentIndex + 1} / ${queue.length}`;
  }

  // Kategori kutusunu doldur
  const input = document.getElementById("quickfill-category-input");
  if (input) {
    input.value = book.category || "";
  }

  // Tür kutusunu doldur + odaklan
  const genreInput = document.getElementById("quickfill-genre-input");
  if (genreInput) {
    genreInput.value = book.genre || "";
    setTimeout(() => {
      // Kategori doluysa tür inputuna, değilse kategori inputuna odaklan
      if (book.category && input) input.focus();
      else if (input) input.focus();
    }, 0);
  }
}

// ── Geçerli kitabın kategorisini kaydet ve sonrakine geç ───────────────────
async function saveAndNext() {
  const bookId    = queue[currentIndex];
  const catInput  = document.getElementById("quickfill-category-input");
  const genreInput = document.getElementById("quickfill-genre-input");
  const catValue  = catInput  ? catInput.value.trim()  : "";
  const genreValue = genreInput ? genreInput.value.trim() : "";

  if (!catValue && !genreValue) {
    // İkisi de boş — kaydetmeye zorlamıyoruz, "Atla" ile aynı davranır.
    skipCurrent();
    return;
  }

  const saveBtn = document.getElementById("quickfill-save-next");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const updates = {};
    if (catValue)   updates.category = catValue;
    if (genreValue) updates.genre    = genreValue;
    await updateBookRecordWithCascade(bookId, updates);
    doneCount++;
    currentIndex++;
    renderCurrentBook();
  } catch (err) {
    showToast("Kayıt hatası: " + (err?.message || err), "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Bu kitabı atla (kaydetmeden sonrakine geç) ───────────────────────────────
function skipCurrent() {
  currentIndex++;
  renderCurrentBook();
}

// ── Oturum bitti: özet göster ve kapat ──────────────────────────────────────
function finishSession() {
  showToast(`Hızlı Doldurma tamamlandı: ${doneCount} kitaba kategori girildi.`);
  closeQuickFill();
}

// ── Olayları bağla (yalnızca bir kez, app.js başlangıcında) ─────────────────
export function initQuickFill() {
  document.getElementById("quickfill-close")?.addEventListener("click", closeQuickFill);

  document.getElementById("quickfill-save-next")?.addEventListener("click", saveAndNext);
  document.getElementById("quickfill-skip")?.addEventListener("click", skipCurrent);

  // Enter tuşu → Kaydet ve Sonraki
  const _keyHandler = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveAndNext();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeQuickFill();
    }
  };
  document.getElementById("quickfill-category-input")?.addEventListener("keydown", _keyHandler);
  document.getElementById("quickfill-genre-input")?.addEventListener("keydown", _keyHandler);

  // Arka plana tıklayınca kapat (mevcut book-modal ile aynı davranış)
  document.getElementById("quickfill-modal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeQuickFill();
  });
}

// ── Toolbar butonunu tetikleyen dış fonksiyon ────────────────────────────────
export function handleQuickFillButtonClick() {
  openQuickFill();
}