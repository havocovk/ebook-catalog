// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — Katalog sayfası mantığı.
//
// 3A: sayfalama (50/sayfa) + ızgara↔liste görünüm geçişi
// 3B: filtreler sol yan panel. Format/Durum chip, Yazar/Yayınevi/Seri select.
//     Yayınevi seçilmeden Seri filtresi pasif. Yayınevi seçilince yalnızca
//     o yayınevinin serileri Seri listesinde görünür.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal } from "../ui/modal.js";
import { escapeHtml, statusLabel, confidenceLevel } from "../ui/common.js";

// ── Adım J8: Fuse.js — Fuzzy (bulanık) arama ────────────────────────────────
// CDN'den ES Module olarak yüklenir; yüklenemezse tam eşleşme devreye girer.
// Fuse.js kurulum gerektirmez — import yeterli.
let _Fuse = null;

(async () => {
  try {
    const mod = await import("https://esm.sh/fuse.js@7.0.0");
    _Fuse = mod.default;
  } catch {
    // CDN erişilemez (offline, ağ kısıtlaması) → tam eşleşme fallback
    console.warn("[J8] Fuse.js yüklenemedi — tam eşleşme modunda devam ediliyor.");
  }
})();

// Türkçe karakter normalizasyonu: ş→s, ç→c, ğ→g, ü→u, ö→o, ı→i, İ→i
// "şule" → "sule" yapar; böylece "sule" yazıp "Şule"yi bulabilirsin.
function _normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ı/g, "i")
    .replace(/İ/g, "i").replace(/Ş/g, "s").replace(/Ç/g, "c")
    .replace(/Ğ/g, "g").replace(/Ü/g, "u").replace(/Ö/g, "o")
    .replace(/I/g, "i");
}

// Fuzzy arama sonucu önbelleği — state.books değişmezse yeniden oluşturulmaz.
// { books: state.books referansı, fuse: Fuse örneği }
let _fuseCache = null;

function _getFuse() {
  if (!_Fuse) return null;
  // Kitap listesi değiştiyse önbelleği yenile
  if (_fuseCache?.books === state.books) return _fuseCache.fuse;

  // Her kitabın arama alanlarını Türkçe normalize ederek indeksle
  const docs = state.books.map((b) => ({
    $id:    b.$id,
    title:  _normalize(b.title),
    author: _normalize(b.author),
    series: _normalize(b.series),
    tags:   (b.tags || []).map(_normalize).join(" "),
  }));

  const fuse = new _Fuse(docs, {
    keys:               ["title", "author", "series", "tags"],
    threshold:          0.35,   // 0=tam eşleşme 1=her şeyi bul; 0.35 makul tolerans
    minMatchCharLength: 2,      // 1 karakterlik sorguyu fuzzy yapmayız
    distance:           200,    // uzun başlıklarda eşleşme alanı
    ignoreLocation:     true,   // başlığın herhangi bir yerinde eşleşsin
  });

  _fuseCache = { books: state.books, fuse };
  return fuse;
}

// Fuzzy arama: sorguya uyan kitap $id kümesini döndürür.
// Fuse.js yoksa null döner → caller tam eşleşmeye düşer.
function _fuzzySearch(query) {
  const fuse = _getFuse();
  if (!fuse) return null;
  const results = fuse.search(_normalize(query));
  return new Set(results.map((r) => r.item.$id));
}
// ── Adım J8 sonu ─────────────────────────────────────────────────────────────

const PER_PAGE = 50;

const ui = {
  search  : "",
  filters : { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: "", confidence: "", yearMin: null, yearMax: null },
  sort    : "added_at_desc",
  view    : "grid",
  page    : 1,
};

let filtered = [];

// ── Adım 4: Kitaplardaki gerçek en eski/en yeni yıl (slider sınırları) ──────
let yearBounds = { min: 1900, max: new Date().getFullYear() };

// ── Adım J6: LocalStorage yardımcıları ──────────────────────────────────────
// Kaydedilen tercihler: arama terimi, sıralama, görünüm modu (kart/liste).
// Filtreler (yazar, yayınevi, dil vb.) kasıtlı olarak kaydedilmiyor —
// bir sonraki oturumda beklenmedik "kitaplar eksik" durumu yaratabilir.

