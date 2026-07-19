// ─────────────────────────────────────────────────────────────────────────────
// SERIES — Seriler sayfası.
//
// Her seri (yayınevi + ad) çiftiyle tanımlanır. Aynı adlı iki seri farklı
// yayınevlerine aitse ayrı ayrı listelenir.
//
// activeSeries: { name, publisher } — hangi seri detayda gösteriliyor.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";
import { openModal } from "../ui/modal.js";
import { escapeHtmlBasic as esc, escapeAttr as escAttr, statusLabel as statusLabelLocal } from "../ui/common.js";

const POPULAR_COUNT = 6;

// Şu an detayda gösterilen seri. Liste görünümünde null.
// { name: string, publisher: string } formatında.
let activeSeries = null;

// YENİ: Seri detayında seçili format filtresi.
// "" = Tümü, "epub" = sadece EPUB, "pdf" = sadece PDF.
// Bir seriye girildiğinde her zaman "" (Tümü) ile başlar.
let activeFormatFilter = "";

// ─── Dışa açık ──────────────────────────────────────────────────────────────
export function renderSeries() {
  if (activeSeries) {
    renderSeriesDetail(activeSeries.name, activeSeries.publisher);
  } else {
    renderSeriesList();
  }
}

// ═══════════════════════════════════════════════════════════════
// SERİ LİSTESİ
// ═══════════════════════════════════════════════════════════════

function renderSeriesList() {
  const container = document.getElementById("series-content");
  if (!container) return;

  const seriesData = buildSeriesData();

  if (seriesData.length === 0) {
    container.innerHTML = `
      <div class="empty-page-state">
        <iconify-icon icon="lucide:layers"></iconify-icon>
        <p>Henüz seri bilgisi olan kitap yok.</p>
        <p class="empty-page-hint">Kitaplarda seri bilgisi varsa Google Books'tan çekilecektir.</p>
      </div>`;
    return;
  }

  // Popüler Seriler: kitap sayısına göre azalan.
  const popular = [...seriesData]
    .sort((a, b) => b.total - a.total)
    .slice(0, POPULAR_COUNT);

  // Tam liste: önce seri adına, sonra yayınevine göre alfabetik.
  const allSorted = [...seriesData].sort((a, b) => {
    const nameComp = a.name.localeCompare(b.name, "tr", { sensitivity: "base" });
    if (nameComp !== 0) return nameComp;
    return (a.publisher || "").localeCompare(b.publisher || "", "tr", { sensitivity: "base" });
  });

  container.innerHTML = `
    <div class="series-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:flame"></iconify-icon> Popüler Seriler
      </h2>
      <div class="series-popular-grid">
        ${popular.map((s) => popularCardHtml(s)).join("")}
      </div>
    </div>

    <div class="series-section">
      <h2 class="dash-section-title">
        <iconify-icon icon="lucide:layers"></iconify-icon>
        Tüm Seriler
        <span class="detail-sub-count">${seriesData.length} seri</span>
      </h2>
      <div class="series-list" id="series-list">
        ${allSorted.map((s) => seriesRowHtml(s)).join("")}
      </div>
    </div>
  `;
}

// ─── Seri verilerini (yayınevi + ad) çiftine göre grupla ────────────────────
function buildSeriesData() {
  // Anahtar: "yayınevi|||seri adı" — aynı adlı iki seri farklı yayınevindeyse
  // farklı gruplar oluşturur.
  const map = {};

  for (const book of state.books) {
    const name      = (book.series    || "").trim();
    const publisher = (book.publisher || "").trim();
    if (!name) continue;

    const key = `${publisher}|||${name}`;

    if (!map[key]) {
      map[key] = {
        name,
        publisher,
        total : 0,
        read  : 0,
        books : [],
      };
    }
    map[key].total++;
    map[key].books.push(book);
    if (book.status === "okundu") map[key].read++;
  }

  return Object.values(map);
}

// ─── Görüntü adı: "Seri Adı — Yayınevi" (yayınevi varsa) ────────────────────
function displayName(s) {
  return s.publisher ? `${s.name} — ${s.publisher}` : s.name;
}

