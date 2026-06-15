import {
  account,
  databases,
  Query,
  ID,
  DATABASE_ID,
  TABLE_ID,
} from "./appwrite.js";

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  books: [],
  filtered: [],
  search: "",
  filters: {
    format: "",
    status: "",
    author: "",
    series: "",
  },
  sort: "added_at_desc",
  editingId: null,
  user: null,
};

// Appwrite sistem alanları — restore sırasında temizlenecek
const SYSTEM_FIELDS = [
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$collectionId",
  "$databaseId",
  "$sequence",
];

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Appwrite'ta Supabase gibi onAuthStateChange yok. Oturumu manuel yönetiyoruz:
// sayfa açılışında account.get() ile mevcut oturumu kontrol ediyoruz.

async function initAuth() {
  try {
    const user = await account.get();
    state.user = user;
    showApp();
    await loadBooks();
  } catch {
    // Oturum yok — login ekranı göster
    showLogin();
  }
}

async function login() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  errorEl.textContent = "";

  if (!email || !password) {
    errorEl.textContent = "E-posta ve şifre gerekli.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Giriş yapılıyor...";

  try {
    // Önce varsa eski oturumu temizle (aynı tarayıcıda çift oturum hatasını önler)
    try {
      await account.deleteSession("current");
    } catch {
      /* oturum yoktu, sorun değil */
    }

    await account.createEmailPasswordSession(email, password);
    state.user = await account.get();
    showApp();
    await loadBooks();
  } catch (err) {
    errorEl.textContent = "Giriş başarısız: " + (err?.message || "bilinmeyen hata");
  } finally {
    btn.disabled = false;
    btn.textContent = "Giriş yap";
  }
}

async function logout() {
  try {
    await account.deleteSession("current");
  } catch {
    /* yoksay */
  }
  state.user = null;
  state.books = [];
  showLogin();
}

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
}

// ─── Data ─────────────────────────────────────────────────────────────────────
// KRİTİK: Appwrite listDocuments varsayılan olarak yalnızca 25 kayıt döndürür.
// Binlerce kitap olacağı için cursor tabanlı sayfalama ile HEPSİNİ çekiyoruz.

const PAGE_SIZE = 100;

