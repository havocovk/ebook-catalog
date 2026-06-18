// ─────────────────────────────────────────────────────────────────────────────
// APP — Giriş noktası (entry point).
//
// Bu dosya uygulamayı "başlatan" yerdir. Kendi başına fazla mantık içermez;
// görevi tüm parçaları bir araya getirmek:
//   1) Her sayfanın çizim fonksiyonunu router'a tanıtır.
//   2) Olayları bir kez bağlar (katalog, modal, yedekle/yükle).
//   3) Oturumu kontrol eder ve uygulamayı (veya giriş ekranını) gösterir.
//
// Ayrıca üst bardaki Yedekle / Yükle işlevleri burada durur (global kabuk işi).
// ─────────────────────────────────────────────────────────────────────────────

import { initAuth } from "./core/auth.js";
import { registerRoute, refreshCurrentPage } from "./core/router.js";
import { initModal } from "./ui/modal.js";
import { initCatalog, renderCatalog } from "./pages/catalog.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderAuthors, initAuthors } from "./pages/authors.js";
import { renderPublishers, initPublishers } from "./pages/publishers.js";
import { renderSeries, initSeries } from "./pages/series.js";
import {
  fetchAllBooks,
  createBookRecord,
  updateBookRecord,
  stripSystemFields,
  loadBooks,
} from "./core/api.js";
import { showToast, showLoading, today } from "./ui/common.js";

// ─── Yedekle: tüm kitapları JSON dosyası olarak indir ───────────────────────
async function exportBackup() {
  showLoading(true);
  try {
    const all = await fetchAllBooks();

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

// ─── Yükle: yedek JSON dosyasından kayıtları geri yükle (birleştirerek) ─────
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

    // ── Adım J1: Paralel grup yükleme ──────────────────────────────────────
    // Kitaplar CHUNK_SIZE'lık gruplara bölünür ve her grup paralel olarak
    // Appwrite'a gönderilir. Bir grup tamamlandıktan sonra sıradaki grup
    // başlar — bu şekilde sunucuya aşırı yük binmez ama hız maksimize edilir.
    //
    // Mevcut (sıralı — yavaş):
    //   for (const book of books) { await createBookRecord(...) }
    //   500 kitap ≈ 3-4 dakika
    //
    // Yeni (10'arlı gruplar — hızlı):
    //   500 kitap ≈ 30-40 saniye
    const CHUNK_SIZE = 10;

    for (let i = 0; i < books.length; i += CHUNK_SIZE) {
      const chunk = books.slice(i, i + CHUNK_SIZE);

      // Her gruptaki kitapları aynı anda işle
      const results = await Promise.allSettled(
        chunk.map(async (book) => {
          // $id'yi koru; sistem alanlarını ayıkla. $id yoksa createBookRecord yeni ID üretir.
          const docId = book.$id || null;
          const data = stripSystemFields(book);

          try {
            await createBookRecord(docId, data);
          } catch (err) {
            // Aynı kayıt zaten varsa (409) güncellemeyi dene.
            if (err?.code === 409 && docId) {
              await updateBookRecord(docId, data);
            } else {
              throw err;   // Diğer hatalar yukarıya fırlat
            }
          }
        })
      );

      // Grup sonuçlarını say
      for (const result of results) {
        if (result.status === "fulfilled") {
          ok++;
        } else {
          fail++;
        }
      }

      // İlerlemeyi göster (her 50 kitapta bir veya son grupta)
      const processed = Math.min(i + CHUNK_SIZE, books.length);
      if (processed % 50 === 0 || processed === books.length) {
        showToast(`Yükleniyor... ${processed}/${books.length}`);
      }
    }
    // ── Adım J1 sonu ────────────────────────────────────────────────────────

    showToast(`${ok} kitap yüklendi${fail ? `, ${fail} başarısız` : ""}.`);
    await loadBooks();       // hafızayı tazele
    refreshCurrentPage();    // açık sayfayı yeniden çiz
  } catch (err) {
    showToast("Yükleme hatası: " + (err?.message || err), "error");
  } finally {
    showLoading(false);
  }
}

// ─── Yedekle / Yükle butonlarını bağla ──────────────────────────────────────
function bindBackupRestore() {
  const backupBtn = document.getElementById("backup-btn");
  const restoreBtn = document.getElementById("restore-btn");
  const restoreInput = document.getElementById("restore-input");

  if (backupBtn) backupBtn.addEventListener("click", exportBackup);
  if (restoreBtn) restoreBtn.addEventListener("click", () => restoreInput?.click());
  if (restoreInput) {
    restoreInput.addEventListener("change", (e) => {
      importBackup(e.target.files[0]);
      e.target.value = ""; // aynı dosya tekrar seçilebilsin
    });
  }
}

// ─── Başlangıç ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // 1) Her sayfanın çizim fonksiyonunu router'a tanıt.
  registerRoute("catalog", renderCatalog);
  registerRoute("dashboard", renderDashboard);
  registerRoute("authors", renderAuthors);
  registerRoute("publishers", renderPublishers);
  registerRoute("series", renderSeries);

  // 2) Olayları bir kez bağla.
  initCatalog();
  initAuthors();
  initPublishers();
  initSeries();
  initModal();
  bindBackupRestore();

  // 3) Oturumu kontrol et → uygulamayı veya giriş ekranını göster.
  //    (Oturum varsa: kitapları yükler ve router'ı başlatır.)
  initAuth();
});