const _PREFS_KEY = {
  search : "ec_search",
  sort   : "ec_sort",
  view   : "ec_view",
};

function _savePref(key, value) {
  try { localStorage.setItem(_PREFS_KEY[key], value); } catch { /* özel mod */ }
}

function _loadPrefs() {
  try {
    const search = localStorage.getItem(_PREFS_KEY.search) ?? "";
    const sort   = localStorage.getItem(_PREFS_KEY.sort)   ?? "added_at_desc";
    const view   = localStorage.getItem(_PREFS_KEY.view)   ?? "grid";

    ui.search = search;
    ui.sort   = sort;
    ui.view   = view;

    // Arama kutusunu doldur
    const searchEl = document.getElementById("search-input");
    if (searchEl) searchEl.value = search;

    // Sıralama select'ini senkronize et
    const sortEl = document.getElementById("sort-select");
    if (sortEl) sortEl.value = sort;
  } catch { /* özel mod veya localStorage erişim hatası — varsayılanlarla devam */ }
}
// ── Adım J6 sonu ─────────────────────────────────────────────────────────────

// ─── Dışa açık ──────────────────────────────────────────────────────────────
export function renderCatalog() {
  _loadPrefs();               // ── Adım J6: kayıtlı tercihleri yükle
  populateSelectOptions();
  populateTagChips();         // ── Adım J4: dinamik etiket chip'leri
  populateYearSlider();       // ── Adım 4: yıl aralığı slider sınırlarını ayarla
  syncChips();
  updateSeriesOptions();      // yayınevi filtresine göre seri listesini güncelle
  recompute(false);
}

// ── Adım J4: Katalogdaki tüm etiketi toplayıp chip olarak doldur ────────────
function populateTagChips() {
  const container = document.getElementById("filter-tag-chips");
  if (!container) return;

  // Tüm kitapların etiketlerini topla, tekrar etmeyenleri al, sırala
  const allTags = [...new Set(
    state.books.flatMap((b) => b.tags || []).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));

  // Sadece etiket chip'lerini yenile (Tümü butonu HTML'de kalıcı)
  const existing = [...container.querySelectorAll(".chip[data-filter='tag']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className    = "chip";
    btn.dataset.filter = "tag";
    btn.dataset.value  = tag;
    btn.textContent  = tag;
    container.appendChild(btn);
  });

  // Seçili etiketleri senkronize et (Adım 9: artık dizi, çoklu seçim olabilir)
  syncChipGroup("filter-tag-chips", ui.filters.tag);
}

// ── Adım 4: Yıl Aralığı Slider'ı Kur ────────────────────────────────────────
// Kitaplardaki gerçek en eski/en yeni yılı bulup slider'ın min/max
// sınırlarını buna göre ayarlar. Hiç yıl bilgisi yoksa 1900-bugün varsayılır.
function populateYearSlider() {
  const years = state.books.map((b) => b.year).filter((y) => Number.isFinite(y));
  if (years.length > 0) {
    yearBounds = { min: Math.min(...years), max: Math.max(...years) };
  }

  const minInput = document.getElementById("year-range-min");
  const maxInput = document.getElementById("year-range-max");
  if (!minInput || !maxInput) return;

  minInput.min = yearBounds.min;
  minInput.max = yearBounds.max;
  maxInput.min = yearBounds.min;
  maxInput.max = yearBounds.max;

  // Filtre henüz uygulanmamışsa (null) slider'ı tam aralıkta başlat.
  minInput.value = ui.filters.yearMin ?? yearBounds.min;
  maxInput.value = ui.filters.yearMax ?? yearBounds.max;

  updateYearRangeUI();
}

