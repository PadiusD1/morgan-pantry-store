import { BRAND, BRAND_CSS, brandMarkSvg } from "./brand";
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
  return `<footer class="page-footer"><span>${BRAND.name} <span aria-hidden="true">/</span> ${BRAND.domain}</span><span>${section}</span></footer>`;
}
function monthlyTable(months: BoardReport["months"]): string {
  return `<table><caption>Monthly service within the selected period</caption><thead><tr><th scope="col">Month</th><th scope="col">Visits</th><th scope="col">Clients</th><th scope="col">Units</th><th scope="col">Lbs</th><th scope="col">Est. USD</th><th scope="col">Emergency</th></tr></thead><tbody>${cells(months.map(m => [monthLabel(m.month), number(m.entries), number(m.knownClients), number(m.units), m.weightLbs.toFixed(1), money(m.valueUsd), number(m.emergencyVisits)]))}</tbody></table>`;
}

/** Editorial, paginated document. Data comes from the same BoardReport as CSV.
 * No client/donor identity fields are accepted, no raster chart library needed.
 * Empty periods and incomplete measurements stay explicit, not decorative proof.
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
  const methodology = `<h2 class="section-rule">How to read this report</h2><ol class="definitions">${REPORT_DEFINITIONS.map(def => `<li>${escapeHtml(def)}</li>`).join("")}</ol>
<p class="note">Prepared from saved FRC records. This document excludes client names, identifiers, contact details, donor names, and locations. Item descriptions remain visible. Review free-text item names before external sharing.</p>`;
  const appendices: string[] = [];
  // Bounded ledgers preserve ALL recorded months without compressing a long
  // history into unreadable type or silently dropping older activity.
  for (let i = 0; i < Math.max(1, report.months.length); i += 12) {
    appendices.push(`<section class="report-page ledger">${masthead("Monthly ledger")}<p class="eyebrow">03 / Supporting detail</p><h2 class="display">The monthly record.</h2><p class="lede">${escapeHtml(report.periodLabel)}. Only months with recorded distributions are listed.</p>${report.months.length ? monthlyTable(report.months.slice(i, i + 12)) : `<p class="empty">No monthly distributions recorded in this period.</p>`}<p class="note">Clients are distinct within each month. Do not add monthly client counts to calculate unique clients for the full period.</p>${i + 12 >= report.months.length ? methodology : ""}${footer(`Monthly ledger ${Math.floor(i / 12) + 1}`)}</section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="author" content="Systems by Design"><title>FRC Board Summary | Systems by Design</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapeHtml(BRAND.fontStylesheet)}">
<style>${BRAND_CSS}
@page { size: letter; margin: 13mm 14mm; }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--sbd-surface); color: var(--sbd-ink); font: 14px/1.5 var(--sbd-sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.report-page { background: var(--sbd-paper); max-width: 1000px; margin: 24px auto; padding: 42px 48px 28px; border: 1px solid var(--sbd-line); }
.masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--sbd-ink); margin-bottom: 30px; }
.signature { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.signature svg { width: 34px; height: 34px; }
.signature strong { display: block; font-size: 16px; letter-spacing: -.035em; font-weight: 800; }
.signature span,.client span { display: block; font-size: 10px; color: var(--sbd-muted); }
.client { text-align: right; padding-left: 12px; border-left: 3px solid var(--sbd-morgan-orange); }
.client strong { font-size: 11px; color: var(--sbd-morgan-blue); }
.client small { font-size: 9px; color: var(--sbd-muted); }
.eyebrow { font: 10px var(--sbd-mono); letter-spacing: .13em; text-transform: uppercase; color: var(--sbd-blue); margin: 0 0 12px; }
h1,.display { font: 400 44px/1.08 var(--sbd-serif); letter-spacing: -.02em; margin: 0 0 14px; }
h2 { font-size: 18px; line-height: 1.25; font-weight: 700; margin: 0 0 10px; }
h3 { font-size: 13px; margin: 0 0 5px; }
p { margin: 0 0 10px; }
.lede { color: var(--sbd-muted); max-width: 660px; font-size: 14px; margin-bottom: 20px; }
.period { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; border-block: 1px solid var(--sbd-line); padding: 12px 0; margin: 22px 0 6px; font-size: 11px; }
.period span { color: var(--sbd-muted); }
.metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); margin-bottom: 26px; }
.metric { padding: 20px 12px 18px 0; border-bottom: 1px solid var(--sbd-line); min-width: 0; break-inside: avoid; }
.metric:not(:nth-child(3n+1)) { padding-left: 18px; border-left: 1px solid var(--sbd-line); }
.metric strong { display: block; font: 600 32px/1.12 var(--sbd-sans); font-variant-numeric: tabular-nums; letter-spacing: -.045em; overflow-wrap: anywhere; }
.metric span { display: block; font-size: 11px; font-weight: 700; margin-top: 9px; }
.metric small { display: block; color: var(--sbd-muted); font-size: 9px; margin-top: 3px; }
.chart { display: flex; align-items: flex-end; gap: 9px; padding: 12px 0 10px; border-bottom: 1px solid var(--sbd-line); }
.bar { flex: 1; min-width: 0; text-align: center; font-size: 9px; font-variant-numeric: tabular-nums; }
.bar svg { display: block; height: 92px; width: 100%; }
.bar strong { font-size: 11px; font-weight: 600; }
.bar span { display: block; font-size: 8px; color: var(--sbd-muted); padding-top: 7px; overflow-wrap: anywhere; }
.readout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 18px 0; margin-top: 4px; }
.readout p { font-size: 11px; color: var(--sbd-muted); }
.note { color: var(--sbd-muted); font-size: 10px; }
.quality { border-left: 3px solid var(--sbd-amber); background: var(--sbd-amber-soft); padding: 12px 16px; margin-top: 14px; }
.quality p { margin: 0; color: var(--sbd-ink); font-size: 11px; }
.section-rule { border-top: 1px solid var(--sbd-ink); padding-top: 16px; margin-top: 24px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 12px 0; font-size: 11px; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-size: 14px; font-weight: 700; margin: 0 0 12px; }
th,td { border-bottom: 1px solid var(--sbd-line); padding: 9px 5px; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
th:first-child { text-align: left; width: 32%; padding-left: 0; }
thead th { font-size: 9px; color: var(--sbd-muted); background: var(--sbd-surface); font-weight: 600; }
tbody th { font-weight: 500; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.items th:first-child { width: 42%; }
.item-bar { margin-top: 4px; height: 3px; max-width: 100%; display: block; }
.stock-note { padding: 10px 0; border-bottom: 1px solid var(--sbd-line); font-size: 11px; }
.definitions { columns: 2; column-gap: 24px; padding: 0; margin: 12px 0 0; list-style-position: inside; }
.definitions li { font-size: 9px; color: var(--sbd-muted); margin-bottom: 7px; break-inside: avoid; }
.page-footer { border-top: 1px solid var(--sbd-line); margin-top: 22px; padding-top: 12px; display: flex; justify-content: space-between; gap: 16px; color: var(--sbd-muted); font-size: 9px; }
.toolbar { max-width: 1000px; margin: 20px auto 0; padding-inline: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.toolbar p { margin: 0; font-size: 12px; color: var(--sbd-muted); }
.toolbar button { font: 600 13px var(--sbd-sans); border: 1px solid var(--sbd-blue); color: var(--sbd-paper); background: var(--sbd-blue); padding: 12px 18px; min-height: 44px; cursor: pointer; border-radius: var(--sbd-radius); }
.toolbar button:focus-visible { outline: 3px solid var(--sbd-blue); outline-offset: 3px; }
.empty { padding: 20px 0; color: var(--sbd-muted); }
.ledger .display { font-size: 36px; }
.ledger th:first-child { width: 19%; }
@media(max-width:600px) { .report-page { margin: 12px; padding: 24px 18px; } .masthead { gap: 12px; flex-wrap: wrap; } .client { text-align: left; } h1,.display { font-size: 36px; } .metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } .metric,.metric:not(:nth-child(3n+1)) { border-left: 0; padding: 16px 8px 16px 0; } .metric:nth-child(even) { padding-left: 12px; border-left: 1px solid var(--sbd-line); } .metric strong { font-size: 27px; } .readout { grid-template-columns: 1fr; gap: 10px; } .chart { gap: 3px; } .definitions { columns: 1; } table { font-size: 9px; } th,td { padding: 7px 2px; } .toolbar { flex-wrap: wrap; } }
@media print { body { background: var(--sbd-paper); font-size: 12px; } .toolbar { display:none; } .report-page { max-width: none; margin: 0; padding: 0; border: 0; break-after: page; } .report-page:last-child { break-after: auto; } .masthead { margin-bottom: 18px; padding-bottom: 14px; } h1,.display { font-size: 40px; } .metric { padding-top: 13px; padding-bottom: 13px; } .metric strong { font-size: 28px; } .metrics { margin-bottom: 16px; } .chart svg { height: 76px; } .readout { padding: 12px 0; } .page-footer { margin-top: 14px; padding-top: 9px; } .items th,.items td { padding-block: 7px; } h2,h3,caption { break-after: avoid; } .page-footer { break-inside: avoid; } .quality,.readout,.chart { break-inside: avoid; } .ledger table { font-size: 10px; } }
</style></head><body>
<div class="toolbar"><p>Board-ready report. Use your browser's PDF destination to save a copy.</p><button id="sbd-print-report" type="button">Print / save PDF</button></div>
<section class="report-page">${masthead("Board briefing")}<p class="eyebrow">01 / Impact overview</p><h1>Board Summary</h1><p class="lede">Food access, in focus. Recorded service, resources distributed, and the operating signals that deserve attention.</p>
<div class="period"><strong>${escapeHtml(report.periodLabel)}</strong><span>Baltimore calendar &middot; ${escapeHtml(report.generatedAt)}</span></div>
<div class="metrics">${metrics.map(([value, label, note]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>`).join("")}</div>
<h2>Service through the period</h2><p class="note">Distribution visits. ${report.months.length > 12 ? "Latest 12 months with recorded distributions; the complete monthly ledger follows." : "Months with recorded distributions; the complete monthly ledger follows."}</p>
${chartMonths.length ? `<div class="chart" role="img" aria-label="${escapeHtml(chartMonths.map(m => `${monthLabel(m.month)}: ${m.entries} visits`).join("; "))}">${chartMonths.map(m => `<div class="bar"><strong>${number(m.entries)}</strong><svg viewBox="0 0 36 100" preserveAspectRatio="none" aria-hidden="true"><rect x="3" y="${100 - (m.entries / maxVisits) * 92}" width="30" height="${(m.entries / maxVisits) * 92}" fill="var(--sbd-blue)"/></svg><span>${escapeHtml(monthLabel(m.month))}</span></div>`).join("")}</div>` : `<p class="empty">No distributions recorded in this period.</p>`}
<div class="readout"><div><h3>Reading the reach</h3><p>${number(d.unlinkedVisits)} visits have no linked client record. The identified-client figure counts linked records, not household members or estimated people served.</p></div><div><h3>Reading the resources</h3><p>Weight and estimated value use the measurements saved at checkout. Current prices do not rewrite this period's historical service.</p></div></div>
${quality ? `<aside class="quality"><h3>Data quality to review</h3><p>${number(d.unvaluedUnits)} distributed units lack a positive recorded unit value; ${number(d.unweighedUnits)} lack a positive recorded unit weight. ${number(d.unlinkedVisits)} visits are unlinked. These gaps may understate value, weight, or identified reach.</p></aside>` : `<p class="note">No missing positive unit weights, positive unit values, or client links were detected in these saved distribution records. This is not an independent data audit.</p>`}
${footer("Impact overview")}</section>
<section class="report-page">${masthead("Operations briefing")}<p class="eyebrow">02 / Operating picture</p><h2 class="display">Resources behind the service.</h2><p class="lede">Receiving describes the selected period. Inventory describes what is recorded on hand when this report is generated.</p>
<table><caption>Received stock and current inventory</caption><thead><tr><th scope="col">Measure</th><th scope="col">Units</th><th scope="col">Weight (lbs)</th><th scope="col">Estimated value (USD)</th></tr></thead><tbody>${cells([["Received within period (all sources)", number(report.receiving.units), report.receiving.weightLbs.toFixed(1), money(report.receiving.valueUsd)], ["On hand at generation time", number(report.inventory.units), report.inventory.weightLbs.toFixed(1), money(report.inventory.valueUsd)]])}</tbody></table>
<p class="stock-note"><strong>${number(report.inventory.lowStockItems)} low-stock items</strong> &middot; <strong>${number(report.inventory.outOfStockItems)} out-of-stock items</strong> &middot; ${number(report.inventory.itemTypes)} inventory item types. Review the inventory screen for replenishment.</p>
<h2 class="section-rule">Top 10 distributed items by quantity</h2>
${report.items.length ? `<table class="items"><thead><tr><th scope="col">Item</th><th scope="col">Units</th><th scope="col">Weight (lbs)</th><th scope="col">Est. value</th></tr></thead><tbody>${report.items.slice(0, 10).map(item => `<tr><th scope="row">${escapeHtml(item.name)}<svg class="item-bar" width="${Math.max(0, Math.min(100, item.quantity / maxItem * 100))}%" height="3" aria-hidden="true"><rect width="100%" height="3" fill="var(--sbd-blue)"/></svg></th><td>${number(item.quantity)}</td><td>${item.weightLbs.toFixed(1)}</td><td>${money(item.valueUsd)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No distributed items in this period.</p>`}

${footer("Operating picture")}</section>${appendices.join("")}</body></html>`;
}
