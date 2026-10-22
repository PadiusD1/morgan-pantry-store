import type { QueryClient } from "@tanstack/react-query";
import { buildSourceOptions } from "@shared/donation-source";
import type { SourceKind, SourceOption } from "@shared/donation-source";

/** Publish a confirmed registration before a refetch can fail or finish late. */
export async function cacheSavedSource(
  queryClient: QueryClient,
  kind: SourceKind,
  saved: { id: string; name: string; organization?: string | null; identifier?: string | null; email?: string | null; phone?: string | null },
): Promise<void> {
  const queryKey = ["/api/donation-sources"] as const;
  await queryClient.cancelQueries({ queryKey });
  // Built through the shared helper so a published row carries exactly the
  // identity label and searchable fields a refetched row would have.
  const [source] = buildSourceOptions(
    kind === "donor" ? [saved] : [],
    kind === "partner" ? [saved] : [],
    kind === "student" ? [saved] : [],
  );
  if (!source) return;
  queryClient.setQueryData<SourceOption[]>(queryKey, old => [
    ...(old ?? []).filter(row => row.key !== source.key), source,
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.kind.localeCompare(b.kind)));
}
