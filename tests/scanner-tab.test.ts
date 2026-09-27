import { describe, expect, it } from "vitest";
import { TAB_BURST_CONFIG, createKeyRun, createScannerController, type ScanKey } from "@/lib/scanner";

/** Feeds text as keydowns gapMs apart starting at start, returns the time of the last key. */
function typeRun(run: ReturnType<typeof createKeyRun>, text: string, start: number, gapMs: number) {
  let t = start;
  for (const key of text) {
    run.key({ key, time: t });
    t += gapMs;
  }
  return t - gapMs;
}

function press(run: ReturnType<typeof createKeyRun>, ev: ScanKey & { shiftKey?: boolean }) {
  run.key(ev);
}

describe("a Tab that ends a burst in the barcode field", () => {
  it("is a scan when the headless keyboard sends each key about 100 ms apart", () => {
    const run = createKeyRun();
    const last = typeRun(run, "2000000200089", 1000, 100);
    press(run, { key: "Tab", time: last + 100 });
    expect(run.endedBurst("2000000200089")).toBe(true);
  });

  it("is a scan when the keys were held as a fast burst and the Tab came a little late", () => {
    const run = createKeyRun();
    const last = typeRun(run, "2000000200089", 1000, 5);
    press(run, { key: "Tab", time: last + 45 });
    expect(run.endedBurst("2000000200089")).toBe(true);
  });

  it("is not a scan for ordinary typing followed by Tab", () => {
    const run = createKeyRun();
    const last = typeRun(run, "2000000200089", 1000, 200);
    press(run, { key: "Tab", time: last + 200 });
    expect(run.endedBurst("2000000200089")).toBe(false);
  });

  it("is not a scan when the person paused before pressing Tab", () => {
    const run = createKeyRun();
    const last = typeRun(run, "2000000200089", 1000, 5);
    press(run, { key: "Tab", time: last + 600 });
    expect(run.endedBurst("2000000200089")).toBe(false);
  });

  it("is not a scan when the field holds more than the burst", () => {
    const run = createKeyRun();
    const last = typeRun(run, "00089", 1000, 5);
    press(run, { key: "Tab", time: last + 5 });
    expect(run.endedBurst("20000002000089")).toBe(false);
  });

  it("is not a scan for a short fast run", () => {
    const run = createKeyRun();
    const last = typeRun(run, "abc", 1000, 5);
    press(run, { key: "Tab", time: last + 5 });
    expect(run.endedBurst("abc")).toBe(false);
    expect(TAB_BURST_CONFIG.minLength).toBeGreaterThan(3);
  });

  it("is not a scan for Shift Tab or a Tab after another key", () => {
    const run = createKeyRun();
    let last = typeRun(run, "2000000200089", 1000, 5);
    press(run, { key: "Shift", time: last + 2 });
    press(run, { key: "Tab", time: last + 5, shiftKey: true });
    expect(run.endedBurst("2000000200089")).toBe(false);

    last = typeRun(run, "2000000200089", 5000, 5);
    press(run, { key: "Tab", time: last + 5 });
    press(run, { key: "a", time: last + 300 });
    expect(run.endedBurst("2000000200089")).toBe(false);
  });

  it("starts a new run after a slow gap, so earlier typing is not counted", () => {
    const run = createKeyRun();
    typeRun(run, "hello", 1000, 150);
    const last = typeRun(run, "2000000200089", 3000, 10);
    press(run, { key: "Tab", time: last + 10 });
    expect(run.endedBurst("2000000200089")).toBe(true);
    expect(run.endedBurst("hello2000000200089")).toBe(false);
  });

  it("shows the rendered failure, the late Tab passes the machine with the code flushed into the field", () => {
    const field = {
      value: "",
      get selectionStart() {
        return this.value.length;
      },
      get selectionEnd() {
        return this.value.length;
      },
    };
    const scans: string[] = [];
    const controller = createScannerController({
      getFocused: () => field,
      writeField: (f, v) => {
        f.value = v;
      },
      onScan: (code) => scans.push(code),
      schedule: () => () => {},
    });
    const run = createKeyRun();
    const send = (key: string, time: number) => {
      let prevented = false;
      run.key({ key, time });
      controller.handle({ key, time, preventDefault: () => (prevented = true), stopPropagation: () => {} });
      if (!prevented && key.length === 1) field.value += key;
      return prevented;
    };
    let t = 1000;
    for (const key of "2000000200089") {
      send(key, t);
      t += 5;
    }
    const tabPrevented = send("Tab", t - 5 + 45);
    expect(scans).toEqual([]);
    expect(tabPrevented).toBe(false);
    expect(field.value).toBe("2000000200089");
    expect(run.endedBurst(field.value)).toBe(true);
  });
});
