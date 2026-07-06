// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-BULK — Toplu seçim yönetimi + toplu işlemler (sil / durum değiştir /
// etiket ekle / kategori ata / favori yap / koleksiyon ekle).
//
// catalog.js'den ayrıldı (Adım 2-5, Faza 2 parçalanması).
//
// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ (Seçenek A — callback enjeksiyonu) ────────────
// Bu dosyadaki seçim fonksiyonları (toggleSelection, clearSelection,
// toggleSelectAllOnPage) doğrudan render()'ı çağırıyor; render() catalog-ui.js'de.
// catalog-ui.js de bu dosyadan selectedIds/toggleSelection/updateSelectAllButton
// import ediyor → çift yönlü. Adım 2-4'teki recompute callback'iyle AYNI
// mantık: bu dosya catalog-ui.js'i doğrudan import etmez, bir `_render`
// callback'i tutar. catalog/index.js kurulum sırasında setRenderCallback(render)
// ile catalog-ui.js'deki render'ı enjekte eder.
//
// NOT: recompute() (catalog-filters.js'den) doğrudan import ediliyor — bu
// güvenli, çünkü catalog-filters.js bu dosyaya (catalog-bulk.js) bağımlı DEĞİL.
// recompute() kendi render tetiklemesini zaten kendi callback'iyle yapıyor.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { showToast } from "../../ui/common.js";
import { _showPrompt, _showConfirm } from "../../ui/modal.js";
import {
  updateBookRecord,
  updateBookRecordWithCascade,
  deleteBookRecord,
  createCollection,
} from "../../core/api.js";
import { recompute, ui, filtered, PER_PAGE } from "./catalog-filters.js";

// ── DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render() callback'i ─────────────────────────
// catalog/index.js bunu setRenderCallback(render) ile bir kez bağlar.
let _render = null;

export function setRenderCallback(fn) {
  _render = fn;
}

// ── Adım 18: Toplu işlem — seçili kitap ID'leri ─────────────────────────────
// Sayfa içi geçici bir UI durumu (veritabanına yazılmaz). renderBooks() her
// çağrıldığında kartları sıfırdan oluşturduğu için (grid.innerHTML = ""),
// seçim durumu kartların kendi DOM'unda SAKLANAMAZ — bu yüzden ayrı bir Set
// olarak burada tutulur; her kart çizilirken bu Set'e bakılarak checkbox'ın
// işaretli/işaretsiz olacağı belirlenir (favori durumunun book.favorite'ten
// okunmasına benzer, ama veritabanı değil sadece sayfa belleği).
// catalog-ui.js (renderBooks/createBookRow) bu Set'i okuyor → export edilir.
export const selectedIds = new Set();
// ── Adım 18 sonu ─────────────────────────────────────────────────────────────

// ── Adım 18: Toplu işlem (bulk actions) ─────────────────────────────────────

// Bir kitabın seçim durumunu değiştirir, ardından toplu işlem çubuğunu
// senkronize eder. Veritabanına yazılmaz — sadece selectedIds Set'i (sayfa
// belleği) güncellenir. render() yeterli (recompute gerekmiyor çünkü seçim
// hiçbir filtreyi etkilemez, sadece görünümü).
//
// ── Adım 25: bir toplu işlem sürerken (örn. 50 kitap siliniyor) seçim
// değiştirilemez — aksi halde kullanıcı işlem ortasında seçimi değiştirip
// kafası karışabilir, ya da yarıda kalan bir işlemin üstüne yeni bir seçim
// binebilir.
export function toggleSelection(bookId) {
  if (bulkOperationInProgress) return;
  if (selectedIds.has(bookId)) {
    selectedIds.delete(bookId);
  } else {
    selectedIds.add(bookId);
  }
  _render?.();
  updateBulkBar();
}

// Seçimi tamamen temizler (toplu işlem çubuğundaki "Seçimi Temizle" butonu
// VEYA bir toplu işlem başarıyla tamamlandıktan sonra otomatik çağrılır).
export function clearSelection() {
  selectedIds.clear();
  _render?.();
  updateBulkBar();
}

