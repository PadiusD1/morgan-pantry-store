import { REPORT_DEFINITIONS, type BoardReport } from "@shared/reporting";

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const number = (value: number) => value.toLocaleString("en-US");
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** A separate document keeps operational client tables out of a board PDF. */
export function boardSummaryHtml(report: BoardReport): string {
  const d = report.distribution;
  const metrics = [
    [number(d.entries), "Distribution visits"], [number(d.knownClients), "Identified clients served"], [number(d.units), "Units distributed"],
    [`${d.weightLbs.toFixed(1)} lbs`, "Weight distributed"], [money(d.valueUsd), "Estimated value distributed"], [number(d.emergencyVisits), "Emergency visits"],
  ];
  const rows = (cells: (string | number)[][]) => cells.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FRC Board Summary</title>
  <style>
    @page { size: auto; margin: 15mm; }
    * { box-sizing: border-box; } body { margin: 0 auto; max-width: 980px; padding: 28px; color: #172c3d; background: white; font: 13px/1.5 system-ui, sans-serif; }
    header { border-bottom: 4px solid #df6e24; padding-bottom: 14px; margin-bottom: 20px; }
    h1 { font-size: 28px; margin: 3px 0 8px; } h2 { font-size: 17px; margin: 24px 0 10px; } p { margin: 4px 0; } .muted { color: #556675; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; } .metric { border: 1px solid #ccd5de; border-radius: 8px; padding: 14px; }
    .metric strong { display: block; font-size: 24px; line-height: 1.3; } .metric span { color: #556675; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; font-size: 12px; } th,td { text-align: left; padding: 8px; border-bottom: 1px solid #dce2e7; } th { background: #edf1f5; font-weight: 650; }
    td:not(:first-child),th:not(:first-child) { text-align: right; } thead { display: table-header-group; } tr,.metric { break-inside: avoid; }
    .notes { font-size: 11px; color: #556675; padding-left: 18px; } .notes li { margin: 5px 0; } .toolbar { display: flex; justify-content: flex-end; margin-bottom: 14px; }
    button { background: #123c5b; border: 0; border-radius: 6px; color: white; padding: 10px 16px; font: inherit; cursor: pointer; }
    @media print { body { padding: 0; max-width: none; } .toolbar { display: none; } h2 { break-after: avoid; } }
  </style></head><body>
  <header><p class="muted">Morgan State University · Food Resource Center</p><h1>Board Summary</h1><p><strong>Reporting period:</strong> ${escapeHtml(report.periodLabel)}</p><p class="muted">Baltimore calendar · Generated ${escapeHtml(report.generatedAt)}</p></header>
  <div class="metrics">${metrics.map(([value, label]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
  <h2>Monthly service within this period</h2>
  ${report.months.length ? `<table><thead><tr><th>Month</th><th>Visits</th><th>Clients</th><th>Units</th><th>Weight (lbs)</th><th>Est. value</th><th>Emergency</th></tr></thead><tbody>${rows(report.months.map((month) => [month.month, number(month.entries), number(month.knownClients), number(month.units), month.weightLbs.toFixed(1), money(month.valueUsd), number(month.emergencyVisits)]))}</tbody></table>` : "<p class=\"muted\">No distributions recorded in this period.</p>"}
  <h2>Received stock and current inventory</h2>
  <table><thead><tr><th>Measure</th><th>Units</th><th>Weight (lbs)</th><th>Estimated value (USD)</th></tr></thead><tbody>${rows([
    ["Received within period (all sources)", number(report.receiving.units), report.receiving.weightLbs.toFixed(1), money(report.receiving.valueUsd)],
    ["On hand at generation time", number(report.inventory.units), report.inventory.weightLbs.toFixed(1), money(report.inventory.valueUsd)],
  ])}</tbody></table>
  <p>${report.inventory.itemTypes} inventory item types · ${report.inventory.lowStockItems} low-stock items · ${report.inventory.outOfStockItems} out-of-stock items</p>
  <h2>Top 10 distributed items by quantity</h2>
  ${report.items.length ? `<table><thead><tr><th>Item</th><th>Units</th><th>Weight (lbs)</th><th>Est. value</th></tr></thead><tbody>${rows(report.items.slice(0, 10).map((item) => [item.name, number(item.quantity), item.weightLbs.toFixed(1), money(item.valueUsd)]))}</tbody></table>` : "<p class=\"muted\">No distributed items in this period.</p>"}
  <h2>How to read this report</h2>
  <p class="muted">${d.unlinkedVisits} visits without a linked client record. ${d.unvaluedUnits} distributed units without a positive recorded value; ${d.unweighedUnits} without a positive recorded weight.</p>
  <ul class="notes">${REPORT_DEFINITIONS.map((definition) => `<li>${escapeHtml(definition)}</li>`).join("")}</ul>
  <p class="muted">This summary excludes client names, identifiers, contact information, and locations.</p>
  </body></html>`;
}

export function printBoardSummary(report: BoardReport): void {
  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) throw new Error("Allow pop-ups for this site, then choose Print / save PDF again.");
  popup.opener = null;
  popup.document.open();
  popup.document.write(boardSummaryHtml(report));
  popup.document.close();
  // Inline styles and system fonts are ready by the next browser task.
  popup.setTimeout(() => { popup.focus(); popup.print(); }, 150);
}
