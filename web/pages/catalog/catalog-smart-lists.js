// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-SMART-LISTS — Akıllı Listeler (kaydedilebilir filtre setleri) +
// LocalStorage tercihleri (arama/sıralama/görünüm).
//
// catalog.js'den ayrıldı (Adım 2-3, Faza 2 parçalanması).
//
// BAĞIMLILIK NOTU (bkz. REFACTORING_ROADMAP_V5.md Adım 2-1/2-3):
// applySmartList() catalog-filters.js'deki birçok fonksiyonu (ui, recompute,
// _collectFilterOptions, populateSelectOptions, vb.) ve catalog-ui.js'deki
// updateFavoriteOnlyChip()'i çağırıyor. Roadmap'te Seçenek A (doğrudan
// import) seçildi — bu dosya catalog-filters.js'e bağımlı, ama
// catalog-filters.js bu dosyaya bağımlı DEĞİL, yani tek yönlü, dairesel
// bağımlılık oluşmuyor.
//
// ⚠️ DİKKAT: catalog-filters.js (Adım 2-4) ve catalog-ui.js (Adım 2-6) henüz
// oluşturulmadı. Aşağıdaki import satırları, o dosyalar Adım 2-4/2-6'da
// oluşturulduğunda kullanacakları export isimleriyle EŞLEŞECEK şekilde
// roadmap'teki fonksiyon haritasına göre yazıldı. Bu adımda (2-3) bu importlar
// henüz "kırık" olacak (dosyalar yok) — bu beklenen bir durum, Adım 2-9'daki
// tam entegrasyon testinde gerçek çalışma doğrulanacak.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtml } from "../../ui/common.js";
import { _showPrompt, _showInfo } from "../../ui/modal.js";
import {
  ui,
  recompute,
  _collectFilterOptions,
  populateSelectOptions,
  populateTagChips,
  populateCategoryChips,
  populateSubcategoryChips,
  populateTopicChips,
  populateYearSlider,
  updateSeriesOptions,
  syncChips,
} from "./catalog-filters.js";
import { updateFavoriteOnlyChip } from "./catalog-ui.js";

// ── Adım J6: LocalStorage yardımcıları ──────────────────────────────────────
// Kaydedilen tercihler: arama terimi, sıralama, görünüm modu (kart/liste).
// Filtreler (yazar, yayınevi, dil vb.) kasıtlı olarak kaydedilmiyor —
// bir sonraki oturumda beklenmedik "kitaplar eksik" durumu yaratabilir.

const _PREFS_KEY = {
  search : "ec_search",
  sort   : "ec_sort",
  view   : "ec_view",
};

// ── Adım 15: Akıllı Listeler (kaydedilebilir filtre setleri) ────────────────
// localStorage'da JSON dizi olarak saklanır. Her kayıt: { id, name, filters, sort }.
// Sadece filtreler + sıralama kaydedilir — arama metni ve görünüm modu
// (kart/liste) kasıtlı olarak kaydedilmez (geçici/oturuma özel kabul edilir).
const SMART_LIST_KEY   = "ec_smart_lists";
const SMART_LIST_LIMIT = 10;

export function _savePref(key, value) {
  try { localStorage.setItem(_PREFS_KEY[key], value); } catch { /* özel mod */ }
}

