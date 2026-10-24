import { BRAND, BRAND_CSS, brandMarkSvg } from "./brand";
import { BOARD_DOCUMENT_STYLE } from "./board-document-style";
import {
  EVENT_BOARD_OPTIONS, RANK_METRIC_LABELS, UNASSIGNED_KEY, eventBoardDefinitions, eventBoardSections, hasEventBoardSection,
  type EventBoardReport, type EventBoardSelection,
} from "./event-board";
import { reportDateKey } from "./reporting";

const esc = (value: string | number) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const number = (value: number) => value.toLocaleString("en-US");
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function masthead(section: string): string {
  return `<header class="masthead"><div class="signature">${brandMarkSvg()}<div><strong>${BRAND.name}</strong><span>System design &amp; reporting</span></div></div><div class="client"><strong>${BRAND.client}</strong><span>${BRAND.program}</span><small>${esc(section)}</small></div></header>`;
}
function footer(section: string): string {
  return `<footer class="page-footer"><span>${BRAND.name} / ${BRAND.domain}</span><span>${esc(section)}</span></footer>`;
}
function period(report: EventBoardReport): string {
  return `<div class="period"><strong>${esc(report.periodLabel)}</strong><span>Baltimore calendar &middot; Generated ${esc(report.generatedAt)}</span></div><p class="scope"><strong>Events included</strong> ${esc(report.scopeLabel)}</p>`;
}

/**
 * The Systems by Design print document for the event board. Built from the
 * same sections as the screen and the CSV, so only selected data is written
 * into the file at all. Print typography matches the board summary.
 */
