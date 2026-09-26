// Decides what the repository provider shows while its queries load or fail.
// Kept pure so the decision is unit tested without React.

export type QueryLoadState = {
  isLoading: boolean;
  error: unknown;
  data: unknown;
};

export type LoadGate =
  | { kind: "loading" }
  | { kind: "error"; error: Error }
  | { kind: "ready"; staleError: Error | null };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// A failed refetch keeps its last good data (TanStack Query leaves data set),
// so the pages stay mounted with a small notice and nothing typed is lost.
// The full screen error is only for a query that never loaded, because the
// pages would otherwise show an empty list as if it were real.
export function loadGate(queries: readonly QueryLoadState[]): LoadGate {
  if (queries.some((q) => q.isLoading)) return { kind: "loading" };
  const neverLoaded = queries.find((q) => q.error && q.data === undefined);
  if (neverLoaded) return { kind: "error", error: asError(neverLoaded.error) };
  const stale = queries.find((q) => q.error);
  return { kind: "ready", staleError: stale ? asError(stale.error) : null };
}
