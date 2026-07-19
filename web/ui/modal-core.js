// ─────────────────────────────────────────────────────────────────────────────
// MODAL-CORE — Kitap detay modal'ının çekirdek mantığı.
//
// Sorumluluklar:
//   • openModal(bookId)     — Modal'ı aç, form alanlarını kitap verisiyle doldur
//   • closeModal()          — Modal'ı kapat, state'i sıfırla
//   • saveModal()           — Form verilerini oku, veritabanına kaydet
//   • applyUpdate()         — Ortak güncelleme yardımcısı (db + state + UI)
//   • deleteCurrentBook()   — Mevcut kitabı sil
//   • handleCoverFileSelected() — Kapak resmi yükleme
//   • initModal()           — Event listener'ları bir kez bağla
//   • renderCoverArea()     — Kapak alanını çiz
//   • toggleAcademicFields() — Akademik alt alanları göster/gizle
//
// Bağımlılıklar:
//   ← state.js              (kitap, yazar, yayınevi, seri verileri)
//   ← api.js                (updateBookRecordWithCascade, deleteBookRecord, vb.)
//   ← router.js             (refreshCurrentPage)
//   ← common.js             (showToast, escapeHtml, formatFileSize, vb.)
//   ← components.js         (renderStars)
//   ← entity-picker.js      (mountEntityPicker)
//   ← modal-dialog.js       (_showConfirm)
//   ← modal-lock.js         (_getLock, _setLock, _applyLockState, _buildLockedView)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import {
  updateBookRecordWithCascade,
  deleteBookRecord,
  uploadBookCover,
  extractCoverFileId,
  createAuthor,
  renameAuthorEverywhere,
  deleteAuthorEverywhere,
  createPublisher,
  renamePublisherEverywhere,
  deletePublisherEverywhere,
  createSeries,
  renameSeriesEverywhere,
  deleteSeriesEverywhere,
  createCollection,
} from "../core/api.js";
import { refreshCurrentPage } from "../core/router.js";
import { showToast, escapeHtml, formatFileSize, confidenceLevel, confidenceLabel } from "./common.js";
import { renderStars } from "./components.js";
import { mountEntityPicker } from "./entity-picker.js";
import { _showConfirm } from "./modal-dialog.js";
import { _getLock, _setLock, _applyLockState, _buildLockedView } from "./modal-lock.js";

// Şu an düzenlenen kitabın ID'si. Modal kapalıyken null.
let editingId = null;

// Açılır menüler (initModal'da bir kez kurulur).
let authorPicker    = null;
let publisherPicker = null;
let seriesPicker    = null;

// ─── Yardımcı: o an modalda seçili yayınevinin $id'si (yoksa null) ──────────
// Seri alanı buna göre filtrelenir/etkinleşir.
function currentPublisherId() {
  const pubName = document.getElementById("modal-publisher").value.trim();
  const pub = state.publishers.find((p) => p.name === pubName);
  return pub ? pub.$id : null;
}

// ─── Yardımcı: seri alanının durumunu yayıneviye göre ayarla ────────────────
// resetIfInvalid=true ise, seçili seri yeni yayıneviye ait değilse temizlenir.
function updateSeriesAvailability(resetIfInvalid) {
  if (!seriesPicker) return;
  const pubId = currentPublisherId();
  const hint  = document.getElementById("series-hint");

  if (pubId) {
    if (resetIfInvalid) {
      const cur     = document.getElementById("modal-series").value.trim();
      const belongs = state.series.some(
        (s) => s.publisher_id === pubId && s.name === cur
      );
      if (!belongs) seriesPicker.setByName("");
    }
    seriesPicker.setEnabled(true);
    seriesPicker.refresh();
    if (hint) hint.classList.add("hidden");
  } else {
    // Yayınevi yok → seri seçilemez.
    seriesPicker.setByName("");
    seriesPicker.setEnabled(false);
    if (hint) hint.classList.remove("hidden");
  }
}

