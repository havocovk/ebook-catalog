// ─────────────────────────────────────────────────────────────────────────────
// FILTER-POPULATE — Filtre panelindeki chip ve select'leri doldurur.
//
// "Doldurmak" = state.books'tan (veya hazır opts'tan) değerleri toplayıp
// DOM'a chip butonu / <option> olarak yazmak.
//
// Sorumluluklar:
//   • _collectFilterOptions()   — TEK GEÇİŞTE tüm filtre seçeneklerini topla
//   • populateTagChips()        — etiket chip'leri
//   • populateCategoryChips()   — kategori chip'leri
//   • populateGenreChips()      — tür chip'leri
//   • populateSubcategoryChips()— alt alan chip'leri (sadece akademik)
//   • populateTopicChips()      — konu chip'leri (alt alana bağlı)
//   • populateYearSlider()      — yıl slider'ı sınırlarını ayarla
//   • updateYearRangeUI()       — slider görsel güncelleme (dolgu + yazı)
//   • populateSelectOptions()   — Yazar/Yayınevi select'leri
//   • updateSeriesOptions()     — Seri select'i (yayıneviye bağlı)
//   • fillSelect()              — genel <select> doldurma yardımcısı (private)
//
// Bağımlılıklar:
//   ← state.js         (state.books — değerlerin toplandığı ham veri)
//   ← filter-state.js  (ui, getYearBounds, setYearBounds)
//   ← filter-sync.js   (syncChipGroup — her doldurmadan sonra seçimi senkronize et)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { ui, getYearBounds, setYearBounds } from "./filter-state.js";
import { syncChipGroup } from "./filter-sync.js";

// ── Adım J4: Katalogdaki tüm etiketi toplayıp chip olarak doldur ────────────
export function populateTagChips(opts) {
  const container = document.getElementById("filter-tag-chips");
  if (!container) return;

  // Adım 35: opts.tags, _collectFilterOptions()'tan geliyor (tek geçiş)
  const allTags = opts.tags;

  // Sadece etiket chip'lerini yenile (Tümü butonu HTML'de kalıcı)
  const existing = [...container.querySelectorAll(".chip[data-filter='tag']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className      = "chip";
    btn.dataset.filter = "tag";
    btn.dataset.value  = tag;
    btn.textContent    = tag;
    container.appendChild(btn);
  });

  // Seçili etiketleri senkronize et (Adım 9: artık dizi, çoklu seçim olabilir)
  syncChipGroup("filter-tag-chips", ui.filters.tag);
}

// ── Adım 11: Katalogdaki tüm kategorileri toplayıp chip olarak doldur ───────
// (populateTagChips ile birebir aynı mantık — kategori de serbest metin,
//  kitaplardan otomatik toplanıp tekrarsız + sıralı şekilde chip yapılır.)
export function populateCategoryChips(opts) {
  const container = document.getElementById("filter-category-chips");
  if (!container) return;

  // Adım 35: opts.categories, _collectFilterOptions()'tan geliyor (tek geçiş)
  const allCategories = opts.categories;

  // Sadece kategori chip'lerini yenile ("Tümü" butonu HTML'de kalıcı)
  const existing = [...container.querySelectorAll(".chip[data-filter='category']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className      = "chip";
    btn.dataset.filter = "category";
    btn.dataset.value  = cat;
    btn.textContent    = cat;
    container.appendChild(btn);
  });

  // Seçili kategorileri senkronize et (dizi, çoklu seçim)
  syncChipGroup("filter-category-chips", ui.filters.category);
}

// ── Bölüm 2: Tür (genre) chip'lerini doldur ─────────────────────────────────
// populateCategoryChips ile birebir aynı mantık. Çoklu seçim (VEYA mantığı).
export function populateGenreChips(opts) {
  const container = document.getElementById("filter-genre-chips");
  if (!container) return;

  const allGenres = opts.genres;

  // Sadece tür chip'lerini yenile ("Tümü" butonu HTML'de kalıcı)
  const existing = [...container.querySelectorAll(".chip[data-filter='genre']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allGenres.forEach((genre) => {
    const btn = document.createElement("button");
    btn.className      = "chip";
    btn.dataset.filter = "genre";
    btn.dataset.value  = genre;
    btn.textContent    = genre;
    container.appendChild(btn);
  });

  // Seçili türleri senkronize et (dizi, çoklu seçim)
  syncChipGroup("filter-genre-chips", ui.filters.genre);
}

