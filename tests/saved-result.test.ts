import { describe, expect, it } from "vitest";
import { earlierSaveText, recordedUnits, savedCheckInText, savedCheckOutName } from "@/lib/saved-result";
import { createSaveGuard } from "@/lib/save-guard";

const stored = { id: "tx1", clientName: "Test Student One", items: [{ quantity: 3 }] };

describe("text built from the server's saved result", () => {
  it("counts the units the server recorded, not the form", () => {
    expect(recordedUnits(stored)).toBe(3);
    expect(recordedUnits({ items: [{ quantity: 2 }, { quantity: 4 }] })).toBe(6);
    expect(recordedUnits(null)).toBe(0);
  });

  it("says the three units recorded after five were typed", () => {
    expect(savedCheckInText(stored, false)).toBe("Recorded 3 units received.");
    expect(savedCheckInText(stored, true)).toBe("Recorded 3 units received with location.");
    expect(earlierSaveText(stored, "in")).toBe(
      "An earlier try already recorded 3 units received. Your change was not saved.",
    );
  });

  it("names the person and units of an earlier check out", () => {
    expect(savedCheckOutName(stored, "Typed Name")).toBe("Test Student One");
    expect(savedCheckOutName({}, "Typed Name")).toBe("Typed Name");
    expect(earlierSaveText(stored, "out")).toBe(
      "An earlier try already recorded a check out of 3 units for Test Student One. Your change was not saved.",
    );
  });

  it("uses no colon, semicolon or dash in what the user reads", () => {
    for (const text of [savedCheckInText(stored, true), earlierSaveText(stored, "in"), earlierSaveText(stored, "out")]) {
      expect(text).not.toMatch(/[:;]|\s[-–—]\s/);
    }
  });
});

describe("a fresh key after an earlier save was recorded", () => {
  it("renew drops the kept key so the next save gets a new one", async () => {
    let n = 0;
    const guard = createSaveGuard(() => `key-${++n}`);
    const seen: string[] = [];
    await guard.run(async (key) => {
      seen.push(key);
      return false;
    });
    guard.renew();
    await guard.run(async (key) => {
      seen.push(key);
      return false;
    });
    expect(seen).toEqual(["key-1", "key-2"]);
  });
});
