// ─────────────────────────────────────────────────────────────────────────────
// MODAL-DIALOG — Tema uyumlu custom dialog fonksiyonları.
//
// Tarayıcının varsayılan confirm() / prompt() / alert() kutuları yerine
// index.html'deki #custom-dialog-overlay kullanılır.
//
// Export edilen fonksiyonlar:
//   _showConfirm(message)              → Promise<boolean>
//   _showPrompt(message, defaultValue) → Promise<string|null>
//   _showInfo(message)                 → Promise<void>
//
// Bu modülün bağımlılığı yoktur — state, api veya DOM dışında hiçbir şeyi
// import etmez. Bu sayede modal-core.js, catalog-bulk.js ve catalog-smart-lists.js
// bu fonksiyonları doğrudan buradan alabilir.
// ─────────────────────────────────────────────────────────────────────────────

// ── Adım J5: Custom dialog ile onay ─────────────────────────────────────────
// Tarayıcının varsayılan confirm() kutusu yerine index.html'deki
// #custom-dialog-overlay kullanılır. Böylece silme onayı da tema uyumlu olur.
export function _showConfirm(message) {
  return new Promise((resolve) => {
    const overlay   = document.getElementById("custom-dialog-overlay");
    const msgEl     = document.getElementById("custom-dialog-message");
    const inputEl   = document.getElementById("custom-dialog-input");
    const okBtn     = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog yoksa tarayıcının confirm'ini kullan
      resolve(confirm(message));
      return;
    }

    msgEl.textContent = message;
    inputEl?.classList.add("hidden");   // Input alanı gizli (sadece onay istiyoruz)
    overlay.classList.remove("hidden");

    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }

    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener("click", onOk,     { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
  });
}

// ── Adım 15: window.prompt() yerine tema uyumlu özel dialog ─────────────────
// _showConfirm ile birebir aynı overlay/buton altyapısını kullanır, farkı:
// input alanını GÖRÜNÜR yapar, OK'a basınca input'un (trim edilmiş) değerini
// döndürür. Kullanıcı İptal'e basarsa veya Escape/overlay'e tıklarsa null
// döner — çağıran taraf (catalog.js) bunu "kullanıcı iptal etti" olarak
// yorumlar. defaultValue verilirse input o değerle önceden doldurulur
// (örn. "yeniden adlandır" senaryolarında kullanışlı).
export function _showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay   = document.getElementById("custom-dialog-overlay");
    const msgEl     = document.getElementById("custom-dialog-message");
    const inputEl   = document.getElementById("custom-dialog-input");
    const okBtn     = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !inputEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog DOM'da yoksa tarayıcının prompt'unu kullan
      const result = prompt(message, defaultValue);
      resolve(result ? result.trim() : null);
      return;
    }

    msgEl.textContent = message;
    inputEl.value = defaultValue;
    inputEl.classList.remove("hidden");
    overlay.classList.remove("hidden");

    // Modal açılınca input'a otomatik odaklan, kullanıcı direkt yazmaya başlasın.
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 0);

    function cleanup(result) {
      overlay.classList.add("hidden");
      inputEl.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKeydown);
      resolve(result);
    }

    const onOk = () => {
      const val = inputEl.value.trim();
      cleanup(val ? val : null);
    };
    const onCancel = () => cleanup(null);

    // Enter → OK ile aynı, Escape → İptal ile aynı (kullanıcı deneyimi için).
    const onKeydown = (e) => {
      if (e.key === "Enter")  { e.preventDefault(); onOk(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };

    okBtn.addEventListener("click", onOk,     { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
    inputEl.addEventListener("keydown", onKeydown);
  });
}

// ── Adım 15: alert() yerine tema uyumlu tek-butonlu bilgi mesajı ─────────────
// _showConfirm ile aynı altyapı, farkı: İptal butonu tamamen gizlenir, sadece
// "Tamam" görünür. Limit dolduğunda veya isim çakışmasında kullanılır —
// kullanıcının "iptal" seçeneğine ihtiyacı yok, sadece bilgiyi onaylıyor.
export function _showInfo(message) {
  return new Promise((resolve) => {
    const overlay   = document.getElementById("custom-dialog-overlay");
    const msgEl     = document.getElementById("custom-dialog-message");
    const inputEl   = document.getElementById("custom-dialog-input");
    const okBtn     = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      // Fallback: custom dialog yoksa tarayıcının alert'ini kullan
      alert(message);
      resolve();
      return;
    }

    msgEl.textContent = message;
    inputEl?.classList.add("hidden");
    cancelBtn.classList.add("hidden");   // sadece "Tamam" görünsün
    overlay.classList.remove("hidden");

    function cleanup() {
      overlay.classList.add("hidden");
      cancelBtn.classList.remove("hidden");   // diğer dialoglar için geri aç
      okBtn.removeEventListener("click", onOk);
      resolve();
    }

    const onOk = () => cleanup();
    okBtn.addEventListener("click", onOk, { once: true });
  });
}