import { describe, expect, it } from "vitest";
import { DONUT_OTHER, donutSlices } from "@/lib/donut";

const item = (category: string | null, quantity: number) => ({ category, quantity });

describe("donutSlices", () => {
  it("sums by category and drops zero and negative slices", () => {
    const slices = donutSlices([item("Canned", 10), item("Canned", 5), item("Snacks", 0), item("Drinks", -2), item("Produce", 5)]);
    expect(slices.map((s) => [s.name, s.value])).toEqual([
      ["Canned", 15],
      ["Produce", 5],
    ]);
  });

  it("puts items with no category under Uncategorized", () => {
    expect(donutSlices([item(null, 3), item("  ", 2)]).map((s) => [s.name, s.value])).toEqual([["Uncategorized", 5]]);
  });

  it("groups the tail into Other past the slice limit", () => {
    const items = [item("A", 60), item("B", 50), item("C", 40), item("D", 30), item("E", 20), item("F", 10), item("G", 5)];
    const slices = donutSlices(items, 4);
    expect(slices.map((s) => [s.name, s.value])).toEqual([
      ["A", 60],
      ["B", 50],
      ["C", 40],
      [DONUT_OTHER, 65],
    ]);
  });

  it("keeps every slice when they fit and adds no empty Other", () => {
    const slices = donutSlices([item("A", 1), item("B", 1)], 6);
    expect(slices.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("merges a real Other category into the grouped Other and keeps it last", () => {
    const slices = donutSlices([item("Other", 7), item("A", 50), item("B", 40), item("C", 30)], 3);
    expect(slices.map((s) => [s.name, s.value])).toEqual([
      ["A", 50],
      ["B", 40],
      [DONUT_OTHER, 37],
    ]);
  });

  it("gives whole number percents of the total", () => {
    const slices = donutSlices([item("A", 3), item("B", 1)]);
    expect(slices.map((s) => s.percent)).toEqual([75, 25]);
  });

  it("returns nothing when every quantity is zero", () => {
    expect(donutSlices([item("A", 0), item("B", 0)])).toEqual([]);
  });
});