export function eventBoardHtml(report: EventBoardReport, selection: EventBoardSelection, topN = 10): string {
  if (!hasEventBoardSection(selection)) throw new Error("Select at least one event board section.");
  const has = (key: string) => (selection as readonly string[]).includes(key);
  const d = report.totals.distribution;
  const r = report.totals.receiving;
  const metrics: [string, string, string][] = [
    ...(has("distributions") || has("trend") ? [[number(d.entries), "Distribution visits", "Saved checkouts in this selection"] as [string, string, string]] : []),
    ...(has("clients") ? [[number(d.identifiedClients), "Identified clients", "Each client counted once"] as [string, string, string]] : []),
    ...(has("units") && (has("distributions") || has("trend")) ? [[number(d.units), "Units distributed", "Items recorded at checkout"] as [string, string, string]] : []),
    ...(has("weight") && has("distributions") ? [[`${d.weightLbs.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} lbs`, "Recorded weight distributed", `${number(d.unweighedUnits)} units without a weight`] as [string, string, string]] : []),
    ...(has("value") && has("distributions") ? [[money(d.valueCents), "Estimated value distributed", "Not cash or acquisition cost"] as [string, string, string]] : []),
    ...(has("donations") || has("contributors") ? [[number(r.entries), "Entries received", `${number(r.attributedEntries)} from identified donors and partners`] as [string, string, string]] : []),
  ];
  const chartEvents = report.events.filter((row) => row.key !== UNASSIGNED_KEY).slice(-12);
  const maxVisits = Math.max(1, ...chartEvents.map((row) => row.distribution.entries));
  const label = (row: (typeof chartEvents)[number]) => `${row.name}${row.startsAt ? ` ${reportDateKey(row.startsAt) ?? ""}` : ""}`;
  const chart = (has("distributions") || has("trend")) ? (chartEvents.length
    ? `<h2>Visits by event</h2><p class="note">${report.events.filter((row) => row.key !== UNASSIGNED_KEY).length > 12 ? "The latest 12 events in this selection, in date order. The tables that follow list every event." : "Events in date order."}</p><div class="chart" role="img" aria-label="${esc(chartEvents.map((row) => `${label(row)}: ${row.distribution.entries} visits`).join("; "))}">${chartEvents.map((row) => `<div class="bar"><strong>${number(row.distribution.entries)}</strong><svg viewBox="0 0 36 100" preserveAspectRatio="none" aria-hidden="true"><rect x="3" y="${100 - (row.distribution.entries / maxVisits) * 92}" width="30" height="${(row.distribution.entries / maxVisits) * 92}" fill="var(--sbd-blue)"/></svg><span>${esc(row.name)}</span></div>`).join("")}</div>`
    : `<p class="empty">No event activity in this selection.</p>`) : "";
  const c = report.coverage;
  const gaps = (has("weight") && d.unweighedUnits > 0) || (has("value") && d.unvaluedUnits > 0) || c.ambiguousInbound > 0 || c.unattributedInbound > 0 || c.unknownEventEntries > 0;
  const quality = gaps
    ? `<aside class="quality"><h3>Read with care</h3><p>${[
      has("weight") && d.unweighedUnits > 0 ? `${number(d.unweighedUnits)} distributed units have no recorded weight.` : "",
      has("value") && d.unvaluedUnits > 0 ? `${number(d.unvaluedUnits)} distributed units have no recorded value.` : "",
      c.ambiguousInbound > 0 ? `${number(c.ambiguousInbound)} donation entries name a source shared by several records and are credited to no one.` : "",
      c.unattributedInbound > 0 ? `${number(c.unattributedInbound)} entries received have no identifiable donor or partner.` : "",
      c.unknownEventEntries > 0 ? `${number(c.unknownEventEntries)} entries name an event missing from the loaded list.` : "",
    ].filter(Boolean).map(esc).join(" ")} These gaps can understate totals. They are never filled with estimates.</p></aside>`
    : `<p class="note">No missing recorded weights, recorded values or donation attributions were found in this selection. This is not an independent data audit.</p>`;

  const pages: string[] = [`<section class="report-page">${masthead("Events and contributors")}<p class="eyebrow">01 / Event overview</p><h1>Events and Contributors</h1><p class="lede">What each event distributed and received, and the donors and partners behind it, from saved FRC records.</p>${period(report)}${metrics.length ? `<div class="metrics">${metrics.map(([value, name, detail]) => `<div class="metric"><strong>${esc(value)}</strong><span>${esc(name)}</span><small>${esc(detail)}</small></div>`).join("")}</div>` : ""}${chart}${quality}${footer("Event overview")}</section>`];

  const sections = eventBoardSections(report, selection, topN);
  for (const section of sections) {
    const size = section.columns.length > 6 ? 14 : 20;
    // The contributor's name, not the rank, identifies a contributor row.
    const header = section.key === "contributors" ? 1 : 0;
    for (let offset = 0; offset < Math.max(1, section.rows.length); offset += size) {
      const rows = section.rows.slice(offset, offset + size);
      const caption = `${section.title}${section.rows.length > size ? ` (rows ${offset + 1} to ${offset + rows.length} of ${section.rows.length})` : ""}`;
      pages.push(`<section class="report-page ledger event-${esc(section.key)}">${masthead("Events and contributors")}<p class="eyebrow">Selected data / ${esc(section.key)}</p><h2 class="display">${esc(section.title)}</h2>${period(report)}${rows.length
        ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(section.title)}"><table><caption>${esc(caption)}</caption><thead><tr>${section.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value, i) => i === header ? `<th scope="row">${esc(value)}</th>` : `<td>${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">No recorded activity for this section in the selected period.</p>`}${section.note && offset + size >= section.rows.length ? `<p class="note">${esc(section.note)}</p>` : ""}${footer(section.title)}</section>`);
    }
  }

  const selectedLabels = EVENT_BOARD_OPTIONS.filter((option) => selection.includes(option.key)).map((option) => option.label).join(", ");
  pages.push(`<section class="report-page ledger">${masthead("Definitions and scope")}<p class="eyebrow">Interpretation</p><h2 class="display">What the numbers mean.</h2><p class="lede">Selected data ${esc(selectedLabels)}.${has("contributors") ? ` Contributors are ranked by ${esc(RANK_METRIC_LABELS[report.rankMetric])}.` : ""}</p><ol class="definitions">${eventBoardDefinitions(report, selection).map((note) => `<li>${esc(note)}</li>`).join("")}</ol>${footer("Definitions and scope")}</section>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="author" content="Systems by Design"><title>FRC Events and Contributors | Systems by Design</title><link rel="stylesheet" href="${esc(BRAND.fontStylesheet)}"><style>${BRAND_CSS}${BOARD_DOCUMENT_STYLE}
.scope { font-size: 9pt; color: var(--sbd-muted); margin: 6px 0 14px; }
.scope strong { color: var(--sbd-ink); margin-right: 6px; }
.ledger .display { margin-top: 4px; }
.event-contributors th:first-child { width: 7%; padding-left: 0; text-align: left; }
.event-contributors tbody th { text-align: left; width: 26%; }
.event-distributions th:first-child, .event-donations th:first-child, .event-clients th:first-child, .event-trend th:first-child { width: 26%; }
</style></head><body><div class="toolbar"><p>Only the selected data is in this document. PDF tags and reading order depend on the exporting browser.</p><button id="sbd-print-report" type="button">Print / save PDF</button></div><main aria-label="FRC events and contributors report">${pages.join("")}</main></body></html>`;
}
