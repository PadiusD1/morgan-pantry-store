import type { GeoLocation } from "@/lib/repository";

/** A fix older than this is not attached to a save. */
export const LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

type PositionLike = {
  coords: { latitude: number; longitude: number; accuracy?: number };
};

export type NavigatorLike = {
  permissions?: {
    query?: (desc: { name: "geolocation" }) => Promise<{ state: string }>;
  };
  geolocation?: {
    getCurrentPosition: (
      ok: (pos: PositionLike) => void,
      fail?: (err: unknown) => void,
      opts?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
    ) => void;
  };
};

/**
 * Keeps the last location fix in memory. It asks the browser only when the
 * Permissions API already reports geolocation as granted, so no prompt ever
 * appears and no save ever waits on it.
 */
export function createLocationCache(
  getNav: () => NavigatorLike | undefined,
  now: () => number = () => Date.now(),
) {
  let last: { fix: GeoLocation; at: number } | null = null;
  let granted = false;
  let busy = false;

  function lookup() {
    const geo = getNav()?.geolocation;
    if (!geo || busy) return;
    busy = true;
    try {
      geo.getCurrentPosition(
        (pos) => {
          busy = false;
          last = {
            fix: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            },
            at: now(),
          };
        },
        () => {
          busy = false;
        },
        { enableHighAccuracy: false, maximumAge: LOCATION_MAX_AGE_MS, timeout: 20000 },
      );
    } catch {
      busy = false;
    }
  }

  /** Call once at page load. Never awaited by a save. */
  async function prime(): Promise<void> {
    const nav = getNav();
    if (!nav?.geolocation || typeof nav.permissions?.query !== "function") return;
    try {
      const status = await nav.permissions.query({ name: "geolocation" });
      granted = status.state === "granted";
    } catch {
      granted = false;
    }
    if (granted) lookup();
  }

  /** The last fix when it is fresh enough, read at save time without waiting. */
  function current(): GeoLocation | undefined {
    const fresh = last && now() - last.at <= LOCATION_MAX_AGE_MS ? last.fix : undefined;
    // A missing or stale fix is refreshed in the background for the next save.
    if (!fresh && granted) lookup();
    return fresh;
  }

  return { prime, current };
}

const defaultCache = createLocationCache(() =>
  typeof navigator === "undefined" ? undefined : (navigator as unknown as NavigatorLike),
);

export const primeLocation = defaultCache.prime;
export const currentLocation = defaultCache.current;
