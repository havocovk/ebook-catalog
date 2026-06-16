// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE — Uygulamanın tek "hafıza" objesi.
//
// Tüm sayfalar bu objeyi paylaşır. Kitaplar Appwrite'tan bir kere yüklenir ve
// buraya konur; katalog, dashboard, yazarlar vb. hepsi buradan okur. Böylece
// her sayfa açılışında tekrar tekrar veritabanına gidilmez.
//
// NOT: Filtre / arama / sıralama gibi yalnızca katalogu ilgilendiren bilgiler
// burada DEĞİL, catalog.js içinde yerel olarak tutulur. Burada sadece tüm
// uygulamanın ortak ihtiyaç duyduğu veriler bulunur.
// ─────────────────────────────────────────────────────────────────────────────

export const state = {
  // Appwrite'tan yüklenen tüm kitaplar (tek sefer doldurulur, herkes kullanır).
  books: [],

  // Yazar / yayınevi / seri listeleri (ayrı koleksiyonlardan yüklenir).
  // Her eleman bir Appwrite belgesidir: { $id, name, ... }.
  // Modal'daki açılır menüler bu listelerden beslenir.
  authors: [],
  publishers: [],
  series: [],

  // Giriş yapan kullanıcı (Appwrite account objesi). Oturum yoksa null.
  user: null,

  // Şu an görüntülenen sayfanın adı: "catalog", "dashboard", "authors", ...
  // router.js bunu günceller; bir kayıt değişince "aktif sayfayı yenile" için kullanılır.
  currentPage: null,
};