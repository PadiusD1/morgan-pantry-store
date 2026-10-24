import type { PackageType } from "./types";

const VARIETY_PACK_PATTERNS = [
  /variety\s*pack/i,
  /assorted\s*(pack|flavors?|mix)/i,
  /sampler\s*pack/i,
  /mixed\s*(pack|flavors?)/i,
];

// A hyphen is as common as a space in "12-pack" or "24-ct". Missing it read a
// twelve-pack as a single package, which then let an ambiguous component size
// be adopted as the mass of the whole box.
const MULTI_PACK_PATTERNS = [
  /(\d+)\s*[-‐-―]?\s*(?:ct|count|pk|packs?|cans?|bottles?|bags?|bars?|boxes?|pouches?|packets?|rolls?)\b/i,
  /(?:pack\s*of|box\s*of|case\s*of)\s*(\d+)/i,
  /(\d+)\s*[-x×]\s*(?:\d+(?:\.\d+)?\s*(?:oz|g|ml|fl\s*oz))/i,
];

const CASE_PATTERNS = [/\bcase\b/i, /\bbulk\b/i];

export type PackInfo = {
  packageType: PackageType;
  unitCount: number;
  components: { name: string; quantity: number }[];
};

function countFromText(text: string, limit: number): number | null {
  for (const pattern of MULTI_PACK_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number.parseInt(match[1] || match[2], 10);
    if (count > 1 && count <= limit) return count;
  }
  return null;
}

/**
 * How many units the package holds. A count the provider declared outright
 * always wins over one parsed out of a title, because a declared multipack
 * field is a field and a title is prose.
 */
export function detectPackInfo(name: string, description?: string, unitCountHint?: number): PackInfo {
  const text = `${name} ${description || ""}`;
  const declared = unitCountHint && unitCountHint > 1 ? unitCountHint : null;

  if (VARIETY_PACK_PATTERNS.some((pattern) => pattern.test(text))) {
    return { packageType: "variety_pack", unitCount: declared ?? countFromText(text, 200) ?? 1, components: [] };
  }

  if (CASE_PATTERNS.some((pattern) => pattern.test(text))) {
    const unitCount = declared ?? countFromText(text, 500);
    if (unitCount && unitCount > 1) return { packageType: "case", unitCount, components: [] };
  }

  const multi = declared ?? countFromText(text, 200);
  if (multi && multi > 1) return { packageType: "multi_pack", unitCount: multi, components: [] };

  return { packageType: "single", unitCount: 1, components: [] };
}
