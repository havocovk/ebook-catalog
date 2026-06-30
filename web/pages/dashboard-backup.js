// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD-BACKUP — Tam Yedekleme paneli (Adım 5).
//
// AMAÇ: Scanner CLI'daki --backup-full / --restore-backup özelliklerinin
// web sitesi karşılığı. Veritabanı kayıtları + kapak resimlerini TEK bir
// .tar.gz dosyasında indirir/yükler — scanner ile birebir uyumlu format
// (bkz. core/tar-gzip.js'deki Python↔JS uyumluluk testleri).
//
// ESKİ "Yedekle/Yükle" sistemi (sadece JSON, kapaksız) TAMAMEN KALDIRILDI —
// bu modül onun yerini alır. Dashboard'da "Tam Yedekleme" kartı olarak durur.
//
// KRİTİK NOT — Storage yazma throttle'ı (appwrite.js, Adım 32):
// storage.createFile çağrıları bilinçli olarak 1.1 saniyede bir sıraya
// alınıyor (rate-limit koruması). Bu yüzden kapak YÜKLEME (restore) işlemi
// kitap sayısı kadar saniye sürer (örn. 209 kapak ≈ 4 dakika) — kapak
// İNDİRME (backup) ise sadece okuma (fetch ile cover_url'den) olduğu için
// throttle'a tabi değildir, çok daha hızlıdır.
// ─────────────────────────────────────────────────────────────────────────────

import { databases, storage, DATABASE_ID, TABLE_ID, BUCKET_ID } from "../appwrite.js";
import { state } from "../core/state.js";
import {
  fetchAllBooks,
  createBookRecord,
  updateBookRecord,
  stripSystemFields,
  extractCoverFileId,
  loadBooks,
} from "../core/api.js";
import { refreshCurrentPage } from "../core/router.js";
import { showToast, today } from "../ui/common.js";
import { _showConfirm } from "../ui/modal.js";
import { buildTarGz, extractTarGz } from "../core/tar-gzip.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ─── İlerleme metnini güncelle ───────────────────────────────────────────────
function _setProgress(text) {
  const el = document.getElementById("full-backup-progress");
  if (el) {
    el.textContent = text;
    el.classList.remove("hidden");
  }
}

function _clearProgress() {
  const el = document.getElementById("full-backup-progress");
  if (el) el.classList.add("hidden");
}

