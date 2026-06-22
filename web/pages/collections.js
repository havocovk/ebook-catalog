// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS — Koleksiyonlar sayfası (Adım 19).
//
// Kullanıcı tanımlı, serbest gruplamalar (örn. "Tango", "CFD", "Tarih").
// Etiketten farkı: etiket bir niteliği tanımlar, koleksiyon ise kullanıcının
// kendi kurduğu bir "raf"tır. Mimari olarak series.js'in kalıbını izler
// (liste + detay görünümü), AMA Seriler'in aksine bir yayınevine BAĞLI
// değildir — daha basit, Yazarlar'a daha yakın bir ilişki, sadece ÇOKLU:
// bir kitap birden fazla koleksiyona ait olabilir (book.collections bir dizi).
//
// activeCollection: string | null — hangi koleksiyon detayda gösteriliyor.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { createBookCard } from "../ui/components.js";
import { openModal, _showPrompt, _showConfirm } from "../ui/modal.js";
import { escapeHtmlBasic as esc, escapeAttr as escAttr, showToast } from "../ui/common.js";
import {
  createCollection,
  renameCollectionEverywhere,
  deleteCollectionEverywhere,
} from "../core/api.js";

const POPULAR_COUNT = 6;

// Şu an detayda gösterilen koleksiyon adı. Liste görünümünde null.
let activeCollection = null;

// ─── Dışa açık: router her ziyarette çağırır ────────────────────────────────
export function renderCollections() {
  if (activeCollection) {
    renderCollectionDetail(activeCollection);
  } else {
    renderCollectionList();
  }
}

// ═══════════════════════════════════════════════════════════════
// KOLEKSİYON LİSTESİ
// ═══════════════════════════════════════════════════════════════

function renderCollectionList() {
  const container = document.getElementById("collections-content");
  if (!container) return;

  const data = buildCollectionData();

  if (data.length === 0) {
    container.innerHTML = `
      <div class="empty-page-state">
        <iconify-icon icon="lucide:folder-heart"></iconify-icon>
        <p>Henüz hiç koleksiyon yok.</p>
        <p class="empty-page-hint">Bir kitabın detayında "Koleksiyonlar" alanına isim yazarak ilk koleksiyonu oluşturabilirsin.</p>
      </div>`;
    return;
  }

  // Popüler Koleksiyonlar: kitap sayısına göre azalan.
  const popular = [...data].sort((a, b) => b.total - a.total).slice(0, POPULAR_COUNT);

  // Tam liste: alfabetik.
  const allSorted = [...data].sort((a, b) =>
    a.name.localeCompare(b.name, "tr", { sensitivity: "base" })
  );

  container.innerHTML = `
    <div class="collection-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:flame"></iconify-icon> Popüler Koleksiyonlar
      </h2>
      <div class="collection-popular-grid">
        ${popular.map((c) => popularCardHtml(c)).join("")}
      </div>
    </div>

    <div class="collection-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:folder-heart"></iconify-icon>
        Tüm Koleksiyonlar
        <span class="detail-sub-count">${data.length} koleksiyon</span>
      </h2>
      <div class="collection-list" id="collection-list">
        ${allSorted.map((c) => collectionRowHtml(c)).join("")}
      </div>
    </div>
  `;
}

// ─── Koleksiyon verilerini kitaplardan grupla ───────────────────────────────
// Yazarlar/Yayınevleri'nden farkı: tekil alan değil, dizi taranır — bir
// kitap aynı anda birden fazla koleksiyonun "total" sayacına katkıda bulunur.
function buildCollectionData() {
  const map = {};

  for (const book of state.books) {
    for (const rawName of book.collections || []) {
      const name = (rawName || "").trim();
      if (!name) continue;

      if (!map[name]) {
        map[name] = { name, total: 0, read: 0, books: [] };
      }
      map[name].total++;
      map[name].books.push(book);
      if (book.status === "okundu") map[name].read++;
    }
  }

  return Object.values(map);
}

