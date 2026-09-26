import { useRef } from "react";

function randomKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * One lock and one Idempotency-Key per logical save. The lock is taken
 * synchronously before any await, so a second click, an Enter plus a click or
 * a second tap is ignored while the first runs. The key is kept until the save
 * succeeds, so a retry after a failure carries the same key, and the next save
 * after a success gets a new one.
 */
export function createSaveGuard(newKey: () => string = randomKey) {
  let locked = false;
  let key: string | null = null;

  function begin(): string | null {
    if (locked) return null;
    locked = true;
    if (!key) key = newKey();
    return key;
  }

  function end(succeeded: boolean) {
    locked = false;
    if (succeeded) key = null;
  }

  /** Runs the action unless one is running. The action returns true on success. */
  async function run(action: (key: string) => Promise<boolean | void> | boolean | void): Promise<void> {
    const k = begin();
    if (k === null) return;
    let ok = false;
    try {
      ok = (await action(k)) === true;
    } finally {
      end(ok);
    }
  }

  return { begin, end, run, isLocked: () => locked };
}

export type SaveGuard = ReturnType<typeof createSaveGuard>;

export function useSaveGuard(): SaveGuard {
  const ref = useRef<SaveGuard | null>(null);
  if (!ref.current) ref.current = createSaveGuard();
  return ref.current;
}
