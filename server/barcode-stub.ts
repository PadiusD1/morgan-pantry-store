import fs from "fs";
import { RETAIL_OBSERVATION_DISCLAIMER } from "@shared/measurement-provenance";
import type { WeightProvenance } from "@shared/measurement-provenance";
import type { ProviderResult } from "./barcode/types";

/**
 * Local stack only. When FRC_BARCODE_STUB holds the path of a JSON file of
 * synthetic products keyed by barcode, the lookup answers from that file and
 * never calls an outside service. Production never sets the variable.
 *
 * The fixture declares the same evidence a real provider must declare, so the
 * local stack exercises the real normalisation rules rather than a shortcut.
 */
type FixtureProduct = {
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  /** Net mass in grams, with what it measures stated explicitly. */
  packageMassG?: number;
  packageBasis?: WeightProvenance["packageBasis"];
  unitCountHint?: number;
  priceCents?: number;
  currency?: string;
  /** The date the synthetic observation is dated; undated offers are held back. */
  priceObservedAt?: string;
  allergens?: string[];
};

export async function lookupStubProduct(fixturePath: string, barcode: string): Promise<ProviderResult | null> {
  const products = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Record<string, FixtureProduct>;
  const product = products[barcode];
  if (!product) return null;

  const hasMass = typeof product.packageMassG === "number" && product.packageMassG > 0;
  const hasPrice =
    typeof product.priceCents === "number" &&
    product.priceCents > 0 &&
    product.currency === "USD" &&
    typeof product.priceObservedAt === "string";

  return {
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
    // The fixture is keyed by barcode, so an answer is by definition the
    // record for the scanned code.
    gtinVerified: true,
    ...(product.unitCountHint !== undefined ? { unitCountHint: product.unitCountHint } : {}),
    ...(hasMass
      ? {
          packageMassG: product.packageMassG,
          weightProvenance: {
            basis: "provider_net_quantity" as const,
            confidence: "observed" as const,
            source: "Local synthetic fixture",
            observedAt: new Date().toISOString().slice(0, 10),
            packageBasis: product.packageBasis ?? "whole_package",
            note: "Synthetic local-stack value. Not a real measurement.",
          },
        }
      : {}),
    ...(hasPrice
      ? {
          priceCents: product.priceCents,
          priceProvenance: {
            confidence: "observed" as const,
            source: "Local synthetic fixture",
            retailer: "Synthetic Store",
            currency: "USD",
            observedAt: product.priceObservedAt!,
            fetchedAt: new Date().toISOString().slice(0, 10),
            locationId: null,
            note: `${RETAIL_OBSERVATION_DISCLAIMER} Synthetic local-stack value.`,
          },
        }
      : {}),
    allergens: product.allergens ?? [],
    raw: { source: "local stub" },
  };
}
