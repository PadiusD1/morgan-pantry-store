import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSaveGuard } from "@/lib/save-guard";
import { apiRequest, isEarlierSaveRecorded, saveErrorMessage } from "@/lib/queryClient";
import { cacheSavedPartner, partnerSaveRequest, type PartnerForm } from "@/lib/partner-save";
import type { ApiClient } from "@/lib/api-types";
import { duplicateRefusal } from "@shared/identity";

/** Register without leaving checkout or losing the current distribution cart. */
export function PartnerRegistrationDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (partner: ApiClient) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const guard = useSaveGuard();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PartnerForm>(() => ({ name: "", identifier: `PARTNER-${crypto.randomUUID()}`, organization: "", contact: "", email: "", phone: "", status: "active", partnershipType: "Community Organization" }));
  async function save(key: string): Promise<boolean> {
    if (!form.name.trim() || !form.identifier.trim()) return false;
    setSaving(true);
    try {
      const request = partnerSaveRequest(form);
      const response = await apiRequest(request.method, request.url, request.body, { idempotencyKey: key });
      const partner = await cacheSavedPartner(queryClient, await response.json());
      toast({ title: "Partner saved", description: `${partner.name} is selected for this checkout. Your cart is unchanged.` });
      onSaved(partner);
      return true;
    } catch (error) {
      if (isEarlierSaveRecorded(error)) {
        try {
          const partner = await cacheSavedPartner(queryClient, error.recorded);
          toast({ title: "Earlier partner saved", description: `${partner.name} was saved from the earlier attempt and is selected. Later typed changes were not saved.`, variant: "destructive" });
          onSaved(partner);
          return true;
        } catch { /* Unconfirmed responses keep the form and retry key. */ }
      }
      toast({ title: "Partner not saved", description: duplicateRefusal(error) ?? saveErrorMessage(error, "Your entries and cart are kept. Try again to confirm this registration."), variant: "destructive" });
      return false;
    } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !guard.isLocked()) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Register partner</DialogTitle><DialogDescription>This creates a partner record and selects it for checkout without changing your cart.</DialogDescription></DialogHeader>
      <form className="space-y-3" aria-busy={saving} onSubmit={event => { event.preventDefault(); void guard.run(save); }}>
        <fieldset disabled={saving} className="space-y-3">
          {([
            ["name", "Partner name", true], ["identifier", "Partner identifier", true],
            ["organization", "Organization", false], ["contact", "Contact person", false],
            ["email", "Email", false], ["phone", "Phone", false],
          ] as const).map(([key, label, required]) => <div key={key} className="space-y-1.5">
            <label htmlFor={`checkout-partner-${key}`} className="text-sm font-medium">{label}{required ? " *" : ""}</label>
            <Input id={`checkout-partner-${key}`} data-testid={`input-checkout-partner-${key}`} required={required} type={key === "email" ? "email" : "text"} value={form[key] ?? ""} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />
          </div>)}
          <p className="text-xs text-muted-foreground">Partners are listed in Partners and in donation-source selectors. Existing records are not merged or renamed by registration.</p>
        </fieldset>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving} data-testid="button-save-checkout-partner">{saving ? "Saving…" : "Save and select partner"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
