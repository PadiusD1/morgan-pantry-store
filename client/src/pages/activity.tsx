import React, { useMemo, useState } from "react";
import { useRepository } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sourceNameOf } from "@shared/donation-source";

export default function ActivityPage() {
  const { transactions } = useRepository();
  const [typeFilter, setTypeFilter] = useState<"all" | "IN" | "OUT">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      // Use local date for filtering so it matches the date picker values
      const d = new Date(tx.timestamp);
      const dateOnly = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (fromDate && dateOnly < fromDate) return false;
      if (toDate && dateOnly > toDate) return false;
      return true;
    });
  }, [transactions, typeFilter, fromDate, toDate]);

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-activity-filters">
        <CardContent className="grid gap-3 py-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="select-type" data-testid="label-activity-type">
              Type
            </label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger id="select-type" data-testid="select-activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-activity-all">
                  All
                </SelectItem>
                <SelectItem value="IN" data-testid="option-activity-in">
                  IN only
                </SelectItem>
                <SelectItem value="OUT" data-testid="option-activity-out">
                  OUT only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="from" data-testid="label-activity-from">
              From date
            </label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              data-testid="input-activity-from"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="to" data-testid="label-activity-to">
              To date
            </label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              data-testid="input-activity-to"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-activity-table">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span>Transaction history</span>
            <span className="pill-muted" data-testid="text-activity-count">
              {filtered.length} transactions
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="text-right">Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-no-activity-filtered"
                  >
                    No transactions match these filters.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((tx) => {
                const date = new Date(tx.timestamp);
                const units = tx.items.reduce((sum, i) => sum + i.quantity, 0);
                const first = tx.items[0];
                const extra = tx.items.length - 1;
                return (
                  <TableRow key={tx.id} data-testid={`row-activity-${tx.id}`}>
                    <TableCell className="text-xs">
                      {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-xs" data-testid={`text-activity-type-${tx.id}`}>
                      {tx.type}
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-activity-summary-${tx.id}`}>
                      {tx.type === "OUT" && tx.clientName && <span className="font-medium mr-1">{tx.clientName}</span>}
                      {sourceNameOf(tx) && <span className="font-medium mr-1">{sourceNameOf(tx)}</span>}
                      {first?.name}
                      {extra > 0 && <span className="text-muted-foreground"> + {extra} more</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm" data-testid={`text-activity-units-${tx.id}`}>
                      {units}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
