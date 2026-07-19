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
  await renderTimelineSection();
  await renderJourneySection();
  await renderAuthorsSection();
  await renderTrendSection();
}