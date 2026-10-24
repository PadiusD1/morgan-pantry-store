import { ProductName } from "@/components/product-name";
import { productLabel } from "@shared/product-identity";
import React from "react";
import { ProductPhoto } from "@/components/product-photo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon, AlertTriangleIcon } from "lucide-react";

type ItemCardProps = {
  variant?: "default" | "kiosk";
  item: any;
  cartQuantity: number;
  onQuantityChange: (quantity: number) => void;
};

export function ItemCard({
  variant = "default",
  item,
  cartQuantity,
  onQuantityChange,
}: ItemCardProps) {
  const isKiosk = variant === "kiosk";
  const available = item.quantity ?? 0;
  const isLowStock =
    item.reorderThreshold != null && available <= item.reorderThreshold && available > 0;
  const allergens: string[] = item.allergens ?? [];

  function handleIncrement() {
    if (cartQuantity < available) {
      onQuantityChange(cartQuantity + 1);
    }
  }

  function handleDecrement() {
    if (cartQuantity > 0) {
      onQuantityChange(cartQuantity - 1);
    }
  }

  return (
    <Card
      className={`border ${cartQuantity > 0 ? "border-[hsl(22_92%_60%)]/50 bg-[hsl(22_92%_60%)]/5" : ""}`}
      data-testid={`card-item-${item.id}`}
    >
      <CardContent className={isKiosk ? "p-4" : "p-3"}>
        <div className="space-y-2">
          <ProductPhoto item={item} />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`font-medium break-words ${isKiosk ? "text-lg" : "text-sm"}`}
                data-testid={`text-item-name-${item.id}`}
              >
                <ProductName item={item} />
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {item.category && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {item.category}
                  </Badge>
                )}
                {isLowStock && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200 gap-0.5"
                  >
                    <AlertTriangleIcon className="h-2.5 w-2.5" />
                    Low Stock
                  </Badge>
                )}
              </div>
            </div>
            <p
              className={`text-muted-foreground whitespace-nowrap ${isKiosk ? "text-base" : "text-xs"}`}
              data-testid={`text-item-available-${item.id}`}
            >
              {available} avail.
            </p>
          </div>

          {allergens.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allergens.map((allergen: string) => (
                <Badge
                  key={allergen}
                  variant="outline"
                  className="text-[9px] px-1 py-0 bg-red-50 text-red-600 border-red-200"
                >
                  {allergen}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={isKiosk ? "h-12 w-12" : "h-8 w-8"}
              aria-label={`Remove one ${productLabel(item)}`}
              onClick={handleDecrement}
              disabled={cartQuantity <= 0}
              data-testid={`button-item-minus-${item.id}`}
            >
              <MinusIcon className={isKiosk ? "h-5 w-5" : "h-4 w-4"} />
            </Button>
            <span
              className={`font-semibold min-w-[2rem] text-center ${isKiosk ? "text-xl" : "text-sm"}`}
              data-testid={`text-item-qty-${item.id}`}
            >
              {cartQuantity}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={isKiosk ? "h-12 w-12" : "h-8 w-8"}
              aria-label={`Add one ${productLabel(item)}`}
              onClick={handleIncrement}
              disabled={cartQuantity >= available}
              data-testid={`button-item-plus-${item.id}`}
            >
              <PlusIcon className={isKiosk ? "h-5 w-5" : "h-4 w-4"} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
