import { useEffect, useRef, useState } from "react";
import { forgetSentBody } from "./queryClient";

function randomKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * One lock and one Idempotency-Key per logical save. The lock is taken
 * synchronously before any await, so a second click, an Enter plus a click or
 * a second tap is ignored while the first runs. The key is kept until the save
 * succeeds, so a retry after a failure carries the same key, and the next save
 * after a success gets a new one.
 *
 * With onHold, a success keeps the lock until release() is called, so a
 * trailing Enter handled by the old render, whose form still holds the values
 * just saved, cannot save them again with a new key.
 */
export function createSaveGuard(newKey: () => string = randomKey, onHold?: () => void) {
  let locked = false;
  let key: string | null = null;
  let holding = false;

  function begin(): string | null {
    if (locked) return null;
    locked = true;
    if (!key) key = newKey();
    return key;
  }

  function end(succeeded: boolean) {
    if (succeeded) {
      if (key) forgetSentBody(key);
      key = null;
      if (onHold) {
        holding = true;
        onHold();
        return;
      }
    }
    locked = false;
  }

  /** Frees the lock held after a success. Does nothing while a save runs. */
  function release() {
    if (!holding) return;
    holding = false;
    locked = false;
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

  return { begin, end, run, release, isLocked: () => locked };
}

export type SaveGuard = ReturnType<typeof createSaveGuard>;

/**
 * A success bumps a counter in the same batch as the form reset, and the lock
 * is freed in the effect that runs after that render has committed.
 */
export function useSaveGuard(): SaveGuard {
  const [saves, setSaves] = useState(0);
  const ref = useRef<SaveGuard | null>(null);
  if (!ref.current) ref.current = createSaveGuard(randomKey, () => setSaves((n) => n + 1));
  const guard = ref.current;
  useEffect(() => {
    guard.release();
  }, [saves, guard]);
  return guard;
}