// ── Adım 24: Şu an EKRANDA GÖRÜNEN (mevcut sayfadaki, filtrelenmiş) kitap
// dizisini döndürür. "Sayfadaki Tümünü Seç" hem bu listeyi seçmek hem de
// "hepsi zaten seçili mi?" diye kontrol etmek için bu fonksiyonu kullanır.
// renderBooks()'taki "start/slice" mantığıyla BİREBİR aynı olmalı — aksi
// halde "tümünü seç" ekranda görünenden farklı bir kümeyi seçer.
//
// NOT: filtered ve PER_PAGE catalog-filters.js'den import ediliyor (en üstte).
export function getCurrentPageBooks() {
  const start = (ui.page - 1) * PER_PAGE;
  return filtered.slice(start, start + PER_PAGE);
}

// "Sayfadaki Tümünü Seç" — toolbar'daki tek bir checkbox/buton.
// Davranış (kullanıcı talebi): en fazla "bir sayfada görünen kitap sayısı"nı
// seçer (şu an 50) — TÜM filtrelenmiş sonuçları (örn. 267 kitap, 6 sayfa)
// DEĞİL, sadece o an ekranda görünen kitapları.
//
// Toggle mantığı: sayfadaki kitapların HEPSİ zaten seçiliyse → hepsini
// kaldırır (tekrar tıklayınca "seçimi temizle" gibi çalışsın, kullanıcı
// şaşırmasın). Hepsi seçili DEĞİLSE (hiç seçili değil VEYA kısmen seçili) →
// sayfadaki TÜMÜNÜ seçer. Bu, standart "tabloda tümünü seç" checkbox
// davranışıyla aynıdır (Gmail, Excel vb.).
export function toggleSelectAllOnPage() {
  if (bulkOperationInProgress) return; // ── Adım 25: işlem sürerken seçim değiştirilemez
  const pageBooks = getCurrentPageBooks();
  if (pageBooks.length === 0) return;

  const allSelected = pageBooks.every((b) => selectedIds.has(b.$id));

  if (allSelected) {
    pageBooks.forEach((b) => selectedIds.delete(b.$id));
  } else {
    pageBooks.forEach((b) => selectedIds.add(b.$id));
  }

  _render?.();
  updateBulkBar();
}

