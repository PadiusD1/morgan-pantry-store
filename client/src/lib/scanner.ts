import { useEffect, useRef } from "react";

/**
 * USB barcode scanners type a code as a very fast burst of keys ending in a
 * suffix key. The values below are the starting values, not yet measured on
 * the pantry scanner. A slower scanner falls back to normal typing, the burst
 * is flushed back into the field, so no keys are lost.
 */
export const SCANNER_CONFIG = {
  gapMs: 35,
  suffixes: ["Enter", "Tab"] as readonly string[],
  minLength: 4,
};

export type ScannerConfig = typeof SCANNER_CONFIG;

export type ScanKey = {
  key: string;
  time: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type ScanDecision = {
  /** pass lets the browser handle the key, hold and scan suppress it */
  action: "pass" | "hold" | "scan";
  /** text held from an earlier burst that must go back into the field first */
  flush?: string;
  /** true on the first key of a possible burst, snapshot the focused field now */
  snapshot?: boolean;
  code?: string;
};

const IGNORED_KEYS = new Set(["Shift", "CapsLock", "Control", "Alt", "Meta", "AltGraph"]);

/** Pure state machine. It knows keys and timestamps only, never the DOM. */
export function createScanMachine(config: ScannerConfig = SCANNER_CONFIG) {
  let inBurst = false;
  let first = "";
  let held = "";
  let lastTime = 0;

  function reset() {
    inBurst = false;
    first = "";
    held = "";
  }

  function takeHeld(): string | undefined {
    const text = held;
    held = "";
    return text || undefined;
  }

  function key(ev: ScanKey): ScanDecision {
    if (IGNORED_KEYS.has(ev.key)) return { action: "pass" };

    if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) {
      const flush = takeHeld();
      reset();
      return { action: "pass", flush };
    }

    const fast = inBurst && ev.time - lastTime <= config.gapMs;

    if (config.suffixes.includes(ev.key)) {
      const code = first + held;
      if (fast && code.length >= config.minLength) {
        reset();
        return { action: "scan", code };
      }
      const flush = takeHeld();
      reset();
      return { action: "pass", flush };
    }

    if (ev.key.length !== 1) {
      const flush = takeHeld();
      reset();
      return { action: "pass", flush };
    }

    if (fast) {
      held += ev.key;
      lastTime = ev.time;
      return { action: "hold" };
    }

    const flush = takeHeld();
    inBurst = true;
    first = ev.key;
    held = "";
    lastTime = ev.time;
    return { action: "pass", flush, snapshot: true };
  }

  /** Called when no key followed within the gap, returns text to flush. */
  function timeout(): string | undefined {
    const flush = takeHeld();
    reset();
    return flush;
  }

  function hasHeld() {
    return held.length > 0;
  }

  return { key, timeout, hasHeld };
}

export type ScanField = { value: string };

export type ScanKeyEvent = ScanKey & {
  preventDefault(): void;
  stopPropagation(): void;
};

export type ScannerControllerOptions<F extends ScanField> = {
  config?: ScannerConfig;
  getFocused: () => F | null;
  writeField: (field: F, value: string) => void;
  onScan: (code: string) => void;
  schedule: (fn: () => void, ms: number) => () => void;
};

/**
 * Glue between the machine and a page. It snapshots the focused field at the
 * first key, restores it when a scan is confirmed and flushes held keys back
 * into it when no suffix arrives. It takes its field access as functions so it
 * runs in tests without a DOM.
 */
export function createScannerController<F extends ScanField>(opts: ScannerControllerOptions<F>) {
  const config = opts.config ?? SCANNER_CONFIG;
  const machine = createScanMachine(config);
  let field: F | null = null;
  let snapshot = "";
  let cancelTimer: (() => void) | null = null;

  function clearTimer() {
    if (cancelTimer) cancelTimer();
    cancelTimer = null;
  }

  function flushInto(text: string | undefined) {
    if (!text || !field) return;
    opts.writeField(field, field.value + text);
  }

  function handle(ev: ScanKeyEvent) {
    const decision = machine.key(ev);
    if (decision.flush) flushInto(decision.flush);

    if (decision.snapshot) {
      field = opts.getFocused();
      snapshot = field ? field.value : "";
    }

    if (decision.action === "pass") {
      if (!machine.hasHeld()) clearTimer();
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    if (decision.action === "hold") {
      clearTimer();
      cancelTimer = opts.schedule(() => {
        cancelTimer = null;
        flushInto(machine.timeout());
      }, config.gapMs + 15);
      return;
    }

    clearTimer();
    if (field && field.value !== snapshot) opts.writeField(field, snapshot);
    field = null;
    opts.onScan(decision.code!);
  }

  return { handle, dispose: clearTimer };
}

/**
 * Runs lookups one at a time. A code that arrives while a lookup runs waits
 * its turn instead of being dropped.
 */
export function createScanQueue(run: (code: string) => Promise<unknown> | unknown) {
  const waiting: string[] = [];
  let busy = false;

  async function drain() {
    busy = true;
    try {
      while (waiting.length > 0) {
        const code = waiting.shift()!;
        try {
          await run(code);
        } catch {
          // The lookup shows its own error, the next code still runs.
        }
      }
    } finally {
      busy = false;
    }
  }

  function push(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    waiting.push(trimmed);
    if (!busy) void drain();
  }

  return {
    push,
    isBusy: () => busy,
    pending: () => waiting.length,
  };
}

type EditableField = HTMLInputElement | HTMLTextAreaElement;

function focusedEditable(): EditableField | null {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return null;
}

/** Sets a value the way the browser does, so React sees an input event. */
export function setNativeValue(el: EditableField, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Listens on window in the capture phase, so a scan is caught before it reaches
 * whatever field has focus. onScan receives every confirmed code.
 */
export function useScanner(onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const controller = createScannerController<EditableField>({
      getFocused: focusedEditable,
      writeField: setNativeValue,
      onScan: (code) => onScanRef.current(code),
      schedule: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
    const listener = (e: KeyboardEvent) => {
      controller.handle({
        key: e.key,
        time: e.timeStamp,
        repeat: e.repeat,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      });
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
      controller.dispose();
    };
  }, []);
}
