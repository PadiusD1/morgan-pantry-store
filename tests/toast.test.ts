import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ToastModule = typeof import("@/hooks/use-toast");

async function freshModule(): Promise<ToastModule> {
  vi.resetModules();
  return import("@/hooks/use-toast");
}

const open = (m: ToastModule) => m.getToasts().filter((t) => t.open !== false);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toast timers", () => {
  it("closes a success toast after 3 seconds", async () => {
    const m = await freshModule();
    m.toast({ title: "Saved" });
    expect(open(m)).toHaveLength(1);
    vi.advanceTimersByTime(m.SUCCESS_TOAST_MS - 1);
    expect(open(m)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(open(m)).toHaveLength(0);
  });

  it("keeps an error toast until it is dismissed", async () => {
    const m = await freshModule();
    const t = m.toast({ title: "Save failed", variant: "destructive" });
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(open(m).map((x) => x.title)).toEqual(["Save failed"]);
    t.dismiss();
    expect(open(m)).toHaveLength(0);
  });

  it("gives every toast an infinite Radix duration so only the hook closes it", async () => {
    const m = await freshModule();
    m.toast({ title: "Saved" });
    m.toast({ title: "Save failed", variant: "destructive" });
    expect(m.getToasts().every((t) => t.duration === Infinity)).toBe(true);
  });

  it("never lets later successes evict a pinned error", async () => {
    const m = await freshModule();
    m.toast({ title: "Save failed", variant: "destructive" });
    for (let i = 0; i < 6; i++) m.toast({ title: `Saved ${i}` });
    const titles = open(m).map((x) => x.title);
    expect(titles).toContain("Save failed");
    expect(titles[0]).toBe("Saved 5");
    vi.advanceTimersByTime(m.SUCCESS_TOAST_MS);
    expect(open(m).map((x) => x.title)).toEqual(["Save failed"]);
  });
});

describe("fitToLimit and the reducer", () => {
  const t = (id: string, variant?: "destructive", openFlag = true) => ({ id, title: id, variant, open: openFlag });

  it("drops closed toasts first, then the oldest success", async () => {
    const m = await freshModule();
    expect(m.fitToLimit([t("new"), t("s1"), t("closed", undefined, false), t("s2")], 3).map((x) => x.id)).toEqual(["new", "s1", "s2"]);
    expect(m.fitToLimit([t("new"), t("e1", "destructive"), t("s1"), t("s2")], 3).map((x) => x.id)).toEqual(["new", "e1", "s1"]);
  });

  it("lets a success show past the limit rather than evict an error", async () => {
    const m = await freshModule();
    const list = [t("new"), t("e1", "destructive"), t("e2", "destructive"), t("e3", "destructive")];
    expect(m.fitToLimit(list, 3).map((x) => x.id)).toEqual(["new", "e1", "e2", "e3"]);
  });

  it("lets a new error evict the oldest error", async () => {
    const m = await freshModule();
    const list = [t("e4", "destructive"), t("e1", "destructive"), t("e2", "destructive"), t("e3", "destructive")];
    expect(m.fitToLimit(list, 3).map((x) => x.id)).toEqual(["e4", "e1", "e2"]);
  });

  it("adds through the reducer without dropping a pinned error", async () => {
    const m = await freshModule();
    let state = { toasts: [t("e1", "destructive")] };
    for (const id of ["s1", "s2", "s3", "s4"]) state = m.reducer(state, { type: "ADD_TOAST", toast: t(id) });
    expect(state.toasts.map((x) => x.id)).toEqual(["s4", "s3", "e1"]);
  });
});
