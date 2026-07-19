// ─────────────────────────────────────────────────────────────────────────────
// BULK-OPERATIONS — Toplu işlem motoru.
//
// Sorumluluklar:
//   • bulkOperationInProgress  — işlem kilidi bayrağı (export: bulk-selection'ın okur)
//   • runBulkOperation()       — tüm bulk işlemlerin ortak sarmalayıcısı
//   • bulkDelete()             — toplu silme (onay + ilerleme göstergesi)
//   • bulkChangeStatus()       — toplu durum değiştirme
//   • bulkAddTag()             — toplu etiket ekleme
//   • bulkSetCategory()        — toplu kategori atama
//   • bulkSetGenre()           — toplu tür atama
//   • bulkAddCollection()      — toplu koleksiyon ekleme
//   • bulkSetFavorite()        — toplu favori yap/kaldır
//
// Bağımlılıklar:
//   ← state.js             (kitap verileri)
//   ← api.js               (updateBookRecord, updateBookRecordWithCascade, vb.)
//   ← common.js            (showToast)
//   ← modal-dialog.js      (_showPrompt, _showConfirm)
//   ← catalog-filters.js   (recompute)
//   ← bulk-selection.js    (selectedIds, clearSelection)
//
// NOT: Bu modül bulk-selection.js tarafından da import edilir (bulkOperationInProgress
// bayrağı için). Bu tek yönlü bir bağımlılıktır:
//   bulk-operations.js  ←  bulk-selection.js  (selection, bayrak okur)
//   bulk-operations.js  →  bulk-selection.js  (clearSelection çağrır)
// ES modules bu döngüyü "live binding" ile çözer; her iki modül de başlangıçta
// yüklendiği için geçici dairesel referans sorun oluşturmaz.
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
import { recompute } from "./catalog-filters.js";
import { selectedIds, clearSelection } from "./bulk-selection.js";

// ── Adım 25: Toplu işlem KİLİDİ ──────────────────────────────────────────────
// SORUN: Bir toplu işlem (örn. 50 kitabı sırayla silme) birkaç saniye sürebilir
// (her kitap için ayrı bir ağ isteği). Bu süre boyunca butonlar hâlâ tıklanabilir
// durumdaydı — kullanıcı sabırsızlanıp "Sil" butonuna ikinci kez basarsa veya
// henüz bitmemiş bir işlem üzerine "Tümünü Seç"e tekrar basarsa, İKİ TOPLU İŞLEM
// AYNI ANDA çalışmaya başlayabilir. Bu da cascade delete mantığının dayandığı
// "her silme öncekinin sonucunu görür" garantisini bozar.
//
// ÇÖZÜM: Tek bir bayrak (bulkOperationInProgress) + tüm ilgili butonları
// disable eden tek bir fonksiyon (setBulkControlsEnabled). Her toplu işlem
// fonksiyonu artık runBulkOperation() sarmalayıcısı İÇİNDE çalışır.
//
// Bu değişken bulk-selection.js tarafından da okunur (toggleSelection ve
// toggleSelectAllOnPage işlem süresince seçim değişikliğini engeller).
export let bulkOperationInProgress = false;

