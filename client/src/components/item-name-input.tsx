import { useId, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { suggestInventoryItems } from "@/lib/item-entry";
import type { InventoryItem } from "@/lib/repository";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onSelect"> & {
  value: string;
  items: readonly InventoryItem[];
  onChange: (value: string) => void;
  onSelect: (item: InventoryItem) => void;
  "data-testid"?: string;
};

/** Search the saved inventory by name, brand, category or barcode. */
export function ItemNameInput({ value, items, onChange, onSelect, ...inputProps }: Props) {
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => suggestInventoryItems(items, value), [items, value]);
  const shown = open && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  function choose(item: InventoryItem) {
    setOpen(false);
    setActive(0);
    onSelect(item);
  }

  return (
    <div
      className="relative"
      ref={container}
      onBlur={(event) => {
        if (!container.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Input
        {...inputProps}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown ? `${listId}-${activeIndex}` : undefined}
        onFocus={(event) => {
          setOpen(true);
          inputProps.onFocus?.(event);
        }}
        onChange={(event) => {
          setActive(0);
          setOpen(true);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          } else if (shown && event.key === "Enter") {
            event.preventDefault();
            choose(matches[activeIndex]);
          } else if (shown && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else {
            inputProps.onKeyDown?.(event);
          }
        }}
      />
      {shown && (
        <div id={listId} role="listbox" aria-label="Matching inventory items" className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((item, index) => (
            <button
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              tabIndex={-1}
              className={`w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent ${index === activeIndex ? "bg-accent" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
              data-testid={`${inputProps["data-testid"] || "item-name"}-option-${item.id}`}
            >
              <span className="block font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[item.brand, item.category, item.barcode, `${item.quantity} on hand`].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