// ─── Popüler koleksiyon kartı ────────────────────────────────────────────────
function popularCardHtml(c) {
  const pct = c.total > 0 ? Math.round((c.read / c.total) * 100) : 0;
  return `
    <div class="collection-popular-card" data-collection="${escAttr(c.name)}">
      <div class="collection-popular-name">${esc(c.name)}</div>
      <div class="collection-popular-stats">
        <span>${c.total} kitap</span>
        <span class="collection-read-label">${c.read} okundu</span>
      </div>
      <div class="collection-progress-track">
        <div class="collection-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

// ─── Koleksiyon listesi satırı ────────────────────────────────────────────────
// Yazarlar/Yayınevleri'ndeki gibi düzenle/sil butonları içerir — koleksiyon
// adı tıklanırsa detaya gider, kalem/çöp simgesine tıklanırsa yeniden
// adlandırma/silme akışı başlar (event delegation'da ayrıca yakalanır).
function collectionRowHtml(c) {
  const pct = c.total > 0 ? Math.round((c.read / c.total) * 100) : 0;
  return `
    <div class="collection-row" data-collection="${escAttr(c.name)}">
      <div class="collection-row-main">
        <span class="collection-row-name">${esc(c.name)}</span>
      </div>
      <div class="collection-row-right">
        <span class="collection-row-count">${c.read}/${c.total}</span>
        <div class="collection-progress-track collection-progress-track--sm">
          <div class="collection-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <button class="collection-row-edit" data-collection-edit="${escAttr(c.name)}" title="Yeniden adlandır">
        <iconify-icon icon="lucide:pencil"></iconify-icon>
      </button>
      <button class="collection-row-delete" data-collection-delete="${escAttr(c.name)}" title="Sil">
        <iconify-icon icon="lucide:trash-2"></iconify-icon>
      </button>
      <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// KOLEKSİYON DETAY GÖRÜNÜMÜ
// ═══════════════════════════════════════════════════════════════

function renderCollectionDetail(name) {
  const container = document.getElementById("collections-content");
  if (!container) return;

  const books = state.books
    .filter((b) => (b.collections || []).includes(name))
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" }));

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="collection-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Koleksiyonlara Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(name)}</h2>
        <span class="detail-subtitle">${books.length} kitap</span>
      </div>
    </div>
    <div class="books-grid collection-books-grid" id="collection-books-grid"></div>
  `;

  const grid = document.getElementById("collection-books-grid");
  if (grid && books.length > 0) {
    const fragment = document.createDocumentFragment();
    books.forEach((b) => fragment.appendChild(createBookCard(b)));
    grid.appendChild(fragment);
  } else if (grid) {
    grid.innerHTML = `<div class="empty-state">Bu koleksiyonda kitap bulunamadı.</div>`;
  }

  document.getElementById("collection-back-btn")?.addEventListener("click", () => {
    activeCollection = null;
    renderCollectionList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════════════════════════
// YENİDEN ADLANDIRMA / SİLME (Yazarlar/Yayınevleri'ndeki desenle aynı,
// ama bu işlemler entity-picker.js'de değil — burada, liste satırındaki
// kalem/çöp simgeleriyle tetiklenir, çünkü Koleksiyonlar'ın kendi sayfası
// var, modal içinde bir "düzenle" dropdown'u yok).
// ═══════════════════════════════════════════════════════════════

// "state.collections içinde bu isim var mı" kontrolü + bulamazsa otomatik
// tamamlama. Bu gereklidir çünkü bootstrapCollections() ile loadBooks()
// auth.js'de PARALEL çalışıyor (Adım J2 performans optimizasyonu) — eğer
// bootstrapCollections, loadBooks tamamlanmadan state.books'u tararsa,
// henüz hiç kitap yoktur ve o anda kitaplara yazılmış olan koleksiyon
// adları (örn. modal'da az önce kaydedilen "Tango", "CFD") collections
// tablosuna eklenmeden atlanmış olabilir. createCollection() çağrısı bu
// durumu kendiliğinden onarır: isim zaten varsa onu döndürür, yoksa hemen
// oluşturur — kullanıcı "bulunamadı" hatasıyla karşılaşmaz.
async function findOrRepairCollection(name) {
  const existing = state.collections.find((c) => c.name === name);
  if (existing) return existing;
  return await createCollection(name);
}

async function handleRename(name) {
  let collection;
  try {
    collection = await findOrRepairCollection(name);
  } catch (err) {
    showToast("Koleksiyon bilgisi alınamadı: " + (err?.message || err), "error");
    return;
  }
  if (!collection) return; // createCollection boş/geçersiz isimde null döner

  const newName = await _showPrompt("Yeni koleksiyon adı:", name);
  if (!newName || newName === name) return;

  try {
    await renameCollectionEverywhere(collection.$id, name, newName);
    showToast(`"${name}" → "${newName}" olarak güncellendi.`);
    renderCollectionList();
  } catch {
    /* renameCollectionEverywhere kendi hata toast'ını zaten gösterdi */
  }
}

async function handleDelete(name) {
  let collection;
  try {
    collection = await findOrRepairCollection(name);
  } catch (err) {
    showToast("Koleksiyon bilgisi alınamadı: " + (err?.message || err), "error");
    return;
  }
  if (!collection) return;

  const confirmed = await _showConfirm(
    `"${name}" koleksiyonunu silmek istediğinize emin misiniz? Kitaplar silinmez, sadece bu koleksiyondan çıkarılır.`
  );
  if (!confirmed) return;

  try {
    await deleteCollectionEverywhere(collection.$id, name);
    showToast(`"${name}" koleksiyonu silindi.`);
    renderCollectionList();
  } catch {
    /* deleteCollectionEverywhere kendi hata toast'ını zaten gösterdi */
  }
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA (yalnızca bir kez)
// ═══════════════════════════════════════════════════════════════

export function initCollections() {
  document.getElementById("collections-content")?.addEventListener("click", (e) => {

    // Düzenle butonu → yeniden adlandırma akışı (satırın kendisine tıklamadan önce kontrol edilir).
    const editBtn = e.target.closest("[data-collection-edit]");
    if (editBtn) {
      handleRename(editBtn.dataset.collectionEdit);
      return;
    }

    // Sil butonu → silme akışı.
    const deleteBtn = e.target.closest("[data-collection-delete]");
    if (deleteBtn) {
      handleDelete(deleteBtn.dataset.collectionDelete);
      return;
    }

    // Popüler kart veya liste satırı → detay görünümüne geç.
    const collEl = e.target.closest("[data-collection]");
    if (collEl && collEl.dataset.collection) {
      activeCollection = collEl.dataset.collection;
      renderCollectionDetail(activeCollection);
      return;
    }

    // Detaydaki kitap kartı → pop-up aç.
    const bookCard = e.target.closest(".book-card");
    if (bookCard && bookCard.dataset.id) {
      openModal(bookCard.dataset.id);
      return;
    }
  });
}