// Slider hareket ettikçe: dolgu çizgisinin genişliğini ve üstteki
// "1990 — 2024" yazısını günceller. Filtreleme yapmaz (sadece görsel).
function updateYearRangeUI() {
  const minInput = document.getElementById("year-range-min");
  const maxInput = document.getElementById("year-range-max");
  const fill     = document.getElementById("year-range-fill");
  const display  = document.getElementById("filter-year-display");
  if (!minInput || !maxInput || !fill || !display) return;

  let minVal = parseInt(minInput.value);
  let maxVal = parseInt(maxInput.value);

  // İki tutamaç birbirini geçemez — geçerse yer değiştirip düzelt.
  if (minVal > maxVal) {
    [minVal, maxVal] = [maxVal, minVal];
    minInput.value = minVal;
    maxInput.value = maxVal;
  }

  const span = yearBounds.max - yearBounds.min || 1;   // sıfıra bölme koruması
  const leftPct  = ((minVal - yearBounds.min) / span) * 100;
  const rightPct = ((maxVal - yearBounds.min) / span) * 100;
  fill.style.left  = leftPct + "%";
  fill.style.width = (rightPct - leftPct) + "%";

  // Tam aralıktaysa (filtre yok) "Tümü" göster, değilse aralığı göster.
  const isFullRange = minVal === yearBounds.min && maxVal === yearBounds.max;
  display.textContent = isFullRange ? "Tümü" : `${minVal} — ${maxVal}`;
}
// ── Adım 4 sonu (kurulum fonksiyonları) ─────────────────────────────────────

// ─── Filtrele + sırala + çiz ────────────────────────────────────────────────
function recompute(resetPage = false) {
  let result = [...state.books];

  if (ui.search) {
    // ── Adım J8: Fuzzy arama ───────────────────────────────────────────────
    // Kısa sorgularda (1 karakter) ve Fuse.js yüklü değilken tam eşleşme.
    // Uzun sorgularda Fuse.js ile yazım hatası toleranslı arama.
    const q = ui.search.toLowerCase();

    if (ui.search.length >= 2) {
      const matchIds = _fuzzySearch(ui.search);
      if (matchIds) {
        // Fuse.js başarılı — eşleşen $id'lere göre filtrele
        result = result.filter((b) => matchIds.has(b.$id));
      } else {
        // Fallback: Fuse.js yok → tam eşleşme
        result = result.filter(
          (b) =>
            b.title?.toLowerCase().includes(q)  ||
            b.author?.toLowerCase().includes(q) ||
            b.series?.toLowerCase().includes(q) ||
            b.tags?.some((t) => t.toLowerCase().includes(q))
        );
      }
    } else {
      // 1 karakterlik sorgu → her zaman tam eşleşme (fuzzy çok geniş sonuç verir)
      result = result.filter(
        (b) =>
          b.title?.toLowerCase().includes(q)  ||
          b.author?.toLowerCase().includes(q) ||
          b.series?.toLowerCase().includes(q) ||
          b.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    // ── Adım J8 sonu ──────────────────────────────────────────────────────
  }

  if (ui.filters.format)    result = result.filter((b) => b.format    === ui.filters.format);
  if (ui.filters.status)    result = result.filter((b) => b.status    === ui.filters.status);
  if (ui.filters.author)    result = result.filter((b) => b.author    === ui.filters.author);
  if (ui.filters.publisher) result = result.filter((b) => b.publisher === ui.filters.publisher);
  if (ui.filters.series)    result = result.filter((b) => b.series    === ui.filters.series);
  // ── Adım 9: Dil (VEYA) ve Etiket (VE) — çoklu seçim ──────────────────────
  // Dil: bir kitabın TEK dili var (book.language), o yüzden "VEYA" mantıklı —
  //      seçilen dillerden HERHANGİ BİRİYLE eşleşen kitaplar gösterilir.
  // Etiket: bir kitabın BİRDEN FAZLA etiketi olabilir (book.tags dizisi),
  //      o yüzden "VE" mantıklı — seçilen etiketlerin TÜMÜNE sahip olan
  //      kitaplar gösterilir (daha dar, daha kesin sonuç).
  if (ui.filters.language.length > 0) {
    result = result.filter((b) => ui.filters.language.includes(b.language));
  }
  if (ui.filters.tag.length > 0) {
    result = result.filter((b) => ui.filters.tag.every((t) => b.tags?.includes(t)));
  }
  // ── Adım 9 sonu ───────────────────────────────────────────────────────────
  // ── Adım 1: Kategori filtresi ────────────────────────────────────────────
  if (ui.filters.category)  result = result.filter((b) => b.category  === ui.filters.category);
  // ── Adım 1 sonu ──────────────────────────────────────────────────────────

  // ── Adım 3: Güven skoru seviye filtresi ──────────────────────────────────
  if (ui.filters.confidence) {
    result = result.filter((b) => confidenceLevel(b.confidence_score) === ui.filters.confidence);
  }
  // ── Adım 3 sonu ──────────────────────────────────────────────────────────

  // ── Adım 4: Yıl aralığı filtresi ─────────────────────────────────────────
  // null = filtre uygulanmamış (slider tam aralıkta). Filtre aktifse,
  // yıl bilgisi olmayan kitaplar (b.year boş/null) sonuçtan çıkarılır.
  if (ui.filters.yearMin !== null || ui.filters.yearMax !== null) {
    const lo = ui.filters.yearMin ?? yearBounds.min;
    const hi = ui.filters.yearMax ?? yearBounds.max;
    result = result.filter((b) => Number.isFinite(b.year) && b.year >= lo && b.year <= hi);
  }
  // ── Adım 4 sonu ──────────────────────────────────────────────────────────
  // ── Adım J4 sonu ─────────────────────────────────────────────────────────

  filtered = sortBooks(result, ui.sort);
  if (resetPage) ui.page = 1;
  clampPage();
  render();
}

function render() {
  renderBooks();
  renderPagination();
  updateResultCount();
  updateViewToggle();
  updateFilterBadge();
}

function clampPage() {
  const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  ui.page = Math.min(Math.max(1, ui.page), total);
}

function sortBooks(books, key) {
  const s = [...books];
  if (key === "title_asc")
    return s.sort((a, b) => (a.title  || "").localeCompare(b.title  || "", "tr", { sensitivity: "base" }));
  if (key === "author_asc")
    return s.sort((a, b) => (a.author || "").localeCompare(b.author || "", "tr", { sensitivity: "base" }));
  if (key === "series_asc")
    return s.sort((a, b) => {
      const c = (a.series || "").localeCompare(b.series || "", "tr", { sensitivity: "base" });
      return c !== 0 ? c : (a.series_order || 0) - (b.series_order || 0);
    });
  return s.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));
}

