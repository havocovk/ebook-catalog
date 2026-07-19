// ─────────────────────────────────────────────────────────────────────────────
// FILTER-CORE — Katalogun filtreleme + sıralama motoru.
//
// Bu modülün kalbi recompute()'tur: state.books'u alır, sırayla tüm aktif
// filtreleri uygular, sonucu sıralar, sayfayı sınırlar ve render callback'ini
// tetikler.
//
// Sorumluluklar:
//   • recompute(resetPage)  — ana filtreleme + sıralama + render tetikleme
//   • sortBooks(books, key) — sıralama (private)
//   • clampPage()           — sayfa numarasını geçerli aralığa sınırla (private)
//
// Bağımlılıklar:
//   ← state.js            (state.books — filtrelenecek ham veri)
//   ← common.js           (confidenceLevel — güven skoru filtresi için)
//   ← catalog-search.js   (_fuzzySearch — bulanık arama)
//   ← filter-state.js     (ui, PER_PAGE, filtered, setFiltered, getYearBounds,
//                          getRecomputeCallback)
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../../core/state.js";
import { confidenceLevel } from "../../ui/common.js";
import { _fuzzySearch } from "./catalog-search.js";
import {
  ui,
  PER_PAGE,
  filtered,
  setFiltered,
  getYearBounds,
  getRecomputeCallback,
} from "./filter-state.js";

