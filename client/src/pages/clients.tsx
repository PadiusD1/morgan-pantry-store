import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PlusIcon, SearchIcon, XIcon, Trash2Icon, SirenIcon } from "lucide-react";

// Safely highlight query matches inside a note. Renders plain React text nodes
// (React escapes them automatically) and wraps matches in <mark> — never uses
// dangerouslySetInnerHTML, so a malicious note body cannot inject markup.
function highlightNote(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export default function ClientsPage() {
  const { clients: allClients, upsertClient, transactions, settings } = useRepository();
  // The Clients page is for student clients only — partner orgs live under /partners.
  // Treat NULL/unset client_type as 'student' for backward compatibility with existing rows.
  const clients = useMemo(
    () => allClients.filter((c) => !c.clientType || c.clientType === "student"),
    [allClients],
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    identifier: string;
    contact?: string;
    phone?: string;
    email?: string;
    address?: string;
    dateOfBirth?: string;
    householdSize?: number;
    status?: string;
    allergies: string[];
    notes?: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.identifier.toLowerCase().includes(q) ||
      (c.contact && c.contact.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.notes && c.notes.toLowerCase().includes(q)) ||
      (c.allergies && c.allergies.some((a: string) => a.toLowerCase().includes(q))),
    );
  }, [clients, query]);

  // Quick-filter chips from common notes keywords
  const notesKeywords = useMemo(() => {
    const words = new Map<string, number>();
    for (const c of clients) {
      if (!c.notes) continue;
      for (const word of c.notes.toLowerCase().split(/\s+/)) {
        if (word.length >= 4) words.set(word, (words.get(word) || 0) + 1);
      }
    }
    return [...words.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [clients]);

  function handleSave() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.identifier.trim()) {
      toast({ title: "Missing required fields", description: "Name and identifier are required." });
      return;
    }
    const client = upsertClient({
      id: editing.id,
      name: editing.name.trim(),
      identifier: editing.identifier.trim(),
      contact: editing.contact?.trim() || undefined,
      phone: editing.phone?.trim() || undefined,
      email: editing.email?.trim() || undefined,
      address: editing.address?.trim() || undefined,
      dateOfBirth: editing.dateOfBirth || undefined,
      householdSize: editing.householdSize ?? 1,
      status: editing.status ?? "active",
      allergies: editing.allergies,
      notes: editing.notes?.trim() || undefined,
    });
    toast({ title: "Client saved", description: client.name });
    setEditing(null);
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await apiRequest("DELETE", `/api/clients/${deleteConfirm.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted", description: `${deleteConfirm.name} has been removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete client. Try again." });
    }
    setDeleteConfirm(null);
  }

  function lastVisitDate(clientId: string) {
    const visit = transactions.find((t) => t.type === "OUT" && t.clientId === clientId);
    if (!visit) return undefined;
    return new Date(visit.timestamp);
  }

  // Per-client emergency count. Students with more than 1 Emergency Shop Appointment
  // are surfaced as "flagged" in the Status column.
  const emergencyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type !== "OUT" || !tx.isEmergency || !tx.clientId) continue;
      map.set(tx.clientId, (map.get(tx.clientId) ?? 0) + 1);
    }
    return map;
  }, [transactions]);

  function visitWarning(clientId: string) {
    const last = lastVisitDate(clientId);
    if (!last) return undefined;
    const days = settings.visitWarningDays ?? 7;
    const diffMs = Date.now() - last.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < days) {
      return {
        days: Math.round(diffDays),
      };
    }
    return undefined;
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-clients-filters">
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, ID, contact, or notes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              data-testid="input-clients-search"
            />
          </div>
          {notesKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {notesKeywords.map(([word, count]) => (
                <button key={word} type="button" className="text-[10px] px-2 py-0.5 rounded-full border bg-muted/50 hover:bg-muted text-muted-foreground" onClick={() => setQuery(word)}>
                  {word} ({count})
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            onClick={() => setEditing({ id: undefined, name: "", identifier: "", contact: "", phone: "", email: "", address: "", dateOfBirth: "", householdSize: 1, status: "active", allergies: [], notes: "" })}
            data-testid="button-add-client"
          >
            <PlusIcon className="h-4 w-4" />
            New client
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-clients-table">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span>Clients</span>
            <span className="pill-muted" data-testid="text-clients-count">
              {filtered.length} of {clients.length} records
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Identifier</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell">Household</TableHead>
                <TableHead className="hidden md:table-cell">Notes</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="hidden md:table-cell">Last visit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-no-clients"
                  >
                    No clients yet. Add a client here or during Check-Out.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c) => {
                const last = lastVisitDate(c.id);
                const warning = visitWarning(c.id);
                return (
                  <TableRow key={c.id} data-testid={`row-client-${c.id}`}>
                    <TableCell className="text-sm font-medium" data-testid={`text-client-name-${c.id}`}>
                      {c.name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs" data-testid={`text-client-identifier-${c.id}`}>
                      {c.identifier}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-client-contact-${c.id}`}>
                      {c.phone || c.email || c.contact || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-center" data-testid={`text-client-household-${c.id}`}>
                      {c.householdSize ?? 1}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[150px] truncate" title={c.notes || ""}>
                      {c.notes
                        ? highlightNote(c.notes.substring(0, 50) + (c.notes.length > 50 ? "..." : ""), query)
                        : ""}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={c.status === "active" ? "default" : "secondary"}
                          className="text-[10px] h-5 px-1.5 w-fit"
                        >
                          {c.status ?? "active"}
                        </Badge>
                        {(emergencyCounts.get(c.id) ?? 0) > 1 && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] h-5 px-1.5 w-fit"
                            data-testid={`badge-flagged-${c.id}`}
                          >
                            <SirenIcon className="h-3 w-3 mr-1" />
                            Flagged · {emergencyCounts.get(c.id)} emergencies
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs" data-testid={`text-client-last-visit-${c.id}`}>
                      {last ? last.toLocaleDateString() : "No visits yet"}
                      {warning && (
                        <div className="text-[11px] text-amber-700" data-testid={`status-client-frequency-${c.id}`}>
                          Visited {warning.days} day{warning.days === 1 ? "" : "s"} ago (within {settings.visitWarningDays} day window)
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <div className="flex justify-end gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs max-md:min-h-[40px] max-md:px-3"
                          data-testid={`button-view-client-${c.id}`}
                        >
                          <Link href={`/clients/${c.id}`} data-testid={`link-client-${c.id}`}>
                            View
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs max-md:min-h-[40px] max-md:px-3"
                          onClick={() => setEditing({ id: c.id, name: c.name, identifier: c.identifier, contact: c.contact, phone: c.phone, email: c.email, address: c.address, dateOfBirth: c.dateOfBirth, householdSize: c.householdSize ?? 1, status: c.status ?? "active", allergies: c.allergies || [], notes: c.notes })}
                          data-testid={`button-edit-client-${c.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive max-md:min-h-[40px] max-md:px-3"
                          onClick={() => setDeleteConfirm({ id: c.id, name: c.name })}
                          data-testid={`button-delete-client-${c.id}`}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <Card className="glass-panel max-w-xl" data-testid="card-edit-client">
          <CardHeader>
            <CardTitle className="section-heading" data-testid="text-edit-client-heading">
              {editing.id ? "Edit client" : "Add new client"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-name-edit" data-testid="label-edit-client-name">
                  Name
                </label>
                <Input
                  id="client-name-edit"
                  value={editing.name}
                  onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                  data-testid="input-edit-client-name"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-id-edit" data-testid="label-edit-client-identifier">
                  BearCard number / ID / email
                </label>
                <Input
                  id="client-id-edit"
                  value={editing.identifier}
                  onChange={(e) => setEditing((p) => (p ? { ...p, identifier: e.target.value } : p))}
                  data-testid="input-edit-client-identifier"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-contact-edit" data-testid="label-edit-client-contact">
                  Contact (optional)
                </label>
                <Input
                  id="client-contact-edit"
                  value={editing.contact ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, contact: e.target.value } : p))}
                  data-testid="input-edit-client-contact"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="client-phone-edit">Phone</label>
                  <Input
                    id="client-phone-edit"
                    type="tel"
                    value={editing.phone ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, phone: e.target.value } : p))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="client-email-edit">Email</label>
                  <Input
                    id="client-email-edit"
                    type="email"
                    value={editing.email ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, email: e.target.value } : p))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-address-edit">Address</label>
                <Input
                  id="client-address-edit"
                  value={editing.address ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, address: e.target.value } : p))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="client-dob-edit">Date of birth</label>
                  <Input
                    id="client-dob-edit"
                    type="date"
                    value={editing.dateOfBirth ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, dateOfBirth: e.target.value } : p))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="client-household-edit">Household size</label>
                  <Input
                    id="client-household-edit"
                    type="number"
                    min={1}
                    value={editing.householdSize ?? 1}
                    onChange={(e) => setEditing((p) => (p ? { ...p, householdSize: parseInt(e.target.value) || 1 } : p))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="client-status-edit">Status</label>
                  <select
                    id="client-status-edit"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={editing.status ?? "active"}
                    onChange={(e) => setEditing((p) => (p ? { ...p, status: e.target.value } : p))}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-notes-edit">Notes</label>
                <Input
                  id="client-notes-edit"
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, notes: e.target.value } : p))}
                  placeholder="Any additional notes..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-allergies-edit">
                  Allergies
                </label>
                <div className="flex flex-wrap gap-2 mb-2 p-2 border rounded-md min-h-[40px]">
                  {editing.allergies.map((allergy, idx) => (
                    <Badge key={idx} variant="secondary" className="gap-1">
                      {allergy}
                      <button
                        type="button"
                        onClick={() => setEditing(p => p ? ({...p, allergies: p.allergies.filter((_, i) => i !== idx)}) : p)}
                        className="hover:text-destructive"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    type="text"
                    className="border-none shadow-none focus-visible:ring-0 h-6 p-0 w-32 min-w-[80px]"
                    placeholder="Add allergy..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim();
                        if (val && !editing.allergies.includes(val)) {
                          setEditing(p => p ? ({...p, allergies: [...p.allergies, val]}) : p);
                          e.currentTarget.value = '';
                        }
                      }
                    }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">Type allergy and press Enter to add.</p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                  data-testid="button-cancel-edit-client"
                >
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-client">
                  Save client
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete client</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>? This action cannot be undone. Their visit history will be preserved but unlinked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