// ─── Select seçeneklerini doldur ─────────────────────────────────────────────

function populateSelectOptions() {
  // Yazar listesi
  const authors = [...new Set(state.books.map((b) => b.author).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  fillSelect("filter-author", authors, ui.filters.author);

  // Yayınevi listesi
  const publishers = [...new Set(state.books.map((b) => b.publisher).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  fillSelect("filter-publisher", publishers, ui.filters.publisher);

  // ── Adım 1: Kategori listesi (kitaplardan otomatik toplanır, serbest metin) ──
  const categories = [...new Set(state.books.map((b) => b.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  fillSelect("filter-category", categories, ui.filters.category);
  // ── Adım 1 sonu ──────────────────────────────────────────────────────────

  // Seri listesi (yayınevi filtresine göre)
  updateSeriesOptions();
}

// Seri select'ini seçili yayınevine göre doldur.
// Yayınevi seçili değilse select pasif + "Tümü" göster.
function updateSeriesOptions() {
  const seriesEl    = document.getElementById("filter-series");
  const seriesWrap  = document.getElementById("filter-series-wrap");
  if (!seriesEl) return;

  const pub = ui.filters.publisher;

  if (!pub) {
    // Pasif: yayınevi seçilmemiş
    seriesEl.disabled = true;
    seriesEl.innerHTML = `<option value="">— Önce yayınevi seçin —</option>`;
    seriesEl.value = "";
    ui.filters.series = "";
    if (seriesWrap) seriesWrap.classList.add("filter-group--disabled");
    return;
  }

  // Seçili yayınevine ait seriler
  const seriesOfPub = [...new Set(
    state.books
      .filter((b) => b.publisher === pub && b.series)
      .map((b) => b.series)
  )].sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));

  seriesEl.disabled = false;
  if (seriesWrap) seriesWrap.classList.remove("filter-group--disabled");
  fillSelect("filter-series", seriesOfPub, ui.filters.series);

  if (seriesOfPub.length === 0) {
    seriesEl.disabled = true;
    seriesEl.innerHTML = `<option value="">Bu yayınevinde seri yok</option>`;
    if (seriesWrap) seriesWrap.classList.add("filter-group--disabled");
  }
}

function fillSelect(id, options, current) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">Tümü</option>`;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value       = opt;
    o.textContent = opt;
    el.appendChild(o);
  });
  // Seçili değer hâlâ listede varsa koru, yoksa sıfırla.
  el.value = options.includes(current) ? current : "";
}

// ─── Chip butonlarını senkronize et ─────────────────────────────────────────
function syncChips() {
  syncChipGroup("filter-format-chips", ui.filters.format);
  syncChipGroup("filter-status-chips", ui.filters.status);
  // ── Adım J4 ──
  syncChipGroup("filter-language-chips", ui.filters.language);
  syncChipGroup("filter-tag-chips", ui.filters.tag);
  // ── Adım 3: Güven skoru ──────────────────────────────────────────────────
  syncChipGroup("filter-confidence-chips", ui.filters.confidence);
}

// ── Adım 9: activeValue artık ya tek bir string (Format/Durum/Güven gibi
// tek-seçim filtreler) ya da bir dizi (Dil/Etiket gibi çoklu-seçim filtreler)
// olabilir. Hangisi geldiyse ona göre "bu chip aktif mi?" kontrolü yapılır.
function syncChipGroup(containerId, activeValue) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const isMulti = Array.isArray(activeValue);
  el.querySelectorAll(".chip").forEach((chip) => {
    const isActive = isMulti
      ? (chip.dataset.value === "" ? activeValue.length === 0 : activeValue.includes(chip.dataset.value))
      : chip.dataset.value === activeValue;
    chip.classList.toggle("active", isActive);
  });
}

// ─── Kitapları çiz ───────────────────────────────────────────────────────────
function renderBooks() {
  const grid = document.getElementById("books-grid");
  if (!grid) return;
  grid.classList.toggle("list-view", ui.view === "list");
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">Kitap bulunamadı.</div>`;
    return;
  }

  const start    = (ui.page - 1) * PER_PAGE;
  const fragment = document.createDocumentFragment();
  filtered.slice(start, start + PER_PAGE).forEach((book) => {
    fragment.appendChild(ui.view === "list" ? createBookRow(book) : createBookCard(book));
  });
  grid.appendChild(fragment);
}

