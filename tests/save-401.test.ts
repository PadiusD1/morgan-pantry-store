import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  apiRequest,
  isSessionExpiredError,
  saveErrorMessage,
} from "@/lib/queryClient";

function stubPage(path: string) {
  const location = { pathname: path, href: path, origin: "http://localhost" };
  vi.stubGlobal("window", { location });
  return location;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a 401 during a save", () => {
  it("throws a session error and does not redirect on a POST", async () => {
    const location = stubPage("/check-in");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not authenticated", { status: 401 })));
    const err = await apiRequest("POST", "/api/transactions", { type: "IN" }).catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(isSessionExpiredError(err)).toBe(true);
    expect(err.message.startsWith("401")).toBe(true);
    expect(location.href).toBe("/check-in");
  });

  it("keeps the page after a save 401 even when the refetch that follows gets a 401", async () => {
    const location = stubPage("/check-out");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not authenticated", { status: 401 })));
    await apiRequest("POST", "/api/transactions", { type: "OUT" }).catch(() => {});
    await apiRequest("GET", "/api/inventory").catch(() => {});
    expect(location.href).toBe("/check-out");
  });

  it("still redirects on a 401 from a read when no save was refused", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/queryClient");
    const location = stubPage("/check-in");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not authenticated", { status: 401 })));
    const err = await fresh.apiRequest("GET", "/api/inventory").catch((e) => e);
    expect(fresh.isSessionExpiredError(err)).toBe(false);
    expect(location.href).toBe("/login");
  });

  it("maps a session error to the sign in message and anything else to the fallback", () => {
    expect(saveErrorMessage(new SessionExpiredError("x"), "Please try again.")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(saveErrorMessage(new Error("500: boom"), "Please try again.")).toBe("Please try again.");
    expect(SESSION_EXPIRED_MESSAGE).not.toMatch(/[:;]|\s[-–—]\s/);
  });
});
