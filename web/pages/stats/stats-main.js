// ─────────────────────────────────────────────────────────────────────────────
// STATS-MAIN — Orkestratör.
// app.js: import { renderStats } from "./pages/stats/stats-main.js"
// ─────────────────────────────────────────────────────────────────────────────

import { _destroyCharts }        from "./stats-core.js";
import { renderOverview }         from "./stats-overview.js";
import { renderTimelineSection }  from "./stats-timeline.js";
import { renderJourneySection }   from "./stats-journey.js";
import { renderAuthorsSection }   from "./stats-authors.js";
import { renderTrendSection }     from "./stats-trend.js";

export async function renderStats() {
  const container = document.getElementById("stats-content");
  if (!container) return;

  _destroyCharts();
  await renderOverview();

  // ── Grimmory gibi Timeline + Journey yan yana ─────────────────────────────
  const wrap = document.querySelector(".stats-wrap");
  if (wrap) {
    const rowEl = document.createElement("div");
    rowEl.className = "stats-tl-journey-row";
    wrap.appendChild(rowEl);
  }

  await renderTimelineSection();
  await renderJourneySection();

  // ── Top Items (6 tip dropdown) + Yazar Evreni yan yana ───────────────────
  // stats-authors.js içinde .stats-top-row ile yan yana render edilir.
  await renderAuthorsSection();

  await renderTrendSection();
}