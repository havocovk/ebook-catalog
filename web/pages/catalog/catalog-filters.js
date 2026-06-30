// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-FILTERS — Katalogun beyni: filtreleme, sıralama ve filtre paneli
// DOM senkronizasyonu (select / chip / yıl slider'ı).
//
// catalog.js'den ayrıldı (Adım 2-4, Faza 2 parçalanması).
//
// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ (Seçenek A — callback enjeksiyonu) ────────────
// Sorun: recompute() en sonunda render()'ı çağırıyor, ama render() catalog-ui.js'de
// tanımlı VE render()'ın çalışması için bu dosyadaki `filtered` değişkenine
// ihtiyacı var → filters ↔ ui çift yönlü bağımlılık.
//
// Çözüm: Bu dosya catalog-ui.js'i DOĞRUDAN import ETMEZ. Bunun yerine
// `_onRecompute` adlı bir callback tutar. catalog/index.js (orkestratör),
// kurulum sırasında `setRecomputeCallback(render)` çağırarak catalog-ui.js'deki
// render fonksiyonunu buraya enjekte eder. recompute() içinde render() yerine
// `_onRecompute?.()` çağrılır.
//
// Bu sayede bağımlılık tek yönlü kalır:
//   catalog-ui.js → catalog-filters.js (import: recompute, filtered, ui, PER_PAGE)
//   catalog-filters.js → catalog-search.js (import: _fuzzySearch)
//   catalog/index.js → her ikisini birleştirir (setRecomputeCallback ile bağlar)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { confidenceLevel } from "../../ui/common.js";
import { _fuzzySearch } from "./catalog-search.js";
// ── DİKKAT — kısmi dairesel import (filters ↔ ui) ───────────────────────────
// clearFilters() updateFavoriteOnlyChip()'i çağırıyor; bu fonksiyon
// catalog-ui.js'de tanımlı. catalog-ui.js da bu dosyadan recompute/ui/PER_PAGE/
// filtered import ediyor → iki dosya birbirini import ediyor. Bu ES
// modüllerinde GÜVENLİDİR çünkü updateFavoriteOnlyChip yalnızca clearFilters
// ÇALIŞTIĞINDA (runtime) çağrılıyor, modül YÜKLENİRKEN değil — yani modül
// başlatma sırasına bağlı bir "Cannot access before initialization" hatası
// oluşmaz. (recompute() ile catalog-ui.js arasındaki esas döngü zaten
// setRecomputeCallback ile kırıldı; bu sadece tek bir saf DOM yardımcı
// fonksiyonu için kalan zararsız bir kenar.)
import { updateFavoriteOnlyChip } from "./catalog-ui.js";

// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render() callback'i ─────────────────────────
// catalog/index.js bunu setRecomputeCallback(render) ile bir kez bağlar.
let _onRecompute = null;

export function setRecomputeCallback(fn) {
  _onRecompute = fn;
}

// ── Sayfa başına kitap sayısı ───────────────────────────────────────────────
// catalog-ui.js (renderBooks/renderPagination) ve catalog-bulk.js
// (getCurrentPageBooks) bu değeri kullanıyor → export edilir.
export const PER_PAGE = 50;

// ── Filtre + sayfa durumu (tek kaynak) ──────────────────────────────────────
// smart-lists, bulk ve ui modülleri bu objeyi okuyup yazıyor → export edilir.
export const ui = {
  search  : "",
  // ── Adım 14: "missingField" — Dashboard'daki Eksik Bilgi Merkezi'nden
  // gelen bir filtre isteği. Değerler: "author" | "publisher" | "cover_url" |
  // "year" | "" (filtre yok). İlgili alanı boş/null/undefined olan kitapları
  // gösterir. Diğer filtrelerden farkı: "şu değere eşit olsun" değil,
  // "bu alan eksik olsun" mantığıyla çalışır.
  // ── Adım 37: "categoryStatus" — kategori alanı dolu/boş durumuna göre filtre.
  // Değerler: "" (filtre yok) | "empty" (kategorisi boş kitaplar) |
  // "filled" (kategorisi dolu kitaplar). missingField'den farkı: missingField
  // tek bir alanı (author/publisher/cover_url/year) Dashboard'dan tek seferlik
  // yönlendirmeyle filtreler; categoryStatus ise filtre panelinde KALICI bir
  // chip grubu olarak durur ve diğer filtrelerle (seri, yazar vb.) birlikte
  // serbestçe kombine edilebilir.
  filters : { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: [], subcategory: [], topic: [], confidence: "", yearMin: null, yearMax: null, missingField: "", favoriteOnly: false, categoryStatus: "" },
  sort    : "added_at_desc",
  view    : "grid",
  page    : 1,
};