// "Sayfadaki Tümünü Seç" butonunun görsel durumunu senkronize eder:
//   - Sayfadaki kitapların HEPSİ seçiliyse → buton "active" (dolu kutu)
//   - HİÇBİRİ veya BİR KISMI seçiliyse → buton pasif (boş kutu)
// render() her çağrıldığında (sayfa değişimi, filtre değişimi, tekli seçim
// değişimi) çalıştırılır — böylece buton her zaman gerçek durumu yansıtır.
export function updateSelectAllButton() {
  const btn = document.getElementById("select-all-page");
  if (!btn) return;

  const pageBooks = getCurrentPageBooks();
  const allSelected = pageBooks.length > 0 && pageBooks.every((b) => selectedIds.has(b.$id));

  btn.classList.toggle("active", allSelected);
  const icon = btn.querySelector("iconify-icon");
  if (icon) icon.setAttribute("icon", allSelected ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline");
  btn.title = allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tümünü seç";
}
// ── Adım 24 sonu ─────────────────────────────────────────────────────────────

// Toplu işlem çubuğunun görünürlüğünü ve "X kitap seçili" sayısını günceller.
// Hiç seçim yoksa çubuk tamamen gizlenir.
export function updateBulkBar() {
  const bar   = document.getElementById("bulk-bar");
  const count = document.getElementById("bulk-count");
  if (!bar || !count) return;

  const n = selectedIds.size;
  bar.classList.toggle("hidden", n === 0);
  count.textContent = `${n} kitap seçili`;
}

// ── Adım 25: Toplu işlem KİLİDİ ──────────────────────────────────────────────
// SORUN: Bir toplu işlem (örn. 50 kitabı sırayla silme) birkaç saniye sürebilir
// (her kitap için ayrı bir ağ isteği). Bu süre boyunca butonlar hâlâ tıklanabilir
// durumdaydı — kullanıcı sabırsızlanıp "Sil" butonuna ikinci kez basarsa veya
// henüz bitmemiş bir işlem üzerine "Tümünü Seç"e tekrar basarsa, İKİ TOPLU İŞLEM
// AYNI ANDA (iç içe geçmiş şekilde) çalışmaya başlayabilir. Bu da cascade delete
// mantığının dayandığı "her silme öncekinin sonucunu görür" garantisini bozar —
// iki ayrı bulkDelete() çağrısı birbirinden habersiz çalışırsa, aynı yazara ait
// kitaplar farklı çağrılar tarafından işlenir ve hiçbiri "son kitap bu" sonucuna
// doğru anda ulaşamayabilir; yazar/seri yanlışlıkla yetim kalır.
//
// ÇÖZÜM: Tek bir bayrak (bulkOperationInProgress) + tüm ilgili butonları
// disable eden tek bir fonksiyon (setBulkControlsEnabled). Her toplu işlem
// fonksiyonu artık runBulkOperation() sarmalayıcısı İÇİNDE çalışır — bu
// sarmalayıcı işlem başlamadan butonları kilitler, işlem bitince (başarılı
// veya başarısız, fark etmez) açar. Aynı anda yalnızca BİR toplu işlem
// çalışabilir; ikinci bir tıklama bayrak true olduğu sürece sessizce yok sayılır.
let bulkOperationInProgress = false;

// Toplu işlem sırasında tıklanabilecek TÜM kontrolleri devre dışı bırakır/açar:
//   - Toplu işlem çubuğundaki butonlar (durum, etiket, favori, sil, temizle)
//   - Toolbar'daki "Sayfadaki Tümünü Seç" butonu
//   - Kitap kartlarındaki/satırlarındaki tekli seçim checkbox'ları (görsel
//     olarak devre dışı görünmesi için kart/satır listesi yeniden render
//     edilmez, ama tıklamalar toggleSelection() içinde bayrak kontrolüyle
//     engellenir — bkz. aşağıdaki toggleSelection güncellemesi).
function setBulkControlsEnabled(enabled) {
  const ids = [
    "bulk-clear", "bulk-delete", "bulk-favorite-add", "bulk-favorite-remove",
    "bulk-tag-add", "bulk-status-toggle", "select-all-page",
    "bulk-category-set", "bulk-collection-add", // ── Adım 33
    "bulk-genre-set", // ── Bölüm 2: Tür Ata
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });

  const statusPanel = document.getElementById("bulk-status-panel");
  if (statusPanel) {
    statusPanel.querySelectorAll("button").forEach((b) => { b.disabled = !enabled; });
  }
}

// Toplu işlem fonksiyonlarının (bulkDelete, bulkChangeStatus, bulkAddTag,
// bulkSetFavorite) ortak sarmalayıcısı. fn, asıl işlemi yapan async fonksiyondur.
export async function runBulkOperation(fn) {
  if (bulkOperationInProgress) return; // zaten bir işlem sürüyor — yeni tıklama yok sayılır
  bulkOperationInProgress = true;
  setBulkControlsEnabled(false);
  try {
    await fn();
  } finally {
    bulkOperationInProgress = false;
    setBulkControlsEnabled(true);
  }
}
// ── Adım 25 sonu ─────────────────────────────────────────────────────────────

