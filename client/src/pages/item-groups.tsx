import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LayersIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type ItemGroupItem = {
  id: string;
  groupId: string;
  inventoryItemId: string;
  name: string;
  quantity?: number;
  defaultQuantity: number;
};

type ItemGroup = {
  id: string;
  name: string;
  description: string | null;
  items: ItemGroupItem[];
  createdAt: string;
  updatedAt: string;
};

export default function ItemGroupsPage() {
  const { inventory } = useRepository();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: groups = [], isLoading, isError, refetch } = useQuery<ItemGroup[]>({
    queryKey: ["/api/item-groups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/item-groups");
      return res.json();
    },
  });

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    description: string;
    items: { inventoryItemId: string; name: string; defaultQuantity: number }[];
  } | null>(null);

  const [itemSearch, setItemSearch] = useState("");

  const filteredInventory = itemSearch.trim()
    ? inventory.filter(
        (i) =>
          i.name.toLowerCase().includes(itemSearch.toLowerCase()) &&
          !editing?.items.some((ei) => ei.inventoryItemId === i.id),
      )
    : [];

  async function handleSave() {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast({ title: "Group name is required", description: "Enter a name before saving this group." });
      return;
    }

    const body = {
      name: editing.name.trim(),
      description: editing.description.trim() || null,
      items: editing.items.map((i) => ({
        inventoryItemId: i.inventoryItemId,
        quantity: i.defaultQuantity,
      })),
    };

    try {
      const res = editing.id
        ? await apiRequest("PATCH", `/api/item-groups/${editing.id}`, body)
        : await apiRequest("POST", "/api/item-groups", body);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Save failed" }));
        throw new Error(err.message || "Save failed");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/item-groups"] });
      toast({ title: "Item group saved", description: editing.name });
      setEditing(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save item group";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await apiRequest("DELETE", `/api/item-groups/${id}`);
      if (!res.ok) {
        throw new Error("Delete failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/item-groups"] });
      toast({ title: "Item group deleted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete item group";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-item-groups-actions">
        <CardContent className="flex items-center justify-between py-4">
          <p className="text-sm text-muted-foreground">
            Pre-built bundles for quick distribution during check-out.
          </p>
          <Button
            size="sm"
            onClick={() =>
              setEditing({ name: "", description: "", items: [] })
            }
            data-testid="button-add-item-group"
          >
            <PlusIcon className="h-4 w-4" />
            New group
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-item-groups-table">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <LayersIcon className="h-4 w-4" />
              Item Groups
            </span>
            <span className="pill-muted" data-testid="text-item-groups-count">
              {groups.length} groups
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
              <p className="text-sm text-destructive">Could not load item groups.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-sm text-muted-foreground"
                      data-testid="text-no-item-groups"
                    >
                      No item groups yet. Create one to speed up check-out.
                    </TableCell>
                  </TableRow>
                )}
                {groups.map((g) => (
                  <TableRow key={g.id} data-testid={`row-item-group-${g.id}`}>
                    <TableCell className="text-sm font-medium">{g.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.description || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {g.items.map((item) => (
                          <Badge key={item.id} variant="secondary" className="text-[10px]">
                            {item.name} x{item.defaultQuantity ?? item.quantity ?? 1}
                          </Badge>
                        ))}
                        {g.items.length === 0 && (
                          <span className="text-xs text-muted-foreground">No items</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setEditing({
                              id: g.id,
                              name: g.name,
                              description: g.description || "",
                              items: g.items.map((i) => ({
                                inventoryItemId: i.inventoryItemId,
                                name: i.name,
                                defaultQuantity: i.defaultQuantity ?? i.quantity ?? 1,
                              })),
                            })
                          }
                          data-testid={`button-edit-item-group-${g.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive"
                          onClick={() => handleDelete(g.id)}
                          data-testid={`button-delete-item-group-${g.id}`}
                        >
                          <Trash2Icon className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <Card className="glass-panel max-w-xl" data-testid="card-edit-item-group">
          <CardHeader>
            <CardTitle className="section-heading">
              {editing.id ? "Edit item group" : "New item group"}
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
                <label className="text-sm font-medium" htmlFor="group-name">
                  Name
                </label>
                <Input
                  id="group-name"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, name: e.target.value } : p))
                  }
                  placeholder="e.g. Standard Family Bundle"
                  required
                  data-testid="input-group-name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="group-description">
                  Description
                </label>
                <Input
                  id="group-description"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing((p) =>
                      p ? { ...p, description: e.target.value } : p,
                    )
                  }
                  placeholder="Optional description"
                  data-testid="input-group-description"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Bundle items</label>
                <div className="border rounded-md p-2 space-y-2 min-h-[60px]">
                  {editing.items.map((item, idx) => (
                    <div
                      key={item.inventoryItemId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="flex-1 truncate">{item.name}</span>
                      <Input
                        type="number"
                        min={1}
                        className="w-16 h-7 text-xs"
                        value={item.defaultQuantity}
                        onChange={(e) => {
                          const qty = parseInt(e.target.value) || 1;
                          setEditing((p) => {
                            if (!p) return p;
                            const items = [...p.items];
                            items[idx] = { ...items[idx], defaultQuantity: qty };
                            return { ...p, items };
                          });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          setEditing((p) =>
                            p
                              ? {
                                  ...p,
                                  items: p.items.filter((_, i) => i !== idx),
                                }
                              : p,
                          )
                        }
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {editing.items.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">
                      No items yet. Search below to add inventory items.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="item-search">
                  Add item from inventory
                </label>
                <Input
                  id="item-search"
                  type="search"
                  placeholder="Search inventory items..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  data-testid="input-item-group-search"
                />
                {filteredInventory.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {filteredInventory.slice(0, 10).map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between"
                        onClick={() => {
                          setEditing((p) =>
                            p
                              ? {
                                  ...p,
                                  items: [
                                    ...p.items,
                                    {
                                      inventoryItemId: inv.id,
                                      name: inv.name,
                                      defaultQuantity: 1,
                                    },
                                  ],
                                }
                              : p,
                          );
                          setItemSearch("");
                        }}
                      >
                        <span>{inv.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {inv.quantity} in stock
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                  data-testid="button-cancel-edit-group"
                >
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-save-group">
                  Save group
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
