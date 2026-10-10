/** Print typography is expressed in points, not small screen pixels.
 * Application: document-design / print-typography, WCAG PDF9 and WAI structure.
 * This is the sole document stylesheet; branding remains in shared/brand.ts.
 * Browser printing varies. A styled HTML document alone does not prove PDF tags.
 */
export const BOARD_DOCUMENT_STYLE = `
@page { size: letter; margin: 13mm 14mm; }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--sbd-surface); color: var(--sbd-ink); font: 10.5pt/1.45 var(--sbd-sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.report-page { background: var(--sbd-paper); max-width: 1000px; margin: 24px auto; padding: 36px 44px 24px; border: 1px solid var(--sbd-line); }
.masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--sbd-ink); margin-bottom: 24px; }
.signature { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.signature svg { width: 34px; height: 34px; }
.signature strong { display: block; font-size: 12pt; letter-spacing: -.035em; font-weight: 800; }
.signature span,.client span { display: block; font-size: 8.5pt; color: var(--sbd-muted); }
.client { text-align: right; padding-left: 12px; border-left: 3px solid var(--sbd-morgan-orange); }
.client strong { font-size: 9pt; color: var(--sbd-morgan-blue); }
.client small { display: block; font-size: 8pt; color: var(--sbd-muted); }
.eyebrow { font: 8pt var(--sbd-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--sbd-blue); margin: 0 0 12px; }
h1,.display { font: 400 32pt/1.1 var(--sbd-serif); letter-spacing: -.02em; margin: 0 0 14px; }
h2 { font-size: 14pt; line-height: 1.25; font-weight: 700; margin: 0 0 10px; }
h3 { font-size: 11pt; margin: 0 0 5px; }
p { margin: 0 0 10px; orphans: 3; widows: 3; }
.lede { color: var(--sbd-muted); max-width: 72ch; font-size: 11pt; margin-bottom: 18px; }
.period { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; border-block: 1px solid var(--sbd-line); padding: 10px 0; margin: 18px 0 4px; font-size: 9pt; }
.period span { color: var(--sbd-muted); }
.metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); margin-bottom: 22px; }
.metric { padding: 16px 12px 16px 0; border-bottom: 1px solid var(--sbd-line); min-width: 0; break-inside: avoid; }
.metric:not(:nth-child(3n+1)) { padding-left: 16px; border-left: 1px solid var(--sbd-line); }
.metric strong { display: block; font: 600 24pt/1.12 var(--sbd-sans); font-variant-numeric: tabular-nums; letter-spacing: -.045em; overflow-wrap: anywhere; }
.metric span { display: block; font-size: 9pt; font-weight: 700; margin-top: 8px; }
.metric small { display: block; color: var(--sbd-muted); font-size: 8.5pt; margin-top: 3px; }
.chart { display: flex; align-items: flex-end; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--sbd-line); }
.bar { flex: 1; min-width: 0; text-align: center; font-variant-numeric: tabular-nums; }
.bar svg { display: block; height: 86px; width: 100%; }
.bar strong { font-size: 9pt; font-weight: 600; }
.bar span { display: block; font-size: 8pt; color: var(--sbd-muted); padding-top: 6px; overflow-wrap: anywhere; }
.note { color: var(--sbd-muted); font-size: 10pt; }
.quality { border: 1px solid var(--sbd-line); background: var(--sbd-amber-soft); padding: 12px 14px; margin-top: 16px; }
.quality p { margin: 0; color: var(--sbd-ink); font-size: 10pt; }
.section-rule { border-top: 1px solid var(--sbd-ink); padding-top: 14px; margin-top: 22px; }
.table-wrap { max-width: 100%; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 12px 0; font-size: 10pt; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-size: 11pt; font-weight: 700; margin: 0 0 10px; }
th,td { border-bottom: 1px solid var(--sbd-line); padding: 7px 5px; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
th:first-child { text-align: left; width: 32%; padding-left: 0; }
thead th { font-size: 9pt; color: var(--sbd-muted); background: var(--sbd-surface); font-weight: 600; }
tbody th { font-weight: 500; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.items th:first-child { width: 42%; }
.item-bar { margin-top: 4px; height: 3px; max-width: 100%; display: block; }
.stock-note { padding: 10px 0; border-bottom: 1px solid var(--sbd-line); font-size: 10pt; }
.methodology { break-inside: avoid; }
.definitions { columns: 2; column-gap: 24px; padding: 0; margin: 12px 0; list-style-position: inside; }
.definitions li { font-size: 10pt; color: var(--sbd-muted); margin-bottom: 10px; break-inside: avoid; }
.page-footer { border-top: 1px solid var(--sbd-line); margin-top: 20px; padding-top: 10px; display: flex; justify-content: space-between; gap: 12px; color: var(--sbd-muted); font-size: 8pt; }
.toolbar { max-width: 1000px; margin: 20px auto 0; padding-inline: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.toolbar p { margin: 0; font-size: 10pt; color: var(--sbd-muted); max-width: 70ch; }
.toolbar button { font: 600 10pt var(--sbd-sans); border: 1px solid var(--sbd-blue); color: var(--sbd-paper); background: var(--sbd-blue); padding: 12px 18px; min-height: 44px; flex-shrink: 0; cursor: pointer; border-radius: var(--sbd-radius); }
.toolbar button:focus-visible { outline: 3px solid var(--sbd-blue); outline-offset: 3px; }
.empty { padding: 18px 0; color: var(--sbd-muted); }
.ledger .display { font-size: 28pt; }
.ledger th:first-child { width: 16%; }
@media screen and (max-width:600px) {
 .report-page { margin: 12px; padding: 24px 18px; }
 .masthead { gap: 12px; flex-wrap: wrap; }
 .client { text-align: left; }
 h1,.display { font-size: 27pt; }
 .metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }
 .metric,.metric:not(:nth-child(3n+1)) { border-left: 0; padding: 14px 8px 14px 0; }
 .metric:nth-child(even) { padding-left: 12px; border-left: 1px solid var(--sbd-line); }
 .metric strong { font-size: 21pt; }
 .chart { gap: 3px; }
 .definitions { columns: 1; }
 .table-wrap { overflow-x: auto; }
 .ledger table { min-width: 580px; }
 .toolbar { flex-wrap: wrap; }
 .page-footer { flex-wrap: wrap; }
}
@media print {
 body { background: var(--sbd-paper); }
 .toolbar { display:none; }
 .report-page { max-width: none; margin: 0; padding: 0; border: 0; break-after: page; }
 .report-page:last-child { break-after: auto; }
 .masthead { margin-bottom: 16px; padding-bottom: 12px; }
 h1,.display { font-size: 30pt; }
 .metric { padding-top: 12px; padding-bottom: 12px; }
 .metric strong { font-size: 22pt; }
 .metrics { margin-bottom: 16px; }
 .chart svg { height: 72px; }
 .page-footer { margin-top: 14px; padding-top: 8px; }
 .items th,.items td { padding-block: 6px; }
 h2,h3,caption { break-after: avoid; }
 .page-footer,.quality,.chart { break-inside: avoid; }
 .table-wrap { overflow: visible; }
}
`;
