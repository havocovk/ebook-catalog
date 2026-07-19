// ─────────────────────────────────────────────────────────────────────────────
// FILTER-STATE — Katalog filtrelemesinin paylaşılan durumu (tek kaynak).
//
// Bu modül, filtreleme sisteminin EN ALT KATMANIDIR — başka hiçbir filter-*
// modülünü import etmez, sadece dışarıdan import EDİLİR. İçinde:
//
//   • ui            — filtre + sayfa durumu (tek kaynak)
//   • PER_PAGE      — sayfa başına kitap sayısı
//   • filtered      — filtrelenmiş kitap listesi (canlı binding)
//   • setFiltered() — filtered'a yazmak için (filter-core.js kullanır)
//   • yearBounds    — slider sınırları (getYearBounds ile salt-okunur erişim)
//   • setYearBounds() — yearBounds'a yazmak için (filter-populate.js kullanır)
//   • setRecomputeCallback / getRecomputeCallback — dairesel bağımlılık çözümü
//
// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ ──────────────────────────────────────────────
// recompute() (filter-core.js) en sonunda render()'ı çağırır, ama render()
// catalog-ui.js'de. catalog-ui.js de bu sistemden ui/filtered/PER_PAGE import
// eder → çift yönlü. Çözüm: catalog-ui.js DOĞRUDAN import edilmez; index.js
// kurulumda setRecomputeCallback(render) ile render'ı enjekte eder.
// ─────────────────────────────────────────────────────────────────────────────

// ── Sayfa başına kitap sayısı ───────────────────────────────────────────────
// catalog-ui.js (renderBooks/renderPagination) ve bulk-selection.js
// (getCurrentPageBooks) bu değeri kullanıyor → export edilir.
export const PER_PAGE = 50;

// ── Filtre + sayfa durumu (tek kaynak) ──────────────────────────────────────
// smart-lists, bulk ve ui modülleri bu objeyi okuyup yazıyor → export edilir.
//
// Adım 14: "missingField" — Dashboard'daki Eksik Bilgi Merkezi'nden gelen
// bir filtre isteği. Değerler: "author" | "publisher" | "cover_url" | "year" |
// "" (filtre yok). İlgili alanı boş/null/undefined olan kitapları gösterir.
//
// Adım 37: "categoryStatus" — kategori alanı dolu/boş durumuna göre filtre.
// Değerler: "" (filtre yok) | "empty" (kategorisi boş) | "filled" (kategorisi dolu).
export const ui = {
  search  : "",
  filters : { format: "", status: "", author: "", publisher: "", series: "", language: [], tag: [], category: [], subcategory: [], topic: [], genre: [], confidence: "", yearMin: null, yearMax: null, missingField: "", favoriteOnly: false, categoryStatus: "", coverStatus: "" },
  sort    : "added_at_desc",
  view    : "grid",
  page    : 1,
};

// ── Filtrelenmiş kitap listesi ──────────────────────────────────────────────
// SADECE recompute() (filter-core.js) bu değişkene yazar (setFiltered ile).
// catalog-ui.js (renderBooks) ve bulk-selection.js (getCurrentPageBooks) sadece
// OKUR. ES modüllerinde export edilen `let`, "canlı binding"dir: değer her
// güncellendiğinde import eden dosyalar güncel değeri görür.
export let filtered = [];

// filtered'a yazmak için tek yetkili kapı. filter-core.js recompute() içinde
// bunu çağırır — böylece `filtered` bu modülde tanımlı kalır ama başka modül
// tarafından güncellenebilir (canlı binding korunur).
export function setFiltered(list) {
  filtered = list;
}

// ── Adım 4: Kitaplardaki gerçek en eski/en yeni yıl (slider sınırları) ──────
// Sadece filter-populate.js (populateYearSlider) yazar (setYearBounds ile).
// index.js'deki year-slider "change" handler'ı, "tam aralığa dönüldü mü?"
// kontrolü için OKUR (getYearBounds ile). Değişken doğrudan export edilmez ki
// dışarıdan yanlışlıkla yazılmasın.
let yearBounds = { min: 1900, max: new Date().getFullYear() };

export function getYearBounds() {
  return yearBounds;
}

export function setYearBounds(bounds) {
  yearBounds = bounds;
}

// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render() callback'i ─────────────────────────
// catalog/index.js bunu setRecomputeCallback(render) ile bir kez bağlar.
// filter-core.js recompute() sonunda getRecomputeCallback()?.() ile çağırır.
let _onRecompute = null;

export function setRecomputeCallback(fn) {
  _onRecompute = fn;
}

export function getRecomputeCallback() {
  return _onRecompute;
}