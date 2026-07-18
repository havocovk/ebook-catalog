// ─────────────────────────────────────────────────────────────────────────────
// MODAL — Kitap detay pop-up'ı.
//
// 3C güncellemesi:
//   • "Başlık" etiketi → "Kitap Adı"
//   • Yayınevi alanı eklendi (Yazar'ın hemen altında)
//   • Alan sırası: Kitap Adı → Yazar → Yayınevi → Seri → Durum/Yıl →
//                  Puan → Bitirildi → Notlar → Etiketler
//   • Her alan başlığına Lucide ikonu eklendi
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import {
  updateBookRecordWithCascade, // ── Adım 34: updateBookRecord yerine, kapsayan cascade kontrolüyle
  deleteBookRecord,
  uploadBookCover,
  extractCoverFileId, // ── Adım 35: kapak resminin storage dosya ID'sini tooltip'te göstermek için
  createAuthor,
  renameAuthorEverywhere,
  deleteAuthorEverywhere,
  createPublisher,
  renamePublisherEverywhere,
  deletePublisherEverywhere,
  createSeries,
  renameSeriesEverywhere,
  deleteSeriesEverywhere,
  createCollection, // ── Adım 27: koleksiyonların da author/publisher/series gibi anlık oluşturulması için
} from "../core/api.js";
import { refreshCurrentPage } from "../core/router.js";
import { showToast, escapeHtml, formatFileSize, confidenceLevel, confidenceLabel } from "./common.js";
import { renderStars } from "./components.js";
import { mountEntityPicker } from "./entity-picker.js";

// Şu an düzenlenen kitabın ID'si. Modal kapalıyken null.
let editingId = null;

// ── Adım 4 (V5): Kilit durumu — true = kilitli görünüm, false = form görünümü.
// Her openModal() çağrısında false'a sıfırlanır.
let _isLocked = false;