// ── Filtrelenmiş kitap listesi ──────────────────────────────────────────────
// SADECE recompute() bu değişkene yazar. catalog-ui.js (renderBooks) ve
// catalog-bulk.js (getCurrentPageBooks) sadece OKUR. ES modüllerinde export
// edilen `let`, "canlı binding"dir: recompute() değeri her güncellediğinde
// import eden dosyalar güncel değeri görür. Dışarıdan ATANMAZ (sadece okunur),
// bu yüzden setter'a gerek yok.
export let filtered = [];

// ── Adım 4: Kitaplardaki gerçek en eski/en yeni yıl (slider sınırları) ──────
// Sadece populateYearSlider (bu dosyada) yazar. AMA catalog/index.js'deki
// year-slider "change" event handler'ı, "tam aralığa dönüldü mü?" kontrolü
// için bu değeri OKUMAK zorunda — bu yüzden salt-okunur bir erişimci
// (getYearBounds) export edilir. Değişkenin kendisi export edilmez ki
// dışarıdan yanlışlıkla yazılmasın.
let yearBounds = { min: 1900, max: new Date().getFullYear() };

export function getYearBounds() {
  return yearBounds;
}

// ── Adım J4: Katalogdaki tüm etiketi toplayıp chip olarak doldur ────────────
export function populateTagChips(opts) {
  const container = document.getElementById("filter-tag-chips");
  if (!container) return;

  // ── Adım 35: opts.tags, _collectFilterOptions()'tan geliyor (tek geçiş)
  const allTags = opts.tags;

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

// ── Adım 11: Katalogdaki tüm kategorileri toplayıp chip olarak doldur ───────
// (populateTagChips ile birebir aynı mantık — kategori de serbest metin,
//  kitaplardan otomatik toplanıp tekrarsız + sıralı şekilde chip yapılır.)
export function populateCategoryChips(opts) {
  const container = document.getElementById("filter-category-chips");
  if (!container) return;

  // ── Adım 35: opts.categories, _collectFilterOptions()'tan geliyor (tek geçiş)
  const allCategories = opts.categories;

  // Sadece kategori chip'lerini yenile ("Tümü" butonu HTML'de kalıcı)
  const existing = [...container.querySelectorAll(".chip[data-filter='category']:not([data-value=''])")];
  existing.forEach((c) => c.remove());

  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className     = "chip";
    btn.dataset.filter = "category";
    btn.dataset.value  = cat;
    btn.textContent    = cat;
    container.appendChild(btn);
  });

  // Seçili kategorileri senkronize et (dizi, çoklu seçim)
  syncChipGroup("filter-category-chips", ui.filters.category);
}

