// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD-BACKUP — Tam Yedekleme / Geri Yükleme kartı (Adım 5).
//
// Dashboard'da "Tam Yedekleme" bölümünü çizer ve iki butonu yönetir:
//   • Yedek Al  → tüm tabloları + kapakları TAR.GZ olarak indir
//   • Geri Yükle → seçilen TAR.GZ'yi Appwrite'a yükle
//
// Tarayıcı tarafında TAR.GZ oluşturmak için CDN'den fflate kullanılır
// (fflate: ~50 KB, sıfır bağımlılık, async/stream desteği var).
//
// İLERLEME: Her adım tamamlandığında mevcut toast güncellenir — yeni toast
// açılmaz, tek bir toast "canlı" olarak adım adım ilerler.
// ─────────────────────────────────────────────────────────────────────────────

import {
  databases,
  storage,
  Query,
  ID,
  DATABASE_ID,
  TABLE_ID,
  BUCKET_ID,
  AUTHORS_ID,
  PUBLISHERS_ID,
  SERIES_ID,
  COLLECTIONS_ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
} from "../core/appwrite.js";
import { showToast } from "../ui/common.js";

// ─── CDN: fflate (TAR.GZ için) ───────────────────────────────────────────────
// fflate, tarayıcıda TAR.GZ oluşturmayı sağlar.
// Yalnızca backup/restore butonuna basılınca yüklenir (lazy).
let _fflate = null;
async function loadFflate() {
  if (_fflate) return _fflate;
  const mod = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
  _fflate = mod;
  return _fflate;
}

// ─── İkon sabitleri (Lucide — Iconify üzerinden) ─────────────────────────────
const ICON = {
  download:   "lucide:download",
  upload:     "lucide:upload",
  database:   "lucide:database",
  image:      "lucide:image",
  check:      "lucide:check-circle-2",
  alert:      "lucide:alert-circle",
  loader:     "lucide:loader",
};

// ─── Canlı toast yönetimi ─────────────────────────────────────────────────────
// Tek bir toast DOM elemanı tutulur; her adımda içeriği güncellenir.
let _liveToast = null;

function _createLiveToast(icon, message, type = "info") {
  // Önceki varsa kaldır
  if (_liveToast) {
    _liveToast.remove();
    _liveToast = null;
  }
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type} toast-live`;
  toast.innerHTML = `
    <iconify-icon icon="${icon}" style="vertical-align:middle;margin-right:6px"></iconify-icon>
    <span class="toast-live-msg">${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  _liveToast = toast;
}

function _updateLiveToast(icon, message, type) {
  if (!_liveToast) {
    _createLiveToast(icon, message, type);
    return;
  }
  if (type) _liveToast.className = `toast toast-${type} toast-live visible`;
  const msgEl = _liveToast.querySelector(".toast-live-msg");
  if (msgEl) msgEl.textContent = message;
  const iconEl = _liveToast.querySelector("iconify-icon");
  if (iconEl && icon) iconEl.setAttribute("icon", icon);
}

function _closeLiveToast(delay = 3000) {
  if (!_liveToast) return;
  const t = _liveToast;
  setTimeout(() => {
    t.classList.remove("visible");
    setTimeout(() => t.remove(), 300);
  }, delay);
  _liveToast = null;
}

// ─── Yardımcı: tüm kayıtları sayfa sayfa çek ────────────────────────────────
const PAGE_SIZE = 100;
async function _fetchAll(collectionId) {
  const all = [];
  let cursor = null;
  while (true) {
    const queries = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DATABASE_ID, collectionId, queries);
    all.push(...res.documents);
    if (res.documents.length < PAGE_SIZE) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return all;
}

// ─── Yardımcı: cover_url'den Storage file_id çıkar ──────────────────────────
const _FILE_ID_RE = /\/files\/([^/]+)\//;
function _extractFileId(coverUrl) {
  if (!coverUrl) return null;
  const m = _FILE_ID_RE.exec(coverUrl);
  return m ? m[1] : null;
}

