import React, { useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, HandshakeIcon, HeartIcon, PlusCircleIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { IDENTITY_LABELS, sourceSearchText, type SourceKind, type SourceOption } from "@shared/donation-source";

/**
 * One picker for who the stock came from.
 *
 * Staff know a source by whatever they happen to remember: a name, an
 * organisation, a student ID, a phone number. A plain dropdown made them scroll
 * a list that grows every week, so this one is typed as well as browsed, and it
 * searches every field a staff member can see. The groups are labelled by kind,
 * because "Same Name" the donor and "Same Name" the partner organisation are
 * two different records and crediting the wrong one is a reporting error nobody
 * notices until a receipt is questioned.
 */

const KIND_ORDER: SourceKind[] = ["donor", "partner", "student"];

const KIND_ICON: Record<SourceKind, React.ReactNode> = {
  donor: <HeartIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
  partner: <HandshakeIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
  student: <UserIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
};

export type SourcePickerProps = {
  id: string;
  options: readonly SourceOption[];
  /** The selected option key, or "" for none. */
  value: string;
  onSelect: (option: SourceOption) => void;
  /** Called when staff choose to register a source that is not on the list. */
  onRegisterNew?: () => void;
  registerLabel?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  "data-testid"?: string;
};

function describe(option: SourceOption): string {
  return [option.identifier, option.organization].filter((value) => !!value).join(" · ");
}

export function SourcePicker({
  id,
  options,
  value,
  onSelect,
  onRegisterNew,
  registerLabel = "Register donor, partner or student",
  disabled,
  isLoading = false,
  isError = false,
  onRetry,
  "data-testid": testId = "source-picker",
}: SourcePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((option) => option.key === value), [options, value]);

  const grouped = useMemo(() => {
    const byKind = new Map<SourceKind, SourceOption[]>();
    for (const option of options) {
      const list = byKind.get(option.kind);
      if (list) list.push(option);
      else byKind.set(option.kind, [option]);
    }
    return KIND_ORDER.filter((kind) => (byKind.get(kind)?.length ?? 0) > 0).map((kind) => ({
      kind,
      heading: IDENTITY_LABELS[kind],
      rows: byKind.get(kind)!,
    }));
  }, [options]);

  return (
    <div aria-busy={isLoading}>
      {isError && (
        <div role="alert" className="mb-2 text-sm text-destructive" data-testid={`${testId}-error`}>
          {options.length ? "Source refresh failed. Previously loaded records are still shown." : "Could not load saved sources. Retry before selecting or registering a source."}
          {onRetry && <Button type="button" variant="outline" size="sm" className="ml-2" onClick={onRetry}>Retry sources</Button>}
        </div>
      )}
      {isLoading && !options.length && <p role="status" className="mb-1 text-sm text-muted-foreground">Loading saved sources…</p>}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || ((isLoading || isError) && !options.length)}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected ? (
              <>
                {KIND_ICON[selected.kind]}
                <span className="truncate">{selected.name}</span>
                {describe(selected) && (
                  <span className="truncate text-xs text-muted-foreground">· {describe(selected)}</span>
                )}
                <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                  {selected.identityLabel}
                </Badge>
              </>
            ) : (
              <span className="text-muted-foreground">Type a name, ID, organization or phone</span>
            )}
          </span>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      {/*
        The panel follows the trigger's width and is capped to the viewport
        less the page gutters. A fixed minimum width wider than a 320px screen
        would push the list off the side of a phone.
      */}
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        align="start"
        collisionPadding={8}
      >
        <Command
          label="Donors, partners and students"
          filter={(itemValue, search) => {
            // Every searchable field is encoded into the item value, and each
            // typed word has to appear somewhere, so "pantry 1001" narrows the
            // way a staff member expects.
            const haystack = itemValue.toLowerCase();
            return search
              .trim()
              .toLowerCase()
              .split(/\s+/)
              .filter(Boolean)
              .every((word) => haystack.includes(word))
              ? 1
              : 0;
          }}
        >
          <CommandInput placeholder="Search by name, ID, organization, email or phone" data-testid={`${testId}-search`} />
          <CommandList>
            <CommandEmpty>
              <div className="px-3 py-3 text-sm text-muted-foreground">
                No saved source matches that.
                {onRegisterNew ? " Use the register option below to add one." : ""}
              </div>
            </CommandEmpty>

            {grouped.map((group) => (
              <CommandGroup key={group.kind} heading={group.heading}>
                {group.rows.map((option) => (
                  <CommandItem
                    key={option.key}
                    // cmdk matches on this value, so it carries the identifier,
                    // organisation, email and phone as well as the name.
                    value={`${sourceSearchText(option)} ${option.key}`}
                    onSelect={() => {
                      onSelect(option);
                      setOpen(false);
                    }}
                    data-testid={`${testId}-option-${option.key}`}
                  >
                    <CheckIcon
                      className={`mr-2 h-4 w-4 shrink-0 ${option.key === value ? "opacity-100" : "opacity-0"}`}
                      aria-hidden="true"
                    />
                    {KIND_ICON[option.kind]}
                    <span className="truncate">{option.name}</span>
                    {describe(option) && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">· {describe(option)}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {/*
              Registration comes last, and both the group and the item are kept
              mounted so a search that matches no saved record still offers it.
              Putting it first would make it the highlighted row, and typing a
              name that does exist and pressing Enter would open the
              registration form instead of selecting the person who is already
              on file, which is how duplicate people get created.
            */}
            {onRegisterNew && (
              <CommandGroup forceMount heading="Not on the list">
                <CommandItem
                  forceMount
                  value="register new donor partner student source"
                  onSelect={() => {
                    setOpen(false);
                    onRegisterNew();
                  }}
                  data-testid={`${testId}-register-new`}
                >
                  <PlusCircleIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                  {registerLabel}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  );
}

