import type { BoardReport } from "@shared/reporting";
import { boardSummaryHtml } from "@shared/board-document";
export { boardSummaryHtml } from "@shared/board-document";

/** The print document never includes the operational client tables. */
export function printBoardSummary(report: BoardReport): void {
  const popup = window.open("", "_blank", "width=1100,height=850");
  if (!popup) throw new Error("Allow pop-ups for this site, then choose Print / save PDF again.");
  popup.opener = null;
  popup.document.open();
  popup.document.write(boardSummaryHtml(report));
  popup.document.close();
  let autoPrinted = false;
  const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
  const autoPrint = () => { if (autoPrinted) return; autoPrinted = true; print(); };
  const timeout = popup.setTimeout(autoPrint, 1800);
  popup.document.getElementById("sbd-print-report")?.addEventListener("click", () => {
    autoPrinted = true;
    popup.clearTimeout(timeout);
    print();
  });
  // Wait for stylesheet AND fonts, with a bounded fallback for offline/slow
  // connections. Never invoke auto-print twice when fonts settle after timeout.
  const styles = Array.from(popup.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  void Promise.all(styles.map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  }))).then(() => popup.document.fonts.ready).then(() => {
    if (popup.closed) return;
    popup.clearTimeout(timeout);
    popup.requestAnimationFrame(() => popup.requestAnimationFrame(autoPrint));
  }).catch(() => { /* The bounded fallback still opens print. */ });
}