// ── Toplu durum değiştirme ───────────────────────────────────────────────
// _showPrompt yerine basit bir seçim kullanılır: 4 durumdan birini yazılı
// olarak istemek hata yapmaya açık olurdu (kullanıcı "okundu" yerine "Okundu"
// yazabilir). Bunun yerine filter-status-chips'teki AYNI 4 seçenek, küçük
// bir buton grubu (bulk-status-modal) olarak gösterilir — yazım hatası riski
// olmadan, mevcut görsel dile (chip) uygun şekilde.
export async function bulkChangeStatus(newStatus) {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  try {
    const results = await Promise.allSettled(
      ids.map((id) => updateBookRecord(id, { status: newStatus }))
    );

    let ok = 0, fail = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const book = state.books.find((b) => b.$id === ids[i]);
        if (book) book.status = newStatus;
        ok++;
      } else {
        fail++;
      }
    });

    showToast(`${ok} kitabın durumu güncellendi${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu durum güncelleme hatası: " + (err?.message || err), "error");
  }
}

// ── Toplu etiket ekleme ───────────────────────────────────────────────────
// ÖNEMLİ: var olan etiketlerin ÜZERİNE YAZMAZ — her kitabın mevcut tags
// dizisine yeni etiketi EKLER (zaten varsa tekrar eklemez, Set ile
// tekilleştirilir).
export async function bulkAddTag() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const tag = await _showPrompt("Seçili kitaplara eklenecek etiketi yazın:");
  if (!tag) return; // kullanıcı iptal etti veya boş yazdı

  try {
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        const currentTags = book.tags || [];
        if (currentTags.includes(tag)) return Promise.resolve(); // zaten var, tekrar eklemeye gerek yok
        const newTags = [...currentTags, tag];
        return updateBookRecord(id, { tags: newTags }).then(() => {
          book.tags = newTags; // hafızadaki kopyayı güncelle
        });
      })
    );

    const fail = results.filter((r) => r.status === "rejected").length;
    showToast(`${ids.length - fail} kitaba etiket eklendi${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu etiket ekleme hatası: " + (err?.message || err), "error");
  }
}

// ── Adım 33: Toplu kategori ata ──────────────────────────────────────────
// NOT: category, tags/collections gibi bir DİZİ değil — TEK BİR metin
// alanı (örn. "Roman" ya da serbest yazılmış "Roman, Akademik" gibi tek
// parça bir ifade). Bu yüzden burada "ekleme" değil "atama/değiştirme"
// mantığı uygulanır: seçili her kitabın category alanı, yazılan değerle
// DOĞRUDAN DEĞİŞTİRİLİR (üzerine yazılır) — etiket ekleme gibi var olana
// dokunmadan üstüne katma değildir, çünkü tek değerli bir alanda "ekleme"
// kavramı yoktur.
export async function bulkSetCategory() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const category = await _showPrompt("Seçili kitaplara atanacak kategoriyi yazın:");
  if (!category) return; // kullanıcı iptal etti veya boş yazdı

  try {
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        if (book.category === category) return Promise.resolve(); // zaten aynı değer, gereksiz yazma yapma
        return updateBookRecord(id, { category }).then(() => {
          book.category = category; // hafızadaki kopyayı güncelle
        });
      })
    );

    const fail = results.filter((r) => r.status === "rejected").length;
    showToast(`${ids.length - fail} kitaba kategori atandı${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu kategori atama hatası: " + (err?.message || err), "error");
  }
}
// ── Adım 33 sonu ─────────────────────────────────────────────────────────────

// ── Bölüm 2: Toplu tür ata ───────────────────────────────────────────────
// genre, category gibi TEK BİR metin alanıdır (dizi değil). Seçili her
// kitabın genre alanı yazılan değerle DOĞRUDAN DEĞİŞTİRİLİR.
export async function bulkSetGenre() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const genre = await _showPrompt("Seçili kitaplara atanacak türü yazın:");
  if (!genre) return; // kullanıcı iptal etti veya boş yazdı

  try {
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        if (book.genre === genre) return Promise.resolve(); // zaten aynı değer
        return updateBookRecord(id, { genre }).then(() => {
          book.genre = genre; // hafızadaki kopyayı güncelle
        });
      })
    );

    const fail = results.filter((r) => r.status === "rejected").length;
    showToast(`${ids.length - fail} kitaba tür atandı${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu tür atama hatası: " + (err?.message || err), "error");
  }
}
// ── Bölüm 2 sonu ─────────────────────────────────────────────────────────────

