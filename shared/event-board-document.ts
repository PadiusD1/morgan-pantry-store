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
const BAR_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "2-digit" });

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
  // Bars carry the event date, one line each so every bar shares a baseline.
  // The full names are in the aria label and in the tables that follow.
  const barDate = (row: (typeof chartEvents)[number]) => row.startsAt ? BAR_DATE.format(new Date(row.startsAt)) : "No date";
  const chart = (has("distributions") || has("trend")) ? (chartEvents.length
    ? `<h2>Visits by event</h2><p class="note">${report.events.filter((row) => row.key !== UNASSIGNED_KEY).length > 12 ? "The latest 12 events in this selection, in date order. The tables that follow list every event." : "Events in date order."}</p><div class="chart event-chart" role="img" aria-label="${esc(chartEvents.map((row) => `${label(row)}: ${row.distribution.entries} visits`).join("; "))}">${chartEvents.map((row) => `<div class="bar"><strong>${number(row.distribution.entries)}</strong><svg viewBox="0 0 36 100" preserveAspectRatio="none" aria-hidden="true"><rect x="3" y="${100 - (row.distribution.entries / maxVisits) * 92}" width="30" height="${(row.distribution.entries / maxVisits) * 92}" fill="var(--sbd-blue)"/></svg><span>${esc(barDate(row))}</span></div>`).join("")}</div>`
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

  // One flowing detail section after the overview. Tables break across pages
  // with repeated headers, so a short selection is not spread one table per
  // half empty page, and a long one is never cut or shrunk to fit.
  const sections = eventBoardSections(report, selection, topN);
  const tables = sections.map((section) => {
    // The contributor's name, not the rank, identifies a contributor row.
    const header = section.key === "contributors" ? 1 : 0;
    const body = section.rows.length
      ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(section.title)}"><table class="event-table event-${esc(section.key)}"><thead><tr>${section.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((value, i) => i === header ? `<th scope="row">${esc(value)}</th>` : `<td>${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : `<p class="empty">No recorded activity for this section in the selected period.</p>`;
    return `<section class="event-section" aria-labelledby="event-section-${esc(section.key)}"><h2 id="event-section-${esc(section.key)}" class="section-rule">${esc(section.title)}</h2>${body}${section.note ? `<p class="note">${esc(section.note)}</p>` : ""}</section>`;
  }).join("");
  const included = EVENT_BOARD_OPTIONS.filter((option) => selection.includes(option.key)).map((option) => option.label.toLowerCase()).join(", ");
  pages.push(`<section class="report-page ledger">${masthead("Events and contributors")}<p class="eyebrow">02 / Selected detail</p><h2 class="display">The record, event by event.</h2>${period(report)}${tables}<section class="methodology" aria-labelledby="event-definitions"><h2 id="event-definitions" class="section-rule">What the numbers mean</h2><p class="note">This report includes ${esc(included)}.${has("contributors") ? ` Contributors are ranked by ${esc(RANK_METRIC_LABELS[report.rankMetric])}.` : ""}</p><ol class="definitions">${eventBoardDefinitions(report, selection).map((note) => `<li>${esc(note)}</li>`).join("")}</ol></section>${footer("Selected detail and definitions")}</section>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="author" content="Systems by Design"><title>FRC Events and Contributors | Systems by Design</title><link rel="stylesheet" href="${esc(BRAND.fontStylesheet)}"><style>${BRAND_CSS}${BOARD_DOCUMENT_STYLE}
.scope { font-size: 9pt; color: var(--sbd-muted); margin: 6px 0 14px; }
.scope strong { color: var(--sbd-ink); margin-right: 6px; }
.ledger .display { margin-top: 4px; }
/* Columns size to their content and words break only between words. The
   board table rules assume four columns, these tables carry up to ten. */
.event-table { table-layout: auto; }
.event-table th, .event-table td { overflow-wrap: normal; word-break: normal; padding: 6px 4px; }
/* Figures, dates and short labels stay on one line. Only names and headers wrap. */
.event-table td { white-space: nowrap; }
.event-table thead th { font-size: 8.5pt; line-height: 1.25; }
.event-table tbody th { font-weight: 500; overflow-wrap: anywhere; min-width: 14ch; text-align: left; }
.event-contributors tbody th { min-width: 20ch; }
.event-contributors thead th:nth-child(2) { text-align: left; }
.event-table th:first-child { width: auto; }
.event-contributors td:first-child { text-align: left; width: 4ch; }
.event-section { margin-top: 6px; }
.chart.event-chart { justify-content: flex-start; }
.chart.event-chart .bar { flex: 0 1 96px; }
.chart.event-chart .bar span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body><div class="toolbar"><p>Only the selected data is in this document. PDF tags and reading order depend on the exporting browser.</p><button id="sbd-print-report" type="button">Print / save PDF</button></div><main aria-label="FRC events and contributors report">${pages.join("")}</main></body></html>`;
}
