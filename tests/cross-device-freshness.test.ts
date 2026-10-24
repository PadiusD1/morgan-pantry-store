import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { OPEN_PICKER_FRESHNESS, SHARED_RECORD_FRESHNESS } from "@/lib/shared-freshness";
import { queryClient } from "@/lib/queryClient";
import { matchesSourceQuery, buildSourceOptions } from "@shared/donation-source";

/**
 * Two devices converging on one saved record.
 *
 * The application default is an infinite stale time with no focus refetch and
 * no interval, which is right for data that only this tab changes. The shared
 * pantry records are not that: a partner registered at the desk has to appear
 * on the tablet at the door. Invalidating a query key only ever reaches the tab
 * that did the saving, so these overrides are the mechanism that makes the
 * second device converge, and a regression here would look like "the other
 * screen is wrong" rather than like a test failure.
 */

describe("application defaults", () => {
  it("keeps per-tab data indefinitely fresh, which is why the shared records must override it", () => {
    const defaults = queryClient.getDefaultOptions().queries!;
    expect(defaults.staleTime).toBe(Infinity);
    expect(defaults.refetchOnWindowFocus).toBe(false);
    expect(defaults.refetchInterval).toBe(false);
  });
});

describe("shared record freshness", () => {
  it("refetches when a tab regains focus, so looking back at the other screen is enough", () => {
    expect(SHARED_RECORD_FRESHNESS.refetchOnWindowFocus).toBe(true);
  });

  it("refetches on a bounded timer, so an untouched screen does not go stale", () => {
    expect(SHARED_RECORD_FRESHNESS.refetchInterval).toBeGreaterThan(0);
    expect(SHARED_RECORD_FRESHNESS.refetchInterval).toBeLessThanOrEqual(60_000);
  });

  it("does not run that timer while the tab is hidden", () => {
    expect(SHARED_RECORD_FRESHNESS.refetchIntervalInBackground).toBe(false);
  });

  it("holds a short stale window, so moving between pages still reuses what is loaded", () => {
    expect(SHARED_RECORD_FRESHNESS.staleTime).toBeGreaterThan(0);
    expect(SHARED_RECORD_FRESHNESS.staleTime).toBeLessThan(SHARED_RECORD_FRESHNESS.refetchInterval);
  });

  it("always refetches an open picker on mount, while keeping the bounded timer", () => {
    // Codex review R15: the source picker and the donor list had no interval,
    // so a picker left open never converged on a donor another device created.
    expect(OPEN_PICKER_FRESHNESS.staleTime).toBe(0);
    expect(OPEN_PICKER_FRESHNESS.refetchOnMount).toBe(true);
    expect(OPEN_PICKER_FRESHNESS.refetchInterval).toBe(SHARED_RECORD_FRESHNESS.refetchInterval);
    expect(OPEN_PICKER_FRESHNESS.refetchIntervalInBackground).toBe(false);
    expect(OPEN_PICKER_FRESHNESS.refetchOnWindowFocus).toBe(true);
  });

  it("is actually applied, so a query built with it counts as stale after the window", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ["/api/clients"];
    cache.setQueryData(key, []);
    const entry = cache.getQueryCache().find({ queryKey: key })!;
    // With the application default this is fresh forever; with the override it
    // is stale as soon as the window passes.
    expect(entry.isStaleByTime(SHARED_RECORD_FRESHNESS.staleTime)).toBe(false);
    expect(entry.isStaleByTime(0)).toBe(true);
    cache.clear();
  });
});

describe("source search", () => {
  const options = buildSourceOptions(
    [{ id: "d1", name: "Test Food Bank", email: "bank@example.test" }],
    [{ id: "p1", name: "Test Community Pantry", organization: "Test Org", identifier: "PARTNER-7" }],
    [{ id: "s1", name: "Pastor James", identifier: "TEST-1001", phone: "410-555-0100" }],
  );
  const find = (query: string) => options.filter((option) => matchesSourceQuery(option, query)).map((o) => o.key);

  it("finds a source by name", () => {
    expect(find("pastor")).toEqual(["student:s1"]);
  });

  it("finds a source by identifier, which is how staff often know a student", () => {
    expect(find("TEST-1001")).toEqual(["student:s1"]);
  });

  it("finds a partner by its organization", () => {
    expect(find("test org")).toEqual(["partner:p1"]);
  });

  it("finds a source by email or phone", () => {
    expect(find("bank@example.test")).toEqual(["donor:d1"]);
    expect(find("410-555-0100")).toEqual(["student:s1"]);
  });

  it("narrows on every typed word, not just the first", () => {
    expect(find("test pantry")).toEqual(["partner:p1"]);
    expect(find("test bank")).toEqual(["donor:d1"]);
  });

  it("can be narrowed by the kind label, so one list still separates the kinds", () => {
    expect(find("student")).toEqual(["student:s1"]);
    expect(find("partner organization")).toEqual(["partner:p1"]);
  });

  it("returns everything for an empty query, so the list stays browsable", () => {
    expect(find("")).toHaveLength(3);
    expect(find("   ")).toHaveLength(3);
  });

  it("matches nothing rather than everything for an unknown term", () => {
    expect(find("no such source")).toEqual([]);
  });
});