// ─── Popüler seri kartı ───────────────────────────────────────────────────────
function popularCardHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;

  // Kapak görseli olan kitapları al, en fazla 3 tane
  const booksWithCover = s.books.filter((b) => b.cover_url);
  const coverBooks = booksWithCover.slice(0, 3);

  // Kapak HTML: 3 resim üst üste bindirilerek gösterilir.
  // Kapak yoksa placeholder gösterilir.
  let coversHtml = "";
  if (coverBooks.length > 0) {
    const imgs = coverBooks.map((b, i) =>
      `<img src="${esc(b.cover_url)}" alt="${esc(b.title || "")}" loading="lazy" class="series-cover-img series-cover-img--${i}" />`
    ).join("");
    coversHtml = `<div class="series-covers-wrap">${imgs}</div>`;
  } else {
    coversHtml = `
      <div class="series-covers-wrap series-covers-wrap--empty">
        <div class="series-cover-placeholder">
          <iconify-icon icon="lucide:layers"></iconify-icon>
        </div>
      </div>`;
  }

  return `
    <div class="series-popular-card"
         data-series="${escAttr(s.name)}"
         data-publisher="${escAttr(s.publisher)}">
      ${coversHtml}
      <div class="series-popular-info">
        <div class="series-popular-name">${esc(s.name)}</div>
        ${s.publisher
          ? `<div class="series-popular-publisher">${esc(s.publisher)}</div>`
          : ""}
        <div class="series-popular-stats">
          <span>${s.total} kitap</span>
          <span class="series-read-label">${s.read} okundu</span>
        </div>
        <div class="series-progress-track">
          <div class="series-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    </div>
  `;
}

