import { useEffect, useRef } from 'react';

/** Barcode inputs also accept scanners that send no Enter or Tab suffix. */
export function useAutoBarcode(onScan: (code: string) => void) {
  const run = useRef(onScan);
  run.current = onScan;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() { clearTimeout(timer.current); timer.current = undefined; }
  useEffect(() => cancel, []);
  function changed(field: HTMLInputElement, composing = false) {
    cancel();
    const code = field.value.trim();
    if (composing || code.length < 4) return;
    timer.current = setTimeout(() => {
      if (!field.isConnected || field.ownerDocument.activeElement !== field || field.value.trim() !== code) return;
      // Send the same input event as the scanner controller so controlled and
      // uncontrolled fields clear alike, before the next physical scan arrives.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(field, '');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      run.current(code);
    }, 450);
  }
  return { changed, cancel };
}
