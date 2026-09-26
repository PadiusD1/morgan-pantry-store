import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECEIPT_AUTO_CLOSE_MS, createCountdown } from "@/hooks/use-receipt-countdown";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCountdown", () => {
  it("shows the seconds left and closes after about 4 seconds", () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    const c = createCountdown({ totalMs: RECEIPT_AUTO_CLOSE_MS, onTick: (s) => ticks.push(s), onDone });
    expect(ticks).toEqual([4]);
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([4, 3, 2, 1]);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(c.isRunning()).toBe(false);
  });

  it("never closes once cancelled by a click, hover or touch", () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    const c = createCountdown({ totalMs: RECEIPT_AUTO_CLOSE_MS, onTick: (s) => ticks.push(s), onDone });
    vi.advanceTimersByTime(1500);
    c.cancel();
    expect(c.isRunning()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(ticks).toEqual([4, 3]);
  });

  it("does not fire twice or tick after it is done", () => {
    const onTick = vi.fn();
    const onDone = vi.fn();
    createCountdown({ totalMs: 2000, onTick, onDone });
    vi.advanceTimersByTime(10_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls.map((c) => c[0])).toEqual([2, 1]);
  });
});
