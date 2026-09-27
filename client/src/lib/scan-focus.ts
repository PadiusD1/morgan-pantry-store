/**
 * Puts the caret back in a barcode field after a lookup, but only when focus
 * fell to the page body (a disabled field drops it there) or nowhere, so a
 * person who already moved to another control keeps it. Returns whether the
 * field was focused.
 */
export function refocusScanField(field: HTMLInputElement | null, doc: Document): boolean {
  if (!field || field.disabled) return false;
  const active = doc.activeElement;
  if (active && active !== doc.body) return false;
  field.focus();
  return true;
}