// ── Adım 11: Alt Alan chip'lerini doldur (sadece akademik kitaplardan) ──────
// Ağacın 2. seviyesi. Sadece b.is_academic === true olan kitaplardan toplanır.
// Görünürlük: en az 1 akademik kitap yoksa grup tamamen gizlenir.
export function populateSubcategoryChips(opts) {
  const wrap      = document.getElementById("filter-subcategory-wrap");
  const container = document.getElementById("filter-subcategory-chips");
  if (!wrap || !container) return;

  // Adım 35: opts.subcategories, _collectFilterOptions()'tan geliyor
  // (zaten sadece is_academic === true olan kitaplardan toplanmış).
  const allSubcats = opts.subcategories;

  if (allSubcats.length === 0) {
    wrap.classList.add("hidden");
    ui.filters.subcategory = [];
    return;
  }

  wrap.classList.remove("hidden");

  const existing = [...container.querySelectorAll(".chip[data-filter='subcategory']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allSubcats.forEach((sub) => {
    const btn = document.createElement("button");
    btn.className      = "chip";
    btn.dataset.filter = "subcategory";
    btn.dataset.value  = sub;
    btn.textContent    = sub;
    container.appendChild(btn);
  });

  syncChipGroup("filter-subcategory-chips", ui.filters.subcategory);
}

// ── Adım 11: Konu chip'lerini doldur (ağacın 3. seviyesi) ───────────────────
// Sadece akademik kitaplardan VE (eğer Alt Alan seçiliyse) o alt alana ait
// kitaplardan toplanır. Alt Alan hiç seçili değilse tüm akademik konular gösterilir.
export function populateTopicChips() {
  const wrap      = document.getElementById("filter-topic-wrap");
  const container = document.getElementById("filter-topic-chips");
  if (!wrap || !container) return;

  let academicBooks = state.books.filter((b) => b.is_academic);

  // Alt Alan seçiliyse, konu listesini o alt alan(lar)a göre daralt.
  if (ui.filters.subcategory.length > 0) {
    academicBooks = academicBooks.filter((b) => ui.filters.subcategory.includes(b.subcategory));
  }

  const allTopics = [...new Set(
    academicBooks.map((b) => b.topic).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));

  if (allTopics.length === 0) {
    wrap.classList.add("hidden");
    ui.filters.topic = [];
    return;
  }

  wrap.classList.remove("hidden");

  const existing = [...container.querySelectorAll(".chip[data-filter='topic']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allTopics.forEach((topic) => {
    const btn = document.createElement("button");
    btn.className      = "chip";
    btn.dataset.filter = "topic";
    btn.dataset.value  = topic;
    btn.textContent    = topic;
    container.appendChild(btn);
  });

  syncChipGroup("filter-topic-chips", ui.filters.topic);
}

// ── Adım 4: Yıl Aralığı Slider'ı Kur ────────────────────────────────────────
// Kitaplardaki gerçek en eski/en yeni yılı bulup slider'ın min/max
// sınırlarını buna göre ayarlar. Hiç yıl bilgisi yoksa 1900-bugün varsayılır.
export function populateYearSlider(opts) {
  // Adım 35: opts.yearMin/yearMax, _collectFilterOptions()'tan geliyor
  // (tek geçişte, Math.min/Math.max ile birebir aynı sonucu üretir).
  if (opts.yearMin !== null && opts.yearMax !== null) {
    setYearBounds({ min: opts.yearMin, max: opts.yearMax });
  }

  const yb = getYearBounds();
  const minInput = document.getElementById("year-range-min");
  const maxInput = document.getElementById("year-range-max");
  if (!minInput || !maxInput) return;

  minInput.min = yb.min;
  minInput.max = yb.max;
  maxInput.min = yb.min;
  maxInput.max = yb.max;

  // Filtre henüz uygulanmamışsa (null) slider'ı tam aralıkta başlat.
  minInput.value = ui.filters.yearMin ?? yb.min;
  maxInput.value = ui.filters.yearMax ?? yb.max;

  updateYearRangeUI();
}

// Slider hareket ettikçe: dolgu çizgisinin genişliğini ve üstteki
// "1990 — 2024" yazısını günceller. Filtreleme yapmaz (sadece görsel).
export function updateYearRangeUI() {
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

  const yb = getYearBounds();
  const span = yb.max - yb.min || 1;   // sıfıra bölme koruması
  const leftPct  = ((minVal - yb.min) / span) * 100;
  const rightPct = ((maxVal - yb.min) / span) * 100;
  fill.style.left  = leftPct + "%";
  fill.style.width = (rightPct - leftPct) + "%";

  // Tam aralıktaysa (filtre yok) "Tümü" göster, değilse aralığı göster.
  const isFullRange = minVal === yb.min && maxVal === yb.max;
  display.textContent = isFullRange ? "Tümü" : `${minVal} — ${maxVal}`;
}

