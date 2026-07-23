// ─────────────────────────────────────────────────────────────────────────────
// CATALOG/INDEX — Orkestratör.
//
// 5 katalog parçasını (search, smart-lists, filters, bulk, ui) birleştirir ve
// dış dünyaya (app.js → catalog.js → buraya) yalnızca iki fonksiyon sunar:
//   - renderCatalog()  → sayfa her açıldığında çağrılır (router)
//   - initCatalog()    → olay dinleyicilerini bir kez bağlar (app başlangıcı)
//
// ── DAİRESEL BAĞIMLILIĞIN KIRILDIĞI YER ─────────────────────────────────────
// catalog-filters.js ve catalog-bulk.js, catalog-ui.js'deki render()'ı DOĞRUDAN
// import etmez (aksi halde filters↔ui ve bulk↔ui dairesel importu oluşurdu).
// Onun yerine "callback kutuları" tutarlar. Bu dosya, modül yüklenirken bu
// kutulara catalog-ui.js'deki gerçek render fonksiyonunu YERLEŞTİRİR:
//   setRecomputeCallback(render)  → recompute() bittiğinde render() çağrılsın
//   setRenderCallback(render)     → seçim değişince render() çağrılsın
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { openModal } from "../../ui/modal.js";

// ── Smart-lists modülü ──────────────────────────────────────────────────────
import {
  _loadPrefs,
  _savePref,
  _loadSmartLists,
  saveCurrentAsSmartList,
  applySmartList,
  deleteSmartList,
  renderSmartListChips,
} from "./catalog-smart-lists.js";

// ── Filters modülü ──────────────────────────────────────────────────────────
import {
  ui,
  recompute,
  setRecomputeCallback,
  _collectFilterOptions,
  populateSelectOptions,
  populateTagChips,
  populateCategoryChips,
  populateGenreDropdown,
  _syncGenreDropdown,
  populateSubcategoryChips,
  populateTopicChips,
  populateYearSlider,
  updateYearRangeUI,
  syncChips,
  syncChipGroup,
  updateSeriesOptions,
  clearFilters,
  openFilterPanel,
  closeFilterPanel,
  getYearBounds,
  PER_PAGE,
  filtered,
} from "./catalog-filters.js";

// ── Bulk modülü ─────────────────────────────────────────────────────────────
import {
  selectedIds,
  toggleSelection,
  clearSelection,
  toggleSelectAllOnPage,
  updateBulkBar,
  updateSelectAllButton,
  runBulkOperation,
  bulkDelete,
  bulkChangeStatus,
  bulkAddTag,
  bulkSetCategory,
  bulkSetGenre,
  bulkAddCollection,
  bulkSetFavorite,
  setRenderCallback,
} from "./catalog-bulk.js";

// ── UI modülü ───────────────────────────────────────────────────────────────
import {
  render,
  updateFavoriteOnlyChip,
  toggleFavorite,
} from "./catalog-ui.js";

// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render callback'lerini bağla (bir kez) ──────
// Bu iki satır, modül ilk yüklendiğinde çalışır ve filters/bulk modüllerine
// catalog-ui.js'deki gerçek render fonksiyonunu enjekte eder.
setRecomputeCallback(render);
setRenderCallback(render);

