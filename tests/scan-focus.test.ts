import { describe, expect, it, vi } from "vitest";
import { refocusScanField } from "@/lib/scan-focus";

// The check in barcode field is disabled while a lookup runs, which drops the
// caret to the page body. After the lookup the caret goes back to the field,
// unless the person has already moved to another control.

function fakeDoc(active: unknown) {
  const body = { tag: "body" };
  return { body, activeElement: active === "body" ? body : active } as unknown as Document;
}

describe("refocusScanField", () => {
  it("puts the caret back in the field when focus fell to the page body", () => {
    const field = { focus: vi.fn(), disabled: false } as unknown as HTMLInputElement;
    expect(refocusScanField(field, fakeDoc("body"))).toBe(true);
    expect(field.focus).toHaveBeenCalledTimes(1);
  });

  it("puts the caret back when nothing has focus", () => {
    const field = { focus: vi.fn(), disabled: false } as unknown as HTMLInputElement;
    expect(refocusScanField(field, fakeDoc(null))).toBe(true);
    expect(field.focus).toHaveBeenCalledTimes(1);
  });

  it("never takes focus from a control the person moved to", () => {
    const field = { focus: vi.fn(), disabled: false } as unknown as HTMLInputElement;
    const quantity = { tag: "input" };
    expect(refocusScanField(field, fakeDoc(quantity))).toBe(false);
    expect(field.focus).not.toHaveBeenCalled();
  });

  it("does nothing when the field is gone or still disabled", () => {
    expect(refocusScanField(null, fakeDoc("body"))).toBe(false);
    const field = { focus: vi.fn(), disabled: true } as unknown as HTMLInputElement;
    expect(refocusScanField(field, fakeDoc("body"))).toBe(false);
    expect(field.focus).not.toHaveBeenCalled();
  });
});