async function loadBooks() {
  showLoading(true);
  try {
    const all = [];
    let cursor = null;

    while (true) {
      const queries = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));

      const res = await databases.listDocuments(DATABASE_ID, TABLE_ID, queries);
      all.push(...res.documents);

      if (res.documents.length < PAGE_SIZE) break;
      cursor = res.documents[res.documents.length - 1].$id;
    }

    state.books = all;
    populateFilterOptions();
    applyFilters();
  } catch (err) {
    showToast("Kitaplar yüklenemedi: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

async function updateBook(id, updates) {
  try {
    await databases.updateDocument(DATABASE_ID, TABLE_ID, id, updates);

    const idx = state.books.findIndex((b) => b.$id === id);
    if (idx !== -1) {
      state.books[idx] = { ...state.books[idx], ...updates };
    }

    applyFilters();
    showToast("Kaydedildi.");
  } catch (err) {
    showToast("Kayıt hatası: " + (err?.message || err), "error");
  }
}

async function deleteBook(id) {
  if (!confirm("Bu kitabı katalogdan sil?")) return;
  try {
    await databases.deleteDocument(DATABASE_ID, TABLE_ID, id);
    state.books = state.books.filter((b) => b.$id !== id);
    applyFilters();
    closeModal();
    showToast("Kitap silindi.");
  } catch (err) {
    showToast("Silme hatası: " + (err?.message || err), "error");
  }
}

// ─── Filters & Search ────────────────────────────────────────────────────────

function applyFilters() {
  let result = [...state.books];

  if (state.search) {
    const q = state.search.toLowerCase();
    result = result.filter(
      (b) =>
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.series?.toLowerCase().includes(q) ||
        b.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (state.filters.format) {
    result = result.filter((b) => b.format === state.filters.format);
  }
  if (state.filters.status) {
    result = result.filter((b) => b.status === state.filters.status);
  }
  if (state.filters.author) {
    result = result.filter((b) => b.author === state.filters.author);
  }
  if (state.filters.series) {
    result = result.filter((b) => b.series === state.filters.series);
  }

  result = sortBooks(result, state.sort);

  state.filtered = result;
  renderBooks();
  updateResultCount();
}

function sortBooks(books, sortKey) {
  const sorted = [...books];
  switch (sortKey) {
    case "title_asc":
      return sorted.sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr"));
    case "author_asc":
      return sorted.sort((a, b) => (a.author || "").localeCompare(b.author || "", "tr"));
    case "series_asc":
      return sorted.sort((a, b) => {
        const s = (a.series || "").localeCompare(b.series || "", "tr");
        if (s !== 0) return s;
        return (a.series_order || 0) - (b.series_order || 0);
      });
    case "added_at_desc":
    default:
      return sorted.sort(
        (a, b) => new Date(b.$createdAt) - new Date(a.$createdAt)
      );
  }
}

function populateFilterOptions() {
  const authors = [...new Set(state.books.map((b) => b.author).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "tr")
  );
  const series = [...new Set(state.books.map((b) => b.series).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "tr")
  );

  populateSelect("filter-author", authors);
  populateSelect("filter-series", series);
}

function populateSelect(id, options) {
  const el = document.getElementById(id);
  const current = el.value;
  el.innerHTML = `<option value="">Tümü</option>`;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    el.appendChild(o);
  });
  el.value = current;
}

function updateResultCount() {
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${state.filtered.length} kitap`;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderBooks() {
  const grid = document.getElementById("books-grid");
  grid.innerHTML = "";

  if (state.filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((book) => fragment.appendChild(createBookCard(book)));
  grid.appendChild(fragment);
}

function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.dataset.id = book.$id;

  const statusClass = `status-${book.status || "okunmadi"}`;
  const ratingHtml = renderStars(book.rating, false);
  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" loading="lazy" />`
    : `<div class="cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  card.innerHTML = `
    <div class="book-cover">
      ${coverHtml}
      <span class="book-format">${book.format || ""}</span>
      <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHtml(book.title || "Başlıksız")}</h3>
      <p class="book-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</p>
      ${book.series ? `<p class="book-series">${escapeHtml(book.series)}${book.series_order ? " #" + book.series_order : ""}</p>` : ""}
      <div class="book-rating">${ratingHtml}</div>
    </div>
  `;

  card.addEventListener("click", () => openModal(book.$id));
  return card;
}

function renderStars(rating, interactive = false, bookId = null) {
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

// ─── Modal ────────────────────────────────────────────────────────────────────

function openModal(bookId) {
  const book = state.books.find((b) => b.$id === bookId);
  if (!book) return;

  state.editingId = bookId;

  const modal = document.getElementById("book-modal");
  const coverHtml = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" />`
    : `<div class="cover-placeholder large">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;

  document.getElementById("modal-cover").innerHTML = coverHtml;
  document.getElementById("modal-title").value = book.title || "";
  document.getElementById("modal-author").value = book.author || "";
  document.getElementById("modal-series").value = book.series || "";
  document.getElementById("modal-series-order").value = book.series_order ?? "";
  document.getElementById("modal-year").value = book.year ?? "";
  document.getElementById("modal-status").value = book.status || "okunmadi";
  document.getElementById("modal-notes").value = book.notes || "";
  document.getElementById("modal-finished-at").value = book.finished_at || "";
  document.getElementById("modal-tags").value = (book.tags || []).join(", ");
  document.getElementById("modal-file-path").textContent = book.file_path || "";
  document.getElementById("modal-file-size").textContent = formatFileSize(book.file_size);
  document.getElementById("modal-format").textContent = (book.format || "").toUpperCase();

  document.getElementById("modal-rating").innerHTML = renderStars(book.rating, true, bookId);

  modal.classList.remove("hidden");
  modal.classList.add("visible");
}

function closeModal() {
  const modal = document.getElementById("book-modal");
  modal.classList.remove("visible");
  modal.classList.add("hidden");
  state.editingId = null;
}

async function saveModal() {
  if (!state.editingId) return;

  const tags = document.getElementById("modal-tags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const finishedAt = document.getElementById("modal-finished-at").value || null;

  const seriesOrderRaw = document.getElementById("modal-series-order").value;
  const yearRaw = document.getElementById("modal-year").value;

  const updates = {
    title: document.getElementById("modal-title").value.trim(),
    author: document.getElementById("modal-author").value.trim() || null,
    series: document.getElementById("modal-series").value.trim() || null,
    series_order: seriesOrderRaw === "" ? null : parseInt(seriesOrderRaw) || null,
    year: yearRaw === "" ? null : parseInt(yearRaw) || null,
    status: document.getElementById("modal-status").value,
    notes: document.getElementById("modal-notes").value.trim() || null,
    finished_at: finishedAt,
    tags,
  };

  await updateBook(state.editingId, updates);
  closeModal();
}

// ─── Backup & Restore ─────────────────────────────────────────────────────────

async function exportBackup() {
  showLoading(true);
  try {
    // Tüm kayıtları sayfalama ile çek
    const all = [];
    let cursor = null;
    while (true) {
      const queries = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const res = await databases.listDocuments(DATABASE_ID, TABLE_ID, queries);
      all.push(...res.documents);
      if (res.documents.length < PAGE_SIZE) break;
      cursor = res.documents[res.documents.length - 1].$id;
    }

    const json = JSON.stringify(all, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `ebook-catalog-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`${all.length} kitap yedeklendi.`);
  } catch (err) {
    showToast("Yedekleme hatası: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

function stripSystemFields(doc) {
  const data = {};
  for (const key of Object.keys(doc)) {
    if (!SYSTEM_FIELDS.includes(key)) data[key] = doc[key];
  }
  return data;
}

async function importBackup(file) {
  if (!file) return;
  if (!confirm("Yedekten yükleme, kayıtları mevcut katalogla birleştirir. Devam?")) return;

  showLoading(true);
  try {
    const text = await file.text();
    const books = JSON.parse(text);
    if (!Array.isArray(books)) throw new Error("Geçersiz yedek dosyası.");

    let ok = 0;
    let fail = 0;

    for (const book of books) {
      // Sistem alanlarını ayıkla; $id'yi belge ID'si olarak koru
      const docId = book.$id || ID.unique();
      const data = stripSystemFields(book);

      try {
        await databases.createDocument(DATABASE_ID, TABLE_ID, docId, data);
        ok++;
      } catch (err) {
        // Zaten varsa (409) güncellemeyi dene
        if (err?.code === 409) {
          try {
            await databases.updateDocument(DATABASE_ID, TABLE_ID, docId, data);
            ok++;
          } catch {
            fail++;
          }
        } else {
          fail++;
        }
      }
    }

    showToast(`${ok} kitap yüklendi${fail ? `, ${fail} başarısız` : ""}.`);
    await loadBooks();
  } catch (err) {
    showToast("Yükleme hatası: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showLoading(show) {
  const el = document.getElementById("loading");
  if (el) el.classList.toggle("hidden", !show);
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusLabel(status) {
  const labels = {
    okunmadi: "Okunmadı",
    sirada: "Sırada",
    okunuyor: "Okunuyor",
    okundu: "Okundu",
  };
  return labels[status] || "Okunmadı";
}

function formatFileSize(bytes) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function today() {
  return new Date().toISOString().split("T")[0];
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById("login-btn").addEventListener("click", login);
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  document.getElementById("logout-btn").addEventListener("click", logout);

  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value;
    applyFilters();
  });

  document.getElementById("filter-format").addEventListener("change", (e) => {
    state.filters.format = e.target.value;
    applyFilters();
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    applyFilters();
  });
  document.getElementById("filter-author").addEventListener("change", (e) => {
    state.filters.author = e.target.value;
    applyFilters();
  });
  document.getElementById("filter-series").addEventListener("change", (e) => {
    state.filters.series = e.target.value;
    applyFilters();
  });

  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFilters();
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", saveModal);
  document.getElementById("modal-delete").addEventListener("click", () => {
    if (state.editingId) deleteBook(state.editingId);
  });
  document.getElementById("book-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById("modal-rating").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("star")) return;
    const rating = parseInt(e.target.dataset.rating);
    const bookId = e.target.dataset.bookId;
    if (!bookId) return;

    document.querySelectorAll("#modal-rating .star").forEach((s, i) => {
      s.classList.toggle("filled", i < rating);
    });

    await updateBook(bookId, { rating });
  });

  document.getElementById("backup-btn").addEventListener("click", exportBackup);
  document.getElementById("restore-btn").addEventListener("click", () => {
    document.getElementById("restore-input").click();
  });
  document.getElementById("restore-input").addEventListener("change", (e) => {
    importBackup(e.target.files[0]);
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  initAuth();
});