function createBookRow(book) {
  const row = document.createElement("div");
  row.className  = "book-row";
  row.dataset.id = book.$id;
  const statusClass = `status-${book.status || "okunmadi"}`;
  const coverHtml   = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escapeHtml(book.title || "")}" loading="lazy" />`
    : `<div class="row-cover-placeholder">${escapeHtml((book.title || "?")[0].toUpperCase())}</div>`;
  row.innerHTML = `
    <div class="row-cover">${coverHtml}</div>
    <div class="row-main">
      <span class="row-title">${escapeHtml(book.title  || "Başlıksız")}</span>
      <span class="row-author">${escapeHtml(book.author || "Yazar bilinmiyor")}</span>
    </div>
    <span class="badge row-format">${(book.format || "").toUpperCase()}</span>
    <span class="book-status-badge ${statusClass}">${statusLabel(book.status)}</span>
  `;
  return row;
}

// ─── Sayfalama ───────────────────────────────────────────────────────────────
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;
  const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (total <= 1) { container.innerHTML = ""; return; }

  let html = `<button class="page-btn" data-page="prev" ${ui.page === 1 ? "disabled" : ""}>‹</button>`;
  for (const p of pageNumbers(ui.page, total)) {
    html += p === "..."
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${p === ui.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" data-page="next" ${ui.page === total ? "disabled" : ""}>›</button>`;
  container.innerHTML = html;
}

function pageNumbers(current, total) {
  const range = [];
  const left  = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  range.push(1);
  if (left  > 2)          range.push("...");
  for (let i = left; i <= right; i++) range.push(i);
  if (right < total - 1)  range.push("...");
  if (total > 1)           range.push(total);
  return range;
}

// ─── Aktif filtre rozeti ─────────────────────────────────────────────────────
// Adım 9 ÖNEMLİ DÜZELTME: language/tag artık dizi. Boolean([]) JavaScript'te
// "true" döner (boş dizi de "truthy" sayılır) — bu yüzden basit Boolean()
// kontrolü diziler için YANLIŞ sonuç verirdi (hiç seçim yokken bile "aktif
// filtre" sayardı). Dizi ise .length > 0 kontrolü, değilse eski Boolean()
// kontrolü kullanılır.
function updateFilterBadge() {
  const count = Object.values(ui.filters).filter((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v)
  ).length;
  const badge = document.getElementById("filter-badge");
  const btn   = document.getElementById("filter-toggle");
  if (!badge || !btn) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
    btn.classList.add("has-filters");
  } else {
    badge.classList.add("hidden");
    btn.classList.remove("has-filters");
  }
}

