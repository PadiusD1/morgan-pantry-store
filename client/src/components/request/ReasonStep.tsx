import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeftIcon, SendIcon, Loader2 } from "lucide-react";

type CartEntry = { item: any; quantity: number };

type ReasonStepProps = {
  variant?: "default" | "kiosk";
  cart: Map<string, CartEntry>;
  reason: string;
  onReasonChange: (reason: string) => void;
  studentNote?: string;
  onStudentNoteChange?: (note: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
};

export function ReasonStep({
  variant = "default",
  cart,
  reason,
  onReasonChange,
  studentNote = "",
  onStudentNoteChange,
  onSubmit,
  onBack,
  submitting,
}: ReasonStepProps) {
  const isKiosk = variant === "kiosk";
  const entries = Array.from(cart.entries());
  const totalItems = entries.reduce((sum, [, entry]) => sum + entry.quantity, 0);
  const canSubmit = reason.trim().length >= 10 && !submitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }

  return (
    <Card className="glass-panel">
      <CardHeader>
        <CardTitle className={isKiosk ? "text-xl" : "text-lg"}>
          Why do you need these items?
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              className={isKiosk ? "text-lg font-medium" : "text-sm font-medium"}
              htmlFor="req-reason"
            >
              Reason for request *
            </label>
            <Textarea
              id="req-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Please describe why you need these items (minimum 10 characters)..."
              rows={isKiosk ? 5 : 3}
              className={isKiosk ? "text-lg" : ""}
              required
              data-testid="textarea-req-reason"
            />
            {reason.trim().length > 0 && reason.trim().length < 10 && (
              <p className="text-xs text-muted-foreground">
                {10 - reason.trim().length} more character{10 - reason.trim().length === 1 ? "" : "s"} needed
              </p>
            )}
          </div>

          {onStudentNoteChange && (
            <div className="space-y-1.5">
              <label
                className={isKiosk ? "text-lg font-medium" : "text-sm font-medium"}
                htmlFor="req-student-note"
              >
                Note to staff (optional)
              </label>
              <Textarea
                id="req-student-note"
                value={studentNote}
                onChange={(e) => onStudentNoteChange(e.target.value)}
                placeholder="Anything else we should know? (allergies, pickup timing, household details, etc.)"
                rows={isKiosk ? 4 : 2}
                className={isKiosk ? "text-lg" : ""}
                data-testid="textarea-req-student-note"
              />
            </div>
          )}

          <div className="space-y-2">
            <p className={`font-medium ${isKiosk ? "text-base" : "text-sm"}`}>
              Items requested ({totalItems} total)
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(([itemId, entry]) => (
                  <TableRow key={itemId} data-testid={`row-reason-item-${itemId}`}>
                    <TableCell className={isKiosk ? "text-base" : "text-sm"}>
                      {entry.item.name}
                    </TableCell>
                    <TableCell className={`text-right ${isKiosk ? "text-base" : "text-sm"}`}>
                      {entry.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={submitting}
              className={`flex items-center gap-1.5 ${isKiosk ? "h-12 text-base" : ""}`}
              data-testid="button-reason-back"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className={`flex-1 flex items-center justify-center gap-1.5 ${isKiosk ? "h-12 text-base" : ""}`}
              data-testid="button-reason-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <SendIcon className="h-4 w-4" />
                  Submit Request
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
