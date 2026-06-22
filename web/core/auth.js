// ─────────────────────────────────────────────────────────────────────────────
// AUTH — Giriş / çıkış / oturum kontrolü.
//
// Appwrite'ta (Supabase'in aksine) otomatik "oturum değişti" bildirimi yoktur;
// oturumu elle yönetiriz. Açılışta "oturum açık mı?" diye sorarız: açıksa
// uygulamayı gösterip kitapları yükleriz, değilse giriş ekranını gösteririz.
// ─────────────────────────────────────────────────────────────────────────────

import { account } from "../appwrite.js";
import { state } from "./state.js";
import { loadBooks, bootstrapAuthors, bootstrapPublishers, bootstrapSeries, bootstrapCollections } from "./api.js";
import { initRouter } from "./router.js";

// Açılışta çağrılır: butonları bağlar, ardından mevcut oturumu kontrol eder.
export async function initAuth() {
  bindAuthEvents();
  try {
    state.user = await account.get();
    showApp();

    // ── Adım J2: Paralel başlangıç yüklemesi ──────────────────────────────
    // Kitaplar, yazarlar ve yayınevleri birbirinden bağımsız Appwrite sorguları
    // olduğu için aynı anda paralel başlatılır.
    //
    // ── Adım 19 düzeltmesi: bootstrapCollections İLK paralel gruptan
    // ÇIKARILDI. Sebep: bootstrapCollections, state.books'u tarayarak
    // "kitaplarda geçen ama collections tablosunda olmayan isimleri ekle"
    // mantığı çalıştırır (bootstrapAuthors/Publishers ile aynı desen).
    // loadBooks ile paralel çalıştığında state.books bazen henüz boş
    // olabiliyordu (yarış durumu) — bu da yeni eklenen koleksiyon adlarının
    // (örn. "Tango", "CFD") collections tablosuna hiç eklenmemesine, ve
    // Koleksiyonlar sayfasındaki yeniden adlandır/sil butonlarının
    // "koleksiyon bulunamadı" hatası vermesine sebep oluyordu.
    //
    // Çözüm: bootstrapCollections artık bootstrapSeries ile aynı konumda —
    // loadBooks GARANTİ olarak bittikten SONRA çalışır. İkisi de Yazarlar/
    // Yayınevleri'ne bağımlı olmadığı için birbirleriyle paralel kalabilir
    // (performans kaybı yok, sadece state.books'a olan bağımlılık güvene alındı).
    //
    // Mevcut sıralama:
    //   await Promise.all([loadBooks, bootstrapAuthors, bootstrapPublishers])
    //   await Promise.all([bootstrapCollections, bootstrapSeries])
    //   Toplam: ~1200ms (iki paralel dalga)
    await Promise.all([
      loadBooks(),
      bootstrapAuthors(),
      bootstrapPublishers(),
    ]);
    await Promise.all([
      bootstrapCollections(),  // state.books'a bağımlı — artık güvenle çalışır
      bootstrapSeries(),       // Yayınevlerine bağımlı — artık güvenle çalışır
    ]);
    // ── Adım J2 sonu ──────────────────────────────────────────────────────

    initRouter();                    // Tüm veriler yüklendikten sonra sayfa çizilsin
  } catch {
    // Oturum yok — giriş ekranını göster.
    showLogin();
  }
}

// Giriş ekranı ve çıkış butonunun olaylarını bağlar (yalnızca bir kez).
function bindAuthEvents() {
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const passwordInput = document.getElementById("login-password");

  if (loginBtn) loginBtn.addEventListener("click", login);
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (passwordInput) {
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
  }
}

// ─── Giriş yap ──────────────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  errorEl.textContent = "";

  if (!email || !password) {
    errorEl.textContent = "E-posta ve şifre gerekli.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Giriş yapılıyor...";

  try {
    // Aynı tarayıcıda eski bir oturum varsa önce temizle (çift oturum hatasını önler).
    try {
      await account.deleteSession("current");
    } catch {
      /* oturum yoktu, sorun değil */
    }

    await account.createEmailPasswordSession(email, password);
    state.user = await account.get();
    showApp();

    // ── Adım J2: Paralel başlangıç yüklemesi (initAuth ile aynı mantık) ───
    // ── Adım 19 düzeltmesi: bootstrapCollections, loadBooks'tan SONRA
    // (bootstrapSeries ile birlikte paralel) çalışır — yarış durumunu
    // önlemek için initAuth'taki ile aynı düzeltme.
    await Promise.all([
      loadBooks(),
      bootstrapAuthors(),
      bootstrapPublishers(),
    ]);
    await Promise.all([
      bootstrapCollections(),
      bootstrapSeries(),       // Yayınevlerine bağımlı — artık güvenle çalışır
    ]);
    // ── Adım J2 sonu ──────────────────────────────────────────────────────

    initRouter();
  } catch (err) {
    errorEl.textContent = "Giriş başarısız: " + (err?.message || "bilinmeyen hata");
  } finally {
    btn.disabled = false;
    btn.textContent = "Giriş yap";
  }
}

// ─── Çıkış yap ──────────────────────────────────────────────────────────────
async function logout() {
  try {
    await account.deleteSession("current");
  } catch {
    /* yoksay */
  }
  state.user = null;
  state.books = [];
  showLogin();
}

// ─── Ekran geçişleri ────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
}