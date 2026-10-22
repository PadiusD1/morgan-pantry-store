import { productLabel } from '@shared/product-identity';
type AllergyItem = { id: string; name: string; brand?: string; allergens?: string[] };

/** A just-looked-up item is authoritative even before React's inventory render. */
export function cartAllergyWarning(
  itemId: string,
  inventory: readonly AllergyItem[],
  clientAllergies: readonly string[],
  resolvedItem?: AllergyItem,
): { itemName: string; itemAllergens: string[] } | null {
  const item = resolvedItem?.id === itemId ? resolvedItem : inventory.find((row) => row.id === itemId);
  if (!item) return null;
  const allergies = clientAllergies.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
  const matches = (item.allergens ?? []).filter((allergen) => {
    const name = allergen.trim().toLocaleLowerCase();
    return name && allergies.some((allergy) => allergy.includes(name) || name.includes(allergy));
  });
  return matches.length ? { itemName: productLabel(item), itemAllergens: matches } : null;
}
