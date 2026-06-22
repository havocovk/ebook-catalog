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
    //
    // ── Adım 19+ düzeltmesi: bootstrapAuthors/Publishers/Collections, ÜÇÜ DE
    // loadBooks ile aynı paralel gruptan ÇIKARILDI. Sebep: bu üç fonksiyon
    // da state.books'u tarayarak "kitaplarda geçen ama ilgili tabloda
    // (authors/publishers/collections) olmayan isimleri ekle" mantığı
    // çalıştırır. loadBooks ile paralel çalıştıklarında state.books bazen
    // henüz boş oluyordu (yarış durumu) — bu da büyük taramalar sonrasında
    // (örn. 91 kitap) yeni yazar/yayınevi isimlerinin authors/publishers
    // tablolarına HİÇ eklenmemesine sebep oluyordu. Sonuç: kitap kartı
    // üzerinde doğru isim görünse de (books.publisher/author metin alanı
    // doğru), modal'daki seri seçici "yayınevi bulunamadı" diyerek devre
    // dışı kalıyordu (currentPublisherId(), state.publishers içinde isim
    // eşleşmesi arıyor — tablo boşsa hiçbir eşleşme bulunamaz).
    //
    // Bu, Adım 19'da bootstrapCollections için bulunan ve düzeltilen aynı
    // kök sebep — şimdi authors ve publishers'a da uygulanıyor.
    //
    // Çözüm: loadBooks artık TEK BAŞINA, garanti tamamlanana kadar beklenir.
    // Sonra authors/publishers/collections aynı anda (paralel, çünkü
    // birbirlerine bağımlı değiller) çalışır. Seriler en son — yayınevlerine
    // bağımlı olduğu için publishers'ın bitmiş olması gerekiyor.
    //
    // Sıralama (üç dalga):
    //   await loadBooks()
    //   await Promise.all([bootstrapAuthors, bootstrapPublishers, bootstrapCollections])
    //   await bootstrapSeries()
    await loadBooks();
    await Promise.all([
      bootstrapAuthors(),
      bootstrapPublishers(),
      bootstrapCollections(),
    ]);
    await bootstrapSeries();         // Yayınevlerine bağımlı — en son
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
    // ── Adım 19+ düzeltmesi: initAuth'taki ile aynı — loadBooks tek başına
    // beklenir, sonra authors/publishers/collections paralel, en son series.
    await loadBooks();
    await Promise.all([
      bootstrapAuthors(),
      bootstrapPublishers(),
      bootstrapCollections(),
    ]);
    await bootstrapSeries();         // Yayınevlerine bağımlı — en son
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