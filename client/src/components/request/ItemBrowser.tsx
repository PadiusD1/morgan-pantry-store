import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon } from "lucide-react";
import { ItemCard } from "./ItemCard";

type CartEntry = { item: any; quantity: number };

type ItemBrowserProps = {
  variant?: "default" | "kiosk";
  items: any[];
  cart: Map<string, CartEntry>;
  onUpdateCart: (itemId: string, item: any, quantity: number) => void;
};

export function ItemBrowser({
  variant = "default",
  items,
  cart,
  onUpdateCart,
}: ItemBrowserProps) {
  const isKiosk = variant === "kiosk";
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      if (item.category) {
        cats.add(item.category);
      }
    }
    return ["All", ...Array.from(cats).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    const term = search.toLowerCase().trim();
    return items.filter((item) => {
      const available = item.quantity ?? 0;
      if (available <= 0) return false;

      if (activeCategory !== "All" && item.category !== activeCategory) {
        return false;
      }

      if (term) {
        const nameMatch = (item.name ?? "").toLowerCase().includes(term);
        const catMatch = (item.category ?? "").toLowerCase().includes(term);
        if (!nameMatch && !catMatch) return false;
      }

      return true;
    });
  }, [items, search, activeCategory]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className={`pl-9 ${isKiosk ? "h-14 text-lg" : ""}`}
          data-testid="input-item-search"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <Button
            key={cat}
            type="button"
            variant={activeCategory === cat ? "default" : "outline"}
            size="sm"
            className={isKiosk ? "h-10 text-base px-4" : "h-7 text-xs px-2.5"}
            onClick={() => setActiveCategory(cat)}
            data-testid={`button-category-${cat}`}
          >
            {cat}
          </Button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="py-8 text-center">
          <p className={`text-muted-foreground ${isKiosk ? "text-lg" : "text-sm"}`}>
            No items found matching your search.
          </p>
        </div>
      ) : (
        <div
          className={
            isKiosk
              ? "grid grid-cols-1 sm:grid-cols-2 gap-3"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          }
        >
          {filteredItems.map((item) => {
            const entry = cart.get(item.id);
            return (
              <ItemCard
                key={item.id}
                variant={variant}
                item={item}
                cartQuantity={entry?.quantity ?? 0}
                onQuantityChange={(qty) => onUpdateCart(item.id, item, qty)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