function updateResultCount() {
  const el = document.getElementById("result-count");
  if (el) el.textContent = `${filtered.length} kitap`;
}

function updateViewToggle() {
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === ui.view);
  });
}

// ─── Tüm filtreleri sıfırla ──────────────────────────────────────────────────
function clearFilters() {
  ui.filters = { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: "", confidence: "", yearMin: null, yearMax: null };
  syncChips();
  ["filter-author", "filter-publisher", "filter-category"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  populateYearSlider();   // ── Adım 4: slider'ı tam aralığa geri döndür
  updateSeriesOptions(); // seriyi pasif yap
  recompute(true);
}

// ─── Mobil drawer ────────────────────────────────────────────────────────────
function openFilterPanel() {
  document.getElementById("filter-panel")?.classList.add("open");
  document.getElementById("filter-overlay")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeFilterPanel() {
  document.getElementById("filter-panel")?.classList.remove("open");
  document.getElementById("filter-overlay")?.classList.add("hidden");
  document.body.style.overflow = "";
}

// ─── Olayları bağla (yalnızca bir kez) ──────────────────────────────────────
export function initCatalog() {
  // ── Adım J3: Arama Debounce ──────────────────────────────────────────────
  // Kullanıcı her harf yazdığında filtreleme tetiklenmez. Yazmayı bıraktıktan
  // 300ms sonra tek seferlik filtreleme yapılır. Böylece "Vakıf" yazarken
  // V-A-K-I-F için 5 ayrı filtreleme yerine sadece 1 filtreleme çalışır.
  //
  // Mevcut (her tuşta — yavaş):
  //   input → ui.search güncelle → recompute()
  //
  // Yeni (300ms bekleyerek — hızlı):
  //   input → ui.search güncelle → debounce → recompute()
  let _searchDebounceTimer = null;
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    ui.search = e.target.value;
    _savePref("search", ui.search);   // ── Adım J6: kaydet
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => recompute(true), 300);
  });
  // ── Adım J3 sonu ─────────────────────────────────────────────────────────

  document.getElementById("sort-select")?.addEventListener("change", (e) => {
    ui.sort = e.target.value;
    _savePref("sort", ui.sort);   // ── Adım J6: kaydet
    recompute(true);
  });

  document.querySelector(".view-toggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn) return;
    ui.view = btn.dataset.view;
    _savePref("view", ui.view);   // ── Adım J6: kaydet
    render();
  });

  // Chip filtreler (format + durum + ...)
  // ── Adım 9: Dil ve Etiket "çoklu seçim" (MULTI_SELECT_FILTERS) listesinde —
  // bu ikisinde tıklama AÇIK/KAPALI (toggle) çalışır, birden fazla chip aynı
  // anda aktif olabilir. Diğer tüm filtreler (Format, Durum, Güven Skoru vb.)
  // eskisi gibi TEK seçimli kalır — bu liste dışındaki her filterKey için
  // davranış hiç değişmedi.
  const MULTI_SELECT_FILTERS = new Set(["language", "tag"]);

  document.getElementById("filter-panel")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const filterKey = chip.dataset.filter;
    const value     = chip.dataset.value;
    if (!filterKey) return;

    if (MULTI_SELECT_FILTERS.has(filterKey)) {
      // "Tümü" butonu (value === "") → seçimi tamamen temizle
      if (value === "") {
        ui.filters[filterKey] = [];
      } else {
        const current = ui.filters[filterKey];
        const idx = current.indexOf(value);
        if (idx === -1) {
          current.push(value);       // henüz seçili değildi → ekle
        } else {
          current.splice(idx, 1);    // zaten seçiliydi → çıkar (toggle kapat)
        }
      }
    } else {
      // Eski davranış: tek seçim, dokunulmadı.
      ui.filters[filterKey] = value;
    }

    syncChipGroup(`filter-${filterKey}-chips`, ui.filters[filterKey]);
    recompute(true);
  });

  // Yazar
  document.getElementById("filter-author")?.addEventListener("change", (e) => {
    ui.filters.author = e.target.value;
    recompute(true);
  });

  // Yayınevi — değişince seri listesini de güncelle
  document.getElementById("filter-publisher")?.addEventListener("change", (e) => {
    ui.filters.publisher = e.target.value;
    ui.filters.series    = "";  // yayınevi değişince seri seçimini sıfırla
    updateSeriesOptions();
    recompute(true);
  });

  // Seri
  document.getElementById("filter-series")?.addEventListener("change", (e) => {
    ui.filters.series = e.target.value;
    recompute(true);
  });

  // ── Adım 1: Kategori ──────────────────────────────────────────────────────
  document.getElementById("filter-category")?.addEventListener("change", (e) => {
    ui.filters.category = e.target.value;
    recompute(true);
  });
  // ── Adım 1 sonu ──────────────────────────────────────────────────────────

  // ── Adım 4: Yıl Aralığı Slider ───────────────────────────────────────────
  // "input" → sürüklerken anında görsel güncelleme (akıcı, ama filtreleme yapmaz).
  // "change" → kullanıcı tutamaçı bıraktığında gerçek filtreleme tetiklenir.
  // Bu ayrım, binlerce kitapta her piksel hareketinde yeniden hesaplama
  // yapılmasını önler — sadece bırakınca bir kez filtrelenir.
  const yearMinInput = document.getElementById("year-range-min");
  const yearMaxInput = document.getElementById("year-range-max");

  [yearMinInput, yearMaxInput].forEach((input) => {
    input?.addEventListener("input", updateYearRangeUI);

    input?.addEventListener("change", () => {
      let minVal = parseInt(yearMinInput.value);
      let maxVal = parseInt(yearMaxInput.value);
      if (minVal > maxVal) [minVal, maxVal] = [maxVal, minVal];

      // Tam aralığa geri dönülürse filtre tamamen kaldırılır (null).
      const isFullRange = minVal === yearBounds.min && maxVal === yearBounds.max;
      ui.filters.yearMin = isFullRange ? null : minVal;
      ui.filters.yearMax = isFullRange ? null : maxVal;
      recompute(true);
    });
  });
  // ── Adım 4 sonu ──────────────────────────────────────────────────────────

  document.getElementById("filter-clear")?.addEventListener("click", clearFilters);

  document.getElementById("filter-toggle")?.addEventListener("click", openFilterPanel);
  document.getElementById("filter-overlay")?.addEventListener("click", closeFilterPanel);

  document.getElementById("pagination")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (!btn || btn.disabled) return;
    const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const val = btn.dataset.page;
    if      (val === "prev") ui.page = Math.max(1, ui.page - 1);
    else if (val === "next") ui.page = Math.min(total, ui.page + 1);
    else                     ui.page = parseInt(val);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("books-grid")?.addEventListener("click", (e) => {
    const el = e.target.closest(".book-card, .book-row");
    if (el?.dataset.id) openModal(el.dataset.id);
  });
}