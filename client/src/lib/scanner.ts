import { useLayoutEffect, useRef } from "react";

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
  // Time of the last plain character key, null once a run was ended by another key.
  let lastChar: number | null = null;
  // True when the burst began within the key run gap of an earlier character,
  // so the field already holds the front of the code and the burst is only its tail.
  let joinedRun = false;

  function reset() {
    inBurst = false;
    first = "";
    held = "";
    joinedRun = false;
  }

  function takeHeld(): string | undefined {
    const text = held;
    held = "";
    return text || undefined;
  }

  function key(ev: ScanKey): ScanDecision {
    if (IGNORED_KEYS.has(ev.key)) return { action: "pass" };
    const previousChar = lastChar;
    lastChar = null;

    if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) {
      const flush = takeHeld();
      reset();
      return { action: "pass", flush };
    }

    const fast = inBurst && ev.time - lastTime <= config.gapMs;

    if (config.suffixes.includes(ev.key)) {
      const code = first + held;
      // A burst that joined a run is refused, the held keys go back into the
      // field and the suffix reaches it, so the field's own Enter or Tab rule
      // sees the whole typed code instead of its tail.
      if (fast && !joinedRun && code.length >= config.minLength) {
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

    lastChar = ev.time;

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
    joinedRun = previousChar !== null && ev.time - previousChar <= TAB_BURST_CONFIG.gapMs;
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

  function cancel() {
    const flush = timeout();
    lastChar = null;
    return flush;
  }

  return { key, timeout, hasHeld, cancel };
}

/**
 * A slower second check used only by the barcode fields. When keys reach the
 * page further apart than gapMs above (a busy page or a slow scanner), the
 * machine lets them into the field and only Enter used to end the code. A Tab
 * ends the code too when the whole field was typed as one run with every gap
 * and the Tab itself within gapMs, so ordinary typing followed by Tab still
 * moves on.
 */
export const TAB_BURST_CONFIG = {
  gapMs: 120,
  minLength: 8,
};

export function createKeyRun(config: typeof TAB_BURST_CONFIG = TAB_BURST_CONFIG) {
  let text = "";
  let last = 0;
  let ended: { text: string; gap: number } | null = null;

  function key(ev: ScanKey & { shiftKey?: boolean }) {
    if (IGNORED_KEYS.has(ev.key)) return;
    ended = null;
    const plain = !ev.repeat && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (plain && ev.key.length === 1) {
      if (!text || ev.time - last > config.gapMs) text = "";
      text += ev.key;
      last = ev.time;
      return;
    }
    if (plain && !ev.shiftKey && text) ended = { text, gap: ev.time - last };
    text = "";
  }

  /** True when the key just pressed ended a run that is exactly the field value. */
  function endedBurst(value: string) {
    return (
      !!ended &&
      ended.gap <= config.gapMs &&
      ended.text.length >= config.minLength &&
      value === ended.text
    );
  }

  function reset() {
    text = "";
    ended = null;
  }

  return { key, endedBurst, reset };
}

export type ScanField = { value: string; selectionStart?: number | null; selectionEnd?: number | null };

/**
 * Puts text where the caret was, replacing a selected range, and returns the
 * new value with the caret after the inserted text. With no selection known
 * the text goes at the end.
 */
export function insertAtSelection(
  value: string,
  text: string,
  start: number | null | undefined,
  end: number | null | undefined,
): { value: string; caret: number } {
  if (start == null) return { value: value + text, caret: value.length + text.length };
  const clamp = (n: number) => Math.min(Math.max(n, 0), value.length);
  const a = clamp(start);
  const b = clamp(end ?? start);
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length };
}

type HeldAt = { start: number | null; end: number | null };

function readSelection(field: ScanField): HeldAt {
  try {
    return { start: field.selectionStart ?? null, end: field.selectionEnd ?? null };
  } catch {
    return { start: null, end: null };
  }
}

export type ScanKeyEvent = ScanKey & {
  preventDefault(): void;
  stopPropagation(): void;
};

export type ScannerControllerOptions<F extends ScanField> = {
  config?: ScannerConfig;
  getFocused: () => F | null;
  /** Ordinary text editing takes precedence over global scan detection. */
  canCapture?: () => boolean;
  /** A barcode field contributes its complete value, including an earlier prefix. */
  isBarcodeField?: (field: F) => boolean;
  /** caret, when given, is where the caret goes after the write */
  writeField: (field: F, value: string, caret?: number) => void;
  onScan: (code: string) => void;
  schedule: (fn: () => void, ms: number) => () => void;
};

/**
 * Glue between the machine and a page. It snapshots the focused field at the
 * first key, restores ordinary fields when a scan is confirmed and flushes
 * held keys back when no suffix arrives. Dedicated barcode fields contribute
 * their whole value and are cleared on a scan. Its field access is injected
 * so the same logic runs in tests without a DOM.
 */