// ─── Dışa açık: sayfayı çiz ──────────────────────────────────────────────────
export function renderCatalog() {
  _loadPrefs();               // ── Adım J6: kayıtlı tercihleri yükle

  // ── Adım 14: Dashboard'dan gelen bekleyen filtre isteği var mı? ──────────
  // Varsa uygula ve hemen temizle — böylece katalog sayfasına normal
  // şekilde tekrar girildiğinde (menüden tıklayarak) bu filtre "yapışık"
  // kalmaz, sadece bir kerelik bir yönlendirme olur.
  if (state.pendingCatalogFilter) {
    if (state.pendingCatalogFilter.missingField) {
      ui.filters.missingField = state.pendingCatalogFilter.missingField;
    }
    state.pendingCatalogFilter = null;
  }
  // ── Adım 14 sonu ──────────────────────────────────────────────────────────

  // ── Adım 18: Sayfaya her girişte seçim sıfırlanır ────────────────────────
  // Kullanıcı başka bir sayfaya gidip Katalog'a geri dönerse, eski seçim
  // "yapışık" kalmasın — Adım 14'teki pendingCatalogFilter mantığıyla aynı
  // "temiz başlangıç" prensibi.
  selectedIds.clear();
  // ── Adım 18 sonu ──────────────────────────────────────────────────────────

  // ── Adım 35: state.books dizisi BURADA SADECE 1 KEZ taranır. Sonuç,
  // aşağıdaki 5 fonksiyona (kendileri artık ayrıca taramaz) paylaştırılır.
  const filterOpts = _collectFilterOptions();

  populateSelectOptions(filterOpts);
  populateTagChips(filterOpts);         // ── Adım J4: dinamik etiket chip'leri
  populateCategoryChips(filterOpts);    // ── Adım 11: dinamik kategori chip'leri (çoklu seçim)
  populateGenreDropdown(filterOpts);    // ── Bölüm 2: tür dropdown listesini doldur
  populateSubcategoryChips(filterOpts); // ── Adım 11: alt alan chip'leri (sadece akademik)
  populateTopicChips();       // ── Adım 11: konu chip'leri (alt alana bağlı) — ui.filters.subcategory'ye bağımlı, tek-geçişe dahil edilmedi
  populateYearSlider(filterOpts);       // ── Adım 4: yıl aralığı slider sınırlarını ayarla
  syncChips();
  updateSeriesOptions();      // yayınevi filtresine göre seri listesini güncelle — ui.filters.publisher'a bağımlı, tek-geçişe dahil edilmedi
  renderSmartListChips();     // ── Adım 15: kayıtlı akıllı listeleri çiz
  updateFavoriteOnlyChip();   // ── Adım 17: "Sadece Favoriler" chip görselini senkronize et
  updateBulkBar();            // ── Adım 18: toplu işlem çubuğunu gizli başlat
  updateSelectAllButton();    // ── Adım 24: "Sayfadaki Tümünü Seç" butonunu sıfır durumda başlat
  recompute(false);
}

