import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EarlierSaveRecordedError } from "@/lib/queryClient";
import {
  failureToastSlot,
  importFailureText,
  inventoryFailureToast,
  inventorySuccessToast,
  upsertCreatedRow,
} from "@/lib/inventory-save";

// Stock checker attempt 11, observations A to E on the Inventory dialog.

const plain = /[:;]|\s[-–—]\s/;

describe("inventory dialog failure toast", () => {
  it("A. an uncertain stock outcome never has a title that says it was not recorded", () => {
    const t = inventoryFailureToast("stock", new Error("Failed to fetch"), "Test Beans One");
    expect(t.toast.title).not.toMatch(/not recorded|not saved/i);
    expect(t.toast.description).toMatch(/may already be recorded/);
    expect(t.close).toBe(false);
  });

  it("A. a retry that reads back the earlier save shows what was recorded and closes", () => {
    const err = new EarlierSaveRecordedError({ id: "tx-1", items: [{ quantity: 4 }] });
    const t = inventoryFailureToast("stock", err, "Test Beans One");
    expect(t.toast.title).toBe("Already recorded");
    expect(t.toast.description).toMatch(/recorded 4 units received/);
    expect(t.close).toBe(true);
    expect(`${t.toast.title} ${t.toast.description}`).not.toMatch(plain);
  });

  it("keeps the refusal title for a known refusal", () => {
    const t = inventoryFailureToast("stock", new Error('400: {"message":"Quantity must be positive."}'), "Test Beans One");
    expect(t.toast.title).toBe("Stock not recorded");
    expect(t.toast.description).toBe("Quantity must be positive.");
  });

  it("builds the success text from the saved response, not the form", () => {
    const t = inventorySuccessToast("Test Beans One", { items: [{ quantity: 4 }] }, true, false);
    expect(t.description).toBe("Saved Test Beans One. Recorded 4 units received.");
    expect(inventorySuccessToast("Test Beans One", undefined, false, false).description).toBe("Saved Test Beans One.");
  });
});

describe("B. the created item lands in the cache once", () => {
  it("drops the earlier row of the same id when a replayed create answers", () => {
    const old = [{ id: "item-1", q: 4 }, { id: "temp-2", q: 0 }];
    const rows = upsertCreatedRow(old, "temp-2", { id: "item-1", q: 4 });
    expect(rows.map((r) => r.id)).toEqual(["item-1"]);
  });

  it("replaces the temporary row and appends when the row was refetched away", () => {
    expect(upsertCreatedRow([{ id: "a" }, { id: "temp" }], "temp", { id: "b" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(upsertCreatedRow([{ id: "a" }], "temp", { id: "b" }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("C. a success clears the earlier failure toast", () => {
  it("dismisses the signed out toast and shows one confirmation", () => {
    const shown: string[] = [];
    const dismissed: string[] = [];
    const slot = failureToastSlot((p: { title: string }) => {
      shown.push(p.title);
      return { dismiss: () => dismissed.push(p.title) };
    });
    slot.fail({ title: "Not saved" });
    slot.succeed({ title: "Inventory added" });
    expect(shown).toEqual(["Not saved", "Inventory added"]);
    expect(dismissed).toEqual(["Not saved"]);
  });
});

describe("D. a CSV import failure line", () => {
  it("shows the server message, never the raw JSON", () => {
    const text = importFailureText(3, new Error('500: {"message":"Could not save the item."}'));
    expect(text).toBe("Row 3 not saved. Could not save the item.");
    expect(text).not.toMatch(/[{}"]|500/);
  });

  it("shows a plain fallback when there is no message", () => {
    const text = importFailureText(4, new Error("500: <html>oops</html>"));
    expect(text).not.toMatch(/html|500/);
    expect(text).not.toMatch(plain);
  });
});

describe("E. an unchanged retry of the starting quantity sends the same body", () => {
  const source = readFileSync(path.join(__dirname, "..", "client", "src", "pages", "inventory.tsx"), "utf8");
  const save = source.slice(source.indexOf("async function saveItem"), source.indexOf("return (\n"));

  it("passes the save's start time as the transaction time", () => {
    expect(source).toMatch(/saveGuard\.run\(\(key, startedAt\) => saveItem\(key, startedAt, form\)\)/);
    expect(save.slice(save.indexOf("recordInbound({"))).toMatch(/^recordInbound\(\{[\s\S]*?timestamp: startedAt,[\s\S]*?\}\)/);
  });

  it("reuses the location read when the save began on its retries", () => {
    expect(save).toMatch(/const location = withStock \? locationFor\(key\) : undefined;/);
    expect(source).toMatch(/function locationFor\(key: string\)/);
  });
});
