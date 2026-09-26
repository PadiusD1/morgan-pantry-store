import { describe, expect, it } from "vitest";
import {
  SCANNER_CONFIG,
  createScanMachine,
  createScanQueue,
  createScannerController,
  type ScanField,
} from "@/lib/scanner";

type Field = ScanField & { name: string };

/** A tiny page with a barcode bar and a quantity field, no DOM needed. */
function makePage() {
  const barcode: Field = { name: "barcode", value: "" };
  const quantity: Field = { name: "quantity", value: "3" };
  let focused: Field | null = quantity;
  const scans: string[] = [];
  const log = { submitted: 0, tabbedAway: 0 };
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];

  const controller = createScannerController<Field>({
    getFocused: () => focused,
    writeField: (f, v) => {
      f.value = v;
    },
    onScan: (code) => {
      scans.push(code);
      barcode.value = code;
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

  function press(key: string, time: number, repeat = false) {
    advance(time);
    let prevented = false;
    controller.handle({
      key,
      time,
      repeat,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    });
    if (prevented) return;
    if (key.length === 1 && focused) focused.value += key;
    if (key === "Enter") log.submitted += 1;
    if (key === "Tab") log.tabbedAway += 1;
  }

  function type(text: string, start: number, gap: number, suffix?: string) {
    let t = start;
    for (const ch of text) {
      press(ch, t);
      t += gap;
    }
    if (suffix) press(suffix, t);
    return t;
  }

  return {
    barcode,
    quantity,
    scans,
    log,
    press,
    type,
    advance,
    focus: (f: Field | null) => {
      focused = f;
    },
  };
}

describe("scanner", () => {
  it("keeps the gap, the suffixes and the minimum length in one constant", () => {
    expect(SCANNER_CONFIG.gapMs).toBe(35);
    expect(SCANNER_CONFIG.suffixes).toEqual(["Enter", "Tab"]);
    expect(SCANNER_CONFIG.minLength).toBeGreaterThan(1);
  });

  it("sends a 35 ms burst ending in Enter to the barcode bar and leaves quantity unchanged", () => {
    const page = makePage();
    page.type("012345678905", 1000, 35, "Enter");
    expect(page.scans).toEqual(["012345678905"]);
    expect(page.barcode.value).toBe("012345678905");
    expect(page.quantity.value).toBe("3");
    expect(page.log.submitted).toBe(0);
  });

  it("does the same when the scanner ends with Tab and keeps focus in place", () => {
    const page = makePage();
    page.type("4006381333931", 1000, 35, "Tab");
    expect(page.scans).toEqual(["4006381333931"]);
    expect(page.quantity.value).toBe("3");
    expect(page.log.tabbedAway).toBe(0);
  });

  it("lets human typing at 150 ms pass through untouched", () => {
    const page = makePage();
    page.quantity.value = "";
    page.type("12", 1000, 150, "Enter");
    expect(page.scans).toEqual([]);
    expect(page.quantity.value).toBe("12");
    expect(page.log.submitted).toBe(1);
  });

  it("flushes a fast pair back into the field when no suffix follows", () => {
    const page = makePage();
    page.quantity.value = "";
    page.type("12", 1000, 10);
    page.advance(2000);
    expect(page.scans).toEqual([]);
    expect(page.quantity.value).toBe("12");
  });

  it("ignores key repeat", () => {
    const page = makePage();
    page.quantity.value = "";
    page.press("5", 1000);
    page.press("5", 1030, true);
    page.press("5", 1060, true);
    page.press("5", 1090, true);
    page.press("Enter", 1100);
    expect(page.scans).toEqual([]);
    expect(page.quantity.value).toBe("5555");
    expect(page.log.submitted).toBe(1);
  });

  it("does not treat a short fast code as a scan", () => {
    const m = createScanMachine();
    expect(m.key({ key: "1", time: 0 }).action).toBe("pass");
    expect(m.key({ key: "2", time: 10 }).action).toBe("hold");
    const end = m.key({ key: "Enter", time: 20 });
    expect(end.action).toBe("pass");
    expect(end.flush).toBe("2");
  });

  it("queues a second code that arrives during a lookup instead of dropping it", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const queue = createScanQueue(
      (code) =>
        new Promise<void>((resolve) => {
          started.push(code);
          release = resolve;
        }),
    );
    queue.push("111111");
    queue.push("222222");
    expect(started).toEqual(["111111"]);
    expect(queue.pending()).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["111111", "222222"]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.isBusy()).toBe(false);
  });

  it("queues a scan that arrives while the page lookup runs", async () => {
    const page = makePage();
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const queue = createScanQueue(
      (code) =>
        new Promise<void>((resolve) => {
          started.push(code);
          releases.push(resolve);
        }),
    );
    page.type("012345678905", 1000, 35, "Enter");
    page.type("4006381333931", 3000, 35, "Enter");
    for (const code of page.scans) queue.push(code);
    expect(started).toEqual(["012345678905"]);
    releases[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["012345678905", "4006381333931"]);
  });
});
