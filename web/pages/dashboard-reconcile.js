// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD-RECONCILE — Eşleştirme Yönetimi modülü.
//
// Görev: Kütüphanedeki kitapları tarayarak;
//   1) Birebir aynı (yazar + başlık %100 eşleşen) ama henüz canonical_id
//      atanmamış dosya gruplarını tespit eder.
//   2) Yazar bazında normalleştirilmiş başlık karşılaştırması yaparak
//      %90+ benzer olan çiftleri listeler (kullanıcı incelemesi için).
//
// Tasarım kararları:
//   - Tarama her sayfa yüklemesinde ÇALIŞMAZ — kullanıcı "Tara" butonuna basınca.
//   - Sonuçlar sessionStorage'da cache'lenir; aynı oturumda "Tara"ya ikinci kez
//     basılırsa önce cache kontrol edilir. Yeni kitap eklenmişse cache otomatik
//     geçersiz sayılır (state.books.length ile karşılaştırılır).
//   - Fuzzy match YERİ: sadece aynı yazar altındaki kitaplar karşılaştırılır
//     (tüm kütüphane × tüm kütüphane değil). Bu, 10.000 kitapta bile
//     yönetilebilir kalmasını sağlar.
//   - Appwrite'a hiç okuma/yazma yapmaz — sadece state.books (RAM) kullanır.
//     Eşleştirme butonu çalışınca api-books.js'teki setCanonicalId devreye girer.
// ─────────────────────────────────────────────────────────────────────────────

import { state }          from "../core/state.js";
import { setCanonicalId } from "../core/api.js";
import { showToast }      from "../ui/common.js";
import { escapeHtml }     from "../ui/common.js";

// ── Cache anahtarları ────────────────────────────────────────────────────────
const CACHE_KEY_EXACT  = "reconcile_exact";
const CACHE_KEY_FUZZY  = "reconcile_fuzzy";
const CACHE_KEY_COUNT  = "reconcile_book_count"; // cache'in hangi kitap sayısı için üretildiği

// ─────────────────────────────────────────────────────────────────────────────
// YARDIMCI: Normalleştirme
// Türkçe karakterleri İngilizce karşılıklarına çevirir, küçük harfe indirir,
// noktalama ve boşlukları siler. Fuzzy karşılaştırma için kullanılır.
// ─────────────────────────────────────────────────────────────────────────────
function _normalize(str) {
  if (!str) return "";
  return str
    .toLocaleLowerCase("tr")
    .replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
    .replace(/ı/g, "i").replace(/ü/g, "u").replace(/ö/g, "o")
    .replace(/[^a-z0-9]/g, ""); // harf ve rakam dışındaki her şeyi sil
}

// ─────────────────────────────────────────────────────────────────────────────
// YARDIMCI: Levenshtein benzerlik skoru (0–1 arası)
// İki string'in ne kadar benzer olduğunu 0 (hiç benzemiyor) ile 1 (aynı)
// arasında bir sayıyla ifade eder.
// ─────────────────────────────────────────────────────────────────────────────
function _similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  // Performans: çok uzun string'leri kıs (ilk 120 karakter yeterli)
  const A = a.slice(0, 120);
  const B = b.slice(0, 120);
  const M = A.length;
  const N = B.length;

  // Levenshtein matris hesabı (tek satır optimizasyonu)
  let prev = Array.from({ length: N + 1 }, (_, i) => i);
  for (let i = 1; i <= M; i++) {
    const curr = [i];
    for (let j = 1; j <= N; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // silme
        prev[j] + 1,           // ekleme
        prev[j - 1] + cost     // değiştirme
      );
    }
    prev = curr;
  }

  const distance = prev[N];
  return 1 - distance / Math.max(M, N);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXACT MATCH — Birebir eşleşme tespiti