export function createScannerController<F extends ScanField>(opts: ScannerControllerOptions<F>) {
  const config = opts.config ?? SCANNER_CONFIG;
  const machine = createScanMachine(config);
  let field: F | null = null;
  let snapshot = "";
  let heldAt: HeldAt | null = null;
  let cancelTimer: (() => void) | null = null;

  function clearTimer() {
    if (cancelTimer) cancelTimer();
    cancelTimer = null;
  }

  function flushInto(text: string | undefined) {
    const at = heldAt;
    heldAt = null;
    if (!text || !field) return;
    const next = insertAtSelection(field.value, text, at?.start, at?.end);
    opts.writeField(field, next.value, next.caret);
  }

  function handle(ev: ScanKeyEvent) {
    if (opts.getFocused() !== field) pause();
    if (opts.canCapture && !opts.canCapture()) {
      pause();
      return;
    }
    const decision = machine.key(ev);
    if (decision.flush) flushInto(decision.flush);

    if (decision.snapshot) {
      field = opts.getFocused();
      snapshot = field ? field.value : "";
      heldAt = null;
    }

    if (decision.action === "pass") {
      if (!machine.hasHeld()) clearTimer();
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    if (decision.action === "hold") {
      // The first held key marks where the burst goes if it turns out to be typing.
      if (!heldAt && field) heldAt = readSelection(field);
      clearTimer();
      cancelTimer = opts.schedule(() => {
        cancelTimer = null;
        flushInto(machine.timeout());
      }, config.gapMs + 15);
      return;
    }

    clearTimer();
    let code = decision.code!;
    if (field && opts.isBarcodeField?.(field)) {
      // The burst's first character already reached the input; its remaining
      // characters were held. Include any prefix entered before capture was
      // attached or resumed, so a busy first render cannot scan only the tail.
      code = insertAtSelection(field.value, code.slice(1), heldAt?.start, heldAt?.end).value;
      opts.writeField(field, "");
    } else if (field && field.value !== snapshot) {
      opts.writeField(field, snapshot);
    }
    field = null;
    heldAt = null;
    opts.onScan(code);
  }

  function pause() {
    clearTimer();
    flushInto(machine.cancel());
    field = null;
    heldAt = null;
  }

  return { handle, pause, dispose: pause };
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
    clearPending: () => { waiting.length = 0; },
    isBusy: () => busy,
    pending: () => waiting.length,
  };
}

type EditableField = HTMLInputElement | HTMLTextAreaElement;

type ScanTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

/**
 * Timing alone cannot distinguish a fast typist from scanner hardware. Keep
 * Enter/Tab and every character in ordinary fields. Scanners still work in
 * the dedicated barcode fields and while focus is on the page or a button.
 */
export function allowsScannerCapture(target: ScanTarget | null): boolean {
  if (!target) return true;
  if (target.getAttribute?.("data-barcode-input") === "true") return true;
  if (target.isContentEditable || target.closest?.('[contenteditable="true"], [data-scanner-ignore="true"]')) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName?.toUpperCase() ?? "")) return false;
  return !["textbox", "combobox", "listbox"].includes(target.getAttribute?.("role") ?? "");
}

function focusedEditable(): EditableField | null {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return null;
}

/**
 * Sets a value the way the browser does, so React sees an input event, then
 * puts the caret at caret when one is given and the field still has focus.
 */
export function setNativeValue(el: EditableField, value: string, caret?: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (caret === undefined || el.ownerDocument.activeElement !== el) return;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // Number and email fields have no caret to place, the value is already set.
  }
}

/**
 * Capture scanner bursts in a barcode field or on the page without taking
 * normal editing keys from other fields. onScan receives each confirmed code.
 */
export function useScanner(onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const runRef = useRef<ReturnType<typeof createKeyRun> | null>(null);
  if (!runRef.current) runRef.current = createKeyRun();
  const run = runRef.current;

  useLayoutEffect(() => {
    const controller = createScannerController<EditableField>({
      getFocused: focusedEditable,
      canCapture: () => allowsScannerCapture(document.activeElement),
      isBarcodeField: (field) => field.getAttribute("data-barcode-input") === "true",
      writeField: setNativeValue,
      onScan: (code) => onScanRef.current(code),
      schedule: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
    const listener = (e: KeyboardEvent) => {
      if (e.isComposing || !allowsScannerCapture(document.activeElement)) {
        controller.pause();
        run.reset();
        return;
      }
      run.key({
        key: e.key,
        time: e.timeStamp,
        repeat: e.repeat,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
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

  /** Ask from the barcode field keydown whether a Tab there ends a scan. */
  return run.endedBurst;
}
