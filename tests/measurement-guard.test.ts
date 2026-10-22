import { describe, expect, it } from "vitest";
import { measurementRefusal, withoutUnchangedMeasurements } from "../server/measurement-guard";

describe("measurement evidence boundaries", () => {
  it("keeps unaudited manual item figures editable", () => {
    expect(measurementRefusal({ weightPerUnitLbs: "1", valuePerUnitUsd: "2" }, { weightPerUnitLbs: "3", valuePerUnitUsd: "4" })).toBeNull();
  });
  it("protects provider figures independently without locking an unknown other figure", () => {
    const item = { weightPerUnitLbs: "1", valuePerUnitUsd: "0", rawPayload: {
      frcWeightProvenance: { source: "Package provider", confidence: "observed" },
      frcPriceProvenance: { source: null, confidence: "unknown" },
    } };
    expect(measurementRefusal(item, { weightPerUnitLbs: "2" })).not.toBeNull();
    expect(measurementRefusal(item, { valuePerUnitUsd: "2" })).toBeNull();
    expect(measurementRefusal({ valuePerUnitUsd: "2", costCents: 200 }, { valuePerUnitUsd: "3" })).not.toBeNull();
  });
  it("accepts equivalent JSON and numeric values without rewriting evidence", () => {
    const item = { weightPerUnitLbs: "1.0000", rawPayload: { frcMeasurementReview: { by: "synthetic", at: "2026-10-21" }, extra: 1 } };
    const patch = { name: "Unrelated rename", weightPerUnitLbs: "1", rawPayload: { extra: 1, frcMeasurementReview: { at: "2026-10-21", by: "synthetic" } } };
    expect(measurementRefusal(item, patch)).toBeNull();
    expect(withoutUnchangedMeasurements(item, patch)).toEqual({ name: "Unrelated rename" });
    expect(item.rawPayload.frcMeasurementReview.by).toBe("synthetic");
  });
  it("treats removing a figure as a change even when the prior value is zero", () => {
    expect(measurementRefusal({ costCents: 0 }, { costCents: null })).not.toBeNull();
  });
});