//
// canonical_id'si BOŞ olan kitapları yazar+başlık anahtarına göre gruplar.
// 2 veya daha fazla dosyası olan grupları döndürür.
//
// Dönüş: [{ key, author, title, books: [{$id, title, author, format}] }, ...]
// ─────────────────────────────────────────────────────────────────────────────
export function findExactMatches() {
  const map = {};

  for (const b of state.books) {
    // Dolu canonical_id'ye sahip olanları atla — zaten eşleştirilmiş
    if (b.canonical_id && b.canonical_id.trim()) continue;

    const author = (b.author || "").toLocaleLowerCase("tr").trim();
    const title  = (b.title  || "").toLocaleLowerCase("tr").trim();

    // Yazar veya başlık tamamen boşsa güvenilir değil, atla
    if (!author && !title) continue;

    const key = `${author}|||${title}`;
    if (!map[key]) {
      map[key] = {
        key,
        author: b.author || "",
        title:  b.title  || "",
        books:  [],
      };
    }
    map[key].books.push({
      $id:    b.$id,
      title:  b.title  || "",
      author: b.author || "",
      format: (b.format || b.file_type || "").toUpperCase(),
    });
  }

  // Sadece 2+ dosyası olan grupları al
  return Object.values(map).filter((g) => g.books.length >= 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY MATCH — Yakın benzerlik tespiti (~%90+)
//
// Yazar bazlı çalışır: önce tüm kitapları yazara göre gruplar, sonra her
// yazar grubunun kendi içindeki kitapları normalleştirilmiş başlıkla
// karşılaştırır. Benzerlik ≥ 0.90 olan çiftleri döndürür.
//
// Zaten aynı canonical_id grubundaki kitapları birbirleriyle karşılaştırmaz
// (zaten eşleştirilmişler). Birebir exact match olan çiftleri de
// fuzzy listesine katmaz (kullanıcıyı çift uyarmak istemiyoruz).
//
// Dönüş: [{ book_a, book_b, similarity, reason }, ...]
//   book_a / book_b: { $id, title, author, format }
//   similarity: 0.90–1.0 arası float (1.0 exact match'e gireceklerden exclude edildi)
//   reason: neden benzer olduğunu açıklayan kısa metin
// ─────────────────────────────────────────────────────────────────────────────
export function findFuzzyMatches(threshold = 0.90) {
  const results = [];

  // Yazara göre grupla
  const byAuthor = {};
  for (const b of state.books) {
    const authorKey = _normalize(b.author || "bilinmiyen");
    if (!byAuthor[authorKey]) byAuthor[authorKey] = [];
    byAuthor[authorKey].push(b);
  }

  // Her yazar grubunun içinde başlıkları karşılaştır
  for (const authorKey of Object.keys(byAuthor)) {
    const group = byAuthor[authorKey];
    if (group.length < 2) continue; // tek kitap varsa karşılaştıracak bir şey yok

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        // Aynı canonical grubundakileri karşılaştırma
        const cidA = (a.canonical_id || "").trim();
        const cidB = (b.canonical_id || "").trim();
        if (cidA && cidB && cidA === cidB) continue;

        const normA = _normalize(a.title || "");
        const normB = _normalize(b.title || "");

        // Exact normalize eşleşmesi → fuzzy'ye değil exact grubuna gider, atla
        if (normA === normB && normA !== "") continue;

        const sim = _similarity(normA, normB);
        if (sim < threshold) continue;

        // Fark nedenini tespit et (kullanıcıya açıklama için)
        let reason = "Başlık yazımı benzer";
        const rawA = (a.title || "").toLocaleLowerCase("tr");
        const rawB = (b.title || "").toLocaleLowerCase("tr");
        if (rawA === rawB && normA !== normB) {
          reason = "Türkçe/Latin karakter farkı";
        } else if (normA === normB) {
          reason = "Büyük/küçük harf veya noktalama farkı";
        }

        results.push({
          book_a: {
            $id:    a.$id,
            title:  a.title  || "",
            author: a.author || "",
            format: (a.format || a.file_type || "").toUpperCase(),
          },
          book_b: {
            $id:    b.$id,
            title:  b.title  || "",
            author: b.author || "",
            format: (b.format || b.file_type || "").toUpperCase(),
          },
          similarity: sim,
          reason,
        });
      }
    }
  }

  // Benzerlik skoruna göre azalan sırala (en şüpheliler başta)
  return results.sort((a, b) => b.similarity - a.similarity);
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE YÖNETİMİ
// ─────────────────────────────────────────────────────────────────────────────
function _saveCache(exactGroups, fuzzyPairs) {
  try {
    sessionStorage.setItem(CACHE_KEY_EXACT,  JSON.stringify(exactGroups));
    sessionStorage.setItem(CACHE_KEY_FUZZY,  JSON.stringify(fuzzyPairs));
    sessionStorage.setItem(CACHE_KEY_COUNT,  String(state.books.length));
  } catch (_) {
    // sessionStorage dolu veya engelliyse sessizce geç
  }
}

function _loadCache() {
  try {
    const savedCount = Number(sessionStorage.getItem(CACHE_KEY_COUNT));
    // Kitap sayısı değiştiyse cache geçersiz
    if (savedCount !== state.books.length) return null;

    const exact = JSON.parse(sessionStorage.getItem(CACHE_KEY_EXACT) || "null");
    const fuzzy = JSON.parse(sessionStorage.getItem(CACHE_KEY_FUZZY) || "null");
    if (!exact || !fuzzy) return null;

    return { exact, fuzzy };
  } catch (_) {
    return null;
  }
}

export function clearReconcileCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY_EXACT);
    sessionStorage.removeItem(CACHE_KEY_FUZZY);
    sessionStorage.removeItem(CACHE_KEY_COUNT);
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ANA TARAMA FONKSİYONU
// "Kütüphaneyi Tara" butonundan çağrılır. Cache varsa kullanır, yoksa hesaplar.
// Dönüş: { exact: [...], fuzzy: [...], fromCache: boolean }
// ─────────────────────────────────────────────────────────────────────────────
export function scanLibrary(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = _loadCache();
    if (cached) return { ...cached, fromCache: true };
  }

  const exact = findExactMatches();
  const fuzzy = findFuzzyMatches();
  _saveCache(exact, fuzzy);
  return { exact, fuzzy, fromCache: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPLU OTOMATİK EŞLEŞTİRME
// exactGroups dizisindeki her grubu setCanonicalId ile eşleştirir.
// onProgress(current, total) callback'i her adımda çağrılır.
// ─────────────────────────────────────────────────────────────────────────────
export async function bulkAutoMatch(exactGroups, onProgress) {
  if (!exactGroups || exactGroups.length === 0) return { groupCount: 0, fileCount: 0 };

  let totalFiles = 0;

  for (let i = 0; i < exactGroups.length; i++) {
    const group = exactGroups[i];
    const ids   = group.books.map((b) => b.$id);
    const newId = `canon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await setCanonicalId(ids, newId);
    totalFiles += ids.length;

    if (typeof onProgress === "function") {
      onProgress(i + 1, exactGroups.length);
    }

    // Timestamp çakışmasını önlemek için kısa bekleme
    await new Promise((r) => setTimeout(r, 5));
  }

  // Eşleştirme tamamlandı — cache geçersiz (state değişti)
  clearReconcileCache();

  return { groupCount: exactGroups.length, fileCount: totalFiles };
}

// ─────────────────────────────────────────────────────────────────────────────
// İLERLEME TOAST'I
// Tek bir toast'ı yerinde güncelleyen yardımcı. authors.js'teki ile aynı desen.
// ─────────────────────────────────────────────────────────────────────────────
export function createProgressToast(initialMessage) {
  const container = document.getElementById("toast-container");
  if (!container) return { update: () => {}, dismiss: () => {} };

  const toast = document.createElement("div");
  toast.className = "toast toast-success visible";
  toast.textContent = initialMessage;
  container.appendChild(toast);

  return {
    update(msg) { toast.textContent = msg; },
    dismiss() {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML OLUŞTURUCULAR — Dashboard paneli için
// ─────────────────────────────────────────────────────────────────────────────

// ── Tam eşleşme modal içeriği: checkbox'lı yazar + başlık listesi ────────────
//
// Her satırda bir checkbox bulunur. Varsayılan olarak TÜM satırlar işaretli
// (checked) başlar — kullanıcı eşleştirmek İSTEMEDİĞİ grupları işaretten çıkarır.
// data-group-key attribute'u grubun benzersiz anahtarını taşır; dashboard.js bu
// key ile hangi grupların işaretli olduğunu takip eder.
// ─────────────────────────────────────────────────────────────────────────────
export function renderExactMatchModalContent(exactGroups) {
  if (!exactGroups || exactGroups.length === 0) {
    return `<p class="reconcile-empty">Birebir eşleşme bulunamadı.</p>`;
  }

  // "Tümünü seç / Tümünü kaldır" üst checkbox satırı
  const headerRow = `
    <div class="reconcile-select-all-row">
      <label class="reconcile-checkbox-label">
        <input type="checkbox" id="reconcile-select-all" checked />
        <span class="reconcile-checkbox-custom"></span>
        <span class="reconcile-select-all-text">Tümünü seç / kaldır</span>
      </label>
    </div>
  `;

  const rows = exactGroups.map((g) => {
    const formats  = g.books.map((b) => b.format || "?").join(" + ");
    // key içindeki özel karakterleri attribute için güvenli hale getir
    const safeKey  = escapeHtml(g.key);
    return `
      <label class="reconcile-exact-row reconcile-exact-row--selectable" data-group-key="${safeKey}">
        <input type="checkbox" class="reconcile-group-checkbox" data-group-key="${safeKey}" checked />
        <span class="reconcile-checkbox-custom"></span>
        <div class="reconcile-exact-info">
          <span class="reconcile-exact-author">${escapeHtml(g.author)}</span>
          <span class="reconcile-exact-title">${escapeHtml(g.title)}</span>
        </div>
        <span class="reconcile-exact-formats">${escapeHtml(formats)}</span>
      </label>
    `;
  }).join("");

  return `
    <div class="reconcile-exact-list">
      ${headerRow}
      ${rows}
    </div>
  `;
}

// ── Yakın benzerlik modal içeriği: çift çift listeleme ───────────────────────
export function renderFuzzyMatchModalContent(fuzzyPairs) {
  if (!fuzzyPairs || fuzzyPairs.length === 0) {
    return `<p class="reconcile-empty">%90 üzeri benzerlikte çift bulunamadı.</p>`;
  }

  const rows = fuzzyPairs.map((pair) => {
    const pct   = Math.round(pair.similarity * 100);
    // %95 ve üzeri → turuncu uyarı, %90-94 arası → sarı
    const badge = pct >= 95
      ? `<span class="reconcile-sim-badge reconcile-sim-high">${pct}%</span>`
      : `<span class="reconcile-sim-badge reconcile-sim-mid">${pct}%</span>`;

    return `
      <div class="reconcile-fuzzy-row">
        <div class="reconcile-fuzzy-pair">
          <div class="reconcile-fuzzy-book">
            <span class="reconcile-fuzzy-label">A</span>
            <div class="reconcile-fuzzy-meta">
              <span class="reconcile-fuzzy-author">${escapeHtml(pair.book_a.author)}</span>
              <span class="reconcile-fuzzy-title">${escapeHtml(pair.book_a.title)}</span>
              ${pair.book_a.format ? `<span class="reconcile-fuzzy-format">${escapeHtml(pair.book_a.format)}</span>` : ""}
            </div>
          </div>
          <div class="reconcile-fuzzy-divider">
            ${badge}
            <span class="reconcile-fuzzy-reason">${escapeHtml(pair.reason)}</span>
          </div>
          <div class="reconcile-fuzzy-book">
            <span class="reconcile-fuzzy-label">B</span>
            <div class="reconcile-fuzzy-meta">
              <span class="reconcile-fuzzy-author">${escapeHtml(pair.book_b.author)}</span>
              <span class="reconcile-fuzzy-title">${escapeHtml(pair.book_b.title)}</span>
              ${pair.book_b.format ? `<span class="reconcile-fuzzy-format">${escapeHtml(pair.book_b.format)}</span>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="reconcile-fuzzy-list">
      ${rows}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL HTML — dashboard.js renderLayout() içine yerleştirilir
// ─────────────────────────────────────────────────────────────────────────────
export function renderReconcilePanel(scanResult) {
  // Tarama henüz yapılmadıysa sadece "Tara" butonu göster
  if (!scanResult) {
    return `
      <div class="dash-container dash-container--reconcile" id="reconcile-panel">
        <div class="dash-container-header">
          <h2 class="dash-container-title">
            <iconify-icon icon="lucide:git-merge"></iconify-icon> Eşleştirme Yönetimi
          </h2>
        </div>
        <p class="reconcile-desc">
          Aynı kitabın birden fazla formatta (PDF + EPUB gibi) kütüphanede bulunup
          bulunmadığını tarar; birebir ve yakın benzer olanları tespit eder.
        </p>
        <div class="reconcile-actions">
          <button id="reconcile-scan-btn" class="btn btn-sm btn-reconcile-scan">
            <iconify-icon icon="lucide:scan-search"></iconify-icon>
            <span>Kütüphaneyi Tara</span>
          </button>
        </div>
      </div>
    `;
  }

  const { exact, fuzzy, fromCache } = scanResult;
  const totalExactFiles = exact.reduce((s, g) => s + g.books.length, 0);
  const cacheNote = fromCache
    ? `<span class="reconcile-cache-note">(önbellekten)</span>`
    : "";

  const exactSection = exact.length > 0
    ? `
      <div class="reconcile-result-row reconcile-result-exact">
        <div class="reconcile-result-info">
          <iconify-icon icon="lucide:check-circle-2"></iconify-icon>
          <div>
            <span class="reconcile-result-count">${exact.length} grup</span>
            <span class="reconcile-result-label">birebir eşleşme — ${totalExactFiles} dosya</span>
          </div>
        </div>
        <div class="reconcile-result-btns">
          <button id="reconcile-exact-view-btn" class="btn btn-sm">
            <iconify-icon icon="lucide:list"></iconify-icon>
            <span>Listele</span>
          </button>
          <button id="reconcile-exact-match-btn" class="btn btn-sm btn-reconcile-match">
            <iconify-icon icon="lucide:wand-2"></iconify-icon>
            <span>Hepsini Eşleştir</span>
          </button>
        </div>
      </div>
    `
    : `
      <div class="reconcile-result-row reconcile-result-clean">
        <iconify-icon icon="lucide:check-circle-2"></iconify-icon>
        <span>Birebir eşleşme bulunamadı — temiz</span>
      </div>
    `;

  const fuzzySection = fuzzy.length > 0
    ? `
      <div class="reconcile-result-row reconcile-result-fuzzy">
        <div class="reconcile-result-info">
          <iconify-icon icon="lucide:alert-triangle"></iconify-icon>
          <div>
            <span class="reconcile-result-count">${fuzzy.length} çift</span>
            <span class="reconcile-result-label">%90+ benzerlik — incelemeniz önerilir</span>
          </div>
        </div>
        <button id="reconcile-fuzzy-view-btn" class="btn btn-sm">
          <iconify-icon icon="lucide:eye"></iconify-icon>
          <span>İncele</span>
        </button>
      </div>
    `
    : `
      <div class="reconcile-result-row reconcile-result-clean">
        <iconify-icon icon="lucide:shield-check"></iconify-icon>
        <span>%90+ benzerlik bulunamadı</span>
      </div>
    `;

  return `
    <div class="dash-container dash-container--reconcile" id="reconcile-panel">
      <div class="dash-container-header">
        <h2 class="dash-container-title">
          <iconify-icon icon="lucide:git-merge"></iconify-icon> Eşleştirme Yönetimi
          ${cacheNote}
        </h2>
        <button id="reconcile-scan-btn" class="btn btn-sm btn-reconcile-scan">
          <iconify-icon icon="lucide:scan-search"></iconify-icon>
          <span>Yeniden Tara</span>
        </button>
      </div>
      <div class="reconcile-results">
        ${exactSection}
        <div class="reconcile-divider"></div>
        ${fuzzySection}
      </div>
    </div>
  `;
}