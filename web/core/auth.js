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
    // Kitaplar, yazarlar, yayınevleri ve koleksiyonlar birbirinden bağımsız
    // Appwrite sorguları olduğu için aynı anda paralel başlatılır. Seriler
    // yayınevi ID'lerine bağlı olduğundan yayınevleri yüklendikten sonra
    // çalıştırılır.
    //
    // Mevcut (sıralı — yavaş):
    //   await loadBooks();             // ~800ms
    //   await bootstrapAuthors();      // ~400ms
    //   await bootstrapPublishers();   // ~400ms
    //   await bootstrapCollections();  // ~400ms
    //   await bootstrapSeries();       // ~400ms
    //   Toplam: ~2400ms
    //
    // Yeni (paralel — hızlı):
    //   await Promise.all([loadBooks, bootstrapAuthors, bootstrapPublishers, bootstrapCollections])
    //   await bootstrapSeries();
    //   Toplam: ~800ms (en uzun sürenin kadar)
    //
    // ── Adım 19 notu: bootstrapCollections, bootstrapAuthors/Publishers ile
    // birebir aynı "eksik tamamlama" desenini izler (state.books'u tarar).
    // Bu paralel grupta state.books henüz loadBooks() tarafından doldurulmamış
    // olabilir — bu, zaten bootstrapAuthors/Publishers'ın da paylaştığı bilinen
    // bir davranış (yarış durumu kasıtlı kabul edilmiş, Adım J2'nin parçası).
    // Sonraki bir sayfa açılışında (loadBooks tamamlandıktan sonra çağrılan
    // bootstrap fonksiyonları) eksik tamamlama zaten gerçekleşir.
    await Promise.all([
      loadBooks(),
      bootstrapAuthors(),
      bootstrapPublishers(),
      bootstrapCollections(),
    ]);
    await bootstrapSeries();         // Yayınevlerine bağlı — en sona kalır
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
    await Promise.all([
      loadBooks(),
      bootstrapAuthors(),
      bootstrapPublishers(),
      bootstrapCollections(),  // ── Adım 19
    ]);
    await bootstrapSeries();         // Yayınevlerine bağlı — en sona kalır
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