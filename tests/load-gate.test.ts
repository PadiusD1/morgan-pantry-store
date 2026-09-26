import { describe, expect, it } from "vitest";
import { loadGate, type QueryLoadState } from "@/lib/load-gate";

const signedOut = new Error("401: Sign in required");

function loaded(data: unknown): QueryLoadState {
  return { isLoading: false, error: null, data };
}

describe("repository load gate", () => {
  it("shows the spinner while any query is still on its first load", () => {
    expect(loadGate([loaded([]), { isLoading: true, error: null, data: undefined }, loaded([])])).toEqual({
      kind: "loading",
    });
  });

  it("renders the pages when every query has loaded", () => {
    expect(loadGate([loaded([{ id: "i1" }]), loaded([]), loaded([])])).toEqual({ kind: "ready", staleError: null });
  });

  it("keeps the pages over the last good data when a refetch fails with 401 after a load", () => {
    const gate = loadGate([
      loaded([{ id: "i1" }]),
      { isLoading: false, error: signedOut, data: [{ id: "c1", name: "Test Student One" }] },
      loaded([]),
    ]);
    expect(gate).toEqual({ kind: "ready", staleError: signedOut });
  });

  it("treats an empty list that loaded as data, so its failed refetch keeps the page", () => {
    const gate = loadGate([loaded([{ id: "i1" }]), loaded([]), { isLoading: false, error: signedOut, data: [] }]);
    expect(gate).toEqual({ kind: "ready", staleError: signedOut });
  });

  it("shows the full screen error when the first load fails and nothing loaded", () => {
    const failed: QueryLoadState = { isLoading: false, error: signedOut, data: undefined };
    expect(loadGate([failed, failed, failed])).toEqual({ kind: "error", error: signedOut });
  });

  it("shows the full screen error when one query has never loaded, even if others kept data", () => {
    const gate = loadGate([
      { isLoading: false, error: signedOut, data: [{ id: "i1" }] },
      { isLoading: false, error: signedOut, data: undefined },
      loaded([]),
    ]);
    expect(gate).toEqual({ kind: "error", error: signedOut });
  });
});