// ─── Seri listesi satırı ──────────────────────────────────────────────────────
function seriesRowHtml(s) {
  const pct = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0;
  return `
    <div class="series-row"
         data-series="${escAttr(s.name)}"
         data-publisher="${escAttr(s.publisher)}">
      <div class="series-row-main">
        <span class="series-row-name">${esc(s.name)}</span>
        <span class="series-row-author">${esc(s.publisher || "")}</span>
      </div>
      <div class="series-row-right">
        <span class="series-row-count">${s.read}/${s.total}</span>
        <div class="series-progress-track series-progress-track--sm">
          <div class="series-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <iconify-icon icon="lucide:chevron-right" class="author-row-arrow"></iconify-icon>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// SERİ DETAY GÖRÜNÜMÜ
// ═══════════════════════════════════════════════════════════════

function renderSeriesDetail(seriesName, publisher) {
  const container = document.getElementById("series-content");
  if (!container) return;

  // Hem seri adı hem yayınevi eşleşmeli — aynı adlı serilerin karışmaması için.
  // allBooks: bu seriye ait TÜM kitaplar (format filtresi uygulanmadan) —
  // hangi format chip'lerinin gösterileceğine bunlara göre karar verilir.
  const allBooks = state.books
    .filter((b) => {
      const nameMatch = b.series === seriesName;
      // Yayınevi boşsa: kitabın da yayınevinin boş olması gerekir.
      const pubMatch  = (b.publisher || "") === (publisher || "");
      return nameMatch && pubMatch;
    })
    .sort((a, b) => {
      const ao = a.series_order ?? 9999;
      const bo = b.series_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" });
    });

  // YENİ: Bu seride hangi formatlar gerçekten var? (chip'leri buna göre göster)
  const hasEpub = allBooks.some((b) => (b.format || "").toLowerCase() === "epub");
  const hasPdf  = allBooks.some((b) => (b.format || "").toLowerCase() === "pdf");

  // Seçili format chip'i artık bu seride yoksa (örn. başka bir seriden
  // gelindi ve önceki seçim "pdf" kalmıştı ama bu seride PDF yoksa) sıfırla.
  if (activeFormatFilter === "epub" && !hasEpub) activeFormatFilter = "";
  if (activeFormatFilter === "pdf"  && !hasPdf)  activeFormatFilter = "";

  // YENİ: Format filtresi uygulanmış liste — ekranda gösterilen budur.
  const books = activeFormatFilter
    ? allBooks.filter((b) => (b.format || "").toLowerCase() === activeFormatFilter)
    : allBooks;

  // İlerleme/okuma sayacı her zaman TÜM seri üzerinden hesaplanır (format
  // filtresi sadece görünümü değiştirir, serinin genel ilerlemesini değil).
  const readCount  = allBooks.filter((b) => b.status === "okundu").length;
  const totalCount = allBooks.length;
  const pct        = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  // YENİ: Format chip'leri — sadece seride GERÇEKTEN var olan formatlar
  // için chip oluşturulur. İkisi de yoksa (olağan dışı durum) hiç chip
  // grubu render edilmez.
  const formatChipsHtml = (hasEpub || hasPdf)
    ? `
      <div class="series-format-chips" id="series-format-chips">
        <button class="chip${activeFormatFilter === "" ? " active" : ""}" data-series-format="">Tümü</button>
        ${hasEpub ? `<button class="chip${activeFormatFilter === "epub" ? " active" : ""}" data-series-format="epub">EPUB</button>` : ""}
        ${hasPdf  ? `<button class="chip${activeFormatFilter === "pdf"  ? " active" : ""}" data-series-format="pdf">PDF</button>`   : ""}
      </div>
    `
    : "";

  // GÜNCELLEME: Eksik kitap numarası tespiti artık FORMAT FİLTRESİNE göre
  // hesaplanıyor. "Tümü" seçiliyken serinin tamamına bakılır (bir numaranın
  // herhangi bir formatta kopyası varsa yeşil). "EPUB" veya "PDF" seçiliyken
  // ise SADECE o formattaki kopyalar "mevcut" sayılır.
  //
  // ÖNEMLİ: Grid'in büyüklüğü (maxOrder) HER ZAMAN allBooks'tan hesaplanır
  // (computeMissingNumbers'ın 2. parametresi) — serideki en son kitabın
  // (örn. #30) seçili formatta kopyası olmasa bile, grid yine #30'a kadar
  // gider ve o numarayı eksik (kırmızı) olarak gösterir. Sadece "mevcut mu"
  // sorusunun cevabı (1. parametre = books) format filtresine göre değişir.
  const missingInfo = computeMissingNumbers(books, allBooks);
  const missingGridHtml = renderMissingGrid(missingInfo, books, activeFormatFilter);

  container.innerHTML = `
    <div class="detail-header">
      <button class="detail-back-btn" id="series-back-btn">
        <iconify-icon icon="lucide:arrow-left"></iconify-icon>
        <span>Serilere Dön</span>
      </button>
      <div class="detail-title-wrap">
        <h2 class="detail-title">${esc(seriesName)}</h2>
        ${publisher
          ? `<span class="detail-subtitle">${esc(publisher)}</span>`
          : ""}
      </div>
    </div>

    <div class="series-detail-progress">
      <div class="series-progress-track">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-bar-label">${readCount} / ${totalCount} kitap okundu — %${pct}</span>
    </div>

    ${formatChipsHtml}

    <div class="series-detail-layout">
      <div class="series-book-list" id="series-book-list">
        ${books.map((b) => detailBookRowHtml(b)).join("")}
      </div>
      ${missingGridHtml}
    </div>
  `;

  document.getElementById("series-back-btn")?.addEventListener("click", () => {
    activeSeries = null;
    activeFormatFilter = "";   // YENİ: seriden çıkınca filtre sıfırlanır
    renderSeriesList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── GÜNCELLEME: Eksik kitap numaralarını hesapla ───────────────────────────
// presenceBooks: hangi kitapların "mevcut" sayılacağını belirleyen liste
//                (format filtresi uygulanmışsa SADECE o formattaki kitaplar).
// maxOrderBooks: grid'in büyüklüğünü (1..maxOrder) belirleyen liste — bu HER
//                ZAMAN serinin TAMAMI (allBooks) olmalı. Aksi halde, serideki
//                en son kitabın (örn. #30) seçili formatta kopyası yoksa,
//                grid #30'a hiç ulaşmadan kesilir ve o eksiklik gizlenir.
//                (Bu hata gerçek bir test senaryosunda yakalanıp düzeltildi.)
// Dönüş: { maxOrder, presentMap, missingNumbers }
function computeMissingNumbers(presenceBooks, maxOrderBooks) {
  const presentMap = new Map();

  for (const book of presenceBooks) {
    const order = book.series_order;
    if (order === null || order === undefined || order <= 0) continue;
    if (!presentMap.has(order)) presentMap.set(order, []);
    presentMap.get(order).push(book);
  }

  // maxOrder, presenceBooks'tan DEĞİL, serinin tamamından (maxOrderBooks)
  // hesaplanır — böylece grid her zaman gerçek seri büyüklüğünü gösterir.
  const allOrders = maxOrderBooks
    .map((b) => b.series_order)
    .filter((o) => o !== null && o !== undefined && o > 0);

  if (allOrders.length === 0) {
    return { maxOrder: 0, presentMap, missingNumbers: [] };
  }

  const maxOrder = Math.max(...allOrders);
  const missingNumbers = [];
  for (let i = 1; i <= maxOrder; i++) {
    if (!presentMap.has(i)) missingNumbers.push(i);
  }

  return { maxOrder, presentMap, missingNumbers };
}

// ─── GÜNCELLEME: Eksik kitap grid'i (heat-map) HTML'i ──────────────────────
// 10 sütunlu bir ızgara: 1'den maxOrder'a kadar her numara bir hücre.
// Mevcut numaralar yeşil, eksik numaralar kırmızı. Üstte özet satırı.
// Seri numarası hiç kullanılmıyorsa (maxOrder=0) hiçbir şey render edilmez.
//
// formatFilter: "" | "epub" | "pdf" — özet metninde hangi formata göre
// hesaplandığını belirtmek için kullanılır (örn. "EPUB formatında ...").
function renderMissingGrid(missingInfo, filteredBooks, formatFilter) {
  const { maxOrder, presentMap, missingNumbers } = missingInfo;
  if (maxOrder === 0) return "";

  const presentCount = maxOrder - missingNumbers.length;

  // Özet metnindeki format etiketi: "Tümü" seçiliyken hiç belirtilmez
  // (önceki davranışla aynı kalsın), EPUB/PDF seçiliyken açıkça yazılır —
  // böylece kullanıcı "neye göre eksik hesaplandığını" karıştırmaz.
  const formatLabel = formatFilter === "epub" ? "EPUB formatında "
                     : formatFilter === "pdf"  ? "PDF formatında "
                     : "";

  const summaryHtml = missingNumbers.length === 0
    ? `
      <p class="missing-grid-summary missing-grid-summary--ok">
        <iconify-icon icon="lucide:check-circle"></iconify-icon>
        ${formatLabel}${maxOrder} kitabın tamamı mevcut, eksik yok.
      </p>
    `
    : `
      <p class="missing-grid-summary missing-grid-summary--warn">
        <iconify-icon icon="lucide:alert-triangle"></iconify-icon>
        ${formatLabel}${maxOrder} kitaptan ${presentCount}'si mevcut, ${missingNumbers.length} eksik
        (${missingNumbers.map((n) => `#${n}`).join(", ")})
      </p>
    `;

  const cellsHtml = [];
  for (let i = 1; i <= maxOrder; i++) {
    const isPresent = presentMap.has(i);
    if (isPresent) {
      const booksAtThisNumber = presentMap.get(i);
      // Birden fazla kitap aynı numarayı paylaşıyorsa (örn. aynı kitabın
      // PDF+EPUB kopyası) tooltip'te hepsinin başlığı virgülle gösterilir.
      const titles = booksAtThisNumber.map((b) => b.title || "Başlıksız").join(", ");
      cellsHtml.push(
        `<span class="missing-grid-cell missing-grid-cell--present" title="#${i} — ${escAttr(titles)}">${i}</span>`
      );
    } else {
      cellsHtml.push(
        `<span class="missing-grid-cell missing-grid-cell--missing" title="#${i} — Eksik">${i}</span>`
      );
    }
  }

  return `
    <div class="series-missing-grid-wrap">
      <h3 class="missing-grid-title">
        <iconify-icon icon="lucide:grid-3x3"></iconify-icon> Eksik Kitap Kontrolü
      </h3>
      ${summaryHtml}
      <div class="missing-grid">
        ${cellsHtml.join("")}
      </div>
    </div>
  `;
}

// ─── Detay kitap satırı ───────────────────────────────────────────────────────
function detailBookRowHtml(book) {
  const statusClass = `status-${book.status || "okunmadi"}`;
  const statusText  = statusLabelLocal(book.status);
  const orderLabel  = book.series_order ? `#${book.series_order}` : "—";

  const coverHtml = book.cover_url
    ? `<img src="${esc(book.cover_url)}" alt="${esc(book.title || "")}" loading="lazy" />`
    : `<div class="row-cover-placeholder">${esc((book.title || "?")[0].toUpperCase())}</div>`;

  return `
    <div class="series-book-row" data-id="${esc(book.$id)}">
      <span class="series-book-order">${orderLabel}</span>
      <div class="row-cover series-book-cover">${coverHtml}</div>
      <div class="row-main">
        <span class="row-title">${esc(book.title || "Başlıksız")}</span>
        <span class="row-author">${esc(book.author || "")}</span>
      </div>
      <span class="book-status-badge ${statusClass}">${statusText}</span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// OLAYLARI BAĞLA
// ═══════════════════════════════════════════════════════════════

export function initSeries() {
  document.getElementById("series-content")?.addEventListener("click", (e) => {

    // Popüler kart veya liste satırı → detay
    const seriesEl = e.target.closest("[data-series]");
    if (seriesEl && seriesEl.dataset.series) {
      activeSeries = {
        name      : seriesEl.dataset.series,
        publisher : seriesEl.dataset.publisher || "",
      };
      activeFormatFilter = "";   // YENİ: her seriye girişte "Tümü" ile başla
      renderSeriesDetail(activeSeries.name, activeSeries.publisher);
      return;
    }

    // YENİ: Format chip'i (Tümü / EPUB / PDF) → listeyi filtrele
    const formatChip = e.target.closest("[data-series-format]");
    if (formatChip && activeSeries) {
      activeFormatFilter = formatChip.dataset.seriesFormat || "";
      renderSeriesDetail(activeSeries.name, activeSeries.publisher);
      return;
    }

    // Detaydaki kitap satırı → pop-up
    const bookRow = e.target.closest(".series-book-row");
    if (bookRow && bookRow.dataset.id) {
      openModal(bookRow.dataset.id);
      return;
    }
  });
}