import { useCallback, useEffect, useRef, useState } from "react";

// The check out receipt window closes on its own after this long.
export const RECEIPT_AUTO_CLOSE_MS = 4000;

export type Countdown = { cancel: () => void; isRunning: () => boolean };

// Calls onTick with the whole seconds left, at once and every second, and
// onDone when the time is up, unless cancel runs first.
export function createCountdown(opts: {
  totalMs: number;
  onTick: (secondsLeft: number) => void;
  onDone: () => void;
}): Countdown {
  const { totalMs, onTick, onDone } = opts;
  const startedAt = Date.now();
  let running = true;
  const stop = () => {
    running = false;
    clearInterval(interval);
    clearTimeout(timeout);
  };
  onTick(Math.ceil(totalMs / 1000));
  const interval = setInterval(() => {
    const left = Math.ceil((totalMs - (Date.now() - startedAt)) / 1000);
    if (left > 0) onTick(left);
  }, 1000);
  const timeout = setTimeout(() => {
    stop();
    onDone();
  }, totalMs);
  return { cancel: stop, isRunning: () => running };
}

// Runs the countdown each time a new receipt opens. cancel keeps the window
// open. lastReceipt stays for the Reprint last receipt control, and a
// receipt reopened after markReprint does not count down again.
export function useReceiptCountdown<T>(receipt: T | null, close: () => void, totalMs = RECEIPT_AUTO_CLOSE_MS) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [lastReceipt, setLastReceipt] = useState<T | null>(null);
  const countdownRef = useRef<Countdown | null>(null);
  const reprintRef = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!receipt) {
      setSecondsLeft(null);
      return;
    }
    setLastReceipt(receipt);
    if (reprintRef.current) {
      reprintRef.current = false;
      setSecondsLeft(null);
      return;
    }
    const countdown = createCountdown({
      totalMs,
      onTick: setSecondsLeft,
      onDone: () => {
        setSecondsLeft(null);
        closeRef.current();
      },
    });
    countdownRef.current = countdown;
    return () => countdown.cancel();
  }, [receipt, totalMs]);

  const cancel = useCallback(() => {
    if (countdownRef.current?.isRunning()) {
      countdownRef.current.cancel();
      setSecondsLeft(null);
    }
  }, []);

  const markReprint = useCallback(() => {
    reprintRef.current = true;
  }, []);

  return { secondsLeft, cancel, lastReceipt, markReprint };
}