// ─── Filtrele + sırala + çiz ────────────────────────────────────────────────
export function recompute(resetPage = false) {
  let result = [...state.books];

  if (ui.search) {
    // Adım J8: Fuzzy arama
    // Kısa sorgularda (1 karakter) ve Fuse.js yüklü değilken tam eşleşme.
    // Uzun sorgularda Fuse.js ile yazım hatası toleranslı arama.
    const q = ui.search.toLowerCase();

    if (ui.search.length >= 2) {
      const matchIds = _fuzzySearch(ui.search);
      if (matchIds) {
        // Fuse.js başarılı — eşleşen $id'lere göre filtrele
        result = result.filter((b) => matchIds.has(b.$id));
      } else {
        // Fallback: Fuse.js yok → tam eşleşme
        result = result.filter(
          (b) =>
            b.title?.toLowerCase().includes(q)  ||
            b.author?.toLowerCase().includes(q) ||
            b.series?.toLowerCase().includes(q) ||
            b.tags?.some((t) => t.toLowerCase().includes(q))
        );
      }
    } else {
      // 1 karakterlik sorgu → her zaman tam eşleşme (fuzzy çok geniş sonuç verir)
      result = result.filter(
        (b) =>
          b.title?.toLowerCase().includes(q)  ||
          b.author?.toLowerCase().includes(q) ||
          b.series?.toLowerCase().includes(q) ||
          b.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
  }

  if (ui.filters.format)    result = result.filter((b) => b.format    === ui.filters.format);
  if (ui.filters.status)    result = result.filter((b) => b.status    === ui.filters.status);
  if (ui.filters.author)    result = result.filter((b) => b.author    === ui.filters.author);
  if (ui.filters.publisher) result = result.filter((b) => b.publisher === ui.filters.publisher);
  if (ui.filters.series)    result = result.filter((b) => b.series    === ui.filters.series);

  // Adım 9: Dil (VEYA) ve Etiket (VE) — çoklu seçim
  // Dil: bir kitabın TEK dili var (book.language), o yüzden "VEYA" mantıklı.
  // Etiket: bir kitabın BİRDEN FAZLA etiketi olabilir (book.tags dizisi),
  //         o yüzden "VE" mantıklı — seçilen etiketlerin TÜMÜNE sahip olanlar.
  if (ui.filters.language.length > 0) {
    result = result.filter((b) => ui.filters.language.includes(b.language));
  }
  if (ui.filters.tag.length > 0) {
    result = result.filter((b) => ui.filters.tag.every((t) => b.tags?.includes(t)));
  }

  // Adım 11: Kategori filtresi (çoklu seçim, VEYA mantığı)
  // Bir kitabın TEK kategorisi var (book.category), o yüzden "VEYA" doğru.
  if (ui.filters.category.length > 0) {
    result = result.filter((b) => ui.filters.category.includes(b.category));
  }

  // Bölüm 2: Tür (genre) filtresi (çoklu seçim, VEYA mantığı)
  // Kategori filtresiyle birebir aynı mantık — bir kitabın TEK türü var.
  if (ui.filters.genre.length > 0) {
    result = result.filter((b) => ui.filters.genre.includes(b.genre));
  }

  // Adım 11: Alt Alan ve Konu filtreleri (ağacın 2. ve 3. seviyesi)
  // Her ikisi de VEYA mantığıyla çoklu seçim — bir kitabın tek alt alanı/konusu olur.
  if (ui.filters.subcategory.length > 0) {
    result = result.filter((b) => ui.filters.subcategory.includes(b.subcategory));
  }
  if (ui.filters.topic.length > 0) {
    result = result.filter((b) => ui.filters.topic.includes(b.topic));
  }

  // Adım 3: Güven skoru seviye filtresi
  if (ui.filters.confidence) {
    result = result.filter((b) => confidenceLevel(b.confidence_score) === ui.filters.confidence);
  }

  // Adım 4: Yıl aralığı filtresi
  // null = filtre uygulanmamış (slider tam aralıkta). Filtre aktifse,
  // yıl bilgisi olmayan kitaplar (b.year boş/null) sonuçtan çıkarılır.
  if (ui.filters.yearMin !== null || ui.filters.yearMax !== null) {
    const yb = getYearBounds();
    const lo = ui.filters.yearMin ?? yb.min;
    const hi = ui.filters.yearMax ?? yb.max;
    result = result.filter((b) => Number.isFinite(b.year) && b.year >= lo && b.year <= hi);
  }

  // Adım 14: Eksik alan filtresi (Dashboard "Eksik Bilgi Merkezi")
  // İlgili alanı boş string, null veya undefined olan kitapları gösterir.
  // Diğer filtrelerin tersine "değere eşit" değil "değer eksik" mantığı.
  if (ui.filters.missingField) {
    const field = ui.filters.missingField;
    result = result.filter((b) => !b[field]);
  }

  // Adım 37: Kategori Durumu filtresi (boş/dolu)
  if (ui.filters.categoryStatus === "empty") {
    result = result.filter((b) => !b.category);
  } else if (ui.filters.categoryStatus === "filled") {
    result = result.filter((b) => Boolean(b.category));
  }

  // Kapak Resmi Durumu filtresi (boş/dolu)
  if (ui.filters.coverStatus === "empty") {
    result = result.filter((b) => !b.cover_url);
  } else if (ui.filters.coverStatus === "filled") {
    result = result.filter((b) => Boolean(b.cover_url));
  }

  // Adım 17: Sadece Favoriler filtresi
  if (ui.filters.favoriteOnly) {
    result = result.filter((b) => Boolean(b.favorite));
  }

  setFiltered(sortBooks(result, ui.sort));
  if (resetPage) ui.page = 1;
  clampPage();

  // DAİRESEL BAĞIMLILIK ÇÖZÜMÜ: render() doğrudan import edilmiyor,
  // catalog/index.js tarafından enjekte edilen callback çağrılıyor.
  getRecomputeCallback()?.();
}

function clampPage() {
  const total = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  ui.page = Math.min(Math.max(1, ui.page), total);
}

function sortBooks(books, key) {
  const s = [...books];
  if (key === "title_asc")
    return s.sort((a, b) => (a.title  || "").localeCompare(b.title  || "", "tr", { sensitivity: "base" }));
  if (key === "author_asc")
    return s.sort((a, b) => (a.author || "").localeCompare(b.author || "", "tr", { sensitivity: "base" }));
  if (key === "series_asc")
    return s.sort((a, b) => {
      const c = (a.series || "").localeCompare(b.series || "", "tr", { sensitivity: "base" });
      return c !== 0 ? c : (a.series_order || 0) - (b.series_order || 0);
    });
  return s.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));
}