export function _loadPrefs() {
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

// ── Adım 15: Akıllı Listeler — okuma/yazma/uygulama/silme ───────────────────

// localStorage'dan kayıtlı listeleri oku. Bozuk/eksik veri varsa boş dizi döner.
// catalog/index.js'deki smart-list-chips "uygula" handler'ı, tıklanan chip'in
// id'sinden ilgili listeyi bulmak için bunu çağırıyor → export edilir.
export function _loadSmartLists() {
  try {
    const raw = localStorage.getItem(SMART_LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // bozuk JSON veya özel mod — sessizce boş liste
  }
}

// Listeyi localStorage'a yaz.
function _saveSmartLists(lists) {
  try {
    localStorage.setItem(SMART_LIST_KEY, JSON.stringify(lists));
  } catch { /* özel mod veya kota dolu — sessizce yoksay */ }
}

// Mevcut filtre + sıralama durumunu yeni bir Akıllı Liste olarak kaydet.
// İsim çakışması ve limit kontrolü burada yapılır (Soru 2 ve Soru 3 kararları).
// async: window.prompt()/alert() yerine sitenin kendi tema uyumlu dialog'unu
// (_showPrompt / _showInfo) kullanır, bunlar Promise döndürür.
export async function saveCurrentAsSmartList() {
  const lists = _loadSmartLists();

  if (lists.length >= SMART_LIST_LIMIT) {
    await _showInfo(`En fazla ${SMART_LIST_LIMIT} akıllı liste kaydedebilirsiniz. Lütfen önce mevcut listelerden birini silin.`);
    return;
  }

  const name = await _showPrompt("Bu filtre kombinasyonuna bir isim verin:");
  if (!name) return; // kullanıcı iptal etti veya boş isim girdi

  // Aynı isim zaten var mı? (büyük/küçük harf duyarsız karşılaştırma)
  const exists = lists.some((l) => l.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    await _showInfo(`"${name}" isimli bir akıllı liste zaten var. Lütfen başka bir isim seçin.`);
    return;
  }

  const newList = {
    id      : `sl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name    : name,
    // Derin kopya: ileride filtreler değişirse kayıtlı liste etkilenmesin.
    filters : JSON.parse(JSON.stringify(ui.filters)),
    sort    : ui.sort,
  };

  lists.push(newList);
  _saveSmartLists(lists);
  renderSmartListChips();
}

// Kayıtlı bir Akıllı Liste'yi mevcut filtre durumuna uygula.
// clearFilters() ile aynı eksiksiz yeniden senkronizasyon zincirini izler:
// önce ui.filters'ı tamamen değiştir, sonra series/select/chip/slider'ı
// sırayla güncelle (publisher önce set edilmeli ki updateSeriesOptions
// series seçimini sıfırlamasın), en son recompute(true) çağrılır.
export function applySmartList(list) {
  // Eksik alan ihtimaline karşı varsayılanlarla birleştir (eski kayıtlar
  // ileride yeni bir filtre alanı eklenirse kırılmasın).
  ui.filters = {
    format: "", status: "", author: "", publisher: "", series: "",
    language: [], tag: [], category: [], subcategory: [], topic: [],
    confidence: "", yearMin: null, yearMax: null, missingField: "",
    favoriteOnly: false, categoryStatus: "",
    ...JSON.parse(JSON.stringify(list.filters)),
  };
  ui.sort = list.sort || "added_at_desc";

  // Sıralama select'ini görsel olarak senkronize et (kaydedilmiyor ama UI tutarlı kalsın).
  const sortEl = document.getElementById("sort-select");
  if (sortEl) sortEl.value = ui.sort;

  // ── Adım 35: Burada da state.books taranıp opts hazırlanır — aksi halde
  // populateSubcategoryChips/populateYearSlider artık opts.subcategories /
  // opts.yearMin gibi alanlar beklediği için "opts undefined" hatası alırlardı.
  const filterOpts = _collectFilterOptions();

  // ── Adım 36: EKSİK ÇAĞRILAR TAMAMLANDI ───────────────────────────────────
  // SORUN: Adım 35'te renderCatalog() ve clearFilters() güncellenirken,
  // applySmartList() YARIM güncellenmişti — populateSelectOptions(),
  // populateTagChips() ve populateCategoryChips() çağrıları hiç
  // eklenmemişti. Sonuç: bir Akıllı Liste uygulandığında ui.filters doğru
  // ayarlanıp recompute(true) kitapları doğru filtreliyordu, AMA Yazar/
  // Yayınevi dropdown'ları ve Etiket/Kategori chip'leri YENİDEN
  // ÇİZİLMİYORDU — kullanıcı sonucu kitap listesinde görmeden önce arayüzde
  // "hiçbir şey değişmedi" sanıyordu.
  //
  // populateSelectOptions(filterOpts) eklenince, altındaki "Yazar/Yayınevi
  // select'lerini elle senkronize et" bloğu da gereksiz hale geldi — onun
  // yaptığı işi (value ayarlamayı) fillSelect() içeriden zaten yapıyor,
  // üstelik seçenek listesini de (options) doğru şekilde yeniliyor.
  populateSelectOptions(filterOpts);    // Adım 11: yazar/yayınevi dropdown'ları
  populateTagChips(filterOpts);         // Adım J4: etiket chip'leri
  populateCategoryChips(filterOpts);    // Adım 11: kategori chip'leri
  // ── Adım 36 sonu ──────────────────────────────────────────────────────────

  populateSubcategoryChips(filterOpts); // Adım 11: alt alan grubu yeni kategoriye göre yeniden çizilir
  populateTopicChips();       // Adım 11: konu grubu yeni alt alana göre yeniden çizilir
  populateYearSlider(filterOpts);       // Adım 4: slider tutamaçlarını filtreye göre konumlandır
  updateSeriesOptions();      // publisher zaten set edildi → series seçimini koruyacak
  syncChips();                // tüm chip gruplarını aktif/pasif olarak senkronize et

  updateFavoriteOnlyChip(); // ── Adım 17: chip görselini yeni filtre durumuna göre senkronize et

  recompute(true);
}

// Kayıtlı bir Akıllı Liste'yi sil.
export function deleteSmartList(id) {
  const lists = _loadSmartLists().filter((l) => l.id !== id);
  _saveSmartLists(lists);
  renderSmartListChips();
}

// Kayıtlı listeleri chip olarak filtre panelinin Akıllı Listeler bölümüne çiz.
// Her chip tıklanınca uygulanır; yanındaki (×) ikonu tıklanınca silinir.
export function renderSmartListChips() {
  const container = document.getElementById("smart-list-chips");
  if (!container) return;

  const lists = _loadSmartLists();

  if (lists.length === 0) {
    container.innerHTML = `<span class="smart-list-empty">Henüz kayıtlı liste yok.</span>`;
    return;
  }

  container.innerHTML = lists.map((l) => `
    <span class="smart-list-chip" data-id="${l.id}">
      <button class="smart-list-chip-apply" data-id="${l.id}">${escapeHtml(l.name)}</button>
      <button class="smart-list-chip-delete" data-id="${l.id}" title="Bu listeyi sil">×</button>
    </span>
  `).join("");
}
// ── Adım 15 sonu ──────────────────────────────────────────────────────────