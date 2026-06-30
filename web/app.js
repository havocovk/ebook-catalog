// ─────────────────────────────────────────────────────────────────────────────
// APP — Giriş noktası (entry point).
//
// Bu dosya uygulamayı "başlatan" yerdir. Kendi başına fazla mantık içermez;
// görevi tüm parçaları bir araya getirmek:
//   1) Her sayfanın çizim fonksiyonunu router'a tanıtır.
//   2) Olayları bir kez bağlar (katalog, modal).
//   3) Oturumu kontrol eder ve uygulamayı (veya giriş ekranını) gösterir.
//
// ── Adım 5 NOTU: Eski "Yedekle/Yükle" üst bar işlevleri (JSON, kapaksız)
// buradan TAMAMEN KALDIRILDI. Yerine Dashboard'daki "Tam Yedekleme" kartı
// geldi (bkz. pages/dashboard.js + pages/dashboard-backup.js) — veritabanı
// VE kapak resimlerini birlikte, scanner CLI ile uyumlu .tar.gz formatında
// yönetir.
// ─────────────────────────────────────────────────────────────────────────────

import { initAuth } from "./core/auth.js";
import { registerRoute } from "./core/router.js";
import { initModal } from "./ui/modal.js";
import { initCatalog, renderCatalog } from "./pages/catalog.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderAuthors, initAuthors } from "./pages/authors.js";
import { renderPublishers, initPublishers } from "./pages/publishers.js";
import { renderSeries, initSeries } from "./pages/series.js";
import { renderCollections, initCollections } from "./pages/collections.js";
import { renderDedupe, initDedupe } from "./pages/dedupe.js";
import { showToast } from "./ui/common.js";

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
// Not: Mevcut try/catch blokları (modal.js, dashboard-backup.js, vb.) bu
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

  // 3) Oturumu kontrol et → uygulamayı veya giriş ekranını göster.
  //    (Oturum varsa: kitapları yükler ve router'ı başlatır.)
  initAuth();
});