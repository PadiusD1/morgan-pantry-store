import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { SaveIcon, SettingsIcon, Loader2 } from "lucide-react";

type SettingsMap = Record<string, string>;

export default function SettingsPage() {
  const { settings, updateSettings } = useRepository();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: serverSettings = {} } = useQuery<SettingsMap>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings");
      return res.json();
    },
  });

  const [form, setForm] = useState({
    orgName: "",
    orgAddress: "",
    orgPhone: "",
    orgEmail: "",
    visitWarningDays: 7,
    maxHouseholdSize: 20,
    defaultDistributionNote: "",
  });

  useEffect(() => {
    setForm({
      orgName: serverSettings.orgName ?? "",
      orgAddress: serverSettings.orgAddress ?? "",
      orgPhone: serverSettings.orgPhone ?? "",
      orgEmail: serverSettings.orgEmail ?? "",
      visitWarningDays: parseInt(serverSettings.visitWarningDays ?? "") || settings.visitWarningDays || 7,
      maxHouseholdSize: parseInt(serverSettings.maxHouseholdSize ?? "") || 20,
      defaultDistributionNote: serverSettings.defaultDistributionNote ?? "",
    });
  }, [serverSettings, settings.visitWarningDays]);

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const entries: [string, string][] = [
      ["orgName", form.orgName],
      ["orgAddress", form.orgAddress],
      ["orgPhone", form.orgPhone],
      ["orgEmail", form.orgEmail],
      ["visitWarningDays", String(form.visitWarningDays)],
      ["maxHouseholdSize", String(form.maxHouseholdSize)],
      ["defaultDistributionNote", form.defaultDistributionNote],
    ];

    const failed: string[] = [];
    // Parallel save with per-key error tracking
    await Promise.all(
      entries.map(async ([key, value]) => {
        try {
          const res = await apiRequest("PUT", `/api/settings/${key}`, { value });
          if (!res.ok) failed.push(key);
        } catch {
          failed.push(key);
        }
      })
    );

    // Sync local settings regardless (visitWarningDays affects UI warnings)
    updateSettings({ visitWarningDays: form.visitWarningDays });
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    setSaving(false);

    if (failed.length === 0) {
      toast({ title: "Settings saved", description: "Organization settings updated." });
    } else {
      toast({
        title: "Some settings failed to save",
        description: `Could not save: ${failed.join(", ")}. Please try again.`,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="glass-panel" data-testid="card-org-settings">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <SettingsIcon className="h-4 w-4" />
            Organization Details
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="org-name">
                Organization name
              </label>
              <Input
                id="org-name"
                value={form.orgName}
                onChange={(e) => setForm((p) => ({ ...p, orgName: e.target.value }))}
                placeholder="Morgan State University Food Resource Center"
                data-testid="input-org-name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="org-address">
                Address
              </label>
              <Input
                id="org-address"
                value={form.orgAddress}
                onChange={(e) => setForm((p) => ({ ...p, orgAddress: e.target.value }))}
                placeholder="1700 E Cold Spring Ln, Baltimore, MD 21251"
                data-testid="input-org-address"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="org-phone">
                  Phone
                </label>
                <Input
                  id="org-phone"
                  type="tel"
                  value={form.orgPhone}
                  onChange={(e) => setForm((p) => ({ ...p, orgPhone: e.target.value }))}
                  data-testid="input-org-phone"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="org-email">
                  Email
                </label>
                <Input
                  id="org-email"
                  type="email"
                  value={form.orgEmail}
                  onChange={(e) => setForm((p) => ({ ...p, orgEmail: e.target.value }))}
                  data-testid="input-org-email"
                />
              </div>
            </div>

            <div className="border-t border-border/80 pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-3">Visit & Distribution Policies</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="visit-warning-days">
                    Visit frequency warning (days)
                  </label>
                  <Input
                    id="visit-warning-days"
                    type="number"
                    min={1}
                    max={90}
                    value={form.visitWarningDays}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        visitWarningDays: parseInt(e.target.value) || 7,
                      }))
                    }
                    data-testid="input-visit-warning-days"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Warn when a client returns within this many days.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="max-household">
                    Max household size
                  </label>
                  <Input
                    id="max-household"
                    type="number"
                    min={1}
                    max={50}
                    value={form.maxHouseholdSize}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        maxHouseholdSize: parseInt(e.target.value) || 20,
                      }))
                    }
                    data-testid="input-max-household"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Maximum allowed household size for client records.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="distribution-note">
                Default distribution note
              </label>
              <Input
                id="distribution-note"
                value={form.defaultDistributionNote}
                onChange={(e) =>
                  setForm((p) => ({ ...p, defaultDistributionNote: e.target.value }))
                }
                placeholder="Optional note shown during check-out"
                data-testid="input-distribution-note"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={saving} data-testid="button-save-settings">
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4 mr-1" />
                )}
                {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-data-info">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading">Data & Storage</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Your records and settings are saved in the shared database and remain
            available across sessions. Use Reports to download board updates and
            detailed data exports. Exports are not a complete database backup;
            database backups are managed separately by your administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