// ═══════════════════════════════════════════════════════════════════════════
// İNDİRME (backup) — veritabanı + kapakları .tar.gz olarak indir
// ═══════════════════════════════════════════════════════════════════════════
async function downloadFullBackup() {
  const btn = document.getElementById("full-backup-download-btn");
  if (btn) btn.disabled = true;

  try {
    _setProgress("Kitap kayıtları çekiliyor...");
    const books = await fetchAllBooks();

    const booksWithCover = books.filter((b) => b.cover_url);
    const total = booksWithCover.length;

    const files = [
      { name: "books.json", data: encoder.encode(JSON.stringify(books, null, 2)) },
    ];

    // ── Kapakları paralel indir ───────────────────────────────────────────
    // cover_url zaten herkese açık görüntüleme adresi (/view) — Storage
    // SDK'sının throttle'lı createFile/deleteFile'ından FARKLI olarak bu
    // sadece bir GET isteği (fetch), throttle kuyruğuna hiç girmez.
    // Bu yüzden Promise.all ile gerçekten paralel/hızlı çalışır.
    let done = 0;
    _setProgress(`Kapak resimleri indiriliyor... 0/${total}`);

    const coverResults = await Promise.allSettled(
      booksWithCover.map(async (book) => {
        const fileId = extractCoverFileId(book.cover_url) || book.$id;
        const resp = await fetch(book.cover_url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        done++;
        if (done % 10 === 0 || done === total) {
          _setProgress(`Kapak resimleri indiriliyor... ${done}/${total}`);
        }
        return { name: `covers/${fileId}.jpg`, data: buf };
      })
    );

    let coverErrorCount = 0;
    for (const res of coverResults) {
      if (res.status === "fulfilled") {
        files.push(res.value);
      } else {
        coverErrorCount++;
        console.warn("[Tam Yedekleme] Kapak indirilemedi:", res.reason);
      }
    }

    _setProgress("TAR.GZ dosyası oluşturuluyor...");
    const blob = await buildTarGz(files);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ebook-catalog-full-backup-${today()}.tar.gz`;
    a.click();
    URL.revokeObjectURL(url);

    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    showToast(
      `Tam yedek indirildi: ${books.length} kitap, ${total - coverErrorCount} kapak (${sizeMb} MB).` +
      (coverErrorCount > 0 ? ` ${coverErrorCount} kapak indirilemedi.` : "")
    );
  } catch (err) {
    showToast("Yedekleme hatası: " + (err?.message || err), "error");
  } finally {
    _clearProgress();
    if (btn) btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// YÜKLEME (restore) — .tar.gz dosyasından veritabanı + kapakları geri yükle
// ═══════════════════════════════════════════════════════════════════════════
async function uploadFullBackup(file) {
  if (!file) return;

  const confirmed = await _showConfirm(
    "Tam yedekten geri yükleme, kayıtları ve kapak resimlerini mevcut katalogla birleştirir. Devam?"
  );
  if (!confirmed) return;

  const btn = document.getElementById("full-backup-upload-btn");
  if (btn) btn.disabled = true;

  try {
    _setProgress("TAR.GZ dosyası okunuyor...");
    const arrayBuffer = await file.arrayBuffer();
    const extracted = await extractTarGz(arrayBuffer);

    const booksEntry = extracted.find((f) => f.name === "books.json");
    if (!booksEntry) throw new Error("Bu dosyada books.json bulunamadı — geçerli bir tam yedek mi?");

    const books = JSON.parse(decoder.decode(booksEntry.data));
    if (!Array.isArray(books)) throw new Error("Geçersiz yedek dosyası (books.json bir dizi değil).");

    const coverFiles = extracted.filter((f) => f.name.startsWith("covers/"));
    const coverByFileId = new Map();
    for (const cf of coverFiles) {
      const fileId = cf.name.replace(/^covers\//, "").replace(/\.jpg$/, "");
      coverByFileId.set(fileId, cf.data);
    }

    // ── 1) Kitap kayıtlarını paralel yükle (mevcut CHUNK_SIZE=10 deseni) ───
    let bookOk = 0;
    let bookFail = 0;
    const CHUNK_SIZE = 10;

    for (let i = 0; i < books.length; i += CHUNK_SIZE) {
      const chunk = books.slice(i, i + CHUNK_SIZE);

      const results = await Promise.allSettled(
        chunk.map(async (book) => {
          const docId = book.$id || null;
          const data = stripSystemFields(book);
          try {
            await createBookRecord(docId, data);
          } catch (err) {
            if (err?.code === 409 && docId) {
              await updateBookRecord(docId, data);
            } else {
              throw err;
            }
          }
        })
      );

      for (const r of results) (r.status === "fulfilled" ? bookOk++ : bookFail++);

      const processed = Math.min(i + CHUNK_SIZE, books.length);
      _setProgress(`Kitap kayıtları yükleniyor... ${processed}/${books.length}`);
    }

    // ── 2) Kapak resimlerini yükle ──────────────────────────────────────────
    // ÖNEMLİ: storage.createFile, appwrite.js'de THROTTLE'LI (Adım 32) —
    // her çağrı arasında en az 1.1 saniye bekleniyor (rate-limit koruması).
    // Bu yüzden burada Promise.all ile "paralel" göndersek bile gerçek
    // network trafiği throttle kuyruğu yüzünden SIRALI olacaktır. Kodu buna
    // göre yazıyoruz: paralel BAŞLATMAK yerine sırayla await ediyoruz, çünkü
    // throttle zaten paralelliği iptal ediyor — sırayla yazmak hem daha
    // okunaklı hem de aynı gerçek hızda çalışır.
    let coverOk = 0;
    let coverFail = 0;
    const coverEntries = [...coverByFileId.entries()];

    for (let i = 0; i < coverEntries.length; i++) {
      const [fileId, data] = coverEntries[i];
      try {
        // Varsa eski dosyayı temizle (uploader.py / uploadBookCover ile
        // tutarlı "üzerine yaz" davranışı).
        try {
          await storage.deleteFile(BUCKET_ID, fileId);
        } catch (_) {
          // dosya zaten yoktu — sorun değil
        }
        const blob = new Blob([data], { type: "image/jpeg" });
        const renamedFile = new File([blob], `${fileId}.jpg`, { type: "image/jpeg" });
        await storage.createFile(BUCKET_ID, fileId, renamedFile);
        coverOk++;
      } catch (err) {
        coverFail++;
        console.warn(`[Tam Yedekleme] Kapak yüklenemedi (${fileId}):`, err?.message || err);
      }

      _setProgress(`Kapak resimleri yükleniyor (yavaş, korumalı)... ${i + 1}/${coverEntries.length}`);
    }

    showToast(
      `Geri yükleme tamamlandı: ${bookOk} kitap${bookFail ? `, ${bookFail} başarısız` : ""} — ` +
      `${coverOk} kapak${coverFail ? `, ${coverFail} başarısız` : ""}.`
    );

    await loadBooks();
    refreshCurrentPage();
  } catch (err) {
    showToast("Geri yükleme hatası: " + (err?.message || err), "error");
  } finally {
    _clearProgress();
    if (btn) btn.disabled = false;
  }
}

// ─── Dashboard'daki butonları bağla ──────────────────────────────────────────
// dashboard.js'in renderLayout() fonksiyonu her çizimde bu HTML'i yeniden
// oluşturduğu için (bkz. dashboard.js Adım J9 — yeniden çizim önleme), olay
// dinleyicileri her render sonrası YENİDEN bağlanmalıdır. dashboard.js
// kendi bindRecentClicks() fonksiyonundan bu fonksiyonu çağırır.
export function bindFullBackupPanel() {
  const downloadBtn = document.getElementById("full-backup-download-btn");
  const uploadBtn = document.getElementById("full-backup-upload-btn");
  const uploadInput = document.getElementById("full-backup-upload-input");

  downloadBtn?.addEventListener("click", downloadFullBackup);
  uploadBtn?.addEventListener("click", () => uploadInput?.click());
  uploadInput?.addEventListener("change", (e) => {
    uploadFullBackup(e.target.files[0]);
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
  });
}