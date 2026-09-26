import fs from "fs";
import type { ProviderResult } from "./barcode-lookup";

/**
 * Local stack only. When FRC_BARCODE_STUB holds the path of a JSON file of
 * synthetic products keyed by barcode, the lookup answers from that file and
 * never calls an outside service. Production never sets the variable.
 */
export async function lookupStubProduct(fixturePath: string, barcode: string): Promise<ProviderResult | null> {
  const products = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Record<string, Omit<ProviderResult, "raw">>;
  const product = products[barcode];
  return product ? { ...product, raw: { source: "local stub" } } : null;
}
