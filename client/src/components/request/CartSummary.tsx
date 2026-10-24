import { ProductName } from "@/components/product-name";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCartIcon, XIcon, ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

type CartEntry = { item: any; quantity: number };

type CartSummaryProps = {
  variant?: "default" | "kiosk";
  cart: Map<string, CartEntry>;
  onRemoveItem: (itemId: string) => void;
  onContinue: () => void;
  onBack?: () => void;
};

export function CartSummary({
  variant = "default",
  cart,
  onRemoveItem,
  onContinue,
  onBack,
}: CartSummaryProps) {
  const isKiosk = variant === "kiosk";
  const entries = Array.from(cart.entries());
  const totalItems = entries.reduce((sum, [, entry]) => sum + entry.quantity, 0);

  return (
    <Card className="border-dashed" data-testid="card-cart-summary">
      <CardHeader className="py-2 px-3">
        <CardTitle
          className={`flex items-center justify-between ${isKiosk ? "text-base" : "text-xs"} font-medium text-muted-foreground`}
        >
          <span className="flex items-center gap-1.5">
            <ShoppingCartIcon className={isKiosk ? "h-5 w-5" : "h-3.5 w-3.5"} />
            Cart
          </span>
          <span className="pill-muted" data-testid="text-cart-total">
            {totalItems} item{totalItems === 1 ? "" : "s"} selected
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {entries.length === 0 ? (
          <p
            className={`text-center py-4 text-muted-foreground ${isKiosk ? "text-base" : "text-xs"}`}
            data-testid="text-cart-empty"
          >
            No items selected yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map(([itemId, entry]) => (
              <li
                key={itemId}
                className="flex items-center justify-between gap-2"
                data-testid={`row-cart-${itemId}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`break-words font-medium ${isKiosk ? "text-base" : "text-sm"}`}>
                    <ProductName item={entry.item} />
                  </p>
                  <p className={`text-muted-foreground ${isKiosk ? "text-sm" : "text-[11px]"}`}>
                    Qty: {entry.quantity}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={isKiosk ? "h-10 w-10" : "h-7 w-7"}
                  onClick={() => onRemoveItem(itemId)}
                  data-testid={`button-remove-cart-${itemId}`}
                >
                  <XIcon className={isKiosk ? "h-5 w-5" : "h-3.5 w-3.5"} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-3">
          {onBack && (
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className={`flex items-center gap-1.5 ${isKiosk ? "h-12 text-base" : ""}`}
              data-testid="button-cart-back"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
          )}
          <Button
            type="button"
            onClick={onContinue}
            disabled={entries.length === 0}
            className={`flex-1 flex items-center justify-center gap-1.5 ${isKiosk ? "h-12 text-base" : ""}`}
            data-testid="button-cart-continue"
          >
            Continue
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
