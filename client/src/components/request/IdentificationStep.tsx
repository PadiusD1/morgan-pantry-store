import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserIcon, SearchIcon } from "lucide-react";

type IdentificationData = {
  clientName: string;
  clientIdentifier: string;
  clientEmail?: string;
  clientPhone?: string;
  clientId?: string;
};

type IdentificationStepProps = {
  variant?: "default" | "kiosk";
  onNext: (data: IdentificationData) => void;
  onCheckHistory: () => void;
};

export function IdentificationStep({
  variant = "default",
  onNext,
  onCheckHistory,
}: IdentificationStepProps) {
  const [clientName, setClientName] = useState("");
  const [clientIdentifier, setClientIdentifier] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  const isKiosk = variant === "kiosk";
  const inputClass = isKiosk ? "h-14 text-lg" : "";
  const labelClass = isKiosk
    ? "text-lg font-medium"
    : "text-sm font-medium";

  const canContinue =
    clientName.trim().length > 0 && clientIdentifier.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue) return;

    onNext({
      clientName: clientName.trim(),
      clientIdentifier: clientIdentifier.trim(),
      clientEmail: clientEmail.trim() || undefined,
      clientPhone: clientPhone.trim() || undefined,
    });
  }

  return (
    <Card className="glass-panel">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2">
          <div className="h-12 w-12 rounded-full bg-[hsl(22_92%_60%)]/10 flex items-center justify-center mx-auto">
            <UserIcon className="h-6 w-6 text-[hsl(22_92%_60%)]" />
          </div>
        </div>
        <CardTitle className={isKiosk ? "text-2xl" : "text-lg"}>
          Morgan State University
        </CardTitle>
        <p className={`text-muted-foreground ${isKiosk ? "text-base" : "text-sm"}`}>
          Food Resource Center - Request Form
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="req-client-name">
              Full Name *
            </label>
            <Input
              id="req-client-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Enter your full name"
              required
              className={inputClass}
              data-testid="input-req-client-name"
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="req-client-id">
              Student ID *
            </label>
            <Input
              id="req-client-id"
              value={clientIdentifier}
              onChange={(e) => setClientIdentifier(e.target.value)}
              placeholder="Enter your student ID"
              required
              className={inputClass}
              data-testid="input-req-client-identifier"
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="req-client-email">
              Email (optional)
            </label>
            <Input
              id="req-client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="your.email@morgan.edu"
              className={inputClass}
              data-testid="input-req-client-email"
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="req-client-phone">
              Phone (optional)
            </label>
            <Input
              id="req-client-phone"
              type="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className={inputClass}
              data-testid="input-req-client-phone"
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={!canContinue}
              className={isKiosk ? "h-14 text-lg" : ""}
              data-testid="button-req-continue"
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCheckHistory}
              className={`flex items-center gap-1.5 ${isKiosk ? "h-12 text-base" : "text-sm"}`}
              data-testid="button-req-check-history"
            >
              <SearchIcon className={isKiosk ? "h-5 w-5" : "h-4 w-4"} />
              Check My Requests
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
