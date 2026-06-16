// ─────────────────────────────────────────────────────────────────────────────
// ENTITY PICKER — Aranabilir açılır menü + ekle / düzenle / sil.
//
// Modal'daki Yazar (ve ileride Yayınevi, Seri) alanları için ortak bileşen.
// Bir metin kutusu yerine: seçili değeri gösteren bir tetikleyici, yanında
// 3 işlem butonu (ekle/düzenle/sil) ve açılınca aranabilir bir liste sunar.
//
// Seçilen değer gizli bir <input>'a yazılır; modal kaydederken oradan okunur.
// Böylece mevcut kaydetme mantığı değişmeden çalışır.
//
// Bu bileşen "akıllı" değildir: ne yükleneceğini, eklenince/silinince ne
// olacağını dışarıdan verilen fonksiyonlar (getItems, onAdd, onRename,
// onDelete) belirler. Veritabanı işleri çağıran tarafta (modal.js → api.js).
// ─────────────────────────────────────────────────────────────────────────────

// Küçük kaçış yardımcıları (HTML enjeksiyonunu önlemek için).
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ─── Bir picker'ı kur ───────────────────────────────────────────────────────
// prefix: HTML'deki id ön eki. Örn "author" →  author-trigger, author-dropdown,
//         author-search, author-options, author-add/edit/delete, modal-author.
//
// Dönen nesne: { setByName, getValue, refresh, setEnabled }
export function mountEntityPicker({
  prefix,
  emptyLabel = "— Yok —",
  placeholder = "Seç...",
  addPromptLabel = "Yeni ad:",
  editPromptLabel = "Yeni ad:",
  deleteConfirm = (name) => `"${name}" silinsin mi?`,
  getItems,                 // () => [{ $id, name }]
  onAdd,                    // async (name) => { $id, name }
  onRename,                 // async (id, oldName, newName) => void
  onDelete,                 // async (id, name) => void
  onChange,                 // (name) => void   (seçim/değişim sonrası)
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

  // ─── Seçili değeri ayarla (ad + id) ──────────────────────────────────────
  function setValue(name, id) {
    selectedName = name || "";
    selectedId   = id || null;
    hidden.value = selectedName;
    triggerTxt.textContent = selectedName || placeholder;
    triggerTxt.classList.toggle("placeholder", !selectedName);
    updateActionButtons();
  }

  // Sadece ada göre ayarla; id'yi listeden bul (modal açılırken kullanılır).
  function setByName(name) {
    const clean = (name || "").trim();
    const item = getItems().find((i) => i.name === clean);
    setValue(clean, item ? item.$id : null);
  }

  // Düzenle/Sil sadece listede kayıtlı (id'si olan) bir öğe seçiliyken çalışır.
  function updateActionButtons() {
    const hasSel = !!selectedId && enabled;
    editBtn.disabled = !hasSel;
    delBtn.disabled  = !hasSel;
    addBtn.disabled  = !enabled;
    trigger.disabled = !enabled;
  }

  // Tüm alanı aktif/pasif yap (Seri alanı: yayınevi seçilene kadar pasif).
  function setEnabled(on) {
    enabled = !!on;
    field.classList.toggle("entity-disabled", !enabled);
    updateActionButtons();
    if (!enabled) close();
  }

  // ─── Açılır listeyi çiz ───────────────────────────────────────────────────
  function renderOptions(filter) {
    const f = (filter || "").toLocaleLowerCase("tr");
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
  function close() { dropdown.classList.add("hidden"); }
  function isOpen() { return !dropdown.classList.contains("hidden"); }

  // ─── Olaylar ──────────────────────────────────────────────────────────────
  trigger.addEventListener("click", () => (isOpen() ? close() : open()));

  search.addEventListener("input", () => renderOptions(search.value));

  optionsEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".entity-option");
    if (!opt) return;
    setValue(opt.dataset.name, opt.dataset.id || null);
    onChange?.(selectedName);
    close();
  });

  addBtn.addEventListener("click", async () => {
    const name = window.prompt(addPromptLabel, "");
    if (!name || !name.trim()) return;
    try {
      const doc = await onAdd(name.trim());
      if (doc) {
        setValue(doc.name, doc.$id);
        onChange?.(doc.name);
      }
    } catch (err) {
      /* hata mesajı api katmanında gösteriliyor */
    }
  });

  editBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    const newName = window.prompt(editPromptLabel, selectedName);
    if (!newName || !newName.trim() || newName.trim() === selectedName) return;
    try {
      await onRename(selectedId, selectedName, newName.trim());
      setValue(newName.trim(), selectedId);
      onChange?.(selectedName);
    } catch (err) {
      /* hata mesajı api katmanında */
    }
  });

  delBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!window.confirm(deleteConfirm(selectedName))) return;
    try {
      await onDelete(selectedId, selectedName);
      setValue("", null);
      onChange?.("");
    } catch (err) {
      /* hata mesajı api katmanında */
    }
  });

  // Alan dışına tıklayınca açılır listeyi kapat.
  document.addEventListener("click", (e) => {
    if (field && !field.contains(e.target)) close();
  });

  // Başlangıç durumu.
  setValue("", null);

  return { setByName, getValue: () => selectedName, refresh: () => renderOptions(search.value || ""), setEnabled };
}