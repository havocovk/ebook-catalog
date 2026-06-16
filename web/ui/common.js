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