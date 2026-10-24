import React, { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, isEarlierSaveRecorded } from "@/lib/queryClient";
import {
  EVENTS_KEY, eventErrorText, eventWhen, fromLocalInput, refreshEventData, toLocalInput,
  useEventSession, useEvents, useSelectEvent, type FrcEvent,
} from "@/lib/events";
import { Loader2Icon } from "lucide-react";

const NO_EVENT = "__none__";

/**
 * The event this signed in session is working, shown above check out and check
 * in. The choice is saved on the server for this session, so it stays through
 * every checkout, a reload and other pages until someone switches, clears or
 * ends it, and signing out forgets it.
 */
export function EventSessionBar({ mode }: { mode: "checkout" | "checkin" }) {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "staff";
  const session = useEventSession();
  const events = useEvents();
  const select = useSelectEvent();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  if (session.isPending) {
    return <div className="sbd-event-bar" data-state="loading" data-testid="event-bar"><p className="text-sm text-muted-foreground" role="status"><Loader2Icon className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading the active event</p></div>;
  }
  if (session.isError) {
    return (
      <div className="sbd-event-bar" data-state="error" data-testid="event-bar" role="alert">
        <p className="text-sm">The active event could not be loaded. {mode === "checkout" ? "Checkouts" : "Check ins"} save without an event until it loads.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => session.refetch()} disabled={session.isFetching}>Retry</Button>
      </div>
    );
  }
  // Without the event tables there is nothing to choose, and saving works as before.
  if (!session.data?.ready) return null;

  const selection = session.data.selection;
  const active = (events.data ?? []).filter((event) => event.status === "active");
  const choices = selection && !active.some((event) => event.id === selection.event.id) ? [selection.event, ...active] : active;

  function choose(value: string) {
    const eventId = value === NO_EVENT ? null : value;
    if ((selection?.event.id ?? null) === eventId) return;
    select.mutate({ eventId }, {
      onError: (error) => toast({ title: "Event not changed", description: eventErrorText(error, "The event could not be changed. Try again."), variant: "destructive" }),
    });
  }

  function setTag(tagInbound: boolean) {
    if (!selection) return;
    select.mutate({ eventId: selection.event.id, tagInbound }, {
      onError: (error) => toast({ title: "Not changed", description: eventErrorText(error, "The setting could not be saved. Try again."), variant: "destructive" }),
    });
  }

  const counts = mode === "checkout"
    ? "Every checkout saved here counts toward this event until you change or clear it."
    : selection?.tagInbound
      ? "Donations checked in here count toward this event."
      : "Donations checked in here are not counted toward this event.";

  return (
    <section className="sbd-event-bar" data-state={selection ? "active" : "none"} aria-labelledby="event-bar-label" data-testid="event-bar">
      <div className="min-w-0 flex-1">
        <p id="event-bar-label" className="sbd-eyebrow">Event</p>
        {selection ? (
          <>
            <p className="sbd-event-name" data-testid="text-active-event">{selection.event.name}</p>
            <p className="text-xs text-muted-foreground" data-testid="text-active-event-when">{eventWhen(selection.event)}. {counts}</p>
          </>
        ) : (
          <p className="text-sm" data-testid="text-active-event">
            No event selected. {mode === "checkout" ? "Checkouts are recorded as general distribution." : "Check ins are recorded without an event."}
          </p>
        )}
        {session.data.ended && !selection && (
          <p className="sbd-event-ended" role="status" data-testid="text-event-ended">{session.data.ended.name} was ended, so it is no longer selected.</p>
        )}
        {mode === "checkin" && selection && (
          <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2 text-sm" data-testid="label-tag-inbound">
            <Checkbox checked={selection.tagInbound} disabled={select.isPending} onCheckedChange={(value) => setTag(value === true)} data-testid="checkbox-tag-inbound" />
            Count donations received here toward {selection.event.name}
          </label>
        )}
      </div>
      <div className="sbd-event-actions">
        <Select value={selection?.event.id ?? NO_EVENT} onValueChange={choose} disabled={select.isPending || events.isPending}>
          <SelectTrigger className="min-w-0 sm:w-64" aria-label="Choose the active event" data-testid="select-active-event">
            <SelectValue placeholder="Choose an event" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_EVENT} data-testid="option-event-none">No event</SelectItem>
            {choices.map((event) => (
              <SelectItem key={event.id} value={event.id} data-testid={`option-event-${event.id}`}>{event.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selection && (
          <Button type="button" variant="outline" onClick={() => choose(NO_EVENT)} disabled={select.isPending} data-testid="button-clear-event">Clear</Button>
        )}
        {canManage && <Button type="button" variant="outline" onClick={() => setCreateOpen(true)} data-testid="button-new-event">New event</Button>}
        {canManage && <Link href="/events" className="self-center text-sm text-primary underline-offset-4 hover:underline" data-testid="link-manage-events">Manage events</Link>}
      </div>
      {events.isError && <p className="w-full text-xs text-destructive" role="alert">The event list could not be loaded. The selected event still applies.</p>}
      {createOpen && <EventFormDialog onClose={() => setCreateOpen(false)} onSaved={(event) => {
        setCreateOpen(false);
        select.mutate({ eventId: event.id }, {
          onSuccess: () => toast({ title: "Event selected", description: `${event.name} now applies to every ${mode === "checkout" ? "checkout" : "check in you choose to count"} in this session.` }),
          onError: (error) => toast({ title: "Event created, not selected", description: eventErrorText(error, "Choose it from the list."), variant: "destructive" }),
        });
      }} />}
    </section>
  );
}

/** Create an event, or edit one when `event` is given. Staff and admins only. */
export function EventFormDialog({ event, onClose, onSaved }: { event?: FrcEvent; onClose: () => void; onSaved: (event: FrcEvent) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(event?.name ?? "");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(event?.startsAt ?? new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(event?.endsAt));
  const [description, setDescription] = useState(event?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per dialog, so a create retried after a lost answer never makes a
  // second event. An edit sets values, so repeating one is harmless.
  const [key] = useState(() => crypto.randomUUID());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // A portal still bubbles React events, so a page form around the trigger
    // must never see this submit.
    e.stopPropagation();
    const start = fromLocalInput(startsAt);
    const end = fromLocalInput(endsAt);
    if (!name.trim()) return setProblem("Enter an event name.");
    if (!start) return setProblem("Enter when the event starts.");
    if (endsAt && !end) return setProblem("Enter a valid end, or leave it blank.");
    if (end && Date.parse(end) < Date.parse(start)) return setProblem("The end must be at or after the start.");
    setProblem(null);
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, startsAt: start, endsAt: end };
      let saved: FrcEvent;
      try {
        const res = event
          ? await apiRequest("PATCH", `/api/frc-events/${event.id}`, body, { idempotencyKey: crypto.randomUUID() })
          : await apiRequest("POST", "/api/frc-events", body, { idempotencyKey: key });
        saved = await res.json();
      } catch (error) {
        // An earlier try under this key was saved, so that event is the result.
        if (!event && isEarlierSaveRecorded(error) && error.recorded && typeof (error.recorded as FrcEvent).id === "string") saved = error.recorded as FrcEvent;
        else throw error;
      }
      queryClient.setQueryData<FrcEvent[]>(EVENTS_KEY, (old) => old ? [saved, ...old.filter((row) => row.id !== saved.id)] : old);
      refreshEventData(queryClient);
      toast({ title: event ? "Event updated" : "Event created", description: saved.name });
      onSaved(saved);
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      const duplicate = /"code":"event_duplicate"/.test(text);
      setProblem(eventErrorText(error, "The event could not be saved. Try again."));
      if (duplicate) refreshEventData(queryClient);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-event-form">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>Dates and times are in Baltimore time on this device. Staff choose the event before checking anyone out.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="event-name" className="text-sm font-medium">Event name</label>
            <Input id="event-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus data-testid="input-event-name" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="event-start" className="text-sm font-medium">Starts</label>
              <Input id="event-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required data-testid="input-event-start" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-end" className="text-sm font-medium">Ends (optional)</label>
              <Input id="event-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} data-testid="input-event-end" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-description" className="text-sm font-medium">Description (optional)</label>
            <Textarea id="event-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} data-testid="input-event-description" />
            <p className="text-xs text-muted-foreground">Board reports can show event names. Keep student names and contact details out of names and descriptions.</p>
          </div>
          {problem && <p className="text-sm text-destructive" role="alert" data-testid="text-event-form-error">{problem}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving} data-testid="button-save-event">{saving && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{event ? "Save changes" : "Create event"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
