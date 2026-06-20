// ─────────────────────────────────────────────────────────────────────────────
// COMMON UI HELPERS — Her yerde kullanılan küçük yardımcı fonksiyonlar.
//
// Bu dosya hiçbir şeye bağımlı değildir (en alt katman). Diğer modüller buradan
// fonksiyon alıp kullanır. Tek bir yerde durmaları, ileride bir davranışı
// değiştirmek istediğimizde tek noktadan halletmemizi sağlar.
// ─────────────────────────────────────────────────────────────────────────────

// "Yükleniyor..." animasyonunu göster (true) ya da gizle (false).
export function showLoading(show) {
  const el = document.getElementById("loading");
  if (el) el.classList.toggle("hidden", !show);
}

// Sağ altta kısa süreli bildirim gösterir. type: "success" (yeşil) veya "error" (kırmızı).
export function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Önce görünür yap (animasyon için kısa gecikme), sonra 3 saniye sonra kaldır.
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// HTML'in içine metin koyarken özel karakterleri kaçırır (güvenlik için).
// Örn. kitap başlığında < > " gibi karakterler varsa sayfayı bozmasını engeller.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Veritabanındaki durum kodunu (ör. "okunuyor") Türkçe etikete çevirir.
export function statusLabel(status) {
  const labels = {
    okunmadi: "Okunmadı",
    sirada: "Sırada",
    okunuyor: "Okunuyor",
    okundu: "Okundu",
  };
  return labels[status] || "Okunmadı";
}

// Bayt cinsinden dosya boyutunu okunabilir metne çevirir (ör. 1536000 → "1.5 MB").
export function formatFileSize(bytes) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Bugünün tarihini "YYYY-MM-DD" biçiminde döndürür (ör. yedek dosyası adı için).
export function today() {
  return new Date().toISOString().split("T")[0];
}

// ── Adım 3: Güven Skoru Yardımcıları ────────────────────────────────────────
// Veritabanındaki confidence_score (0-100) sayısını 3 seviyeye böler:
//   Yüksek (80+)  → "high"   → yeşil
//   Orta   (50-79)→ "medium" → sarı
//   Düşük  (<50)  → "low"    → kırmızı
// score null/undefined ise null döner (rozet hiç gösterilmez — eski taramalar
// veya henüz işlenmemiş kayıtlar için).
export function confidenceLevel(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

// Seviye koduna göre Türkçe kısa etiket.
export function confidenceLabel(level) {
  const labels = { high: "Yüksek", medium: "Orta", low: "Düşük" };
  return labels[level] || "";
}

// ── Adım 6: Authors/Publishers/Series Ortak Yardımcıları ───────────────────
// NOT: escapeHtml() apostrofu (') da kaçırır (&#039;); bu fonksiyon kaçırmaz.
// authors/publishers/series sayfalarındaki eski "esc()" davranışını korumak
// için ayrı tutuldu — birleştirseydik "O'Brien" gibi adların görünümü
// "O&#039;Brien" olarak değişirdi (davranış değişikliği, istemiyoruz).
export function escapeHtmlBasic(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Eski "escAttr()" ile birebir aynı: tırnak + apostrof kaçırır (HTML
// attribute değerleri için, örn. data-author="...").
export function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}