// ─────────────────────────────────────────────────────────────────────────────
// STATS — İstatistikler sayfası.
//
// Adım 6: Sayfa iskeleti — başlık + placeholder.
// Adım 7-11: İçerik bölümleri burada doldurulacak.
// ─────────────────────────────────────────────────────────────────────────────

import { state } from "../core/state.js";

export function renderStats() {
  const container = document.getElementById("stats-content");
  if (!container) return;

  container.innerHTML = `
    <div class="stats-wrap">
      <div class="stats-header">
        <h1 class="stats-title">
          <iconify-icon icon="lucide:bar-chart-2"></iconify-icon> İstatistikler
        </h1>
        <p class="stats-sub">${state.books.length} kitap üzerinden hesaplanıyor</p>
      </div>
      <div class="stats-placeholder">
        <iconify-icon icon="lucide:loader-2" class="stats-spinner"></iconify-icon>
        <p>İstatistik bölümleri yakında eklenecek…</p>
      </div>
    </div>
  `;
}