// ─── Yardımcı: Appwrite Storage'dan resim indir (Blob olarak) ───────────────
async function _downloadCover(fileId) {
  const url = `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${fileId}/download`;
  const res = await fetch(url, {
    headers: {
      "X-Appwrite-Project": APPWRITE_PROJECT_ID,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.arrayBuffer();
}

// ─── Yardımcı: dosya adı üret ────────────────────────────────────────────────
function _backupFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `backup-full-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.tar.gz`
  );
}

// ─── Yardımcı: sistem alanlarını ayıkla ─────────────────────────────────────
const _SYSTEM = new Set(["$id","$createdAt","$updatedAt","$permissions","$databaseId","$collectionId"]);
function _stripSystem(doc) {
  return Object.fromEntries(Object.entries(doc).filter(([k]) => !_SYSTEM.has(k)));
}

// ═══════════════════════════════════════════════════════════════════════════
// YEDEK AL
// ═══════════════════════════════════════════════════════════════════════════
async function doBackup() {
  const fflate = await loadFflate();
  const btn = document.getElementById("backup-full-btn");
  if (btn) btn.disabled = true;

  const TABLES = [
    ["authors",     AUTHORS_ID],
    ["publishers",  PUBLISHERS_ID],
    ["series",      SERIES_ID],
    ["collections", COLLECTIONS_ID],
    ["books",       TABLE_ID],
  ];

  try {
    _createLiveToast(ICON.loader, "Yedekleme başlıyor...", "info");

    // ── Tabloları indir ──────────────────────────────────────────────────
    const tableData = {};
    for (let i = 0; i < TABLES.length; i++) {
      const [name, colId] = TABLES[i];
      _updateLiveToast(ICON.database, `[${i+1}/6] ${name} indiriliyor...`);
      tableData[name] = await _fetchAll(colId);
    }

    // ── Kapakları indir ──────────────────────────────────────────────────
    const booksWithCover = tableData.books.filter((b) => b.cover_url);
    const covers = {}; // { bookId: ArrayBuffer }
    let coverOk = 0;
    let coverFail = 0;

    for (let i = 0; i < booksWithCover.length; i++) {
      const book = booksWithCover[i];
      const fileId = _extractFileId(book.cover_url);
      _updateLiveToast(ICON.image, `[6/6] Kapaklar indiriliyor: ${i+1}/${booksWithCover.length}`);
      try {
        covers[book.$id] = new Uint8Array(await _downloadCover(fileId));
        coverOk++;
      } catch {
        coverFail++;
      }
    }

    // ── TAR.GZ oluştur ───────────────────────────────────────────────────
    _updateLiveToast(ICON.loader, "Arşiv oluşturuluyor...");

    const tarFiles = {};

    // JSON dosyaları
    for (const [name, docs] of Object.entries(tableData)) {
      const enc = new TextEncoder().encode(JSON.stringify(docs, null, 2));
      tarFiles[`${name}.json`] = enc;
    }

    // Kapak resimleri
    for (const [bookId, data] of Object.entries(covers)) {
      tarFiles[`covers/${bookId}.jpg`] = data;
    }

    // fflate ile sıkıştır
    const tgz = await new Promise((resolve, reject) => {
      fflate.tgz(tarFiles, {}, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    // ── İndir ────────────────────────────────────────────────────────────
    const blob = new Blob([tgz], { type: "application/gzip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = _backupFilename();
    a.click();
    URL.revokeObjectURL(url);

    const failNote = coverFail > 0 ? `, ${coverFail} kapak başarısız` : "";
    _updateLiveToast(ICON.check, `Yedekleme tamamlandı! (${coverOk} kapak${failNote})`, "success");
    _closeLiveToast(4000);

  } catch (err) {
    _updateLiveToast(ICON.alert, "Yedekleme hatası: " + (err?.message || err), "error");
    _closeLiveToast(5000);
    console.error("[Backup]", err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GERİ YÜKLE
// ═══════════════════════════════════════════════════════════════════════════
async function doRestore(file) {
  if (!file) return;
  const fflate = await loadFflate();
  const btn = document.getElementById("restore-full-btn");
  if (btn) btn.disabled = true;

  const TABLES = [
    ["authors",     AUTHORS_ID],
    ["publishers",  PUBLISHERS_ID],
    ["series",      SERIES_ID],
    ["collections", COLLECTIONS_ID],
    ["books",       TABLE_ID],
  ];

  try {
    _createLiveToast(ICON.loader, "Arşiv açılıyor...", "info");

    // ── TAR.GZ oku ───────────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const tarFiles = await new Promise((resolve, reject) => {
      fflate.decompress(uint8, (err, data) => {
        if (err) reject(err);
        else {
          // data: Uint8Array (tar içeriği, sıkıştırması açılmış)
          // fflate.untar ile dosyaları ayır
          try {
            resolve(fflate.untar ? fflate.untar(data) : _manualUntar(data));
          } catch(e) {
            reject(e);
          }
        }
      });
    });

    // ── Tabloları yükle ──────────────────────────────────────────────────
    for (let i = 0; i < TABLES.length; i++) {
      const [name, colId] = TABLES[i];
      const fileEntry = tarFiles[`${name}.json`];
      if (!fileEntry) continue;

      const docs = JSON.parse(new TextDecoder().decode(fileEntry));
      _updateLiveToast(ICON.database, `[${i+1}/6] ${name} yükleniyor... (${docs.length} kayıt)`);

      let ok = 0;
      for (const doc of docs) {
        const docId = doc.$id;
        const data  = _stripSystem(doc);
        try {
          await databases.createDocument(DATABASE_ID, colId, docId, data);
        } catch (e) {
          if (e?.code === 409) {
            await databases.updateDocument(DATABASE_ID, colId, docId, data);
          }
        }
        ok++;
      }
      _updateLiveToast(ICON.database, `[${i+1}/6] ${name}: ${ok} kayıt yüklendi.`);
    }

    // ── Covers bucket temizle ────────────────────────────────────────────
    _updateLiveToast(ICON.loader, "Eski kapaklar temizleniyor...");
    let deleted = 0;
    let storageCursor = null;
    while (true) {
      const queries = [Query.limit(100)];
      if (storageCursor) queries.push(Query.cursorAfter(storageCursor));
      const res = await storage.listFiles(BUCKET_ID, queries);
      if (!res.files.length) break;
      for (const f of res.files) {
        try { await storage.deleteFile(BUCKET_ID, f.$id); deleted++; } catch {}
      }
      if (res.files.length < 100) break;
      storageCursor = res.files[res.files.length - 1].$id;
    }
    _updateLiveToast(ICON.loader, `${deleted} eski kapak silindi. Yeni kapaklar yükleniyor...`);

    // ── Kapakları yükle ──────────────────────────────────────────────────
    const coverEntries = Object.entries(tarFiles).filter(([k]) => k.startsWith("covers/"));
    let coverOk = 0;
    let coverFail = 0;

    for (let i = 0; i < coverEntries.length; i++) {
      const [path, data] = coverEntries[i];
      const bookId = path.replace("covers/", "").replace(".jpg", "");
      _updateLiveToast(ICON.image, `[6/6] Kapaklar yükleniyor: ${i+1}/${coverEntries.length}`);

      try {
        const blob = new Blob([data], { type: "image/jpeg" });
        const f = new File([blob], `${bookId}.jpg`, { type: "image/jpeg" });
        await storage.createFile(BUCKET_ID, bookId, f);

        // cover_url güncelle
        const newUrl = `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${bookId}/view?project=${APPWRITE_PROJECT_ID}`;
        await databases.updateDocument(DATABASE_ID, TABLE_ID, bookId, { cover_url: newUrl });
        coverOk++;
      } catch {
        coverFail++;
      }
    }

    const failNote = coverFail > 0 ? `, ${coverFail} başarısız` : "";
    _updateLiveToast(ICON.check, `Geri yükleme tamamlandı! (${coverOk} kapak${failNote})`, "success");
    _closeLiveToast(5000);

  } catch (err) {
    _updateLiveToast(ICON.alert, "Geri yükleme hatası: " + (err?.message || err), "error");
    _closeLiveToast(5000);
    console.error("[Restore]", err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── TAR manuel parser (fflate.untar yoksa fallback) ─────────────────────────
function _manualUntar(buffer) {
  const files = {};
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.slice(offset, offset + 512);
    const name = new TextDecoder().decode(header.slice(0, 100)).replace(/\0/g, "").trim();
    if (!name) break;
    const sizeOctal = new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    offset += 512;
    if (size > 0) {
      files[name] = buffer.slice(offset, offset + size);
      offset += Math.ceil(size / 512) * 512;
    }
  }
  return files;
}

// ─── Dashboard HTML bölümü ───────────────────────────────────────────────────
export function renderBackupSection() {
  return `
    <div class="dash-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:archive"></iconify-icon> Tam Yedekleme
      </h2>
      <div class="db-maintenance-box">
        <p class="db-maintenance-desc">
          Tüm tabloları (kitaplar, yazarlar, yayınevleri, seriler, koleksiyonlar)
          ve kapak resimlerini tek bir TAR.GZ arşivine yedekler veya geri yükler.
        </p>
        <div class="backup-actions">
          <button id="backup-full-btn" class="btn btn-sm">
            <iconify-icon icon="lucide:download"></iconify-icon>
            <span class="btn-label">Yedek Al</span>
          </button>
          <button id="restore-full-btn" class="btn btn-sm">
            <iconify-icon icon="lucide:upload"></iconify-icon>
            <span class="btn-label">Geri Yükle</span>
          </button>
          <input type="file" id="restore-full-input" accept=".tar.gz,.gz" hidden />
        </div>
      </div>
    </div>
  `;
}

// ─── Olay bağlayıcı — dashboard render edildikten sonra çağrılır ─────────────
export function bindBackupSection() {
  document.getElementById("backup-full-btn")?.addEventListener("click", doBackup);

  const restoreBtn   = document.getElementById("restore-full-btn");
  const restoreInput = document.getElementById("restore-full-input");

  restoreBtn?.addEventListener("click", () => restoreInput?.click());
  restoreInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) doRestore(file);
    e.target.value = "";
  });
}