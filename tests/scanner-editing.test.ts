import { describe, expect, it } from "vitest";
import { allowsScannerCapture, createScanQueue, createScannerController, type ScanField } from "@/lib/scanner";

type Field = ScanField & { tagName: string; barcode?: boolean };

function page() {
  const name: Field = { tagName: "INPUT", value: "" };
  const barcode: Field = { tagName: "INPUT", value: "", barcode: true };
  let focused: Field = name;
  const scans: string[] = [];
  const passed: string[] = [];
  const controller = createScannerController({
    getFocused: () => focused,
    canCapture: () => allowsScannerCapture({ ...focused, getAttribute: (key) => key === "data-barcode-input" && focused.barcode ? "true" : null }),
    isBarcodeField: (field) => !!field.barcode,
    writeField: (field, value) => { field.value = value; },
    onScan: (code) => scans.push(code),
    schedule: () => () => {},
  });
  function press(key: string, time: number) {
    let prevented = false;
    controller.handle({ key, time, preventDefault: () => { prevented = true; }, stopPropagation() {} });
    if (!prevented) {
      passed.push(key);
      if (key.length === 1) focused.value += key;
    }
  }
  function type(value: string, start = 0, suffix = "Enter") {
    [...value, suffix].forEach((key, index) => press(key, start + index * 10));
  }
  return { name, barcode, scans, passed, press, type, focus: (field: Field) => { focused = field; } };
}

describe("scanner respects ordinary editing", () => {
  it("lets a rapidly typed name and Enter reach the field without scanning or erasing it", () => {
    const p = page();
    p.type("Brown Rice");
    expect(p.name.value).toBe("Brown Rice");
    expect(p.scans).toEqual([]);
    expect(p.passed.at(-1)).toBe("Enter");
  });

  it("keeps a rapidly entered numeric student ID as an ID", () => {
    const p = page();
    p.type("123456789012");
    expect(p.name.value).toBe("123456789012");
    expect(p.scans).toEqual([]);
  });

  it("continues recognizing hardware bursts in the dedicated barcode field", () => {
    const p = page();
    p.focus(p.barcode);
    p.type("123456789012");
    expect(p.scans).toEqual(["123456789012"]);
    expect(p.barcode.value).toBe("");
    expect(p.passed).not.toContain("Enter");
  });

  it.each(["Enter", "Tab"])("includes a barcode prefix entered before capture starts with a %s suffix", (suffix) => {
    const p = page();
    p.barcode.value = "29";
    p.focus(p.barcode);
    p.type("56960402466", 0, suffix);
    expect(p.scans).toEqual(["2956960402466"]);
    expect(p.barcode.value).toBe("");
    expect(p.passed).not.toContain(suffix);
  });

  it("does not mix a partial barcode with typing after the person changes focus", () => {
    const p = page();
    p.focus(p.barcode);
    p.press("1", 0);
    p.press("2", 10);
    p.focus(p.name);
    p.type("Rice", 20);
    expect(p.barcode.value).toBe("12");
    expect(p.name.value).toBe("Rice");
    expect(p.scans).toEqual([]);
  });

  it("protects rich-text, text areas and select/search controls, and permits page-level scans", () => {
    expect(allowsScannerCapture({ tagName: "TEXTAREA" })).toBe(false);
    expect(allowsScannerCapture({ tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(allowsScannerCapture({ tagName: "BUTTON", getAttribute: (name) => name === "role" ? "combobox" : null })).toBe(false);
    expect(allowsScannerCapture({ tagName: "BODY" })).toBe(true);
    expect(allowsScannerCapture(null)).toBe(true);
  });

  it("discards older queued scans when the person switches to manual item selection", async () => {
    const started: string[] = [];
    let finish: () => void = () => {};
    const queue = createScanQueue((code) => {
      started.push(code);
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    queue.push("123456789012");
    queue.push("223456789012");
    expect(queue.pending()).toBe(1);
    queue.clearPending();
    finish();
    await Promise.resolve();
    expect(started).toEqual(["123456789012"]);
    expect(queue.pending()).toBe(0);
  });
});
