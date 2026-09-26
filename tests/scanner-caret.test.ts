import { describe, expect, it } from "vitest";
import { createScannerController, insertAtSelection, type ScanField } from "@/lib/scanner";

type Field = ScanField & { selectionStart: number | null; selectionEnd: number | null };

/**
 * A field that behaves like a text input. A passed key replaces the selection
 * and leaves the caret after it, and a value written from code moves the caret
 * to the end unless the writer places it.
 */
function makeCaretPage(value: string, start: number, end = start) {
  const field: Field = { value, selectionStart: start, selectionEnd: end };
  const scans: string[] = [];
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];

  const controller = createScannerController<Field>({
    getFocused: () => field,
    writeField: (f, v, caret) => {
      f.value = v;
      const at = caret ?? v.length;
      f.selectionStart = at;
      f.selectionEnd = at;
    },
    onScan: (code) => {
      scans.push(code);
    },
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
  });

  function advance(to: number) {
    now = to;
    const due = timers.filter((t) => t.live && t.at <= now);
    timers = timers.filter((t) => t.live && t.at > now);
    for (const t of due) t.fn();
  }

  function press(key: string, time: number) {
    advance(time);
    let prevented = false;
    controller.handle({
      key,
      time,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    });
    if (prevented || key.length !== 1) return;
    const s = field.selectionStart ?? field.value.length;
    const e = field.selectionEnd ?? s;
    field.value = field.value.slice(0, s) + key + field.value.slice(e);
    field.selectionStart = s + 1;
    field.selectionEnd = s + 1;
  }

  return { field, scans, press, advance };
}

describe("insertAtSelection", () => {
  it("puts held text at a caret in the middle and leaves the caret after it", () => {
    expect(insertAtSelection("AB", "12", 1, 1)).toEqual({ value: "A12B", caret: 3 });
  });

  it("puts held text at a caret at the end", () => {
    expect(insertAtSelection("AB", "12", 2, 2)).toEqual({ value: "AB12", caret: 4 });
  });

  it("replaces a selected range", () => {
    expect(insertAtSelection("AXYB", "12", 1, 3)).toEqual({ value: "A12B", caret: 3 });
  });

  it("fills an empty field", () => {
    expect(insertAtSelection("", "12", 0, 0)).toEqual({ value: "12", caret: 2 });
  });

  it("appends at the end when the field reports no selection", () => {
    expect(insertAtSelection("AB", "12", null, null)).toEqual({ value: "AB12", caret: 4 });
  });

  it("keeps a position past the end or a reversed range inside the value", () => {
    expect(insertAtSelection("AB", "1", 9, 9)).toEqual({ value: "AB1", caret: 3 });
    expect(insertAtSelection("AXB", "1", 2, 1)).toEqual({ value: "A1B", caret: 2 });
  });
});

describe("scanner flush at the caret", () => {
  it("types 12 between A and B at 20 ms with no suffix as A12B", () => {
    const page = makeCaretPage("AB", 1);
    page.press("1", 1000);
    page.press("2", 1020);
    page.advance(2000);
    expect(page.scans).toEqual([]);
    expect(page.field.value).toBe("A12B");
    expect(page.field.selectionStart).toBe(3);
    expect(page.field.selectionEnd).toBe(3);
  });

  it("flushes before a slower key and that key lands after the flushed text", () => {
    const page = makeCaretPage("AB", 1);
    page.press("1", 1000);
    page.press("2", 1020);
    page.press("3", 1300);
    page.advance(2000);
    expect(page.scans).toEqual([]);
    expect(page.field.value).toBe("A123B");
    expect(page.field.selectionStart).toBe(4);
  });

  it("replaces the range selected when the first held key arrived", () => {
    const page = makeCaretPage("A", 1);
    page.press("1", 1000);
    page.field.value = "A1XYB";
    page.field.selectionStart = 2;
    page.field.selectionEnd = 4;
    page.press("2", 1020);
    page.advance(2000);
    expect(page.field.value).toBe("A12B");
    expect(page.field.selectionStart).toBe(3);
  });

  it("still restores the field and reports the code on a real scan", () => {
    const page = makeCaretPage("AB", 1);
    const code = "012345678905";
    let t = 1000;
    for (const ch of code) {
      page.press(ch, t);
      t += 20;
    }
    page.press("Enter", t);
    expect(page.scans).toEqual([code]);
    expect(page.field.value).toBe("AB");
  });
});