// ── Adım 35: Tek geçişte (single-pass) filtre seçeneklerini topla ───────────
//
// SORUN: populateSelectOptions, populateTagChips, populateCategoryChips,
// populateSubcategoryChips ve populateYearSlider — her biri state.books
// dizisini KENDİ BAŞINA baştan sona tarıyordu. Kitap sayısı arttıkça (örn.
// 2000+), bu 6 ayrı tarama toplamda ciddi bir CPU yükü oluşturuyordu.
//
// ÇÖZÜM: state.books dizisi SADECE 1 KEZ taranır (klasik for döngüsüyle).
// Tarama sırasında her kitaptan author/publisher/tag/category/subcategory/
// year bilgisi AYNI ANDA toplanır. Sonuç, hazır Set'ler içeren tek bir nesne
// olarak döndürülür — DOM'a yazma işini ÜSTLENMEZ, sadece veriyi hazırlar.
//
// NOT: populateTopicChips() ve updateSeriesOptions() bu fonksiyona DAHIL
// EDİLMEDİ — ikisi de o anki kullanıcı filtresine göre DARALTILMIŞ bir alt
// küme üzerinde çalışıyor, "ham/tüm kitaplardan liste çıkarma" mantığına uymuyor.
export function _collectFilterOptions() {
  const authorSet      = new Set();
  const publisherSet   = new Set();
  const tagSet         = new Set();
  const categorySet    = new Set();
  const subcategorySet = new Set();
  const genreSet       = new Set();
  let yearMin = null;
  let yearMax = null;

  for (const b of state.books) {
    if (b.author)    authorSet.add(b.author);
    if (b.publisher) publisherSet.add(b.publisher);
    if (b.category)  categorySet.add(b.category);
    if (b.genre)     genreSet.add(b.genre);

    if (b.tags) {
      for (const t of b.tags) if (t) tagSet.add(t);
    }

    if (b.is_academic && b.subcategory) subcategorySet.add(b.subcategory);

    if (Number.isFinite(b.year)) {
      if (yearMin === null || b.year < yearMin) yearMin = b.year;
      if (yearMax === null || b.year > yearMax) yearMax = b.year;
    }
  }

  const trCompare = (a, b) => a.localeCompare(b, "tr", { sensitivity: "base" });

  return {
    authors:       [...authorSet].sort(trCompare),
    publishers:    [...publisherSet].sort(trCompare),
    tags:          [...tagSet].sort(trCompare),
    categories:    [...categorySet].sort(trCompare),
    subcategories: [...subcategorySet].sort(trCompare),
    genres:        [...genreSet].sort(trCompare),
    yearMin,
    yearMax,
  };
}

// ─── Select seçeneklerini doldur ─────────────────────────────────────────────
export function populateSelectOptions(opts) {
  // Adım 35: opts artık _collectFilterOptions()'tan geliyor — kendi başına
  // state.books'u taramaz, hazır listeyi DOM'a yazar.
  fillSelect("filter-author", opts.authors, ui.filters.author);
  fillSelect("filter-publisher", opts.publishers, ui.filters.publisher);

  // (Adım 11: Kategori artık dropdown değil, chip — populateCategoryChips() ile doldurulur)
  //
  // Adım 33: Seri listesi güncellemesi BURADAN ÇIKARILDI. populateSelectOptions()
  // artık SADECE Yazar/Yayınevi select'lerini doldurur; seri güncelleme görevi
  // tamamen renderCatalog()'a (updateSeriesOptions çağrısına) bırakıldı.
}

// Seri select'ini seçili yayınevine göre doldur.
// Yayınevi seçili değilse select pasif + "Tümü" göster.
export function updateSeriesOptions() {
  const seriesEl   = document.getElementById("filter-series");
  const seriesWrap = document.getElementById("filter-series-wrap");
  if (!seriesEl) return;

  const pub = ui.filters.publisher;

  if (!pub) {
    // Pasif: yayınevi seçilmemiş
    seriesEl.disabled  = true;
    seriesEl.innerHTML = `<option value="">— Önce yayınevi seçin —</option>`;
    seriesEl.value     = "";
    ui.filters.series  = "";
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
    seriesEl.disabled  = true;
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