// ── Adım 33: Toplu koleksiyon ekle ───────────────────────────────────────
// book.collections bir DİZİdir (bir kitap birden fazla koleksiyona ait
// olabilir) — bu yüzden mantık bulkAddTag ile BİREBİR aynı: var olan
// koleksiyon listesinin ÜZERİNE YAZILMAZ, listeye yeni isim EKLENİR (zaten
// varsa tekrar eklenmez).
//
// EK ADIM (tags'ten farkı): collections tablosunda bu isme sahip bir kayıt
// yoksa, createCollection() ile ANINDA oluşturulur — author/publisher/series
// entity-picker'ının onAdd callback'i ile yaptığı işin aynısı (bkz. Adım 27,
// modal.js'deki saveModal()). createCollection() zaten "varsa tekrar
// oluşturma" kontrolü yaptığı için burada güvenle çağrılabilir.
export async function bulkAddCollection() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const collectionName = await _showPrompt("Seçili kitaplara eklenecek koleksiyonu yazın:");
  if (!collectionName) return; // kullanıcı iptal etti veya boş yazdı

  try {
    // Önce koleksiyon kaydının kendisini (collections tablosunda) garantiye
    // al — author/publisher/series ile aynı tutarlılıkta, modal'dan tek tek
    // eklerken de aynı şey yapılıyor (Adım 27).
    try {
      await createCollection(collectionName);
    } catch (err) {
      console.warn(`[bulkAddCollection] Koleksiyon oluşturulamadı (${collectionName}):`, err?.message || err);
    }

    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        const currentCollections = book.collections || [];
        if (currentCollections.includes(collectionName)) return Promise.resolve(); // zaten var
        const newCollections = [...currentCollections, collectionName];
        // ── Adım 34: updateBookRecord yerine updateBookRecordWithCascade —
        // bu çağrı sadece YENİ bir koleksiyon EKLEDİĞİ için (var olanları
        // çıkarmadığı için) burada hiçbir yetim kalma riski yok, ama ileride
        // bu fonksiyonun "toplu koleksiyon çıkar" gibi bir kardeşi eklenirse
        // aynı güvenli mekanizmayı kullanması için tutarlılık sağlanıyor.
        // NOT: book.collections'ı burada elle güncellemiyoruz —
        // updateBookRecordWithCascade bunu kendi içinde (Object.assign ile)
        // zaten yapıyor.
        return updateBookRecordWithCascade(id, { collections: newCollections });
      })
    );

    const fail = results.filter((r) => r.status === "rejected").length;
    showToast(`${ids.length - fail} kitaba koleksiyon eklendi${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu koleksiyon ekleme hatası: " + (err?.message || err), "error");
  }
}
// ── Adım 33 sonu ─────────────────────────────────────────────────────────────

// ── Toplu favori yap/kaldır ──────────────────────────────────────────────
// newValue: true (favorile) veya false (favorilerden çıkar) — iki ayrı
// buton olarak sunulur ("toggle" değil, çünkü seçili kitaplar karışık
// favori durumunda olabilir; "toggle" o durumda kafa karıştırıcı olurdu).
export async function bulkSetFavorite(newValue) {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  try {
    const results = await Promise.allSettled(
      ids.map((id) => updateBookRecord(id, { favorite: newValue }))
    );

    let ok = 0, fail = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const book = state.books.find((b) => b.$id === ids[i]);
        if (book) book.favorite = newValue;
        ok++;
      } else {
        fail++;
      }
    });

    showToast(`${ok} kitap ${newValue ? "favorilere eklendi" : "favorilerden çıkarıldı"}${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu favori güncelleme hatası: " + (err?.message || err), "error");
  }
}

