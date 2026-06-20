// ─────────────────────────────────────────────────────────────────────────────
// DEDUPE — Kitap Ayıklayıcı sayfası.
//
// Bu sayfa, veritabanında "aynı yazar + aynı kitap adı" olan ama farklı
// yayınevinden eklenmiş kitapları bulmaya yarar. Kullanıcı bu kitapları
// karşılaştırıp gerçekten aynı mı diye karar verir.
//
// ADIM 1 (bu dosya): Sadece sayfa iskeleti — karşılama mesajı + buton.
// ADIM 2'de: Eşleştirme mantığı ve kitap kartlarının gösterimi eklenecek.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Dışa açık: sayfa her açıldığında çağrılır ──────────────────────────────
export function renderDedupe() {
  const container = document.getElementById("dedupe-content");
  if (!container) return;

  container.innerHTML = `
    <div class="dedupe-intro">
      <iconify-icon icon="lucide:copy-x" class="dedupe-intro-icon"></iconify-icon>
      <h2 class="dedupe-intro-title">Kitap Ayıklayıcı</h2>
      <p class="dedupe-intro-text">
        Bu sayfa kullanıcının isteğine bağlı olarak veritabanındaki birbirinin
        aynısı olan kitapları bulmak için tasarlanmıştır.
      </p>
      <button id="dedupe-scan-btn" class="btn btn-primary">
        <iconify-icon icon="lucide:search"></iconify-icon>
        Aynı Kitapları Bul
      </button>
    </div>
    <div id="dedupe-results"></div>
  `;
}

// ─── Dışa açık: olayları bir kez bağlamak için ──────────────────────────────
export function initDedupe() {
  document.getElementById("dedupe-content")?.addEventListener("click", (e) => {
    if (e.target.closest("#dedupe-scan-btn")) {
      // ADIM 2'de buraya gerçek eşleştirme mantığı gelecek.
      // Şimdilik sadece butonun göründüğünü ve tıklanabildiğini doğruluyoruz.
      console.log("[Kitap Ayıklayıcı] Buton tıklandı — mantık henüz eklenmedi (Adım 2).");
    }
  });
}