// ─── Kapak alanını çiz: resim varsa göster, yoksa yer tutucu göster ────────
// Hem modal açılışında hem de yeni kapak yüklendikten sonra çağrılır.
//
// Adım 35: Kapak resminin storage dosya ID'sini "title" attribute'una
// koyuyoruz — tarayıcının yerleşik davranışıyla, resmin üzerine gelince
// tooltip olarak görünür. Kullanıcı o ID'yi arayıp kapağı eksik olan diğer
// versiyona yükleyebilir.
function renderCoverArea(book) {
  let coverHtml;
  if (book.cover_url) {
    const fileId  = extractCoverFileId(book.cover_url);
    const tooltip = fileId ? `${fileId}.jpg` : "";
    coverHtml = `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" title="${escapeHtml(tooltip)}" />`;
  } else {
    coverHtml = `<div class="cover-placeholder large">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  }
  document.getElementById("modal-cover").innerHTML = coverHtml;
}

// ── Adım 11: Alt Alan/Konu kutularını göster/gizle ──────────────────────────
// Akademik kutucuğu işaretliyken kutular görünür; işaretsizken gizlenir ve
// kutuların içeriği temizlenir (gizliyken eski değer kalıp sessizce kaydedilmesin).
function toggleAcademicFields(isAcademic) {
  const wrap = document.getElementById("modal-academic-fields");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !isAcademic);
  if (!isAcademic) {
    document.getElementById("modal-subcategory").value = "";
    document.getElementById("modal-topic").value       = "";
  }
}

// ─── Modal'ı aç ─────────────────────────────────────────────────────────────
export function openModal(bookId) {
  const book = state.books.find((b) => b.$id === bookId);
  if (!book) return;

  editingId = bookId;

  renderCoverArea(book);

  // Adım 3: Modal başlığındaki güven skoru rozeti
  const confBadgeEl = document.getElementById("modal-confidence-badge");
  if (confBadgeEl) {
    const level = confidenceLevel(book.confidence_score);
    if (level) {
      confBadgeEl.textContent = `${confidenceLabel(level)} Güven (${book.confidence_score}/100)`;
      confBadgeEl.className   = `confidence-badge-lg confidence-${level}`;
      confBadgeEl.classList.remove("hidden");
    } else {
      confBadgeEl.classList.add("hidden");
    }
  }

  // Alan sırası: Kitap Adı → Yazar → Yayınevi → Seri → Durum/Yıl → Puan → ...
  document.getElementById("modal-title").value        = book.title || "";
  if (authorPicker)    authorPicker.setByName(book.author || "");
  if (publisherPicker) publisherPicker.setByName(book.publisher || "");

  // Seri yayıneviye bağlı: yayınevi ayarlandıktan SONRA seriyi ayarla.
  if (seriesPicker) {
    seriesPicker.setByName(book.series || "");
    updateSeriesAvailability(false);   // kayıtlı veri tutarlı; temizleme yok
  }

  document.getElementById("modal-series-order").value = book.series_order ?? "";
  document.getElementById("modal-edition").value      = book.edition || "";
  document.getElementById("modal-category").value     = book.category || "";

  // Adım 11: Akademik kutucuğu + Alt Alan/Konu doldur
  const isAcademic = Boolean(book.is_academic);
  document.getElementById("modal-is-academic").checked = isAcademic;
  document.getElementById("modal-subcategory").value   = book.subcategory || "";
  document.getElementById("modal-topic").value         = book.topic || "";
  toggleAcademicFields(isAcademic);

  document.getElementById("modal-year").value         = book.year ?? "";
  document.getElementById("modal-status").value       = book.status || "okunmadi";
  document.getElementById("modal-notes").value        = book.notes || "";
  document.getElementById("modal-finished-at").value  = book.finished_at || "";
  document.getElementById("modal-tags").value         = (book.tags || []).join(", ");

  // Adım 19: Koleksiyonlar — tags ile birebir aynı ayrıştırma mantığı.
  document.getElementById("modal-collections").value  = (book.collections || []).join(", ");

  document.getElementById("modal-file-path").textContent = book.file_path || "";
  document.getElementById("modal-file-size").textContent = formatFileSize(book.file_size);
  document.getElementById("modal-format").textContent    = (book.format || "").toUpperCase();

  document.getElementById("modal-language").value = book.language || "";
  document.getElementById("modal-genre").value    = book.genre || "";
  document.getElementById("modal-rating").innerHTML = renderStars(book.rating, true, bookId);

  // Adım 17: Favori kutucuğunu doldur
  const favoriteEl = document.getElementById("modal-favorite");
  if (favoriteEl) favoriteEl.checked = Boolean(book.favorite);

  // Adım 39: Fiziksel kopya kutucuğunu doldur
  const physicalEl = document.getElementById("modal-physical-copy");
  if (physicalEl) physicalEl.checked = Boolean(book.has_physical_copy);

  // Adım 4 (V5): Kitabın önceki kilit durumunu geri yükle
  const locked = _getLock(bookId);
  _buildLockedView(book);
  _applyLockState(locked);

  const modal = document.getElementById("book-modal");
  modal.classList.remove("hidden");
  modal.classList.add("visible");
}

// ─── Modal'ı kapat ──────────────────────────────────────────────────────────
export function closeModal() {
  const modal = document.getElementById("book-modal");
  modal.classList.remove("visible");
  modal.classList.add("hidden");
  // Adım 4 (V5): DOM'u AÇIK konumuna döndür (bir sonraki kitap doğru başlasın).
  // Map'teki kayıt SİLİNMEZ — aynı kitap yeniden açılınca kilit durumu geri gelir.
  _applyLockState(false);
  editingId = null;
}

// ─── Ortak güncelleme: veritabanı + hafıza + ekran ──────────────────────────
// Adım 34: updateBookRecord yerine updateBookRecordWithCascade kullanılıyor.
// Cascade, kaydetme sırasında eski değerlerin artık hiçbir kitapta kullanılmıyorsa
// otomatik olarak silinmesini sağlar.
async function applyUpdate(id, updates) {
  try {
    await updateBookRecordWithCascade(id, updates);
    refreshCurrentPage();
    showToast("Kaydedildi.");
  } catch (err) {
    showToast("Kayıt hatası: " + (err?.message || err), "error");
  }
}

// ─── Kaydet ─────────────────────────────────────────────────────────────────
async function saveModal() {
  if (!editingId) return;

  const tags = document.getElementById("modal-tags").value
    .split(",").map((t) => t.trim()).filter(Boolean);

  // Adım 19: Koleksiyonlar — tags ile birebir aynı ayrıştırma mantığı.
  const collections = document.getElementById("modal-collections").value
    .split(",").map((c) => c.trim()).filter(Boolean);

  // Adım 27: Yeni koleksiyon adlarını ANLIK olarak collections tablosuna yaz.
  // createCollection() zaten aynı isimde kayıt varsa onu döndürür (tekrar oluşturmaz).
  for (const name of collections) {
    try {
      await createCollection(name);
    } catch (err) {
      console.warn(`[saveModal] Koleksiyon oluşturulamadı (${name}):`, err?.message || err);
    }
  }

  const finishedAt     = document.getElementById("modal-finished-at").value || null;
  const seriesOrderRaw = document.getElementById("modal-series-order").value;
  const yearRaw        = document.getElementById("modal-year").value;

  const updates = {
    title:        document.getElementById("modal-title").value.trim(),
    author:       document.getElementById("modal-author").value.trim() || null,
    publisher:    document.getElementById("modal-publisher").value.trim() || null,
    series:       document.getElementById("modal-series").value.trim() || null,
    series_order: seriesOrderRaw === "" ? null : parseInt(seriesOrderRaw) || null,
    edition:      document.getElementById("modal-edition").value.trim() || null,
    category:     document.getElementById("modal-category").value.trim() || null,
    // Adım 11: Akademik işareti + Alt Alan/Konu
    is_academic:  document.getElementById("modal-is-academic").checked,
    subcategory:  document.getElementById("modal-subcategory").value.trim() || null,
    topic:        document.getElementById("modal-topic").value.trim() || null,
    year:         yearRaw === "" ? null : parseInt(yearRaw) || null,
    language:     document.getElementById("modal-language").value || null,
    genre:        document.getElementById("modal-genre").value.trim() || null,
    status:       document.getElementById("modal-status").value,
    notes:        document.getElementById("modal-notes").value.trim() || null,
    finished_at:  finishedAt,
    tags,
    collections,
  };

  await applyUpdate(editingId, updates);
  closeModal();
}

// ── Kapak resmi yükleme ──────────────────────────────────────────────────────
async function handleCoverFileSelected(file) {
  if (!file || !editingId) return;

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    showToast("Sadece JPG, PNG veya WEBP resim dosyası yükleyebilirsiniz.", "error");
    return;
  }

  try {
    showToast("Kapak resmi yükleniyor...");
    const newCoverUrl = await uploadBookCover(editingId, file);

    // Modal'daki kapak alanını anında güncelle.
    const book = state.books.find((b) => b.$id === editingId);
    if (book) renderCoverArea(book);

    // Kataloğdaki kart görünümünü de tazele.
    refreshCurrentPage();
    showToast("Kapak resmi güncellendi.");
  } catch (err) {
    showToast("Kapak yüklenemedi: " + (err?.message || err), "error");
  }
}

// ─── Sil ────────────────────────────────────────────────────────────────────
async function deleteCurrentBook() {
  if (!editingId) return;
  const confirmed = await _showConfirm("Bu kitabı katalogdan sil?");
  if (!confirmed) return;

  try {
    await deleteBookRecord(editingId);
    refreshCurrentPage();
    closeModal();
    showToast("Kitap silindi.");
  } catch (err) {
    console.error(`[deleteCurrentBook] Kitap silinemedi (${editingId}):`, err?.message || err, err);
    showToast("Silme hatası: " + (err?.message || err), "error");
  }
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initModal() {
  // Yazar açılır menüsünü kur.
  authorPicker = mountEntityPicker({
    prefix: "author",
    placeholder: "Yazar seç...",
    addPromptLabel: "Yeni yazar adı:",
    editPromptLabel: "Yazar adını düzenle:",
    deleteConfirm: (name) =>
      `"${name}" yazarını sil?\nBu yazara bağlı kitapların yazar bilgisi boşalacak.`,
    getItems: () => state.authors,
    onAdd:    (name) => createAuthor(name),
    onRename: (id, oldName, newName) => renameAuthorEverywhere(id, oldName, newName),
    onDelete: (id, name) => deleteAuthorEverywhere(id, name),
    onChange: () => { refreshCurrentPage(); },
  });

  // Yayınevi açılır menüsü — yazarla aynı mantık.
  publisherPicker = mountEntityPicker({
    prefix: "publisher",
    placeholder: "Yayınevi seç...",
    addPromptLabel: "Yeni yayınevi adı:",
    editPromptLabel: "Yayınevi adını düzenle:",
    deleteConfirm: (name) =>
      `"${name}" yayınevini sil?\nBu yayınevine bağlı kitapların yayınevi bilgisi boşalacak.`,
    getItems: () => state.publishers,
    onAdd:    (name) => createPublisher(name),
    onRename: (id, oldName, newName) => renamePublisherEverywhere(id, oldName, newName),
    onDelete: (id, name) => deletePublisherEverywhere(id, name),
    onChange: () => {
      refreshCurrentPage();
      // Yayınevi değişti → seri listesini güncelle, geçersiz seriyi temizle.
      updateSeriesAvailability(true);
    },
  });

  // Seri açılır menüsü — YAYINEVİNE bağlı.
  seriesPicker = mountEntityPicker({
    prefix: "series",
    placeholder: "Seri seç...",
    addPromptLabel: "Yeni seri adı:",
    editPromptLabel: "Seri adını düzenle:",
    deleteConfirm: (name) =>
      `"${name}" serisini sil?\nBu seriye ait kitapların seri bilgisi boşalacak.`,
    getItems: () => {
      const pubId = currentPublisherId();
      if (!pubId) return [];
      return state.series.filter((s) => s.publisher_id === pubId);
    },
    onAdd:    (name) => createSeries(name, currentPublisherId()),
    onRename: (id, oldName, newName) =>
      renameSeriesEverywhere(id, oldName, newName, currentPublisherId()),
    onDelete: (id, name) =>
      deleteSeriesEverywhere(id, name, currentPublisherId()),
    onChange: () => { refreshCurrentPage(); },
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", saveModal);
  document.getElementById("modal-delete").addEventListener("click", deleteCurrentBook);

  // Adım 4 (V5): Kilitle / Kilidi Aç butonu
  document.getElementById("modal-lock-btn")?.addEventListener("click", () => {
    if (!editingId) return;
    const wasLocked = _getLock(editingId);
    const nowLocked = !wasLocked;
    _setLock(editingId, nowLocked);
    // Kilitlenince kilitli view'ı güncel kitap verisiyle yeniden oluştur.
    // (state.books'taki SON KAYDEDİLMİŞ veriyi gösterir — kaydedilmemiş
    // form değişikliklerini değil.)
    if (nowLocked) {
      const book = state.books.find((b) => b.$id === editingId);
      if (book) _buildLockedView(book);
    }
    _applyLockState(nowLocked);
  });

  // Kapak resmi yükleme: butona basınca gizli dosya seçiciyi tetikle.
  const coverInput = document.getElementById("modal-cover-input");
  document.getElementById("modal-cover-upload-btn")?.addEventListener("click", () => {
    coverInput?.click();
  });
  coverInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    handleCoverFileSelected(file);
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
  });

  // Overlay'e tıklayınca kapat.
  document.getElementById("book-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Yıldız puanlama — tıklanınca anında kaydedilir.
  document.getElementById("modal-rating").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("star")) return;
    const rating = parseInt(e.target.dataset.rating);
    const bookId = e.target.dataset.bookId;
    if (!bookId) return;

    document.querySelectorAll("#modal-rating .star").forEach((s, i) => {
      s.classList.toggle("filled", i < rating);
    });

    await applyUpdate(bookId, { rating });
  });

  // Escape tuşuyla kapat.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Adım 11: Akademik onay kutusu — işaretlenince Alt Alan/Konu görünür.
  document.getElementById("modal-is-academic")?.addEventListener("change", (e) => {
    toggleAcademicFields(e.target.checked);
  });

  // Adım 17: Favori onay kutusu — tıklanır tıklanmaz anında kaydedilir.
  document.getElementById("modal-favorite")?.addEventListener("change", async (e) => {
    if (!editingId) return;
    await applyUpdate(editingId, { favorite: e.target.checked });
  });

  // Adım 39: Fiziksel kopya onay kutusu — favori ile aynı kalıp.
  document.getElementById("modal-physical-copy")?.addEventListener("change", async (e) => {
    if (!editingId) return;
    await applyUpdate(editingId, { has_physical_copy: e.target.checked });
  });
}