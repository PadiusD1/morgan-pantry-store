import { describe, expect, it } from "vitest";
import { catalogImage, catalogQuality, safeCatalogImage } from "../shared/catalog";
const photo = "https://images.openfoodfacts.org/images/products/123/456/789/front_en.1.400.jpg";
it("projects a stored provider product photo without exposing the provider payload", () => {
  expect(catalogImage({ product: { image_front_url: photo, private: "DO NOT EXPOSE" }, note: "private" })).toEqual({ imageUrl: photo, imageAlt: "", imageSource: "Open Food Facts" });
});
it.each(["javascript:alert(1)", "data:image/svg+xml,test", "//evil.example/image.jpg", "https://images.openfoodfacts.org.evil.example/images/products/123.jpg", "https://user:password@images.openfoodfacts.org/images/products/123.jpg", photo + "?student=private", "/item-photos/../secrets.png", "/item-photos/test.svg", "http://images.openfoodfacts.org/images/products/123.jpg"])("rejects unsafe image %s", value => { expect(safeCatalogImage(value)).toBeNull(); });
it("supports local product images and explicit removal without restoring an older photo", () => {
  expect(safeCatalogImage("/item-photos/test-rice.webp")).toBe("/item-photos/test-rice.webp");
  expect(catalogImage({ product: { image_url: photo }, frcCatalog: { imageUrl: null } }).imageUrl).toBeNull();
});
it("does not expose private staff evidence as photo attribution", () => {
  expect(catalogImage({ frcCatalog: { imageUrl: photo, imageSource: "private review by staff" } }).imageSource).toBe("Open Food Facts");
});
it("reports unknown weight/value rather than silently making them complete", () => {
  const row = { id: "a", name: "Rice", quantity: 1, updatedAt: "2026-01-01", weightPerUnitLbs: "0", valuePerUnitUsd: "NaN" };
  const result = catalogQuality([row, { ...row, id: "b", weightPerUnitLbs: "2", valuePerUnitUsd: "4", rawPayload: { product: { image_url: photo } } }]);
  expect(result).toMatchObject({ total: 2, missingWeight: 1, missingValue: 1, missingPhoto: 1 });
  expect(result.rows[0].gaps).toEqual(["weight", "value", "photo"]);
});