// Toplu işlem sırasında tıklanabilecek TÜM kontrolleri devre dışı bırakır/açar.
function setBulkControlsEnabled(enabled) {
  const ids = [
    "bulk-clear", "bulk-delete", "bulk-favorite-add", "bulk-favorite-remove",
    "bulk-tag-add", "bulk-status-toggle", "select-all-page",
    "bulk-category-set", "bulk-collection-add", // Adım 33
    "bulk-genre-set", // Bölüm 2: Tür Ata
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

// Toplu işlem fonksiyonlarının ortak sarmalayıcısı. fn, asıl işlemi yapan
// async fonksiyondur. İşlem başlamadan butonları kilitler, bittikten sonra
// (başarılı veya başarısız, fark etmez) açar. Aynı anda yalnızca BİR toplu
// işlem çalışabilir; ikinci tıklama bayrak true olduğu sürece yok sayılır.
export async function runBulkOperation(fn) {
  if (bulkOperationInProgress) return; // zaten bir işlem sürüyor
  bulkOperationInProgress = true;
  setBulkControlsEnabled(false);
  try {
    await fn();
  } finally {
    bulkOperationInProgress = false;
    setBulkControlsEnabled(true);
  }
}

// ── Toplu silme (ONAY ZORUNLU — geri alınamaz işlem) ─────────────────────────
export async function bulkDelete() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const confirmed = await _showConfirm(
    `${ids.length} kitabı katalogdan silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
  );
  if (!confirmed) return;

  try {
    // Adım 31: Toplu silme ilerleme göstergesi
    // 2+ kitaplık toplu silme throttle mekanizması nedeniyle birkaç dakika
    // sürebiliyor; kullanıcının "sistem donmuş mu?" diye tereddüt etmemesi
    // için kalıcı, kendini güncelleyen bir ilerleme toast'ı gösteriliyor.
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

    // Adım 24: SIRALI (sequential) silme — KASITLI olarak Promise.allSettled
    // ile paralel YAPILMIYOR. Sebep: deleteBookRecord her çağrıldığında
    // state.books'a bakarak cascade delete kontrolü yapıyor. Paralel silme
    // durumunda tüm işlemler henüz silinmemiş eski state.books'u aynı anda
    // okuyabilir ve "son kitap bu" sonucuna hiçbiri doğru anda ulaşamayabilir.
    // Sıralı çalıştırarak her silme işlemi öncekinin state.books güncellemesini görür.
    //
    // Adım 28: Loglama iyileştirmesi — her başarısız silme, hangi kitabın
    // (ID + varsa başlığı) hangi hata mesajıyla başarısız olduğunu açıkça loglar.
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await deleteBookRecord(id);
        ok++;
      } catch (err) {
        fail++;
        const book  = state.books.find((b) => b.$id === id);
        const label = book ? `"${book.title}" (${id})` : id;
        console.error(`[bulkDelete] Kitap silinemedi — ${label}:`, err?.message || err, err);
      }

      // Adım 31: her kitap işlenince ilerleme sayacını güncelle
      if (progressToast) {
        const done = ok + fail;
        progressToast.textContent = `${done}/${ids.length} kitap silindi.`;
      }
    }

    // Adım 31: ilerleme toast'ını kaldır, sonucu normal showToast ile bildir
    if (progressToast) {
      progressToast.classList.remove("visible");
      setTimeout(() => progressToast.remove(), 300);
    }

    showToast(`${ok} kitap silindi${fail ? `, ${fail} başarısız` : ""}.`);
    clearSelection();
    recompute(false);
  } catch (err) {
    showToast("Toplu silme hatası: " + (err?.message || err), "error");
  }
}

// ── Toplu durum değiştirme ────────────────────────────────────────────────────
// _showPrompt yerine basit bir seçim kullanılır: 4 durumdan birini yazılı
// istemek hata yapmaya açık olurdu. Bunun yerine filter-status-chips'teki
// AYNI 4 seçenek buton grubu (bulk-status-modal) olarak gösterilir.
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

// ── Toplu etiket ekleme ───────────────────────────────────────────────────────
// ÖNEMLİ: var olan etiketlerin ÜZERİNE YAZMAZ — her kitabın mevcut tags
// dizisine yeni etiketi EKLER (zaten varsa tekrar eklemez, Set ile tekilleştirilir).
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
        if (currentTags.includes(tag)) return Promise.resolve(); // zaten var
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

// ── Adım 33: Toplu kategori ata ──────────────────────────────────────────────
// category, tags/collections gibi bir DİZİ değil — TEK BİR metin alanıdır.
// Bu yüzden "ekleme" değil "atama/değiştirme" mantığı uygulanır: seçili her
// kitabın category alanı, yazılan değerle DOĞRUDAN DEĞİŞTİRİLİR.
export async function bulkSetCategory() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const category = await _showPrompt("Seçili kitaplara atanacak kategoriyi yazın:");
  if (!category) return;

  try {
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        if (book.category === category) return Promise.resolve(); // zaten aynı değer
        return updateBookRecord(id, { category }).then(() => {
          book.category = category;
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

// ── Bölüm 2: Toplu tür ata ───────────────────────────────────────────────────
// genre, category gibi TEK BİR metin alanıdır (dizi değil). Seçili her
// kitabın genre alanı yazılan değerle DOĞRUDAN DEĞİŞTİRİLİR.
export async function bulkSetGenre() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const genre = await _showPrompt("Seçili kitaplara atanacak türü yazın:");
  if (!genre) return;

  try {
    const results = await Promise.allSettled(
      ids.map((id) => {
        const book = state.books.find((b) => b.$id === id);
        if (!book) return Promise.resolve();
        if (book.genre === genre) return Promise.resolve(); // zaten aynı değer
        return updateBookRecord(id, { genre }).then(() => {
          book.genre = genre;
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

// ── Adım 33: Toplu koleksiyon ekle ───────────────────────────────────────────
// book.collections bir DİZİdir (bir kitap birden fazla koleksiyona ait
// olabilir) — bu yüzden mantık bulkAddTag ile BİREBİR aynı: var olan
// koleksiyon listesinin ÜZERİNE YAZILMAZ, listeye yeni isim EKLENİR.
//
// EK ADIM (tags'ten farkı): collections tablosunda bu isme sahip bir kayıt
// yoksa, createCollection() ile ANINDA oluşturulur (Adım 27 ile aynı tutarlılık).
export async function bulkAddCollection() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  const collectionName = await _showPrompt("Seçili kitaplara eklenecek koleksiyonu yazın:");
  if (!collectionName) return;

  try {
    // Önce koleksiyon kaydının kendisini (collections tablosunda) garantiye al.
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
        // Adım 34: updateBookRecordWithCascade — ileride "toplu koleksiyon çıkar"
        // gibi bir kardeş eklenirse aynı güvenli mekanizmayı kullanması için
        // tutarlılık sağlanıyor. NOT: book.collections updateBookRecordWithCascade
        // tarafından Object.assign ile zaten güncelleniyor.
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

// ── Toplu favori yap/kaldır ───────────────────────────────────────────────────
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