// ── Toplu silme (ONAY ZORUNLU — geri alınamaz işlem) ─────────────────────
export async function bulkDelete() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const confirmed = await _showConfirm(
    `${ids.length} kitabı katalogdan silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
  );
  if (!confirmed) return;

  try {
    // ── Adım 31: Toplu silme ilerleme göstergesi ───────────────────────────
    // Tek kitap silerken (modal üzerinden) ekstra bildirime gerek yok — işlem
    // anlık. Ama 2+ kitaplık toplu silme artık throttle mekanizması (Adım 30)
    // nedeniyle birkaç dakika sürebiliyor; kullanıcının "sistem donmuş mu yoksa
    // çalışıyor mu" diye tereddüt etmemesi için kalıcı, kendini güncelleyen
    // bir ilerleme toast'ı gösteriliyor. Normal showToast() her çağrıldığında
    // YENİ bir toast açıp 3 saniye sonra kapatıyor — burada istenen davranış
    // FARKLI (aynı toast'un İÇERİĞİ güncellensin, sürekli yeni toast açılıp
    // kapanmasın), bu yüzden showToast()'a dokunmadan kendi kalıcı toast
    // elementini oluşturup yönetiyoruz; CSS sınıfları (toast, toast-success)
    // mevcut toast stiliyle birebir aynı, görsel tutarlılık korunuyor.
    const showProgress = ids.length >= 2;
    let progressToast = null;
    if (showProgress) {
      const container = document.getElementById("toast-container");
      if (container) {
        progressToast = document.createElement("div");
        progressToast.className = "toast toast-success";
        progressToast.textContent = "Silme işlemi başladı.";
        container.appendChild(progressToast);
        setTimeout(() => progressToast.classList.add("visible"), 10);
      }
    }
    // ── Adım 31 sonu (devamı aşağıda, döngü içinde ve sonunda) ─────────────

    // ── Adım 24: SIRALI (sequential) silme — KASITLI olarak Promise.allSettled
    // ile paralel YAPILMIYOR. Sebep: deleteBookRecord her çağrıldığında
    // state.books'a bakarak "bu yazarın/yayınevinin/serinin başka kitabı var
    // mı?" diye cascade delete kontrolü yapıyor. Eğer aynı yazara ait 3 kitap
    // PARALEL silinirse, 3 silme işlemi de "henüz silinmemiş" eski
    // state.books'u aynı anda okuyabilir ve hiçbiri "son kitap bu" sonucuna
    // ulaşamayabilir — yazar yanlışlıkla yetim kalır (silinmez). Sıralı
    // çalıştırarak her silme işlemi öncekinin state.books güncellemesini
    // görür, cascade delete her zaman doğru çalışır.
    // ── Adım 28: Loglama iyileştirmesi — ÖNCEDEN bu catch bloğu hatayı TAMAMEN
    // sessizce yutuyordu (sadece fail++ yapıyordu), bu yüzden bir kitap
    // silinemediğinde GERÇEK SEBEP hiçbir yere yazılmıyordu — ne konsola ne
    // başka bir yere. Artık her başarısız silme, hangi kitabın (ID + varsa
    // başlığı) hangi hata mesajıyla başarısız olduğunu console.error ile
    // açıkça loglar. Bu, davranışı DEĞİŞTİRMEZ (kitap hâlâ "başarısız" sayılır,
    // işlem hâlâ devam eder) — sadece NEDEN başarısız olduğunu görünür kılar.
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await deleteBookRecord(id);
        ok++;
      } catch (err) {
        fail++;
        const book = state.books.find((b) => b.$id === id);
        const label = book ? `"${book.title}" (${id})` : id;
        console.error(`[bulkDelete] Kitap silinemedi — ${label}:`, err?.message || err, err);
      }

      // ── Adım 31: ilerleme toast'ını güncelle — her kitap denendiğinde
      // (başarılı ya da başarısız, fark etmez) "X/Y kitap silindi" sayacı
      // bir artar; kullanıcı sürecin canlı olduğunu ve ne kadar ilerlediğini
      // görür.
      if (progressToast) {
        const done = ok + fail;
        progressToast.textContent = `${done}/${ids.length} kitap silindi.`;
      }
    }
    // ── Adım 28 sonu ─────────────────────────────────────────────────────────────

    // ── Adım 31: ilerleme toast'ını kaldır, sonucu normal showToast ile bildir
    if (progressToast) {
      progressToast.classList.remove("visible");
      setTimeout(() => progressToast.remove(), 300);
    }
    // ── Adım 31 sonu ─────────────────────────────────────────────────────────────

    showToast(`${ok} kitap silindi${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu silme hatası: " + (err?.message || err), "error");
  }
}
// ── Adım 18 sonu ─────────────────────────────────────────────────────────────