// ── Adım 11: Alt Alan chip'lerini doldur (sadece akademik kitaplardan) ──────
// Ağacın 2. seviyesi. Sadece b.is_academic === true olan kitaplardan toplanır
// — kategori adı "Akademik" yazmasa da is_academic işaretliyse dahil edilir
// (Seçenek A: category metni ile is_academic checkbox'ı bağımsız).
// Görünürlük: en az 1 akademik kitap yoksa grup tamamen gizlenir.
export function populateSubcategoryChips(opts) {
  const wrap      = document.getElementById("filter-subcategory-wrap");
  const container = document.getElementById("filter-subcategory-chips");
  if (!wrap || !container) return;

  // ── Adım 35: opts.subcategories, _collectFilterOptions()'tan geliyor
  // (zaten sadece is_academic === true olan kitaplardan toplanmış).
  // Liste boşsa, ya hiç akademik kitap yok ya da hiçbirinde subcategory
  // girilmemiş — her iki durumda da grup gizlenir (eski mantıkla aynı).
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
    btn.className     = "chip";
    btn.dataset.filter = "subcategory";
    btn.dataset.value  = sub;
    btn.textContent    = sub;
    container.appendChild(btn);
  });

  syncChipGroup("filter-subcategory-chips", ui.filters.subcategory);
}

// ── Adım 11: Konu chip'lerini doldur (ağacın 3. seviyesi) ───────────────────
// Sadece akademik kitaplardan VE (eğer Alt Alan seçiliyse) o alt alana ait
// kitaplardan toplanır. Alt Alan hiç seçili değilse, tüm akademik kitapların
// konuları gösterilir (henüz daraltma yapılmamış demektir).
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
    btn.className     = "chip";
    btn.dataset.filter = "topic";
    btn.dataset.value  = topic;
    btn.textContent    = topic;
    container.appendChild(btn);
  });

  syncChipGroup("filter-topic-chips", ui.filters.topic);
}
// ── Adım 11 sonu ─────────────────────────────────────────────────────────────

