// ─────────────────────────────────────────────────────────────────────────────
// BULK-SELECTION — Toplu seçim state yönetimi ve UI senkronizasyonu.
//
// Sorumluluklar:
//   • selectedIds Set — seçili kitap ID'lerinin sayfa belleği
//   • toggleSelection()       — tek kitap seç/kaldır
//   • clearSelection()        — tüm seçimi temizle
//   • toggleSelectAllOnPage() — sayfadaki tümünü seç/kaldır
//   • updateSelectAllButton() — "Tümünü Seç" butonunun görsel durumu
//   • updateBulkBar()         — toplu işlem çubuğu görünürlüğü ve sayacı
//   • getCurrentPageBooks()   — o an ekranda görünen kitapları döndürür
//   • setRenderCallback()     — dairesel bağımlılık çözümü (callback enjeksiyonu)
//
// Bağımlılıklar:
//   ← catalog-filters.js  (ui, filtered, PER_PAGE — sayfalama hesabı için)
//
// DAİRESEL BAĞIMLILIK ÇÖZÜMÜ:
//   Bu modül catalog-ui.js'i doğrudan import ETMEZ. index.js kurulum sırasında
//   setRenderCallback(render) ile render fonksiyonunu enjekte eder.
// ─────────────────────────────────────────────────────────────────────────────

import { ui, filtered, PER_PAGE } from "./catalog-filters.js";

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

// Bir kitabın seçim durumunu değiştirir, ardından toplu işlem çubuğunu
// senkronize eder. Veritabanına yazılmaz — sadece selectedIds Set'i (sayfa
// belleği) güncellenir. render() yeterli (recompute gerekmiyor çünkü seçim
// hiçbir filtreyi etkilemez, sadece görünümü).
//
// Adım 25: bir toplu işlem sürerken (örn. 50 kitap siliniyor) seçim
// değiştirilemez — aksi halde kullanıcı işlem ortasında seçimi değiştirip
// kafası karışabilir, ya da yarıda kalan bir işlemin üstüne yeni bir seçim
// binebilir.
//
// NOT: bulkOperationInProgress bayrağı bulk-operations.js'den içe aktarılmaktadır.
// Bu kontrol, işlem sürerken seçimi engellemek için zorunludur.
import { bulkOperationInProgress } from "./bulk-operations.js";

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

// Adım 24: Şu an EKRANDA GÖRÜNEN (mevcut sayfadaki, filtrelenmiş) kitap
// dizisini döndürür. "Sayfadaki Tümünü Seç" hem bu listeyi seçmek hem de
// "hepsi zaten seçili mi?" diye kontrol etmek için bu fonksiyonu kullanır.
// renderBooks()'taki "start/slice" mantığıyla BİREBİR aynı olmalı — aksi
// halde "tümünü seç" ekranda görünenden farklı bir kümeyi seçer.
export function getCurrentPageBooks() {
  const start = (ui.page - 1) * PER_PAGE;
  return filtered.slice(start, start + PER_PAGE);
}

// "Sayfadaki Tümünü Seç" — toolbar'daki tek bir checkbox/buton.
// Toggle mantığı: sayfadaki kitapların HEPSİ zaten seçiliyse → hepsini
// kaldırır. Hepsi seçili DEĞİLSE (hiç seçili değil VEYA kısmen seçili) →
// sayfadaki TÜMÜNÜ seçer. (Gmail, Excel vb. ile aynı standart davranış.)
export function toggleSelectAllOnPage() {
  if (bulkOperationInProgress) return; // Adım 25: işlem sürerken seçim değiştirilemez
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
// render() her çağrıldığında çalıştırılır — böylece buton her zaman
// gerçek durumu yansıtır.
export function updateSelectAllButton() {
  const btn = document.getElementById("select-all-page");
  if (!btn) return;

  const pageBooks   = getCurrentPageBooks();
  const allSelected = pageBooks.length > 0 && pageBooks.every((b) => selectedIds.has(b.$id));

  btn.classList.toggle("active", allSelected);
  const icon = btn.querySelector("iconify-icon");
  if (icon) icon.setAttribute("icon", allSelected ? "mdi:checkbox-marked" : "mdi:checkbox-blank-outline");
  btn.title = allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tümünü seç";
}

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