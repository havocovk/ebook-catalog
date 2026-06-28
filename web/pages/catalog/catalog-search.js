// ─────────────────────────────────────────────────────────────────────────────
// CATALOG-SEARCH — Fuzzy (bulanık) arama + Türkçe karakter normalizasyonu.
//
// catalog.js'den ayrıldı (Adım 2-2, Faza 2 parçalanması).
// Diğer hiçbir katalog parçasına bağımlı değil — sadece state.books okur.
// catalog-filters.js'deki recompute() bu dosyadaki _fuzzySearch()'ü çağırır.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";

// ── Adım J8: Fuse.js — Fuzzy (bulanık) arama ────────────────────────────────
// CDN'den ES Module olarak yüklenir; yüklenemezse tam eşleşme devreye girer.
// Fuse.js kurulum gerektirmez — import yeterli.
let _Fuse = null;

(async () => {
  try {
    const mod = await import("https://esm.sh/fuse.js@7.0.0");
    _Fuse = mod.default;
  } catch {
    // CDN erişilemez (offline, ağ kısıtlaması) → tam eşleşme fallback
    console.warn("[J8] Fuse.js yüklenemedi — tam eşleşme modunda devam ediliyor.");
  }
})();

// Türkçe karakter normalizasyonu: ş→s, ç→c, ğ→g, ü→u, ö→o, ı→i, İ→i
// "şule" → "sule" yapar; böylece "sule" yazıp "Şule"yi bulabilirsin.
function _normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ı/g, "i")
    .replace(/İ/g, "i").replace(/Ş/g, "s").replace(/Ç/g, "c")
    .replace(/Ğ/g, "g").replace(/Ü/g, "u").replace(/Ö/g, "o")
    .replace(/I/g, "i");
}

// Fuzzy arama sonucu önbelleği — state.books değişmezse yeniden oluşturulmaz.
// { books: state.books referansı, fuse: Fuse örneği }
let _fuseCache = null;

function _getFuse() {
  if (!_Fuse) return null;
  // Kitap listesi değiştiyse önbelleği yenile
  if (_fuseCache?.books === state.books) return _fuseCache.fuse;

  // Her kitabın arama alanlarını Türkçe normalize ederek indeksle
  const docs = state.books.map((b) => ({
    $id:    b.$id,
    title:  _normalize(b.title),
    author: _normalize(b.author),
    series: _normalize(b.series),
    tags:   (b.tags || []).map(_normalize).join(" "),
  }));

  const fuse = new _Fuse(docs, {
    keys:               ["title", "author", "series", "tags"],
    threshold:          0.35,   // 0=tam eşleşme 1=her şeyi bul; 0.35 makul tolerans
    minMatchCharLength: 2,      // 1 karakterlik sorguyu fuzzy yapmayız
    distance:           200,    // uzun başlıklarda eşleşme alanı
    ignoreLocation:     true,   // başlığın herhangi bir yerinde eşleşsin
  });

  _fuseCache = { books: state.books, fuse };
  return fuse;
}

// Fuzzy arama: sorguya uyan kitap $id kümesini döndürür.
// Fuse.js yoksa null döner → caller tam eşleşmeye düşer.
export function _fuzzySearch(query) {
  const fuse = _getFuse();
  if (!fuse) return null;
  const results = fuse.search(_normalize(query));
  return new Set(results.map((r) => r.item.$id));
}
// ── Adım J8 sonu ─────────────────────────────────────────────────────────────