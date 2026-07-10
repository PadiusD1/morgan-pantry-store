import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { HeartHandshakeIcon, PlusIcon, PencilIcon, Trash2Icon, SearchIcon, Loader2 } from "lucide-react";

interface Donor {
  id: string;
  name: string;
  organization?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  status: string;
  totalDonations?: number;
  totalItems?: number;
  lastDonation?: string;
  createdAt: string;
}

interface DonorForm {
  id?: string;
  name: string;
  organization: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: string;
}

const emptyForm: DonorForm = {
  id: undefined,
  name: "",
  organization: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  status: "active",
};

export default function DonorsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DonorForm | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: donors = [], isLoading, isError, refetch } = useQuery<Donor[]>({
    queryKey: ["/api/donors"],
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return donors;
    return donors.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.organization && d.organization.toLowerCase().includes(q)) ||
        (d.notes && d.notes.toLowerCase().includes(q)),
    );
  }, [donors, query]);

  async function handleSave() {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast({ title: "Donor name is required", description: "Enter a name before saving this donor." });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: editing.name.trim(),
        organization: editing.organization.trim() || undefined,
        contactName: editing.contactName.trim() || undefined,
        phone: editing.phone.trim() || undefined,
        email: editing.email.trim() || undefined,
        address: editing.address.trim() || undefined,
        notes: editing.notes.trim() || undefined,
        status: editing.status,
      };
      if (editing.id) {
        await apiRequest("PATCH", `/api/donors/${editing.id}`, payload);
        toast({ title: "Donor updated", description: payload.name });
      } else {
        await apiRequest("POST", "/api/donors", payload);
        toast({ title: "Donor created", description: payload.name });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/donors"] });
      setEditing(null);
    } catch {
      toast({ title: "Save failed", description: "Could not save donor. Try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await apiRequest("DELETE", `/api/donors/${deleteConfirm.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/donors"] });
      toast({ title: "Donor deleted", description: `${deleteConfirm.name} has been removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete donor. Try again." });
    }
    setDeleteConfirm(null);
  }

  function openEdit(donor: Donor) {
    setEditing({
      id: donor.id,
      name: donor.name,
      organization: donor.organization ?? "",
      contactName: donor.contactName ?? "",
      phone: donor.phone ?? "",
      email: donor.email ?? "",
      address: donor.address ?? "",
      notes: donor.notes ?? "",
      status: donor.status ?? "active",
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">Could not load donors.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-donors-filters">
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search donors by name, organization, or notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              data-testid="input-donors-search"
            />
          </div>
          <Button
            size="sm"
            onClick={() => setEditing({ ...emptyForm })}
            data-testid="button-add-donor"
          >
            <PlusIcon className="h-4 w-4" />
            New donor
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-donors-table">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span className="flex items-center gap-2">
              <HeartHandshakeIcon className="h-4 w-4" />
              Donors
            </span>
            <span className="pill-muted" data-testid="text-donors-count">
              {filtered.length} of {donors.length} records
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Organization</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell text-right">Total Donations</TableHead>
                <TableHead className="hidden md:table-cell text-right">Total Items</TableHead>
                <TableHead className="hidden md:table-cell">Last Donation</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-no-donors"
                  >
                    No donors yet. Add a donor to start tracking donations.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/donors/${d.id}`)}
                  data-testid={`row-donor-${d.id}`}
                >
                  <TableCell className="text-sm font-medium" data-testid={`text-donor-name-${d.id}`}>
                    {d.name}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-donor-org-${d.id}`}>
                    {d.organization || "\u2014"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-donor-contact-${d.id}`}>
                    {d.phone || d.email || d.contactName || "\u2014"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-right" data-testid={`text-donor-total-donations-${d.id}`}>
                    {d.totalDonations ?? 0}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-right" data-testid={`text-donor-total-items-${d.id}`}>
                    {d.totalItems ?? 0}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs" data-testid={`text-donor-last-donation-${d.id}`}>
                    {d.lastDonation
                      ? new Date(d.lastDonation).toLocaleDateString()
                      : "No donations yet"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    <Badge
                      variant={d.status === "active" ? "default" : "secondary"}
                      className="text-[10px] h-5 px-1.5"
                    >
                      {d.status ?? "active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs max-md:min-h-[40px] max-md:px-3"
                        onClick={() => openEdit(d)}
                        data-testid={`button-edit-donor-${d.id}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive max-md:min-h-[40px] max-md:px-3"
                        onClick={() => setDeleteConfirm({ id: d.id, name: d.name })}
                        data-testid={`button-delete-donor-${d.id}`}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-donor-heading">
              {editing?.id ? "Edit donor" : "Add new donor"}
            </DialogTitle>
            <DialogDescription>
              {editing?.id
                ? "Update the donor information below."
                : "Fill in the details to register a new donor."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-name-edit">
                Name *
              </label>
              <Input
                id="donor-name-edit"
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                data-testid="input-edit-donor-name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-org-edit">
                Organization
              </label>
              <Input
                id="donor-org-edit"
                value={editing?.organization ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, organization: e.target.value } : p))}
                data-testid="input-edit-donor-org"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-contact-edit">
                Contact Name
              </label>
              <Input
                id="donor-contact-edit"
                value={editing?.contactName ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, contactName: e.target.value } : p))}
                data-testid="input-edit-donor-contact"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="donor-phone-edit">Phone</label>
                <Input
                  id="donor-phone-edit"
                  type="tel"
                  value={editing?.phone ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, phone: e.target.value } : p))}
                  data-testid="input-edit-donor-phone"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="donor-email-edit">Email</label>
                <Input
                  id="donor-email-edit"
                  type="email"
                  value={editing?.email ?? ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, email: e.target.value } : p))}
                  data-testid="input-edit-donor-email"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-address-edit">Address</label>
              <Input
                id="donor-address-edit"
                value={editing?.address ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, address: e.target.value } : p))}
                data-testid="input-edit-donor-address"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-status-edit">Status</label>
              <Select
                value={editing?.status ?? "active"}
                onValueChange={(val) => setEditing((p) => (p ? { ...p, status: val } : p))}
              >
                <SelectTrigger id="donor-status-edit" data-testid="select-edit-donor-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="donor-notes-edit">Notes</label>
              <Input
                id="donor-notes-edit"
                value={editing?.notes ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, notes: e.target.value } : p))}
                placeholder="Any additional notes..."
                data-testid="input-edit-donor-notes"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
                data-testid="button-cancel-edit-donor"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving} data-testid="button-save-donor">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save donor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete donor</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>? This action cannot be undone. Their donation history will be preserved but unlinked.
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