// Açılır menüler (initModal'da bir kez kurulur).
let authorPicker = null;
let publisherPicker = null;
let seriesPicker = null;

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
  const hint = document.getElementById("series-hint");

  if (pubId) {
    if (resetIfInvalid) {
      // Seçili seri bu yayıneviye ait mi? Değilse temizle.
      const cur = document.getElementById("modal-series").value.trim();
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
// ── Adım 35: Kapak resminin storage dosya ID'sini "title" attribute'una
// koyuyoruz — bu, tarayıcının yerleşik davranışıyla, resmin üzerine fare ile
// gelindiğinde küçük bir araç ipucu (tooltip) olarak görünür. Amaç: birden
// fazla format (PDF/EPUB) versiyonu olan bir kitapta, kapağı olan versiyonun
// dosyasını Appwrite Storage konsolunda bulmayı kolaylaştırmak — kullanıcı
// o ID'yi arayıp aynı resmi kapağı eksik olan diğer versiyona indirip
// yükleyebilir. Kart/modal üzerinde KALICI olarak görünmez, sadece hover'da.
function renderCoverArea(book) {
  let coverHtml;
  if (book.cover_url) {
    const fileId = extractCoverFileId(book.cover_url);
    const tooltip = fileId ? `${fileId}.jpg` : "";
    coverHtml = `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" title="${escapeHtml(tooltip)}" />`;
  } else {
    coverHtml = `<div class="cover-placeholder large">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  }

  document.getElementById("modal-cover").innerHTML = coverHtml;
}

// ─── Modal'ı aç ─────────────────────────────────────────────────────────────
export function openModal(bookId) {
  const book = state.books.find((b) => b.$id === bookId);
  if (!book) return;

  editingId = bookId;

  renderCoverArea(book);

  // ── Adım 3: Modal başlığındaki güven skoru rozeti ──────────────────────
  const confBadgeEl = document.getElementById("modal-confidence-badge");
  if (confBadgeEl) {
    const level = confidenceLevel(book.confidence_score);
    if (level) {
      confBadgeEl.textContent = `${confidenceLabel(level)} Güven (${book.confidence_score}/100)`;
      confBadgeEl.className = `confidence-badge-lg confidence-${level}`;
      confBadgeEl.classList.remove("hidden");
    } else {
      confBadgeEl.classList.add("hidden");
    }
  }

  // Alan sırası: Kitap Adı → Yazar → Yayınevi → Seri → Durum/Yıl → Puan → ...
  document.getElementById("modal-title").value        = book.title || "";
  if (authorPicker) authorPicker.setByName(book.author || "");        // Yazar
  if (publisherPicker) publisherPicker.setByName(book.publisher || ""); // Yayınevi
  // Seri yayıneviye bağlı: yayınevi ayarlandıktan SONRA seriyi ayarla.
  if (seriesPicker) {
    seriesPicker.setByName(book.series || "");
    updateSeriesAvailability(false);   // kayıtlı veri tutarlı; temizleme yok
  }
  document.getElementById("modal-series-order").value = book.series_order ?? "";
  document.getElementById("modal-edition").value      = book.edition || "";
  document.getElementById("modal-category").value     = book.category || "";   // ── Adım 1

  // ── Adım 11: Akademik kutucuğu + Alt Alan/Konu doldur ───────────────────
  const isAcademic = Boolean(book.is_academic);
  document.getElementById("modal-is-academic").checked = isAcademic;
  document.getElementById("modal-subcategory").value   = book.subcategory || "";
  document.getElementById("modal-topic").value         = book.topic || "";
  toggleAcademicFields(isAcademic);
  // ── Adım 11 sonu ─────────────────────────────────────────────────────────
  document.getElementById("modal-year").value         = book.year ?? "";
  document.getElementById("modal-status").value       = book.status || "okunmadi";
  document.getElementById("modal-notes").value        = book.notes || "";
  document.getElementById("modal-finished-at").value  = book.finished_at || "";
  document.getElementById("modal-tags").value         = (book.tags || []).join(", ");
  // ── Adım 19: Koleksiyonlar — modal-tags ile birebir aynı kalıp (serbest
  // metin, virgülle ayrılmış) — ayrı bir dropdown/seçici kurulmadı, kullanıcı
  // deneyimi açısından zaten tanıdık bir desen olduğu için.
  document.getElementById("modal-collections").value  = (book.collections || []).join(", ");
  // ── Adım 19 sonu ──────────────────────────────────────────────────────────
  document.getElementById("modal-file-path").textContent = book.file_path || "";
  document.getElementById("modal-file-size").textContent = formatFileSize(book.file_size);
  document.getElementById("modal-format").textContent    = (book.format || "").toUpperCase();

  document.getElementById("modal-language").value      = book.language || "";
  document.getElementById("modal-rating").innerHTML = renderStars(book.rating, true, bookId);

  // ── Adım 17: Favori kutucuğunu doldur ────────────────────────────────────
  const favoriteEl = document.getElementById("modal-favorite");
  if (favoriteEl) favoriteEl.checked = Boolean(book.favorite);
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  // ── Adım 39: Fiziksel kopya kutucuğunu doldur ────────────────────────────
  const physicalEl = document.getElementById("modal-physical-copy");
  if (physicalEl) physicalEl.checked = Boolean(book.has_physical_copy);
  // ── Adım 39 sonu ──────────────────────────────────────────────────────────

  // ── Adım 4 (V5): Her açılışta AÇIK moddan başla + kilitli view'ı hazırla ──
  _isLocked = false;
  _applyLockState(false);
  _buildLockedView(book);
  // ── Adım 4 (V5) sonu ──────────────────────────────────────────────────────

  const modal = document.getElementById("book-modal");
  modal.classList.remove("hidden");
  modal.classList.add("visible");
}

// ─── Modal'ı kapat ──────────────────────────────────────────────────────────
export function closeModal() {
  const modal = document.getElementById("book-modal");
  modal.classList.remove("visible");
  modal.classList.add("hidden");
  editingId = null;
  // ── Adım 4 (V5): Kapanınca kilit durumunu sıfırla ────────────────────────
  _isLocked = false;
  _applyLockState(false);
  // ── Adım 4 (V5) sonu ──────────────────────────────────────────────────────
}

// ─── Kaydet ─────────────────────────────────────────────────────────────────
async function saveModal() {
  if (!editingId) return;

  const tags = document.getElementById("modal-tags").value
    .split(",").map((t) => t.trim()).filter(Boolean);

  // ── Adım 19: Koleksiyonlar — tags ile birebir aynı ayrıştırma mantığı.
  const collections = document.getElementById("modal-collections").value
    .split(",").map((c) => c.trim()).filter(Boolean);
  // ── Adım 19 sonu ──────────────────────────────────────────────────────────

  // ── Adım 27: Yeni koleksiyon adlarını ANLIK olarak collections tablosuna
  // yaz — author/publisher/series için entity-picker'ın onAdd callback'i
  // (createAuthor/createPublisher/createSeries) bunu zaten yapıyordu, ama
  // koleksiyonlar düz bir metin kutusu olduğu için (entity-picker değil) bu
  // adım eksikti. Eskiden koleksiyonlar SADECE sayfa yenilenince/girişte
  // çalışan bootstrapCollections() ile (gecikmeli olarak) tamamlanıyordu —
  // kaydet'e basar basmaz hemen görünmüyordu. createCollection() zaten aynı
  // isimde bir kayıt varsa onu döndürüp tekrar oluşturmuyor, bu yüzden burada
  // güvenle her isim için çağrılabilir.
  for (const name of collections) {
    try {
      await createCollection(name);
    } catch (err) {
      console.warn(`[saveModal] Koleksiyon oluşturulamadı (${name}):`, err?.message || err);
    }
  }
  // ── Adım 27 sonu ──────────────────────────────────────────────────────────

  const finishedAt      = document.getElementById("modal-finished-at").value || null;
  const seriesOrderRaw  = document.getElementById("modal-series-order").value;
  const yearRaw         = document.getElementById("modal-year").value;

  const updates = {
    title:        document.getElementById("modal-title").value.trim(),
    author:       document.getElementById("modal-author").value.trim() || null,
    publisher:    document.getElementById("modal-publisher").value.trim() || null,  // YENİ
    series:       document.getElementById("modal-series").value.trim() || null,
    series_order: seriesOrderRaw === "" ? null : parseInt(seriesOrderRaw) || null,
    edition:      document.getElementById("modal-edition").value.trim() || null,
    category:     document.getElementById("modal-category").value.trim() || null,  // ── Adım 1
    // ── Adım 11: Akademik işareti + Alt Alan/Konu ────────────────────────
    // Akademik kutucuğu işaretsizse Alt Alan/Konu zaten boşaltılmış olur
    // (toggleAcademicFields tarafından) — burada tekrar null'a zorlamaya
    // gerek yok, kutudaki gerçek değeri (boşsa boş) kaydediyoruz.
    is_academic:  document.getElementById("modal-is-academic").checked,
    subcategory:  document.getElementById("modal-subcategory").value.trim() || null,
    topic:        document.getElementById("modal-topic").value.trim() || null,
    // ── Adım 11 sonu ──────────────────────────────────────────────────────
    year:         yearRaw === "" ? null : parseInt(yearRaw) || null,
    language:     document.getElementById("modal-language").value || null,
    status:       document.getElementById("modal-status").value,
    notes:        document.getElementById("modal-notes").value.trim() || null,
    finished_at:  finishedAt,
    tags,
    collections,  // ── Adım 19
  };

  await applyUpdate(editingId, updates);
  closeModal();
}

// ─── Ortak güncelleme: veritabanı + hafıza + ekran ──────────────────────────
// ── Adım 34: updateBookRecord yerine updateBookRecordWithCascade kullanılıyor.
// Bu, kaydetme sırasında author/publisher/series/collections alanlarından
// herhangi biri DEĞİŞTİYSE (ör. bir koleksiyon adı kaldırıldıysa, yazar
// değiştirildiyse), eski değerin artık hiçbir kitapta kullanılmıyorsa
// otomatik olarak silinmesini sağlar (cascadeDeleteOrphans ile aynı mantık,
// ama "kitap silinirken" değil "kitap güncellenirken" tetiklenir).
//
// state.books güncellemesi artık BURADA YAPILMIYOR — updateBookRecordWithCascade
// kendi içinde state.books'taki nesneyi (Object.assign ile) günceller, çünkü
// cascade kontrolünün doğru çalışması için güncellemenin BU fonksiyon
// İÇİNDE, kontrolden ÖNCE yapılmış olması gerekiyor.
async function applyUpdate(id, updates) {
  try {
    await updateBookRecordWithCascade(id, updates);

    refreshCurrentPage();
    showToast("Kaydedildi.");
  } catch (err) {
    showToast("Kayıt hatası: " + (err?.message || err), "error");
  }
}

// ── Adım J5: Custom dialog ile onay ─────────────────────────────────────────
// Tarayıcının varsayılan confirm() kutusu yerine index.html'deki
// #custom-dialog-overlay kullanılır. Böylece silme onayı da tema uyumlu olur.
//
// entity-picker.js'te aynı dialog sistemi mevcuttur; burada modal.js'e özgü
// hafif bir kopyası kullanılır (import bağımlılığı eklememek için).
export function _showConfirm(message) {
  return new Promise((resolve) => {
    const overlay  = document.getElementById("custom-dialog-overlay");
    const msgEl    = document.getElementById("custom-dialog-message");
    const inputEl  = document.getElementById("custom-dialog-input");
    const okBtn    = document.getElementById("custom-dialog-ok");
    const cancelBtn= document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog yoksa tarayıcının confirm'ini kullan
      resolve(confirm(message));
      return;
    }

    msgEl.textContent = message;
    inputEl?.classList.add("hidden");   // Input alanı gizli (sadece onay istiyoruz)
    overlay.classList.remove("hidden");

    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }

    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener("click", onOk,     { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
  });
}

// ── Adım 15: window.prompt() yerine tema uyumlu özel dialog ─────────────────
// _showConfirm ile birebir aynı overlay/buton altyapısını kullanır, farkı:
// input alanını GÖRÜNÜR yapar, OK'a basınca input'un (trim edilmiş) değerini
// döndürür. Kullanıcı İptal'e basarsa veya Escape/overlay'e tıklarsa null
// döner — çağıran taraf (catalog.js) bunu "kullanıcı iptal etti" olarak
// yorumlar. defaultValue verilirse input o değerle önceden doldurulur
// (örn. "yeniden adlandır" senaryolarında kullanışlı).
export function _showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay  = document.getElementById("custom-dialog-overlay");
    const msgEl    = document.getElementById("custom-dialog-message");
    const inputEl  = document.getElementById("custom-dialog-input");
    const okBtn    = document.getElementById("custom-dialog-ok");
    const cancelBtn= document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !inputEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog DOM'da yoksa tarayıcının prompt'unu kullan
      const result = prompt(message, defaultValue);
      resolve(result ? result.trim() : null);
      return;
    }

    msgEl.textContent = message;
    inputEl.value = defaultValue;
    inputEl.classList.remove("hidden");
    overlay.classList.remove("hidden");

    // Modal açılınca input'a otomatik odaklan, kullanıcı direkt yazmaya başlasın.
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 0);

    function cleanup(result) {
      overlay.classList.add("hidden");
      inputEl.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKeydown);
      resolve(result);
    }

    const onOk     = () => {
      const val = inputEl.value.trim();
      cleanup(val ? val : null);
    };
    const onCancel = () => cleanup(null);

    // Enter → OK ile aynı, Escape → İptal ile aynı (kullanıcı deneyimi için).
    const onKeydown = (e) => {
      if (e.key === "Enter")  { e.preventDefault(); onOk(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };

    okBtn.addEventListener("click", onOk,     { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
    inputEl.addEventListener("keydown", onKeydown);
  });
}
// ── Adım 15 sonu ─────────────────────────────────────────────────────────────

// ── Adım 15: alert() yerine tema uyumlu tek-butonlu bilgi mesajı ─────────────
// _showConfirm ile aynı altyapı, farkı: İptal butonu tamamen gizlenir, sadece
// "Tamam" görünür. Limit dolduğunda veya isim çakışmasında kullanılır —
// kullanıcının "iptal" seçeneğine ihtiyacı yok, sadece bilgiyi onaylıyor.
export function _showInfo(message) {
  return new Promise((resolve) => {
    const overlay  = document.getElementById("custom-dialog-overlay");
    const msgEl    = document.getElementById("custom-dialog-message");
    const inputEl  = document.getElementById("custom-dialog-input");
    const okBtn    = document.getElementById("custom-dialog-ok");
    const cancelBtn= document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog yoksa tarayıcının alert'ini kullan
      alert(message);
      resolve();
      return;
    }

    msgEl.textContent = message;
    inputEl?.classList.add("hidden");
    cancelBtn.classList.add("hidden");   // sadece "Tamam" görünsün
    overlay.classList.remove("hidden");

    function cleanup() {
      overlay.classList.add("hidden");
      cancelBtn.classList.remove("hidden");   // diğer dialoglar için geri aç
      okBtn.removeEventListener("click", onOk);
      resolve();
    }

    const onOk = () => cleanup();
    okBtn.addEventListener("click", onOk, { once: true });
  });
}
// ── Adım 15 sonu ─────────────────────────────────────────────────────────────

// ── Kapak resmi yükle ────────────────────────────────────────────────────────
// Buton tıklanınca gizli dosya seçiciyi açar; dosya seçilince Appwrite
// Storage'a yükler, eski kapak varsa siler, kitap kaydını ve ekranı günceller.
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
  // ── Adım J5: confirm() → _showConfirm() (tema uyumlu custom dialog) ──────
  const confirmed = await _showConfirm("Bu kitabı katalogdan sil?");
  if (!confirmed) return;

  try {
    // ── Adım 24: deleteBookRecord artık state.books güncellemesini VE
    // cascade delete (yetim author/publisher/series/collection temizliği)
    // işlemini kendi içinde yapıyor — burada ekstra bir şey yapmaya gerek yok.
    await deleteBookRecord(editingId);
    refreshCurrentPage();
    closeModal();
    showToast("Kitap silindi.");
  } catch (err) {
    // ── Adım 28: bulkDelete ile aynı tutarlılıkta — hata sadece toast'a değil
    // konsola da yazılır (toast geçici/kaybolan bir bildirim, konsol kalıcı iz).
    console.error(`[deleteCurrentBook] Kitap silinemedi (${editingId}):`, err?.message || err, err);
    showToast("Silme hatası: " + (err?.message || err), "error");
  }
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initModal() {
  // Yazar açılır menüsünü kur. Liste state.authors'tan beslenir; ekle/düzenle/sil
  // işlemleri api katmanına gider ve oradan tüm kitaplara yansır.
  authorPicker = mountEntityPicker({
    prefix: "author",
    placeholder: "Yazar seç...",
    addPromptLabel: "Yeni yazar adı:",
    editPromptLabel: "Yazar adını düzenle:",
    deleteConfirm: (name) =>
      `"${name}" yazarını sil?\nBu yazara bağlı kitapların yazar bilgisi boşalacak.`,
    getItems: () => state.authors,
    onAdd: (name) => createAuthor(name),
    onRename: (id, oldName, newName) => renameAuthorEverywhere(id, oldName, newName),
    onDelete: (id, name) => deleteAuthorEverywhere(id, name),
    onChange: () => {
      // Ekle/düzenle/sil tüm kitapları etkileyebilir; açık sayfayı tazele.
      refreshCurrentPage();
    },
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
    onAdd: (name) => createPublisher(name),
    onRename: (id, oldName, newName) => renamePublisherEverywhere(id, oldName, newName),
    onDelete: (id, name) => deletePublisherEverywhere(id, name),
    onChange: () => {
      refreshCurrentPage();
      // Yayınevi değişti → seri listesini ve etkinliğini güncelle,
      // mevcut seri yeni yayıneviye ait değilse temizle.
      updateSeriesAvailability(true);
    },
  });

  // Seri açılır menüsü — YAYINEVİNE bağlı.
  // Liste yalnızca o an seçili yayınevine ait serileri gösterir; yeni seri o
  // yayıneviye bağlanır. Yayınevi seçili değilse alan pasiftir.
  seriesPicker = mountEntityPicker({
    prefix: "series",
    placeholder: "Seri seç...",
    addPromptLabel: "Yeni seri adı:",
    editPromptLabel: "Seri adını düzenle:",
    deleteConfirm: (name) =>
      `"${name}" serisini sil?\nBu seriye ait kitapların seri bilgisi boşalacak.`,
    // Yalnızca seçili yayınevine ait serileri döndür.
    getItems: () => {
      const pubId = currentPublisherId();
      if (!pubId) return [];
      return state.series.filter((s) => s.publisher_id === pubId);
    },
    // Yeni seri, o an seçili yayıneviye bağlanır.
    onAdd: (name) => createSeries(name, currentPublisherId()),
    onRename: (id, oldName, newName) =>
      renameSeriesEverywhere(id, oldName, newName, currentPublisherId()),
    onDelete: (id, name) =>
      deleteSeriesEverywhere(id, name, currentPublisherId()),
    onChange: () => { refreshCurrentPage(); },
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", saveModal);
  document.getElementById("modal-delete").addEventListener("click", deleteCurrentBook);

  // ── Adım 4 (V5): Kilitle / Kilidi Aç butonu ──────────────────────────────
  document.getElementById("modal-lock-btn")?.addEventListener("click", () => {
    if (!editingId) return;
    _isLocked = !_isLocked;
    // Kilitlenince kilitli view'ı güncel kitap verisiyle yeniden oluştur
    // (kullanıcı form'da bir şey değiştirmiş olabilir ama kaydetmemişse
    // kilitli view state.books'taki SON KAYDEDILMIŞ veriyi gösterir).
    if (_isLocked) {
      const book = state.books.find((b) => b.$id === editingId);
      if (book) _buildLockedView(book);
    }
    _applyLockState(_isLocked);
  });
  // ── Adım 4 (V5) sonu ──────────────────────────────────────────────────────

  // ── Kapak resmi yükleme: butona basınca gizli dosya seçiciyi tetikle ──────
  const coverInput = document.getElementById("modal-cover-input");
  document.getElementById("modal-cover-upload-btn")?.addEventListener("click", () => {
    coverInput?.click();
  });
  coverInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    handleCoverFileSelected(file);
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
  });

  document.getElementById("book-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById("modal-rating").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("star")) return;
    const rating  = parseInt(e.target.dataset.rating);
    const bookId  = e.target.dataset.bookId;
    if (!bookId) return;

    document.querySelectorAll("#modal-rating .star").forEach((s, i) => {
      s.classList.toggle("filled", i < rating);
    });

    await applyUpdate(bookId, { rating });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ── Adım 11: Akademik onay kutusu — işaretlenince Alt Alan/Konu görünür ──
  document.getElementById("modal-is-academic")?.addEventListener("change", (e) => {
    toggleAcademicFields(e.target.checked);
  });
  // ── Adım 11 sonu ──────────────────────────────────────────────────────────

  // ── Adım 17: Favori onay kutusu — rating gibi ANINDA kaydedilir ─────────
  // is_academic'ten farkı: favori başka bir alana bağımlı değil, tek başına
  // bir tercih. Bu yüzden "Kaydet" butonuna basmayı beklemeden, tıklanır
  // tıklanmaz applyUpdate ile veritabanına yazılır (rating ile aynı desen).
  document.getElementById("modal-favorite")?.addEventListener("change", async (e) => {
    if (!editingId) return;
    await applyUpdate(editingId, { favorite: e.target.checked });
  });
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  // ── Adım 39: Fiziksel kopya onay kutusu — favori ile aynı kalıp ──────────
  // Tıklanır tıklanmaz anında Appwrite'a yazılır; "Kaydet" beklenmez.
  document.getElementById("modal-physical-copy")?.addEventListener("change", async (e) => {
    if (!editingId) return;
    await applyUpdate(editingId, { has_physical_copy: e.target.checked });
  });
  // ── Adım 39 sonu ──────────────────────────────────────────────────────────
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
    document.getElementById("modal-topic").value        = "";
  }
}
// ── Adım 11 sonu ─────────────────────────────────────────────────────────────

// ── Adım 4 (V5): Kilit durumunu uygula ───────────────────────────────────────
// locked=true  → form katmanı gizlenir, kilitli view gösterilir, buton "Kilidi Aç" olur
// locked=false → form katmanı gösterilir, kilitli view gizlenir, buton "Kilitle" olur
function _applyLockState(locked) {
  const fields     = document.getElementById("modal-fields");
  const footer     = document.getElementById("modal-footer");
  const lockedView = document.getElementById("modal-locked-view");
  const lockBtn    = document.getElementById("modal-lock-btn");

  if (fields)     fields.classList.toggle("hidden", locked);
  if (footer)     footer.classList.toggle("hidden", locked);
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
// state.books'taki EN SON KAYDEDILMIŞ veriyi kullanır.
// Format chip renkleri Adım 3 (V5) ile eklenen CSS sınıflarını (format-pdf /
// format-epub) kullanır — aynı görsel dil korunur.
function _buildLockedView(book) {
  const el = document.getElementById("modal-locked-view");
  if (!el) return;

  // Format chip
  const fmt         = (book.format || "").toLowerCase();
  const fmtClass    = fmt === "pdf" ? "format-pdf" : fmt === "epub" ? "format-epub" : "";
  const fmtHtml     = book.format
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
  const st      = statusMap[book.status] || statusMap["okunmadi"];
  const stHtml  = `<span class="locked-chip ${st.cls}">${st.label}</span>`;

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

  // Bilgi grid'i: yayınevi, yıl, baskı, dil
  const langLabels = { tr:"Türkçe", en:"İngilizce", de:"Almanca", fr:"Fransızca",
    es:"İspanyolca", it:"İtalyanca", ru:"Rusça", ar:"Arapça", ja:"Japonca",
    zh:"Çince", other:"Diğer" };
  const infoItems = [
    { icon: "lucide:building-2",  label: "Yayınevi", val: book.publisher },
    { icon: "lucide:calendar",    label: "Yıl",      val: book.year      },
    { icon: "lucide:layers-2",    label: "Baskı",    val: book.edition   },
    { icon: "lucide:languages",   label: "Dil",      val: langLabels[book.language] || book.language },
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

  // Etiketler
  const tagsHtml = (book.tags || []).length
    ? `<div class="locked-tags">
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
      ${tagsHtml}
    </div>
  `;
}
// ── Adım 4 (V5) sonu ──────────────────────────────────────────────────────────