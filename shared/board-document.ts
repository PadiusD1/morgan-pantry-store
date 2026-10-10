import { BRAND, BRAND_CSS, brandMarkSvg } from "./brand";
import { BOARD_DOCUMENT_STYLE } from "./board-document-style";
import { REPORT_DEFINITIONS, type BoardReport } from "./reporting";

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const number = (value: number) => value.toLocaleString("en-US");
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const monthLabel = (key: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
const cells = (rows: (string | number)[][]) => rows.map(row => `<tr>${row.map((cell, i) => i === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");

function masthead(section: string): string {
  return `<header class="masthead"><div class="signature">${brandMarkSvg()}<div><strong>${BRAND.name}</strong><span>System design &amp; reporting</span></div></div><div class="client"><strong>${BRAND.client}</strong><span>${BRAND.program}</span><small>${section}</small></div></header>`;
}
function footer(section: string): string {
  return `<footer class="page-footer"><span>${BRAND.name} / ${BRAND.domain}</span><span>${escapeHtml(section)}</span></footer>`;
}
function monthlyTable(months: BoardReport["months"]): string {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Monthly service data, scroll horizontally on small screens"><table><caption>Monthly service within the selected period</caption><thead><tr><th scope="col">Month</th><th scope="col">Visits</th><th scope="col">Clients</th><th scope="col">Units</th><th scope="col">Lbs</th><th scope="col">Est. USD</th><th scope="col">Emergency</th></tr></thead><tbody>${cells(months.map(m => [monthLabel(m.month), number(m.entries), number(m.knownClients), number(m.units), m.weightLbs.toFixed(1), money(m.valueUsd), number(m.emergencyVisits)]))}</tbody></table></div>`;
}

/** The CSV and document share a BoardReport, never separate metric formulas.
 * Print body/definitions use readable point sizes. Visual structure does not
 * prove PDF accessibility: the exporting browser must preserve the tag tree.
 */
export function boardSummaryHtml(report: BoardReport): string {
  const d = report.distribution;
  const chartMonths = report.months.slice(-12);
  const maxVisits = Math.max(1, ...chartMonths.map(m => m.entries));
  const metrics = [
    [number(d.entries), "Distribution visits", "One saved checkout is one visit"],
    [number(d.knownClients), "Identified clients served", "Distinct linked client records"],
    [number(d.units), "Units distributed", "Items recorded at checkout"],
    [`${d.weightLbs.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs`, "Weight distributed", "Historical checkout weights"],
    [money(d.valueUsd), "Estimated value distributed", "Not cash revenue or measured savings"],
    [number(d.emergencyVisits), "Emergency visits", "Included in distribution visits"],
  ];
  const quality = d.unvaluedUnits > 0 || d.unweighedUnits > 0 || d.unlinkedVisits > 0;
  const maxItem = Math.max(1, ...report.items.slice(0, 10).map(item => item.quantity));
  const methodology = `<section class="methodology" aria-labelledby="report-methodology"><h2 id="report-methodology" class="section-rule">How to read this report</h2><ol class="definitions">${REPORT_DEFINITIONS.map(def => `<li>${escapeHtml(def)}</li>`).join("")}</ol><p class="note">Prepared from saved FRC records. Client names, identifiers, contact details, donor names, and locations are excluded. Item descriptions remain visible. Review free-text item names before external sharing.</p></section>`;
  const appendices: string[] = [];
  const lastLedgerRows = report.months.length === 0 ? 0 : (report.months.length - 1) % 12 + 1;
  // Long ledgers get a separate methodology sheet rather than shrinking the
  // explanations. No monthly row is removed to fit a fixed page count.
  const separateMethodology = lastLedgerRows > 4;
  for (let i = 0; i < Math.max(1, report.months.length); i += 12) {
    appendices.push(`<section class="report-page ledger">${masthead("Monthly ledger")}<p class="eyebrow">03 / Supporting detail</p><h2 class="display">The monthly record.</h2><p class="lede">${escapeHtml(report.periodLabel)}. Only months with recorded distributions are listed.</p>${report.months.length ? monthlyTable(report.months.slice(i, i + 12)) : `<p class="empty">No monthly distributions recorded in this period.</p>`}<p class="note">Clients are distinct within each month. Do not add monthly client counts to calculate unique clients for the full period.</p>${!separateMethodology && i + 12 >= report.months.length ? methodology : ""}${footer(`Monthly ledger ${Math.floor(i / 12) + 1}`)}</section>`);
  }
  if (separateMethodology) appendices.push(`<section class="report-page ledger">${masthead("Definitions and scope")}<p class="eyebrow">04 / Interpretation</p><h2 class="display">What the numbers mean.</h2><p class="lede">A record of service, not an estimate of every person reached or every outcome achieved.</p>${methodology}${footer("Definitions and scope")}</section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="author" content="Systems by Design"><title>FRC Board Summary | Systems by Design</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapeHtml(BRAND.fontStylesheet)}"><style>${BRAND_CSS}${BOARD_DOCUMENT_STYLE}</style></head><body>
<div class="toolbar"><p>This HTML report remains readable without saving a file. PDF tags and reading order depend on your browser and export settings.</p><button id="sbd-print-report" type="button">Print / save PDF</button></div>
<main aria-label="FRC board report">
<section class="report-page">${masthead("Board briefing")}<p class="eyebrow">01 / Impact overview</p><h1>Board Summary</h1><p class="lede">Food access, in focus. Recorded service, resources distributed, and the operating signals that deserve attention.</p>
<div class="period"><strong>${escapeHtml(report.periodLabel)}</strong><span>Baltimore calendar &middot; Generated ${escapeHtml(report.generatedAt)}</span></div>
<div class="metrics">${metrics.map(([value, label, note]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>`).join("")}</div>
<h2>Service through the period</h2><p class="note">Distribution visits. ${report.months.length > 12 ? "Latest 12 months with recorded distributions; the complete monthly ledger follows." : "Months with recorded distributions; the complete monthly ledger follows."}</p>
${chartMonths.length ? `<div class="chart" role="img" aria-label="${escapeHtml(chartMonths.map(m => `${monthLabel(m.month)}: ${m.entries} visits`).join("; "))}">${chartMonths.map(m => `<div class="bar"><strong>${number(m.entries)}</strong><svg viewBox="0 0 36 100" preserveAspectRatio="none" aria-hidden="true"><rect x="3" y="${100 - (m.entries / maxVisits) * 92}" width="30" height="${(m.entries / maxVisits) * 92}" fill="var(--sbd-blue)"/></svg><span>${escapeHtml(monthLabel(m.month))}</span></div>`).join("")}</div>` : `<p class="empty">No distributions recorded in this period.</p>`}
${quality ? `<aside class="quality"><h3>Data quality to review</h3><p>${number(d.unvaluedUnits)} distributed units lack a positive recorded unit value; ${number(d.unweighedUnits)} lack a positive recorded unit weight. ${number(d.unlinkedVisits)} visits are unlinked. These gaps may understate value, weight, or identified reach.</p></aside>` : `<p class="note">No missing positive unit weights, positive unit values, or client links were detected in these saved distribution records. This is not an independent data audit.</p>`}
${footer("Impact overview")}</section>
<section class="report-page">${masthead("Operations briefing")}<p class="eyebrow">02 / Operating picture</p><h2 class="display">Resources behind the service.</h2><p class="lede">Receiving describes the selected period. Inventory describes what is recorded on hand when this report is generated.</p>
<table><caption>Received stock and current inventory</caption><thead><tr><th scope="col">Measure</th><th scope="col">Units</th><th scope="col">Weight (lbs)</th><th scope="col">Estimated value (USD)</th></tr></thead><tbody>${cells([["Received within period (all sources)", number(report.receiving.units), report.receiving.weightLbs.toFixed(1), money(report.receiving.valueUsd)], ["On hand at generation time", number(report.inventory.units), report.inventory.weightLbs.toFixed(1), money(report.inventory.valueUsd)]])}</tbody></table>
<p class="stock-note"><strong>${number(report.inventory.lowStockItems)} low-stock items</strong> &middot; <strong>${number(report.inventory.outOfStockItems)} out-of-stock items</strong> &middot; ${number(report.inventory.itemTypes)} inventory item types. Review the inventory screen for replenishment.</p>
<h2 class="section-rule">Top 10 distributed items by quantity</h2>
${report.items.length ? `<table class="items"><thead><tr><th scope="col">Item</th><th scope="col">Units</th><th scope="col">Weight (lbs)</th><th scope="col">Est. value</th></tr></thead><tbody>${report.items.slice(0, 10).map(item => `<tr><th scope="row">${escapeHtml(item.name)}<svg class="item-bar" width="${Math.max(0, Math.min(100, item.quantity / maxItem * 100))}%" height="3" aria-hidden="true"><rect width="100%" height="3" fill="var(--sbd-blue)"/></svg></th><td>${number(item.quantity)}</td><td>${item.weightLbs.toFixed(1)}</td><td>${money(item.valueUsd)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No distributed items in this period.</p>`}
<p class="note">The board CSV contains every distributed item, including those outside this top-10 view.</p>
${footer("Operating picture")}</section>${appendices.join("")}</main></body></html>`;
}
