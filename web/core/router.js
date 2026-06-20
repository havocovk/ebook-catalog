// ─────────────────────────────────────────────────────────────────────────────
// ROUTER — Sayfa yönlendirme (hash routing).
//
// Tek bir HTML sayfamız var ama içinde birden çok "sayfa" (div) bulunuyor.
// Router, adres çubuğundaki # işaretinden sonrasına bakar (#catalog, #dashboard...)
// ve doğru sayfayı gösterip diğerlerini gizler. Geri/ileri tuşları da çalışır,
// çünkü adres değiştikçe tarayıcı bizi haberdar eder.
//
// Her sayfa kendi "çizim fonksiyonunu" registerRoute ile buraya kaydeder.
// Router o sayfaya geçildiğinde ilgili çizim fonksiyonunu çağırır.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "./state.js";

// Sayfa adı → çizim fonksiyonu eşlemesi. app.js başlangıçta doldurur.
const routes = {};

// Geçerli sayfa adları ve varsayılan (açılışta gidilecek) sayfa.
const VALID_ROUTES = ["catalog", "dashboard", "authors", "publishers", "series", "dedupe"];
const DEFAULT_ROUTE = "catalog";

// Olay dinleyicilerini sadece bir kez bağlamak için bayrak.
let started = false;

// Bir sayfanın çizim fonksiyonunu kaydeder. Örn: registerRoute("catalog", renderCatalog)
export function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

// Router'ı başlatır: adres değişimini ve hamburger menüsünü dinler, ilk sayfayı açar.
export function initRouter() {
  if (!started) {
    window.addEventListener("hashchange", handleRoute);
    setupNavToggle();
    started = true;
  }

  // Açılış: adres boşsa varsayılana git (bu otomatik handleRoute tetikler),
  // adres zaten doluysa doğrudan işle.
  if (!location.hash) {
    location.hash = "#" + DEFAULT_ROUTE;
  } else {
    handleRoute();
  }
}

// Koddan sayfa değiştirmek için (örn. bir butonla). Adresi değiştirir, gerisi otomatik.
export function navigate(name) {
  location.hash = "#" + name;
}

// Şu an açık olan sayfayı yeniden çizer.
// Bir kitap güncellenip/silindiğinde listeyi tazelemek için kullanılır.
export function refreshCurrentPage() {
  const name = state.currentPage;
  if (name && routes[name]) routes[name]();
}

// ─── Dahili: adres değişince çalışır ────────────────────────────────────────
function handleRoute() {
  let name = location.hash.replace("#", "");
  // Bilinmeyen/boş adres gelirse varsayılana düş.
  if (!VALID_ROUTES.includes(name)) name = DEFAULT_ROUTE;
  showPage(name);
  closeMenu();
}

// ─── Dahili: istenen sayfayı göster, diğerlerini gizle ──────────────────────
function showPage(name) {
  // Tüm sayfaları gizle.
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));

  // Seçilen sayfayı göster.
  const page = document.getElementById(`${name}-page`);
  if (page) page.classList.remove("hidden");

  // Menüde aktif sekmeyi vurgula.
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === name);
  });

  // Hafızaya hangi sayfada olduğumuzu yaz.
  state.currentPage = name;

  // Sayfanın kendi çizim fonksiyonunu çağır (kayıtlıysa).
  if (routes[name]) routes[name]();

  // Sayfa değişince en üste kaydır.
  window.scrollTo(0, 0);
}

// ─── Mobil menü (hamburger) ─────────────────────────────────────────────────
function setupNavToggle() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }
}

function closeMenu() {
  const nav = document.getElementById("main-nav");
  if (nav) nav.classList.remove("open");
}