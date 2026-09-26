import { describe, expect, it, vi } from "vitest";
import { LOCATION_MAX_AGE_MS, createLocationCache, type NavigatorLike } from "@/lib/location";

function makeNav(state: string | null) {
  const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void) => {
    ok({ coords: { latitude: 10.5, longitude: 20.25, accuracy: 900 } });
  });
  const nav: NavigatorLike = {
    geolocation: { getCurrentPosition },
    permissions:
      state === null ? undefined : { query: vi.fn(async () => ({ state })) },
  };
  return { nav, getCurrentPosition };
}

describe("location cache", () => {
  it("looks up once at load with low accuracy when permission is granted", async () => {
    let t = 1000;
    const { nav, getCurrentPosition } = makeNav("granted");
    const cache = createLocationCache(() => nav, () => t);
    expect(cache.current()).toBeUndefined();
    await cache.prime();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false });
    t += 60_000;
    expect(cache.current()).toEqual({ latitude: 10.5, longitude: 20.25, accuracy: 900 });
  });

  it("drops a fix older than 5 minutes and refreshes it in the background", async () => {
    let t = 1000;
    const { nav, getCurrentPosition } = makeNav("granted");
    const cache = createLocationCache(() => nav, () => t);
    await cache.prime();
    t += LOCATION_MAX_AGE_MS + 1;
    expect(cache.current()).toBeUndefined();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(cache.current()).toEqual({ latitude: 10.5, longitude: 20.25, accuracy: 900 });
  });

  it("never calls geolocation while permission is at prompt", async () => {
    const { nav, getCurrentPosition } = makeNav("prompt");
    const cache = createLocationCache(() => nav);
    await cache.prime();
    expect(cache.current()).toBeUndefined();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("never calls geolocation when permission is denied", async () => {
    const { nav, getCurrentPosition } = makeNav("denied");
    const cache = createLocationCache(() => nav);
    await cache.prime();
    expect(cache.current()).toBeUndefined();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("never calls geolocation when the Permissions API is missing", async () => {
    const { nav, getCurrentPosition } = makeNav(null);
    const cache = createLocationCache(() => nav);
    await cache.prime();
    expect(cache.current()).toBeUndefined();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("answers at save time without a promise, so no save awaits location", async () => {
    const { nav } = makeNav("granted");
    const cache = createLocationCache(() => nav);
    const answer = cache.current();
    expect(answer instanceof Promise).toBe(false);
  });

  it("does nothing when there is no navigator", async () => {
    const cache = createLocationCache(() => undefined);
    await cache.prime();
    expect(cache.current()).toBeUndefined();
  });
});
