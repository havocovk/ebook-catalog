// ─────────────────────────────────────────────────────────────────────────────
// APP — Giriş noktası (entry point).
//
// Bu dosya uygulamayı "başlatan" yerdir. Kendi başına fazla mantık içermez;
// görevi tüm parçaları bir araya getirmek:
//   1) Her sayfanın çizim fonksiyonunu router'a tanıtır.
//   2) Olayları bir kez bağlar (katalog, modal, yedekle/yükle).
//   3) Oturumu kontrol eder ve uygulamayı (veya giriş ekranını) gösterir.
//
// Yedekle / Yükle işlemleri artık dashboard-backup.js içinde yönetilir (Adım 5).
// ─────────────────────────────────────────────────────────────────────────────

import { initAuth } from "./core/auth.js";
import { registerRoute, refreshCurrentPage } from "./core/router.js";
import { initModal } from "./ui/modal.js";
import { initCatalog, renderCatalog } from "./pages/catalog.js";
// ── Adım 38: Hızlı Kategori Doldurma Modu ───────────────────────────────────
import { initQuickFill, handleQuickFillButtonClick } from "./pages/catalog/catalog-quickfill.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderStats } from "./pages/stats/stats-main.js"; // ── Adım 6: İstatistikler sayfası
import { renderAuthors, initAuthors } from "./pages/authors.js";
import { renderPublishers, initPublishers } from "./pages/publishers.js";
import { renderSeries, initSeries } from "./pages/series.js";
import { renderCollections, initCollections } from "./pages/collections.js";
import { renderDedupe, initDedupe } from "./pages/dedupe.js";
import {
  loadBooks,
} from "./core/api.js";
import { showToast, showLoading } from "./ui/common.js";

// ─────────────────────────────────────────────────────────────────────────────
// ── Adım 16: Global Hata Yakalayıcı ─────────────────────────────────────────
//
// Buraya kadar hiçbir try/catch tarafından yakalanmamış hatalar normalde
// sessizce kaybolur — sayfa "donmuş" gibi görünür ama kullanıcıya hiçbir
// bilgi verilmez. Bu iki dinleyici, böyle durumlarda devreye giren son
// güvenlik ağıdır:
//
//   1) "error"              → normal JavaScript çalışma zamanı hataları
//                              (örn. undefined bir değişkenin özelliğine
//                              erişmeye çalışmak).
//   2) "unhandledrejection"  → async/Promise tabanlı kodda yakalanmamış
//                              hatalar (Appwrite'a yapılan network
//                              çağrılarının büyük kısmı bu türden olduğu
//                              için özellikle önemli).
//
// Her iki durumda da:
//   - Hata, teşhis amacıyla tarayıcı konsoluna eskisi gibi yazdırılır.
//   - Kullanıcıya showToast ile anlaşılır bir Türkçe mesaj gösterilir.
//   - Aynı hata art arda/çok hızlı tekrar ederse (örn. bir döngü içinde),
//     ekranı bildirimle doldurmaması için en fazla 1 saniyede 1 bildirim
//     gösterilir ("sessiz kalma" eşiği).
//
// Not: Mevcut try/catch blokları (exportBackup, importBackup, vb.) bu
// yakalayıcıdan ÖNCE devreye girer ve kendi özel/daha faydalı hata
// mesajlarını gösterir — bu yakalayıcı sadece onların kaçırdığı hataları
// yakalar, onların yerini almaz.
// ─────────────────────────────────────────────────────────────────────────────

let _lastGlobalErrorAt = 0;
const GLOBAL_ERROR_THROTTLE_MS = 1000; // aynı anda art arda gelen hatalarda en fazla 1 bildirim/sn

function _reportUnexpectedError(err) {
  const now = Date.now();
  if (now - _lastGlobalErrorAt < GLOBAL_ERROR_THROTTLE_MS) return; // sessiz kal, konsola yine de yazılmış olacak
  _lastGlobalErrorAt = now;
  showToast("Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyin.", "error");
}

// Normal JavaScript çalışma zamanı hataları (senkron kod).
window.addEventListener("error", (event) => {
  console.error("[Global Hata Yakalayıcı]", event.error || event.message);
  _reportUnexpectedError(event.error);
});

// async/Promise tabanlı kodda yakalanmamış hatalar (örn. unutulmuş bir catch).
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Global Hata Yakalayıcı — Promise]", event.reason);
  _reportUnexpectedError(event.reason);
});
// ── Adım 16 sonu ─────────────────────────────────────────────────────────────

// ─── Başlangıç ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // 1) Her sayfanın çizim fonksiyonunu router'a tanıt.
  registerRoute("catalog", renderCatalog);
  registerRoute("dashboard", renderDashboard);
  registerRoute("stats", renderStats); // ── Adım 6
  registerRoute("authors", renderAuthors);
  registerRoute("publishers", renderPublishers);
  registerRoute("series", renderSeries);
  registerRoute("collections", renderCollections);
  registerRoute("dedupe", renderDedupe);

  // 2) Olayları bir kez bağla.
  initCatalog();
  initAuthors();
  initPublishers();
  initSeries();
  initCollections();
  initDedupe();
  initModal();
  // ── Adım 38: Hızlı Kategori Doldurma — olayları bağla + toolbar butonunu dinle
  initQuickFill();
  document.getElementById("quickfill-open-btn")?.addEventListener("click", handleQuickFillButtonClick);
  // ── Adım 38 sonu ────────────────────────────────────────────────────────

  // 3) Oturumu kontrol et → uygulamayı veya giriş ekranını göster.
  //    (Oturum varsa: kitapları yükler ve router'ı başlatır.)
  initAuth();
});