import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { EventFormDialog } from "@/components/event-session-bar";
import { EVENTS_KEY, eventErrorText, eventWhen, refreshEventData, useEventSession, useEvents, type FrcEvent } from "@/lib/events";
import { CalendarDaysIcon, Loader2Icon } from "lucide-react";

type Pending = { kind: "close" | "reopen" | "delete"; event: FrcEvent } | null;
type HistoryEntry = { id: string; action: string; details: Record<string, unknown>; at: string; actor: string | null };

const ACTION_TEXT: Record<string, string> = {
  created: "Created", updated: "Edited", closed: "Ended", reopened: "Reopened", deleted: "Deleted", selected: "Selected for a session", cleared: "Cleared from a session",
};

export default function EventsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "staff";
  const isAdmin = user?.role === "admin";
  const session = useEventSession();
  const events = useEvents();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<FrcEvent | "new" | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  async function confirm() {
    if (!pending) return;
    setWorking(true);
    const { kind, event } = pending;
    try {
      if (kind === "delete") await apiRequest("DELETE", `/api/frc-events/${event.id}`, undefined, { idempotencyKey: crypto.randomUUID() });
      else await apiRequest("POST", `/api/frc-events/${event.id}/${kind}`, undefined, { idempotencyKey: crypto.randomUUID() });
      toast({ title: kind === "close" ? "Event ended" : kind === "reopen" ? "Event reopened" : "Event deleted", description: event.name });
      setPending(null);
    } catch (error) {
      toast({ title: "Not changed", description: eventErrorText(error, "The event could not be changed. Try again."), variant: "destructive" });
    } finally {
      setWorking(false);
      refreshEventData(queryClient);
    }
  }

  if (session.data && !session.data.ready) {
    return (
      <Card className="glass-panel" data-testid="card-events-not-ready">
        <CardContent className="py-6 text-sm">Event tracking is not set up in this database yet. Checkouts and check ins keep working without events until the event migration is applied.</CardContent>
      </Card>
    );
  }

  const list = events.data ?? [];
  const active = list.filter((event) => event.status === "active");
  const ended = list.filter((event) => event.status === "closed");

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-events">
        <CardHeader className="border-b border-border/80 px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="section-heading flex items-center gap-2"><CalendarDaysIcon className="h-4 w-4" aria-hidden="true" />Events</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Choose the event on Check-Out before serving its line. Ending an event keeps its history and stops new visits counting toward it.</p>
            </div>
            {canManage && <Button type="button" onClick={() => setEditing("new")} data-testid="button-create-event-page">New event</Button>}
          </div>
        </CardHeader>
        <CardContent className="px-4 py-2">
          {events.isPending && <p className="py-6 text-sm text-muted-foreground" role="status"><Loader2Icon className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading events</p>}
          {events.isError && (
            <div className="py-6" role="alert">
              <p className="text-sm text-destructive">The event list could not be loaded.</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => events.refetch()}>Retry</Button>
            </div>
          )}
          {!events.isPending && !events.isError && (
            <>
              <h2 className="sbd-eyebrow pt-3">Active</h2>
              {active.length === 0 && <p className="py-4 text-sm text-muted-foreground" data-testid="text-no-active-events">No active events. {canManage ? "Create one before the next distribution." : "Ask staff to create one."}</p>}
              {active.map((event) => <EventRow key={event.id} event={event} canManage={canManage} isAdmin={isAdmin} onEdit={() => setEditing(event)} onAction={(kind) => setPending({ kind, event })} historyOpen={historyFor === event.id} onHistory={() => setHistoryFor(historyFor === event.id ? null : event.id)} />)}
              <h2 className="sbd-eyebrow pt-6">Ended</h2>
              {ended.length === 0 && <p className="py-4 text-sm text-muted-foreground">No ended events.</p>}
              {ended.map((event) => <EventRow key={event.id} event={event} canManage={canManage} isAdmin={isAdmin} onEdit={() => setEditing(event)} onAction={(kind) => setPending({ kind, event })} historyOpen={historyFor === event.id} onHistory={() => setHistoryFor(historyFor === event.id ? null : event.id)} />)}
            </>
          )}
        </CardContent>
      </Card>

      {editing && <EventFormDialog event={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}

      <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open && !working) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.kind === "close" ? `End ${pending.event.name}?` : pending?.kind === "reopen" ? `Reopen ${pending?.event.name}?` : `Delete ${pending?.event.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "close" && "It leaves every session that has it selected, and new checkouts can no longer count toward it. Everything already recorded stays attributed to it."}
              {pending?.kind === "reopen" && "Staff can select it again and new checkouts can count toward it."}
              {pending?.kind === "delete" && "This removes an event that has no recorded activity. An event with activity can only be ended."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirm(); }} disabled={working} data-testid="button-confirm-event-action">
              {working && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending?.kind === "close" ? "End event" : pending?.kind === "reopen" ? "Reopen event" : "Delete event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EventRow({ event, canManage, isAdmin, onEdit, onAction, historyOpen, onHistory }: {
  event: FrcEvent; canManage: boolean; isAdmin: boolean; onEdit: () => void; onAction: (kind: "close" | "reopen" | "delete") => void; historyOpen: boolean; onHistory: () => void;
}) {
  const used = event.outboundTransactions + event.inboundTransactions > 0;
  return (
    <article className="sbd-event-row" data-testid={`row-event-${event.id}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3>{event.name}</h3>
          <Badge variant={event.status === "active" ? "secondary" : "outline"} className="text-[10px]">{event.status === "active" ? "Active" : "Ended"}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{eventWhen(event)}</p>
        {event.description && <p className="mt-1 text-sm">{event.description}</p>}
        <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-event-activity-${event.id}`}>
          {event.outboundTransactions.toLocaleString("en-US")} {event.outboundTransactions === 1 ? "checkout" : "checkouts"} and {event.inboundTransactions.toLocaleString("en-US")} {event.inboundTransactions === 1 ? "check in" : "check ins"} recorded.
        </p>
        {historyOpen && <EventHistory eventId={event.id} />}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit} data-testid={`button-edit-event-${event.id}`}>Edit</Button>
          {event.status === "active"
            ? <Button type="button" variant="outline" size="sm" onClick={() => onAction("close")} data-testid={`button-close-event-${event.id}`}>End event</Button>
            : <Button type="button" variant="outline" size="sm" onClick={() => onAction("reopen")} data-testid={`button-reopen-event-${event.id}`}>Reopen</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={onHistory} aria-expanded={historyOpen} data-testid={`button-history-event-${event.id}`}>History</Button>
          {isAdmin && !used && <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onAction("delete")} data-testid={`button-delete-event-${event.id}`}>Delete</Button>}
        </div>
      )}
    </article>
  );
}

function EventHistory({ eventId }: { eventId: string }) {
  const history = useQuery<HistoryEntry[]>({
    queryKey: [...EVENTS_KEY, eventId, "history"],
    queryFn: async () => (await apiRequest("GET", `/api/frc-events/${eventId}/history`)).json(),
  });
  if (history.isPending) return <p className="mt-2 text-xs text-muted-foreground" role="status">Loading history</p>;
  if (history.isError) return <p className="mt-2 text-xs text-destructive" role="alert">History could not be loaded.</p>;
  if (!history.data.length) return <p className="mt-2 text-xs text-muted-foreground">No recorded changes.</p>;
  return (
    <ol className="mt-2 space-y-1 border-l pl-3 text-xs" data-testid={`list-event-history-${eventId}`}>
      {history.data.map((entry) => (
        <li key={entry.id}>
          <span className="font-medium">{ACTION_TEXT[entry.action] ?? entry.action}</span>
          {" "}by {entry.actor ?? "a removed account"}, {new Date(entry.at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}
        </li>
      ))}
    </ol>
  );
}
