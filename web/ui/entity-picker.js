// ─────────────────────────────────────────────────────────────────────────────
// ENTITY PICKER — Aranabilir açılır menü + ekle / düzenle / sil.
//
// window.prompt() ve window.confirm() yerine sitenin temasına uygun
// custom dialog kullanır (index.html'deki #custom-dialog-overlay).
// ─────────────────────────────────────────────────────────────────────────────

// ─── Kaçış yardımcıları ─────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM DIALOG — tek bir overlay, iki mod:
//   • "prompt"  : mesaj + metin kutusu + İptal/Tamam
//   • "confirm" : mesaj + İptal/Tamam (metin kutusu gizli)
//
// Her çağrı bir Promise döndürür.
//   prompt  → string | null   (İptal veya boş → null)
//   confirm → boolean
// ═══════════════════════════════════════════════════════════════════════════

let _dialogResolve = null;   // aktif dialog'un resolve fonksiyonu

function _getDialogEls() {
  return {
    overlay  : document.getElementById("custom-dialog-overlay"),
    message  : document.getElementById("custom-dialog-message"),
    input    : document.getElementById("custom-dialog-input"),
    okBtn    : document.getElementById("custom-dialog-ok"),
    cancelBtn: document.getElementById("custom-dialog-cancel"),
  };
}

// Dialog'u kapat ve bekleyen promise'i çöz.
function _closeDialog(value) {
  const { overlay, input } = _getDialogEls();
  overlay.classList.add("hidden");
  input.classList.add("hidden");
  if (_dialogResolve) { _dialogResolve(value); _dialogResolve = null; }
}

// İlk çağrıda olay dinleyicileri bağla (tekrar bağlanmayı önle).
let _dialogInited = false;
function _initDialog() {
  if (_dialogInited) return;
  _dialogInited = true;

  const { okBtn, cancelBtn, input } = _getDialogEls();

  okBtn.addEventListener("click", () => {
    const val = input.classList.contains("hidden") ? true : input.value.trim();
    _closeDialog(val || (input.classList.contains("hidden") ? true : null));
  });

  cancelBtn.addEventListener("click", () => {
    _closeDialog(input.classList.contains("hidden") ? false : null);
  });

  // Enter → Tamam, Escape → İptal
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); okBtn.click(); }
    if (e.key === "Escape") { e.preventDefault(); cancelBtn.click(); }
  });

  document.addEventListener("keydown", (e) => {
    const { overlay } = _getDialogEls();
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      cancelBtn.click();
    }
  });
}

