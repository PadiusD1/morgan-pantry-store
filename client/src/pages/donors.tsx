import { DirectoryReport } from "@/components/directory-report";
import { UnregisteredDonors } from "@/components/unregistered-donors";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, isEarlierSaveRecorded } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useSaveGuard } from "@/lib/save-guard";
import { cacheSavedDonor, donorKeys, removeCachedDonor, type DonorRecord as Donor } from "@/lib/donor-cache";
import { cacheSavedPartner, partnerSaveRequest } from "@/lib/partner-save";
import { visibleDonors, type DonorSort } from "@/lib/donor-list";
import { duplicateRefusal } from "@shared/identity";
import { confirmedDonor, donorErrorMessage, saveDonorRecord, type DonorForm } from "@/lib/donor-save";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { HeartHandshakeIcon, PlusIcon, PencilIcon, Trash2Icon, SearchIcon, Loader2 } from "lucide-react";

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
  const { user } = useAuth();
  const saveGuard = useSaveGuard();
  const deleteGuard = useSaveGuard();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DonorSort>("newest");
  const [registrationStarted, setRegistrationStarted] = useState(false);
  const [registrationType, setRegistrationType] = useState<"donor" | "partner">("donor");
  const [partnerIdentifier, setPartnerIdentifier] = useState("");
  const [lastSaved, setLastSaved] = useState<Donor | null>(null);
  const [editing, setEditing] = useState<DonorForm | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existingDonor, setExistingDonor] = useState<Donor | null>(null);

  const { data: donorData, isLoading, isError, isFetching, refetch } = useQuery<Donor[]>({
    queryKey: donorKeys.all,
    // Staff may register a donor from another screen, tab, or device.
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
  const donors = donorData ?? [];

  const filtered = useMemo(() => visibleDonors(donors, query, sort), [donors, query, sort]);

  function handleSave() {
    void saveGuard.run(saveDonor);
  }

  async function saveDonor(key: string): Promise<boolean | void> {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast({ title: "Name is required", description: "Enter a name before saving this registration.", variant: "destructive" });
      return;
    }
    setSaving(true);
    setRegistrationStarted(true);
    try {
      if (registrationType === "partner" && !editing.id) {
        const request = partnerSaveRequest({
          ...editing, identifier: partnerIdentifier.trim(), partnershipType: "Community Organization", contact: editing.contactName,
        });
        const response = await apiRequest(request.method, request.url, request.body, { idempotencyKey: key });
        const saved = await cacheSavedPartner(queryClient, await response.json());
        toast({ title: "Partner saved", description: `${saved.name} is now in Partners and the donation-source picker.` });
        setEditing(null);
        navigate("/partners");
        return true;
      }
      const result = await saveDonorRecord(editing, key);
      await cacheSavedDonor(queryClient, result.donor);
      if (result.outcome === "existing") {
        setExistingDonor(result.donor);
        // This request completed, but did not save the entered details. Keep
        // the form and use a new key if its name changes on the next attempt.
        return true;
      }
      toast({ title: result.outcome === "created" ? "Donor created" : "Donor updated", description: result.donor.name });
      setQuery("");
      setSort("newest");
      setLastSaved(result.donor);
      setEditing(null);
      setExistingDonor(null);
      return true;
    } catch (err) {
      if (registrationType === "partner" && isEarlierSaveRecorded(err)) {
        try {
          const saved = await cacheSavedPartner(queryClient, err.recorded);
          toast({ title: "Earlier partner saved", description: `${saved.name} was saved from the earlier attempt. Review the saved partner before making further changes.`, variant: "destructive" });
          setEditing(null);
          navigate(`/partners/${saved.id}`);
          return true;
        } catch { /* Keep the input if readback cannot be confirmed. */ }
      }
      if (registrationType === "donor" && isEarlierSaveRecorded(err)) {
        try {
          const recorded = confirmedDonor(err.recorded);
          await cacheSavedDonor(queryClient, recorded);
          if (err.recordedStatus !== 201) {
            // A recovered POST 200 found somebody already on file; it did
            // not create the donor described by this form. Preserve the
            // explicit review step before allowing edits to that person.
            setExistingDonor(recorded);
            return true;
          }
          // A lost answer followed by an edited retry saved the earlier
          // donor. Let the next attempt update it, not create another row.
          setExistingDonor(null);
          setEditing((current) => current ? { ...current, id: recorded.id } : current);
          saveGuard.renew();
          toast({
            title: "Earlier donor saved",
            description: `${recorded.name} was saved from your earlier attempt. Your latest entries are kept here. Review them and save again to update that donor.`,
            variant: "destructive",
          });
          return;
        } catch {
          // Fall through to a recoverable failure when the response is invalid.
        }
      }
      toast({ title: "Save failed", description: duplicateRefusal(err) ?? donorErrorMessage(err, "Could not save this registration. Your entries are kept. Try again."), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    void deleteGuard.run(deleteDonor);
  }

  async function deleteDonor(): Promise<boolean | void> {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/donors/${deleteConfirm.id}`);
      await removeCachedDonor(queryClient, deleteConfirm.id);
      toast({ title: "Donor deleted", description: `${deleteConfirm.name} has been removed.` });
      setDeleteConfirm(null);
      return true;
    } catch (err) {
      toast({ title: "Delete failed", description: donorErrorMessage(err, "Could not delete donor. Try again."), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(donor: Donor) {
    if (saveGuard.isLocked()) return;
    saveGuard.renew();
    setRegistrationType("donor");
              setRegistrationStarted(false);
    setExistingDonor(null);
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

  if (isError && !donorData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">Could not load donors.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <span>Donors could not be refreshed. Showing the last confirmed records.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      {lastSaved && <div role="status" className="rounded-md border p-3 text-sm" data-testid="donor-saved-confirmation">
        <strong>{lastSaved.name}</strong> is saved in Donors. <Link href={`/donors/${lastSaved.id}`} className="underline">View saved record</Link>
      </div>}
      <Card className="glass-panel" data-testid="card-donors-filters">
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search donors"
              placeholder="Search donors by name, organization, or notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              data-testid="input-donors-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="donor-sort">Sort</label>
            <select id="donor-sort" aria-label="Sort donors" className="h-9 rounded-md border bg-background px-2 text-sm" value={sort} onChange={e => setSort(e.target.value as DonorSort)}>
              <option value="newest">Newest additions first</option><option value="name">Name A–Z</option>
            </select>
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()} data-testid="button-refresh-donors">{isFetching ? "Refreshing…" : "Refresh"}</Button>
          </div>
          <Button
            size="sm"
            onClick={() => {
              saveGuard.renew();
              setExistingDonor(null);
              setRegistrationType("donor");
              setRegistrationStarted(false);
              setPartnerIdentifier(`PARTNER-${crypto.randomUUID()}`);
              setEditing({ ...emptyForm });
            }}
            data-testid="button-add-donor"
          >
            <PlusIcon className="h-4 w-4" />
            New donor
          </Button>
        </CardContent>
      </Card>

      <DirectoryReport kind="donor" records={filtered} directory={donors} />
      <UnregisteredDonors donors={donors} />
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
                    {query.trim() ? "No donors match your search. Clear the search to see all donors." : "No donors yet. Add a donor to start tracking donations."}
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
                    <Link href={`/donors/${d.id}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                      {d.name}
                    </Link>
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
                        aria-label={`Edit ${d.name}`}
                        data-testid={`button-edit-donor-${d.id}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </Button>
                      {user?.role === "admin" && <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive max-md:min-h-[40px] max-md:px-3"
                        onClick={() => setDeleteConfirm({ id: d.id, name: d.name })}
                        aria-label={`Delete ${d.name}`}
                        data-testid={`button-delete-donor-${d.id}`}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !saveGuard.isLocked()) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-donor-heading">
              {editing?.id ? "Edit donor" : registrationType === "partner" ? "Register partner" : "Add new donor"}
            </DialogTitle>
            <DialogDescription>
              {editing?.id
                ? "Update the donor information below."
                : `Fill in the details to register a new ${registrationType}.`}
            </DialogDescription>
          </DialogHeader>
          {existingDonor && (
            <div role="alert" className="space-y-2 rounded-md border border-amber-500/50 p-3 text-sm" data-testid="alert-donor-exists">
              <p><strong>{existingDonor.name}</strong> is already on file. Your new details have not been saved.</p>
              <p>Use a different name, or review the existing donor before editing their information.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => openEdit(existingDonor)}>
                Edit existing donor
              </Button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="space-y-3"
            aria-busy={saving}
          >
            <fieldset disabled={saving} className="space-y-3">
            {!editing?.id && <div className="space-y-1.5">
              <label htmlFor="relationship-registration-type" className="text-sm font-medium">Register as</label>
              <select id="relationship-registration-type" data-testid="select-registration-type" disabled={registrationStarted} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={registrationType} onChange={e => { setRegistrationType(e.target.value as "donor" | "partner"); setExistingDonor(null); }}>
                <option value="donor">Donor</option><option value="partner">Partner</option>
              </select>
              <p className="text-xs text-muted-foreground">Donors appear in Donors. Partners appear in Partners. Both are available when receiving a donation. {registrationStarted && "The registration type is fixed for this save attempt; retry to confirm it before starting a different registration."}</p>
            </div>}
            {!editing?.id && registrationType === "partner" && <div className="space-y-1.5">
              <label htmlFor="registration-partner-id" className="text-sm font-medium">Partner identifier</label>
              <Input id="registration-partner-id" data-testid="input-registration-partner-id" value={partnerIdentifier} onChange={e => setPartnerIdentifier(e.target.value)} required />
              <p className="text-xs text-muted-foreground">A unique identifier is provided. You may replace it with your organization's identifier.</p>
            </div>}
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
                {registrationType === "partner" && !editing?.id ? "Save partner" : "Save donor"}
              </Button>
            </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open && !deleteGuard.isLocked()) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete donor</DialogTitle>
            <DialogDescription>
              Delete <strong>{deleteConfirm?.name}</strong>? Only donors without linked donation history can be deleted. Set a donor with donation history to inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>{deleting ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