// ── Adım 4: Yıl Aralığı Slider'ı Kur ────────────────────────────────────────
// Kitaplardaki gerçek en eski/en yeni yılı bulup slider'ın min/max
// sınırlarını buna göre ayarlar. Hiç yıl bilgisi yoksa 1900-bugün varsayılır.
export function populateYearSlider(opts) {
  // ── Adım 35: opts.yearMin/yearMax, _collectFilterOptions()'tan geliyor
  // (tek geçişte, Math.min/Math.max ile birebir aynı sonucu üretir).
  if (opts.yearMin !== null && opts.yearMax !== null) {
    yearBounds = { min: opts.yearMin, max: opts.yearMax };
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
export function recompute(resetPage = false) {
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
  // ── Adım 11: Kategori filtresi (çoklu seçim, VEYA mantığı) ───────────────
  // Dil filtresiyle aynı mantık: bir kitabın TEK kategorisi var (book.category),
  // o yüzden "VEYA" doğru — seçilen kategorilerden HERHANGİ BİRİYLE eşleşen
  // kitaplar gösterilir.
  if (ui.filters.category.length > 0) {
    result = result.filter((b) => ui.filters.category.includes(b.category));
  }
  // ── Adım 11 sonu ──────────────────────────────────────────────────────────

  // ── Adım 11: Alt Alan ve Konu filtreleri (ağacın 2. ve 3. seviyesi) ──────
  // Her ikisi de VEYA mantığıyla çoklu seçim — bir kitabın tek bir alt alanı
  // ve tek bir konusu olur (book.subcategory / book.topic tekil değer).
  if (ui.filters.subcategory.length > 0) {
    result = result.filter((b) => ui.filters.subcategory.includes(b.subcategory));
  }
  if (ui.filters.topic.length > 0) {
    result = result.filter((b) => ui.filters.topic.includes(b.topic));
  }
  // ── Adım 11 (Alt Alan/Konu) sonu ─────────────────────────────────────────

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

  // ── Adım 14: Eksik alan filtresi (Dashboard "Eksik Bilgi Merkezi") ───────
  // İlgili alanı boş string, null veya undefined olan kitapları gösterir.
  // Diğer filtrelerin tersine "değere eşit" değil "değer eksik" mantığı.
  if (ui.filters.missingField) {
    const field = ui.filters.missingField;
    result = result.filter((b) => !b[field]);
  }
  // ── Adım 14 sonu ──────────────────────────────────────────────────────────

  // ── Adım 37: Kategori Durumu filtresi (boş/dolu) ─────────────────────────
  // "empty"  → b.category boş string, null veya undefined olan kitaplar
  // "filled" → b.category'de gerçek bir değer (boş olmayan) olan kitaplar
  if (ui.filters.categoryStatus === "empty") {
    result = result.filter((b) => !b.category);
  } else if (ui.filters.categoryStatus === "filled") {
    result = result.filter((b) => Boolean(b.category));
  }
  // ── Adım 37 sonu ──────────────────────────────────────────────────────────

  // ── Adım 17: Sadece Favoriler filtresi ───────────────────────────────────
  if (ui.filters.favoriteOnly) {
    result = result.filter((b) => Boolean(b.favorite));
  }
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  filtered = sortBooks(result, ui.sort);
  if (resetPage) ui.page = 1;
  clampPage();
  // ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render() doğrudan import edilmiyor,
  // catalog/index.js tarafından enjekte edilen callback çağrılıyor.
  _onRecompute?.();
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

// ── Adım 35: Tek geçişte (single-pass) filtre seçeneklerini topla ───────────
//
// SORUN: populateSelectOptions, populateTagChips, populateCategoryChips,
// populateSubcategoryChips ve populateYearSlider — her biri state.books
// dizisini KENDİ BAŞINA baştan sona tarıyordu (.map/.filter/.flatMap).
// Kitap sayısı arttıkça (örn. 2000+), bu 6 ayrı tarama toplamda ciddi bir
// CPU yükü oluşturuyor ve katalog sayfasının ilk açılışını yavaşlatıyordu.
//
// ÇÖZÜM: state.books dizisi SADECE 1 KEZ taranır (klasik for döngüsüyle).
// Tarama sırasında her kitaptan author/publisher/tag/category/subcategory/
// year bilgisi AYNI ANDA toplanır. Sonuç, hazır Set'ler içeren tek bir
// nesne olarak döndürülür — DOM'a yazma işini ÜSTLENMEZ, sadece veriyi
// hazırlar (sorumluluk ayrımı: toplama burada, DOM yazımı her fonksiyonun
// kendisinde kalır).
//
// NOT: populateTopicChips() ve updateSeriesOptions() bu fonksiyona DAHIL
// EDİLMEDİ — ikisi de o anki kullanıcı filtresine (ui.filters.subcategory /
// ui.filters.publisher) göre DARALTILMIŞ bir alt küme üzerinde çalışıyor,
// "ham/tüm kitaplardan liste çıkarma" mantığına uymuyorlar. Ayrıca ikisi de
// zaten küçük alt kümeler üzerinde (akademik kitaplar / tek yayınevi)
// çalıştığı için performans sorunu yaratmıyorlar.
export function _collectFilterOptions() {
  const authorSet      = new Set();
  const publisherSet   = new Set();
  const tagSet         = new Set();
  const categorySet    = new Set();
  const subcategorySet = new Set();
  let yearMin = null;
  let yearMax = null;

  for (const b of state.books) {
    if (b.author)    authorSet.add(b.author);
    if (b.publisher) publisherSet.add(b.publisher);
    if (b.category)  categorySet.add(b.category);

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
    yearMin,
    yearMax,
  };
}
// ── Adım 35 sonu ─────────────────────────────────────────────────────────────

// ─── Select seçeneklerini doldur ─────────────────────────────────────────────

export function populateSelectOptions(opts) {
  // ── Adım 35: opts artık _collectFilterOptions()'tan geliyor — kendi
  // başına state.books'u taramaz, hazır listeyi DOM'a yazar.
  fillSelect("filter-author", opts.authors, ui.filters.author);
  fillSelect("filter-publisher", opts.publishers, ui.filters.publisher);

  // (Adım 11: Kategori artık dropdown değil, chip — populateCategoryChips() ile doldurulur)

  // ── Adım 33: Seri listesi güncellemesi BURADAN ÇIKARILDI ────────────────
  // SORUN: updateSeriesOptions() burada çağrılıyordu VE renderCatalog()
  // içinde (bu fonksiyondan hemen sonra) TEKRAR çağrılıyordu. Sonuç: aynı
  // render döngüsünde updateSeriesOptions() 2 KEZ çalışıyordu — ikinci
  // çağrı tamamen gereksizdi (birincisinden farklı bir sonuç üretmiyordu,
  // çünkü ui.filters.publisher arada değişmiyor).
  //
  // ÇÖZÜM: Sorumluluk ayrımı netleştirildi. populateSelectOptions() artık
  // SADECE Yazar/Yayınevi select'lerini doldurur. Seri listesini güncelleme
  // görevi tamamen renderCatalog()'a (ve onu çağıran diğer yerlere) bırakıldı
  // — updateSeriesOptions() hâlâ doğru şekilde çalışır, sadece 1 kez.
  // ── Adım 33 sonu ──────────────────────────────────────────────────────────
}

// Seri select'ini seçili yayınevine göre doldur.
// Yayınevi seçili değilse select pasif + "Tümü" göster.
export function updateSeriesOptions() {
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
export function syncChips() {
  syncChipGroup("filter-format-chips", ui.filters.format);
  syncChipGroup("filter-status-chips", ui.filters.status);
  // ── Adım J4 ──
  syncChipGroup("filter-language-chips", ui.filters.language);
  syncChipGroup("filter-tag-chips", ui.filters.tag);
  // ── Adım 3: Güven skoru ──────────────────────────────────────────────────
  syncChipGroup("filter-confidence-chips", ui.filters.confidence);
  // ── Adım 11: Kategori (çoklu seçim) ──────────────────────────────────────
  syncChipGroup("filter-category-chips", ui.filters.category);
  syncChipGroup("filter-subcategory-chips", ui.filters.subcategory);
  syncChipGroup("filter-topic-chips", ui.filters.topic);
  // ── Adım 37: Kategori Durumu (tek seçim) ─────────────────────────────────
  syncChipGroup("filter-categoryStatus-chips", ui.filters.categoryStatus);
}

// ── Adım 9: activeValue artık ya tek bir string (Format/Durum/Güven gibi
// tek-seçim filtreler) ya da bir dizi (Dil/Etiket gibi çoklu-seçim filtreler)
// olabilir. Hangisi geldiyse ona göre "bu chip aktif mi?" kontrolü yapılır.
export function syncChipGroup(containerId, activeValue) {
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

// ─── Tüm filtreleri sıfırla ──────────────────────────────────────────────────
export function clearFilters() {
  ui.filters = { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: [], subcategory: [], topic: [], confidence: "", yearMin: null, yearMax: null, missingField: "", favoriteOnly: false, categoryStatus: "" };
  syncChips();
  ["filter-author", "filter-publisher"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  // ── Adım 35: Aynı sebep — populateSubcategoryChips/populateYearSlider
  // artık opts parametresi bekliyor, burada da hazırlanması gerekiyor.
  const filterOpts = _collectFilterOptions();

  populateSubcategoryChips(filterOpts); // ── Adım 11: alt alan/konu grupları sıfırlanmış filtreyle yeniden çizilir
  populateTopicChips();       // ── Adım 11
  populateYearSlider(filterOpts);   // ── Adım 4: slider'ı tam aralığa geri döndür
  updateSeriesOptions(); // seriyi pasif yap
  updateFavoriteOnlyChip(); // ── Adım 17: "Sadece Favoriler" chip'ini pasif göster
  recompute(true);
}

// ─── Mobil drawer ────────────────────────────────────────────────────────────
export function openFilterPanel() {
  document.getElementById("filter-panel")?.classList.add("open");
  document.getElementById("filter-overlay")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
export function closeFilterPanel() {
  document.getElementById("filter-panel")?.classList.remove("open");
  document.getElementById("filter-overlay")?.classList.add("hidden");
  document.body.style.overflow = "";
}