// ─── Dışa açık: olayları bağla (yalnızca bir kez) ───────────────────────────
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

  // ── Adım 9 + Adım 11: Dil, Etiket ve Kategori "çoklu seçim" (MULTI_SELECT_FILTERS)
  // listesinde — bu üçünde tıklama AÇIK/KAPALI (toggle) çalışır, birden fazla
  // chip aynı anda aktif olabilir. Diğer tüm filtreler (Format, Durum, Güven
  // Skoru vb.) eskisi gibi TEK seçimli kalır — bu liste dışındaki her
  // filterKey için davranış hiç değişmedi.
  const MULTI_SELECT_FILTERS = new Set(["language", "tag", "category", "subcategory", "topic", "genre"]);

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

    // ── Adım 11: Ağaç daraltma — üst seviye değişince alt seviye yeniden
    // hesaplanır. Alt Alan seçimi değişince Konu listesi (o alt alana göre)
    // güncellenir. Kategori değişimi Alt Alan/Konu'yu etkilemez çünkü onlar
    // zaten "is_academic" bayrağına göre (kategori adına göre değil) toplanıyor.
    if (filterKey === "subcategory") {
      ui.filters.topic = [];   // alt alan değişti → eski konu seçimleri geçersiz
      populateTopicChips();
    }
    // ── Adım 11 sonu ──────────────────────────────────────────────────────────

    // ── Bölüm 2: Kategori değişince tür dropdown'ını yenile ─────────────────
    // Kategori seçilince dropdown sadece o kategoriye ait türleri göstermeli.
    // Kategori seçimi değiştiğinde mevcut tür seçimini de sıfırla — seçilen
    // tür yeni kategoride olmayabilir, karışıklık yaratmasın.
    if (filterKey === "category") {
      ui.filters.genre = [];
      const currentOpts = _collectFilterOptions();
      populateGenreDropdown(currentOpts);
      // Akademik seçimi değişince Alt Alan + Konu bölümlerini de yenile
      populateSubcategoryChips(currentOpts);
      populateTopicChips();
    }
    // ── Bölüm 2 sonu ─────────────────────────────────────────────────────────

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

  // ── Adım 1 → Adım 11: Kategori artık chip mantığıyla çalışıyor.
  // (Eski <select> dinleyicisi kaldırıldı; tıklama olayı yukarıdaki genel
  //  "filter-panel" click dinleyicisi + MULTI_SELECT_FILTERS tarafından
  //  otomatik olarak yönetiliyor — Dil/Etiket ile aynı mekanizma.)

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
      // yearBounds catalog-filters.js'de internal; salt-okunur erişimci ile alınır.
      const yb = getYearBounds();
      const isFullRange = minVal === yb.min && maxVal === yb.max;
      ui.filters.yearMin = isFullRange ? null : minVal;
      ui.filters.yearMax = isFullRange ? null : maxVal;
      recompute(true);
    });
  });
  // ── Adım 4 sonu ──────────────────────────────────────────────────────────

  document.getElementById("filter-clear")?.addEventListener("click", clearFilters);

  // ── Adım 15: Akıllı Listeler — kaydet / uygula / sil dinleyicileri ────────
  document.getElementById("smart-list-save")?.addEventListener("click", saveCurrentAsSmartList);

  document.getElementById("smart-list-chips")?.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".smart-list-chip-delete");
    if (deleteBtn) {
      deleteSmartList(deleteBtn.dataset.id);
      return;
    }
    const applyBtn = e.target.closest(".smart-list-chip-apply");
    if (applyBtn) {
      const list = _loadSmartLists().find((l) => l.id === applyBtn.dataset.id);
      if (list) applySmartList(list);
    }
  });
  // ── Adım 15 sonu ───────────────────────────────────────────────────────────

  // ── Adım 17: "Sadece Favoriler" filtre chip'i ────────────────────────────
  document.getElementById("filter-favorite-only")?.addEventListener("click", () => {
    ui.filters.favoriteOnly = !ui.filters.favoriteOnly;
    updateFavoriteOnlyChip();
    recompute(true);
  });
  // ── Adım 17 sonu ──────────────────────────────────────────────────────────

  // ── Adım 18: Toplu işlem çubuğu dinleyicileri ────────────────────────────
  document.getElementById("bulk-clear")?.addEventListener("click", clearSelection);

  // ── Adım 24: "Sayfadaki Tümünü Seç" butonu (toolbar) ─────────────────────
  document.getElementById("select-all-page")?.addEventListener("click", toggleSelectAllOnPage);
  // ── Adım 24 sonu ──────────────────────────────────────────────────────────

  // ── Adım 25: Her toplu işlem artık runBulkOperation() İÇİNDEN çalışıyor —
  // bu sarmalayıcı işlem süresince ilgili tüm butonları kilitler, böylece
  // işlem bitmeden ikinci bir tıklama (çift tık, sabırsızlık vb.) araya giremez.
  document.getElementById("bulk-delete")?.addEventListener("click", () => runBulkOperation(bulkDelete));

  document.getElementById("bulk-favorite-add")?.addEventListener("click", () => runBulkOperation(() => bulkSetFavorite(true)));
  document.getElementById("bulk-favorite-remove")?.addEventListener("click", () => runBulkOperation(() => bulkSetFavorite(false)));

  document.getElementById("bulk-tag-add")?.addEventListener("click", () => runBulkOperation(bulkAddTag));

  // ── Adım 33: Toplu kategori ata + toplu koleksiyon ekle ────────────────
  document.getElementById("bulk-category-set")?.addEventListener("click", () => runBulkOperation(bulkSetCategory));
  document.getElementById("bulk-collection-add")?.addEventListener("click", () => runBulkOperation(bulkAddCollection));
  // ── Adım 33 sonu ────────────────────────────────────────────────────────

  // ── Bölüm 2: Toplu tür ata ──────────────────────────────────────────────
  document.getElementById("bulk-genre-set")?.addEventListener("click", () => runBulkOperation(bulkSetGenre));
  // ── Bölüm 2 sonu ────────────────────────────────────────────────────────

  // "Durum Değiştir" butonu mini paneli açar/kapatır (4 durum seçeneği).
  // Aynı panel içindeki bir durum butonuna tıklamak hem işlemi başlatır
  // hem de paneli kapatır.
  const statusPanel = document.getElementById("bulk-status-panel");
  document.getElementById("bulk-status-toggle")?.addEventListener("click", () => {
    statusPanel?.classList.toggle("hidden");
  });
  statusPanel?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bulk-status]");
    if (!btn) return;
    statusPanel.classList.add("hidden");
    runBulkOperation(() => bulkChangeStatus(btn.dataset.bulkStatus));
  });
  // ── Adım 18 sonu ──────────────────────────────────────────────────────────

  // ── Bölüm 2: Tür dropdown — aç/kapa butonu ──────────────────────────────
  document.getElementById("filter-genre-toggle")?.addEventListener("click", () => {
    const dropdown = document.getElementById("filter-genre-dropdown");
    const chevron  = document.getElementById("filter-genre-chevron");
    if (!dropdown) return;
    const isOpen = !dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden", isOpen);
    chevron?.classList.toggle("rotated", !isOpen);
  });

  // ── Bölüm 2: Tür dropdown — checkbox tıklama (çoklu seçim) ──────────────
  document.getElementById("filter-genre-list")?.addEventListener("change", (e) => {
    const cb = e.target.closest(".filter-genre-checkbox");
    if (!cb) return;
    const genre = cb.dataset.filterGenre;
    const idx   = ui.filters.genre.indexOf(genre);
    if (cb.checked && idx === -1) {
      ui.filters.genre.push(genre);
    } else if (!cb.checked && idx !== -1) {
      ui.filters.genre.splice(idx, 1);
    }
    _syncGenreDropdown();
    recompute(true);
  });

  // ── Bölüm 2: Tür dropdown — seçimi temizle butonu ───────────────────────
  document.getElementById("filter-genre-clear")?.addEventListener("click", () => {
    ui.filters.genre = [];
    _syncGenreDropdown();
    recompute(true);
  });
  // ── Bölüm 2 sonu ─────────────────────────────────────────────────────────

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
    // ── Adım 18: Seçim checkbox'ı önce kontrol edilir ────────────────────
    // Aynı mantık: tıklamak modal'ı AÇMAMALI, sadece seçim durumunu
    // değiştirmeli.
    const selBtn = e.target.closest(".select-btn");
    if (selBtn) {
      const card = selBtn.closest(".book-card, .book-row");
      if (card?.dataset.id) toggleSelection(card.dataset.id);
      return;
    }
    // ── Adım 18 sonu ──────────────────────────────────────────────────────

    // ── Adım 17: Favori butonu önce kontrol edilir ───────────────────────
    // Favori butonuna tıklamak modal'ı AÇMAMALI — sadece favori durumunu
    // değiştirmeli. Bu yüzden closest(".book-card, .book-row") kontrolünden
    // önce gelir; eşleşirse fonksiyon burada durur (modal açılmaz).
    const favBtn = e.target.closest(".favorite-btn");
    if (favBtn) {
      const card = favBtn.closest(".book-card, .book-row");
      if (card?.dataset.id) toggleFavorite(card.dataset.id);
      return;
    }
    // ── Adım 17 sonu ──────────────────────────────────────────────────────

    const el = e.target.closest(".book-card, .book-row");
    if (el?.dataset.id) openModal(el.dataset.id);
  });
}