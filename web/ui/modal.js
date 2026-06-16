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
import { updateBookRecord, deleteBookRecord } from "../core/api.js";
import { refreshCurrentPage } from "../core/router.js";
import { showToast, escapeHtml, formatFileSize } from "./common.js";
import { renderStars } from "./components.js";

// Şu an düzenlenen kitabın ID'si. Modal kapalıyken null.
let editingId = null;

// ─── Modal'ı aç ─────────────────────────────────────────────────────────────
export function openModal(bookId) {
  const book = state.books.find((b) => b.$id === bookId);
  if (!book) return;

  editingId = bookId;

  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" />`
    : `<div class="cover-placeholder large">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  document.getElementById("modal-cover").innerHTML = coverHtml;

  // Alan sırası: Kitap Adı → Yazar → Yayınevi → Seri → Durum/Yıl → Puan → ...
  document.getElementById("modal-title").value        = book.title || "";
  document.getElementById("modal-author").value       = book.author || "";
  document.getElementById("modal-publisher").value    = book.publisher || "";   // YENİ
  document.getElementById("modal-series").value       = book.series || "";
  document.getElementById("modal-series-order").value = book.series_order ?? "";
  document.getElementById("modal-year").value         = book.year ?? "";
  document.getElementById("modal-status").value       = book.status || "okunmadi";
  document.getElementById("modal-notes").value        = book.notes || "";
  document.getElementById("modal-finished-at").value  = book.finished_at || "";
  document.getElementById("modal-tags").value         = (book.tags || []).join(", ");
  document.getElementById("modal-file-path").textContent = book.file_path || "";
  document.getElementById("modal-file-size").textContent = formatFileSize(book.file_size);
  document.getElementById("modal-format").textContent    = (book.format || "").toUpperCase();

  document.getElementById("modal-language").value      = book.language || "";
  document.getElementById("modal-rating").innerHTML = renderStars(book.rating, true, bookId);

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
}

// ─── Kaydet ─────────────────────────────────────────────────────────────────
async function saveModal() {
  if (!editingId) return;

  const tags = document.getElementById("modal-tags").value
    .split(",").map((t) => t.trim()).filter(Boolean);

  const finishedAt      = document.getElementById("modal-finished-at").value || null;
  const seriesOrderRaw  = document.getElementById("modal-series-order").value;
  const yearRaw         = document.getElementById("modal-year").value;

  const updates = {
    title:        document.getElementById("modal-title").value.trim(),
    author:       document.getElementById("modal-author").value.trim() || null,
    publisher:    document.getElementById("modal-publisher").value.trim() || null,  // YENİ
    series:       document.getElementById("modal-series").value.trim() || null,
    series_order: seriesOrderRaw === "" ? null : parseInt(seriesOrderRaw) || null,
    year:         yearRaw === "" ? null : parseInt(yearRaw) || null,
    language:     document.getElementById("modal-language").value || null,
    status:       document.getElementById("modal-status").value,
    notes:        document.getElementById("modal-notes").value.trim() || null,
    finished_at:  finishedAt,
    tags,
  };

  await applyUpdate(editingId, updates);
  closeModal();
}

// ─── Ortak güncelleme: veritabanı + hafıza + ekran ──────────────────────────
async function applyUpdate(id, updates) {
  try {
    await updateBookRecord(id, updates);

    const idx = state.books.findIndex((b) => b.$id === id);
    if (idx !== -1) {
      state.books[idx] = { ...state.books[idx], ...updates };
    }

    refreshCurrentPage();
    showToast("Kaydedildi.");
  } catch (err) {
    showToast("Kayıt hatası: " + (err?.message || err), "error");
  }
}

// ─── Sil ────────────────────────────────────────────────────────────────────
async function deleteCurrentBook() {
  if (!editingId) return;
  if (!confirm("Bu kitabı katalogdan sil?")) return;

  try {
    await deleteBookRecord(editingId);
    state.books = state.books.filter((b) => b.$id !== editingId);
    refreshCurrentPage();
    closeModal();
    showToast("Kitap silindi.");
  } catch (err) {
    showToast("Silme hatası: " + (err?.message || err), "error");
  }
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initModal() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", saveModal);
  document.getElementById("modal-delete").addEventListener("click", deleteCurrentBook);

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
}