/** Print already-rendered, React-escaped receipt content. Never raw user input. */
export function printReceiptContent(receiptElement: HTMLElement): void {
  const popup = window.open("", "_blank", "width=520,height=760");
  if (!popup) throw new Error("Allow pop-ups for this site, then choose Print Receipt again.");
  popup.opener = null;
  popup.document.open();
  popup.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FRC Distribution Receipt</title>
    <style>
      @page { margin: 10mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.45; padding: 16px; max-width: 460px; margin: 0 auto; color: #111; background: white; overflow-wrap: anywhere; }
      h2 { margin: 0 0 3px; font-size: 13pt; }
      p { margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; table-layout: fixed; }
      th, td { padding: 5px 3px; text-align: right; vertical-align: top; font-size: 9pt; }
      th { border-bottom: 1px solid #333; }
      th:first-child, td:first-child { width: 44%; text-align: left; }
      tr, dl > div { break-inside: avoid; }
      dl { margin: 12px 0; }
      dl > div, .flex { display: flex; justify-content: space-between; gap: 12px; }
      dd { margin: 0; text-align: right; flex-shrink: 0; }
      .text-center { text-align: center; }
      .text-xs { font-size: 8.5pt; }
      .font-bold, .font-semibold, .font-medium { font-weight: 700; }
      .border-t { border-top: 1px solid #777; padding-top: 8px; margin-top: 8px; }
      .border-dashed { border-top-style: dashed; }
      #frc-print-again { font: inherit; padding: 8px 14px; margin-bottom: 16px; }
      @media print { body { padding: 0; } #frc-print-again { display: none; } }
    </style></head><body><button id="frc-print-again" type="button">Print receipt</button>${receiptElement.innerHTML}</body></html>`);
  popup.document.close();
  const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
  popup.document.getElementById("frc-print-again")?.addEventListener("click", print);
  // Leave the receipt open for cancellation, PDF saving, or a second print.
  // Closing immediately after print() can interrupt asynchronous browser dialogs.
  popup.requestAnimationFrame(() => popup.requestAnimationFrame(print));
}
