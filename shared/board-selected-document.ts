import { BRAND, BRAND_CSS, brandMarkSvg } from "./brand";
import { BOARD_DOCUMENT_STYLE } from "./board-document-style";
import type { BoardReport } from "./reporting";
import { BOARD_DATA_OPTIONS, selectedBoardSections, selectedBoardDefinitions, type BoardSelection } from "./board-selection";
const esc = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Build only selected values into the HTML; hiding unselected data with CSS is insufficient. */
export function selectedBoardSummaryHtml(report: BoardReport, selection: BoardSelection): string {
  const sections = selectedBoardSections(report, selection);
  if (!sections.length) throw new Error("Select at least one board-report data option.");
  const masthead = `<header class="masthead"><div class="signature">${brandMarkSvg()}<div><strong>${BRAND.name}</strong><span>System design &amp; reporting</span></div></div><div class="client"><strong>${BRAND.client}</strong><span>${BRAND.program}</span><small>Selected board briefing</small></div></header>`;
  const foot = `<footer class="page-footer"><span>${BRAND.name} / ${BRAND.domain}</span><span>Selected board data</span></footer>`;
  const pages: string[] = [];
  // Complete exports, bounded pages. Never truncate a long item or monthly ledger.
  for (const section of sections) {
    const size = section.columns.length > 5 ? 15 : 22;
    for (let offset = 0; offset < Math.max(1, section.rows.length); offset += size) {
      const rows = section.rows.slice(offset, offset + size);
      pages.push(`<section class="report-page ledger">${masthead}<p class="eyebrow">Selected data / ${esc(section.key)}</p><h1>${esc(section.title)}</h1><div class="period"><strong>${esc(report.periodLabel)}</strong><span>Baltimore calendar &middot; Generated ${esc(report.generatedAt)}</span></div>${rows.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(section.title)}"><table><caption>${esc(section.title)}${section.rows.length > size ? ` (rows ${offset + 1}–${offset + rows.length} of ${section.rows.length})` : ""}</caption><thead><tr>${section.columns.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((value, i) => i ? `<td>${esc(value)}</td>` : `<th scope="row">${esc(value)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="empty">No recorded activity for this section in the selected period.</p>`}${section.note ? `<p class="note">${esc(section.note)}</p>` : ""}${foot}</section>`);
    }
  }
  const selectedLabels = BOARD_DATA_OPTIONS.filter(option => selection.includes(option.key)).map(option => option.label).join(", ");
  pages.push(`<section class="report-page ledger">${masthead}<h2 class="display">Definitions and scope</h2><p class="lede">Selected data: ${esc(selectedLabels)}.</p><ol class="definitions">${selectedBoardDefinitions(selection).map(note => `<li>${esc(note)}</li>`).join("")}</ol>${foot}</section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="author" content="Systems by Design"><title>Selected FRC Board Summary | Systems by Design</title><link rel="stylesheet" href="${esc(BRAND.fontStylesheet)}"><style>${BRAND_CSS}${BOARD_DOCUMENT_STYLE}</style></head><body><div class="toolbar"><p>Only selected data is included. PDF tags and reading order depend on the exporting browser.</p><button id="sbd-print-report" type="button">Print / save PDF</button></div><main aria-label="Selected FRC board report">${pages.join("")}</main></body></html>`;
}
