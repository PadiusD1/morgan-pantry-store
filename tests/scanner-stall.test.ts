import { describe, expect, it } from "vitest";
import { createKeyRun, createScannerController, insertAtSelection, type ScanField } from "@/lib/scanner";

type Field = ScanField & { selectionStart: number | null; selectionEnd: number | null };

/**
 * Drives the real controller the page uses, with a field that behaves like a
 * text input. A key the controller lets pass is typed into the field at the
 * caret, the way the browser would. The key run is fed first, as useScanner does.
 */
function makePage(value = "") {
  const field: Field = { value, selectionStart: value.length, selectionEnd: value.length };
  const scans: string[] = [];
  const run = createKeyRun();
  let now = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
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
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      now = due.at;
      due.fn();
    }
    now = to;
  }

  /** Returns true when the key reached the field, false when the scanner took it. */
  function press(key: string, at: number) {
    advance(at);
    run.key({ key, time: at });
    let prevented = false;
    controller.handle({
      key,
      time: at,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    });
    if (!prevented && key.length === 1) {
      const next = insertAtSelection(field.value, key, field.selectionStart, field.selectionEnd);
      field.value = next.value;
      field.selectionStart = next.caret;
      field.selectionEnd = next.caret;
    }
    return !prevented;
  }

  /** Types text one key per step ms from start, returns the time of the last key. */
  function type(text: string, start: number, step: number) {
    let t = start;
    for (const ch of text) {
      press(ch, t);
      t += step;
    }
    return t - step;
  }

  return { field, scans, run, press, type, advance };
}

const CODE = "012345678905";

describe("a burst that began inside a key run", () => {
  it("is refused, and Enter reaches the field holding the whole code", () => {
    const page = makePage();
    const last = page.type(CODE.slice(0, 4), 0, 10);
    const tail = page.type(CODE.slice(4), last + 50, 10);
    const passed = page.press("Enter", tail + 10);
    expect(page.scans).toEqual([]);
    expect(page.field.value).toBe("012345678905");
    expect(passed).toBe(true);
  });

  it("is refused on Tab too, and the 120 ms Tab rule sees the whole code", () => {
    const page = makePage();
    const last = page.type(CODE.slice(0, 4), 0, 10);
    const tail = page.type(CODE.slice(4), last + 50, 10);
    const passed = page.press("Tab", tail + 10);
    expect(page.scans).toEqual([]);
    expect(page.field.value).toBe("012345678905");
    expect(passed).toBe(true);
    expect(page.run.endedBurst(page.field.value)).toBe(true);
  });

  it.each([60, 110])("is refused when a %i ms stall lets the hold timer flush the front first", (stall) => {
    const page = makePage();
    const last = page.type(CODE.slice(0, 4), 0, 10);
    const tail = page.type(CODE.slice(4), last + stall, 10);
    const passed = page.press("Enter", tail + 10);
    expect(page.scans).toEqual([]);
    expect(page.field.value).toBe(CODE);
    expect(passed).toBe(true);
  });

  it("still scans a clean burst", () => {
    const page = makePage();
    const last = page.type("012345678905", 0, 10);
    const passed = page.press("Enter", last + 10);
    expect(page.scans).toEqual(["012345678905"]);
    expect(page.field.value).toBe("");
    expect(passed).toBe(false);
  });

  it("still scans a burst that starts after the typed run ended", () => {
    const page = makePage();
    page.type("A1", 0, 200);
    page.advance(600);
    const last = page.type("012345678905", 700, 10);
    page.press("Enter", last + 10);
    expect(page.scans).toEqual(["012345678905"]);
    expect(page.field.value).toBe("A1");
  });

  it("still scans a second code that follows a scan and its Enter at once", () => {
    const page = makePage();
    let last = page.type("A1B2C3D4", 0, 10);
    page.press("Enter", last + 10);
    last = page.type("E5F6G7H8", last + 30, 10);
    page.press("Enter", last + 10);
    expect(page.scans).toEqual(["A1B2C3D4", "E5F6G7H8"]);
    expect(page.field.value).toBe("");
  });
});
