import type { QueryClient } from "@tanstack/react-query";
import type { SourceKind, SourceOption } from "@shared/donation-source";

/** Publish a confirmed registration before a refetch can fail or finish late. */
export async function cacheSavedSource(queryClient: QueryClient, kind: SourceKind, saved: { id: string; name: string; organization?: string | null }): Promise<void> {
  const queryKey = ["/api/donation-sources"] as const;
  await queryClient.cancelQueries({ queryKey });
  const source: SourceOption = { key: `${kind}:${saved.id}`, kind, id: saved.id, name: saved.name, organization: saved.organization ?? null };
  queryClient.setQueryData<SourceOption[]>(queryKey, old => [
    ...(old ?? []).filter(row => row.key !== source.key), source,
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.kind.localeCompare(b.kind)));
}
