import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import type { ClientRecord } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Handshake, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";

// Partners Hub
//
// Partners are organizations that receive bulk distributions from the FRC
// (community partners, sister pantries, faith-based orgs, etc.). They live in
// the `clients` table with client_type='partner' so they can still appear as
// recipients during check-out, but they are kept on a dedicated page so the
// staff-facing Clients list only shows students.

type PartnerForm = {
  id?: string;
  name: string;
  identifier: string;
  organization: string;
  partnershipType: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: string;
  notes?: string;
};

const emptyForm: PartnerForm = {
  id: undefined,
  name: "",
  identifier: "",
  organization: "",
  partnershipType: "Community Organization",
  contact: "",
  phone: "",
  email: "",
  address: "",
  status: "active",
  notes: "",
};

const PARTNERSHIP_TYPES = [
  "Community Organization",
  "Faith-Based Partner",
  "Campus Department",
  "Sister Pantry",
  "Government Agency",
  "Other",
];

export default function PartnersPage() {
  const { clients, upsertClient, transactions } = useRepository();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PartnerForm | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Only show partner-type clients on this surface.
  const partners = useMemo<ClientRecord[]>(
    () => clients.filter((c) => c.clientType === "partner"),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.identifier.toLowerCase().includes(q) ||
      (p.organization && p.organization.toLowerCase().includes(q)) ||
      (p.partnershipType && p.partnershipType.toLowerCase().includes(q)) ||
      (p.email && p.email.toLowerCase().includes(q)) ||
      (p.phone && p.phone.toLowerCase().includes(q)) ||
      (p.notes && p.notes.toLowerCase().includes(q)),
    );
  }, [partners, query]);

  function partnerContributions(partner: ClientRecord) {
    const partnerName = partner.name.trim().toLowerCase();
    return transactions.filter(
      (t) =>
        t.type === "IN" &&
        (t.clientId === partner.id || t.donor?.trim().toLowerCase() === partnerName),
    );
  }

  function partnerDistributions(partnerId: string) {
    return transactions.filter((t) => t.type === "OUT" && t.clientId === partnerId);
  }

  function lastPartnerActivity(partner: ClientRecord) {
    const partnerName = partner.name.trim().toLowerCase();
    const visit = transactions.find(
      (t) =>
        (t.type === "OUT" && t.clientId === partner.id) ||
        (t.type === "IN" && (t.clientId === partner.id || t.donor?.trim().toLowerCase() === partnerName)),
    );
    return visit ? new Date(visit.timestamp) : undefined;
  }

  function totalUnitsGiven(partner: ClientRecord) {
    return partnerContributions(partner).reduce(
      (sum, tx) => sum + tx.items.reduce((s, i) => s + i.quantity, 0),
      0,
    );
  }

  function totalValueGiven(partner: ClientRecord) {
    return partnerContributions(partner).reduce(
      (sum, tx) => sum + tx.items.reduce((s, i) => s + i.quantity * i.valuePerUnitUsd, 0),
      0,
    );
  }

  function totalUnitsDistributed(partnerId: string) {
    return partnerDistributions(partnerId).reduce(
      (sum, tx) => sum + tx.items.reduce((s, i) => s + i.quantity, 0),
      0,
    );
  }

  function totalValueDistributed(partnerId: string) {
    return partnerDistributions(partnerId).reduce(
      (sum, tx) => sum + tx.items.reduce((s, i) => s + i.quantity * i.valuePerUnitUsd, 0),
      0,
    );
  }

  function handleSave() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.identifier.trim()) {
      toast({ title: "Missing required fields", description: "Partner name and identifier are required." });
      return;
    }
    const saved = upsertClient({
      id: editing.id,
      name: editing.name.trim(),
      identifier: editing.identifier.trim(),
      contact: editing.contact?.trim() || undefined,
      phone: editing.phone?.trim() || undefined,
      email: editing.email?.trim() || undefined,
      address: editing.address?.trim() || undefined,
      organization: editing.organization.trim() || undefined,
      partnershipType: editing.partnershipType || undefined,
      status: editing.status,
      notes: editing.notes?.trim() || undefined,
      clientType: "partner",
      householdSize: 1,
      allergies: [],
    });
    toast({ title: "Partner saved", description: saved.name });
    setEditing(null);
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await apiRequest("DELETE", `/api/clients/${deleteConfirm.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Partner removed", description: `${deleteConfirm.name} has been removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete partner. Try again." });
    }
    setDeleteConfirm(null);
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-partners-filters">
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, organization, partnership type..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              data-testid="input-partners-search"
            />
          </div>
          <Button
            size="sm"
            onClick={() => setEditing({ ...emptyForm })}
            data-testid="button-add-partner"
          >
            <PlusIcon className="h-4 w-4" />
            New partner
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-partners-table">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              Partner Organizations
            </span>
            <span className="pill-muted" data-testid="text-partners-count">
              {filtered.length} of {partners.length} records
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Organization</TableHead>
                <TableHead className="hidden md:table-cell">Partnership type</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell text-right">Gave us</TableHead>
                <TableHead className="hidden md:table-cell text-right">Received from us</TableHead>
                <TableHead className="hidden md:table-cell">Last activity</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-no-partners"
                  >
                    No partner organizations yet. Add one to start tracking bulk distributions.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => {
                const last = lastPartnerActivity(p);
                return (
                  <TableRow key={p.id} data-testid={`row-partner-${p.id}`}>
                    <TableCell className="text-sm font-medium" data-testid={`text-partner-name-${p.id}`}>
                      <Link href={`/partners/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-partner-org-${p.id}`}>
                      {p.organization || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs" data-testid={`text-partner-type-${p.id}`}>
                      {p.partnershipType || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-partner-contact-${p.id}`}>
                      {p.phone || p.email || p.contact || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-right" data-testid={`text-partner-gave-us-${p.id}`}>
                      <div className="font-medium">{totalUnitsGiven(p)} units</div>
                      <div className="text-muted-foreground">${totalValueGiven(p).toFixed(2)}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-right" data-testid={`text-partner-received-${p.id}`}>
                      <div className="font-medium">{totalUnitsDistributed(p.id)} units</div>
                      <div className="text-muted-foreground">${totalValueDistributed(p.id).toFixed(2)}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs" data-testid={`text-partner-last-${p.id}`}>
                      {last ? last.toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      <Badge
                        variant={p.status === "active" ? "default" : "secondary"}
                        className="text-[10px] h-5 px-1.5"
                      >
                        {p.status ?? "active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <div className="flex justify-end gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs max-md:min-h-[40px] max-md:px-3"
                          data-testid={`button-view-partner-${p.id}`}
                        >
                          <Link href={`/partners/${p.id}`}>View</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs max-md:min-h-[40px] max-md:px-3"
                          onClick={() =>
                            setEditing({
                              id: p.id,
                              name: p.name,
                              identifier: p.identifier,
                              organization: p.organization ?? "",
                              partnershipType: p.partnershipType ?? "Community Organization",
                              contact: p.contact,
                              phone: p.phone,
                              email: p.email,
                              address: p.address,
                              status: p.status ?? "active",
                              notes: p.notes,
                            })
                          }
                          data-testid={`button-edit-partner-${p.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive max-md:min-h-[40px] max-md:px-3"
                          onClick={() => setDeleteConfirm({ id: p.id, name: p.name })}
                          data-testid={`button-delete-partner-${p.id}`}
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

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-partner-heading">
              {editing?.id ? "Edit partner" : "Add new partner"}
            </DialogTitle>
            <DialogDescription>
              {editing?.id
                ? "Update the partner organization details below."
                : "Partner organizations receive goods from the pantry. They appear as recipients on check-out."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-name">Partner name *</label>
                  <Input
                    id="partner-name"
                    value={editing.name}
                    onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                    required
                    data-testid="input-edit-partner-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-identifier">Identifier *</label>
                  <Input
                    id="partner-identifier"
                    value={editing.identifier}
                    onChange={(e) => setEditing((p) => (p ? { ...p, identifier: e.target.value } : p))}
                    placeholder="e.g. partner-baltcity-001"
                    required
                    data-testid="input-edit-partner-identifier"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-org">Organization</label>
                  <Input
                    id="partner-org"
                    value={editing.organization}
                    onChange={(e) => setEditing((p) => (p ? { ...p, organization: e.target.value } : p))}
                    placeholder="Parent org / agency"
                    data-testid="input-edit-partner-org"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-type">Partnership type</label>
                  <Select
                    value={editing.partnershipType}
                    onValueChange={(val) => setEditing((p) => (p ? { ...p, partnershipType: val } : p))}
                  >
                    <SelectTrigger id="partner-type" data-testid="select-edit-partner-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTNERSHIP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-contact">Contact name</label>
                  <Input
                    id="partner-contact"
                    value={editing.contact ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, contact: e.target.value } : p))}
                    data-testid="input-edit-partner-contact"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-phone">Phone</label>
                  <Input
                    id="partner-phone"
                    type="tel"
                    value={editing.phone ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, phone: e.target.value } : p))}
                    data-testid="input-edit-partner-phone"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-email">Email</label>
                  <Input
                    id="partner-email"
                    type="email"
                    value={editing.email ?? ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, email: e.target.value } : p))}
                    data-testid="input-edit-partner-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="partner-status">Status</label>
                  <Select
                    value={editing.status}
                    onValueChange={(val) => setEditing((p) => (p ? { ...p, status: val } : p))}
                  >
                    <SelectTrigger id="partner-status" data-testid="select-edit-partner-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="partner-address">Address</label>
                <Input
                  id="partner-address"
                  value={editing.address ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, address: e.target.value } : p))}
                  data-testid="input-edit-partner-address"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="partner-notes">Notes</label>
                <Input
                  id="partner-notes"
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, notes: e.target.value } : p))}
                  placeholder="Frequency, contact preferences, what they accept..."
                  data-testid="input-edit-partner-notes"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)} data-testid="button-cancel-edit-partner">
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-partner">Save partner</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove partner</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteConfirm?.name}</strong>? Their distribution history will be preserved but unlinked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
