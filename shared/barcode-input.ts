/** Saved QR identifiers are opaque text. Only the provider layer interprets GTINs. */
export function validSavedBarcode(code: string): boolean {
  return code.length > 0 && code.length <= 256 && !/[\u0000-\u001f\u007f]/.test(code);
}
