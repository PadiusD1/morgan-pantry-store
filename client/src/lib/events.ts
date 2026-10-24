import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { SHARED_RECORD_FRESHNESS } from "./shared-freshness";
import { serverMessage } from "./stock-change";

/** One FRC event, as GET /api/frc-events returns it. */
export type FrcEvent = {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  status: "active" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  outboundTransactions: number;
  inboundTransactions: number;
};

export type EventSelection = { event: FrcEvent; tagInbound: boolean; selectedAt: string };

/** The event this signed in session is working, from the server. */
export type EventSession = {
  /** False until the event tables exist in the database. */
  ready: boolean;
  selection: EventSelection | null;
  /** An event someone ended while it was selected here. */
  ended: { id: string; name: string } | null;
};

export const EVENTS_KEY = ["/api/frc-events"] as const;
export const EVENT_SESSION_KEY = ["/api/frc-events/session"] as const;

/** The event list. A database without the event tables answers an empty list. */
export function useEvents() {
  return useQuery<FrcEvent[]>({
    queryKey: EVENTS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/frc-events", { credentials: "include", cache: "no-store" });
      if (res.status === 409) return [];
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    ...SHARED_RECORD_FRESHNESS,
  });
}

/**
 * The session's selection. It is read again whenever the tab regains focus, so
 * a second tab or a colleague ending the event shows here before the next save.
 */
export function useEventSession() {
  return useQuery<EventSession>({ queryKey: EVENT_SESSION_KEY, ...SHARED_RECORD_FRESHNESS });
}

export function refreshEventData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: EVENT_SESSION_KEY });
  void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
}

/** Select an event for this session, clear it with null, or change the check in tag. */
export function useSelectEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { eventId: string | null; tagInbound?: boolean }): Promise<EventSession> =>
      (await apiRequest("PUT", "/api/frc-events/session", body)).json(),
    onSuccess: (session) => queryClient.setQueryData(EVENT_SESSION_KEY, session),
    onSettled: () => refreshEventData(queryClient),
  });
}

/** True when a save was refused because its event ended, vanished or is not set up. */
export function isEventRefusal(error: unknown): boolean {
  const text = error instanceof Error ? error.message : "";
  return /^409: /.test(text) && /"code":"event_(closed|missing|tracking_unavailable)"/.test(text);
}

export function eventErrorText(error: unknown, fallback: string): string {
  return serverMessage(error) ?? fallback;
}

const DATE_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const TIME_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** "Sat, Oct 24, 2026, 10:00 AM", in Baltimore time. */
export function eventWhen(event: Pick<FrcEvent, "startsAt" | "endsAt">): string {
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return "";
  const day = DATE_LABEL.format(start);
  const from = TIME_LABEL.format(start);
  if (!event.endsAt) return `${day}, ${from}`;
  const end = new Date(event.endsAt);
  if (Number.isNaN(end.getTime())) return `${day}, ${from}`;
  return DATE_LABEL.format(end) === day ? `${day}, ${from} to ${TIME_LABEL.format(end)}` : `${day}, ${from} to ${DATE_LABEL.format(end)}, ${TIME_LABEL.format(end)}`;
}

/** The value of a datetime-local input for an instant, in this browser's time. */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** An instant from a datetime-local input, or null for a blank or invalid one. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