// Metin kutusu gösteren dialog.
function showPrompt(message, defaultValue = "") {
  _initDialog();
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    const { overlay, message: msgEl, input } = _getDialogEls();
    msgEl.textContent = message;
    input.value = defaultValue;
    input.classList.remove("hidden");
    overlay.classList.remove("hidden");
    // Kısa gecikme: overlay render olduktan sonra focus
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

// Yalnızca onay isteyen dialog.
function showConfirm(message) {
  _initDialog();
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    const { overlay, message: msgEl, input } = _getDialogEls();
    msgEl.textContent = message;
    input.classList.add("hidden");
    overlay.classList.remove("hidden");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY PICKER
// ═══════════════════════════════════════════════════════════════════════════

export function mountEntityPicker({
  prefix,
  emptyLabel     = "— Yok —",
  placeholder    = "Seç...",
  addPromptLabel = "Yeni ad:",
  editPromptLabel= "Yeni ad:",
  deleteConfirm  = (name) => `"${name}" silinsin mi?`,
  getItems,
  onAdd,
  onRename,
  onDelete,
  onChange,
}) {
  const field      = document.getElementById(`${prefix}-field`);
  const trigger    = document.getElementById(`${prefix}-trigger`);
  const triggerTxt = trigger.querySelector(".entity-trigger-text");
  const dropdown   = document.getElementById(`${prefix}-dropdown`);
  const search     = document.getElementById(`${prefix}-search`);
  const optionsEl  = document.getElementById(`${prefix}-options`);
  const hidden     = document.getElementById(`modal-${prefix}`);
  const addBtn     = document.getElementById(`${prefix}-add`);
  const editBtn    = document.getElementById(`${prefix}-edit`);
  const delBtn     = document.getElementById(`${prefix}-delete`);

  let selectedName = "";
  let selectedId   = null;
  let enabled      = true;

  // ─── Seçili değeri ayarla ────────────────────────────────────────────────
  function setValue(name, id) {
    selectedName = name || "";
    selectedId   = id   || null;
    hidden.value = selectedName;
    triggerTxt.textContent = selectedName || placeholder;
    triggerTxt.classList.toggle("placeholder", !selectedName);
    updateActionButtons();
  }

  function setByName(name) {
    const clean = (name || "").trim();
    const item  = getItems().find((i) => i.name === clean);
    setValue(clean, item ? item.$id : null);
  }

  function updateActionButtons() {
    const hasSel = !!selectedId && enabled;
    editBtn.disabled = !hasSel;
    delBtn.disabled  = !hasSel;
    addBtn.disabled  = !enabled;
    trigger.disabled = !enabled;
  }

  function setEnabled(on) {
    enabled = !!on;
    field.classList.toggle("entity-disabled", !enabled);
    updateActionButtons();
    if (!enabled) close();
  }

  // ─── Açılır liste ─────────────────────────────────────────────────────────
  function renderOptions(filter) {
    const f     = (filter || "").toLocaleLowerCase("tr");
    const items = [...getItems()]
      .filter((i) => (i.name || "").toLocaleLowerCase("tr").includes(f))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));

    let html = `<div class="entity-option entity-option-clear" data-id="" data-name="">${esc(emptyLabel)}</div>`;
    for (const i of items) {
      const sel = i.name === selectedName ? " selected" : "";
      html += `<div class="entity-option${sel}" data-id="${escAttr(i.$id)}" data-name="${escAttr(i.name)}">${esc(i.name)}</div>`;
    }
    if (items.length === 0) html += `<div class="entity-empty">Sonuç yok</div>`;
    optionsEl.innerHTML = html;
  }

  function open() {
    if (!enabled) return;
    search.value = "";
    renderOptions("");
    dropdown.classList.remove("hidden");
    search.focus();
  }
  function close()   { dropdown.classList.add("hidden"); }
  function isOpen()  { return !dropdown.classList.contains("hidden"); }

  // ─── Olaylar ──────────────────────────────────────────────────────────────
  trigger.addEventListener("click", () => (isOpen() ? close() : open()));
  search.addEventListener("input",  () => renderOptions(search.value));

  optionsEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".entity-option");
    if (!opt) return;
    setValue(opt.dataset.name, opt.dataset.id || null);
    onChange?.(selectedName);
    close();
  });

  // ─── Ekle ─────────────────────────────────────────────────────────────────
  addBtn.addEventListener("click", async () => {
    close(); // açık dropdown varsa kapat
    const name = await showPrompt(addPromptLabel, "");
    if (!name || !name.trim()) return;
    try {
      const doc = await onAdd(name.trim());
      if (doc) { setValue(doc.name, doc.$id); onChange?.(doc.name); }
    } catch { /* hata api katmanında */ }
  });

  // ─── Düzenle ──────────────────────────────────────────────────────────────
  editBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    close();
    const newName = await showPrompt(editPromptLabel, selectedName);
    if (!newName || !newName.trim() || newName.trim() === selectedName) return;
    try {
      await onRename(selectedId, selectedName, newName.trim());
      setValue(newName.trim(), selectedId);
      onChange?.(selectedName);
    } catch { /* hata api katmanında */ }
  });

  // ─── Sil ──────────────────────────────────────────────────────────────────
  delBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    close();
    const confirmed = await showConfirm(deleteConfirm(selectedName));
    if (!confirmed) return;
    try {
      await onDelete(selectedId, selectedName);
      setValue("", null);
      onChange?.("");
    } catch { /* hata api katmanında */ }
  });

  // Alan dışına tıklayınca kapat (overlay açıksa kapatma).
  document.addEventListener("click", (e) => {
    const overlay = document.getElementById("custom-dialog-overlay");
    if (overlay && !overlay.classList.contains("hidden")) return;
    if (field && !field.contains(e.target)) close();
  });

  setValue("", null);

  return {
    setByName,
    getValue : () => selectedName,
    refresh  : () => renderOptions(search.value || ""),
    setEnabled,
  };
}