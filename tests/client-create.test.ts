import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_MESSAGE,
  classificationProblem,
  createClientWork,
  transactionClassification,
} from "../server/client-create";

type Row = { id: string; name: string };

function deps(opts: { duplicate?: Row; insertError?: unknown } = {}) {
  const inserted: unknown[] = [];
  return {
    inserted,
    deps: {
      checkDuplicate: async () =>
        opts.duplicate ? { duplicate: true as const, match: opts.duplicate } : { duplicate: false as const },
      duplicateMessage: (m: Row) => `${m.name} is already in`,
      insert: async (data: unknown) => {
        if (opts.insertError) throw opts.insertError;
        inserted.push(data);
        return { id: "new1", ...(data as object) };
      },
      isUniqueViolation: (err: unknown) => (err as { code?: string })?.code === "23505",
    },
  };
}

describe("createClientWork", () => {
  it("creates the client with its classification", async () => {
    const d = deps();
    const result = await createClientWork({ name: "Test Student One", identifier: "A1234567", classification: "Junior" }, d.deps);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ id: "new1", classification: "Junior" });
    expect(d.inserted).toHaveLength(1);
  });

  it("keeps the duplicate refusal inside the unit of work", async () => {
    const d = deps({ duplicate: { id: "c9", name: "Test Student Nine" } });
    const result = await createClientWork({ name: "Test Student Nine", identifier: "A9999999" }, d.deps);
    expect(result).toEqual({ status: 409, body: { message: "Test Student Nine is already in", duplicateOf: "c9" } });
    expect(d.inserted).toHaveLength(0);
  });

  it("answers 409 on a unique identifier clash and rethrows anything else", async () => {
    const clash = deps({ insertError: { code: "23505" } });
    expect((await createClientWork({ name: "Test Student Two", identifier: "B2222222" }, clash.deps)).status).toBe(409);
    const broken = deps({ insertError: new Error("boom") });
    await expect(createClientWork({ name: "Test Student Two", identifier: "B2222222" }, broken.deps)).rejects.toThrow("boom");
  });

  it("refuses a classification that is not in the list before any write", async () => {
    const d = deps();
    const result = await createClientWork({ name: "Test Student Three", identifier: "C3333333", classification: "Alumni" }, d.deps);
    expect(result).toEqual({ status: 400, body: { message: CLASSIFICATION_MESSAGE } });
    expect(d.inserted).toHaveLength(0);
  });
});

describe("classification checks", () => {
  it("allows no classification and refuses unlisted text", () => {
    expect(classificationProblem(undefined)).toBeNull();
    expect(classificationProblem(null)).toBeNull();
    expect(classificationProblem("")).toBeNull();
    expect(classificationProblem("Faculty or staff")).toBeNull();
    expect(classificationProblem("senior")).toBe(CLASSIFICATION_MESSAGE);
  });

  it("copies only a listed value onto the check out", () => {
    expect(transactionClassification("Graduate")).toBe("Graduate");
    expect(transactionClassification("Alumni")).toBeNull();
    expect(transactionClassification(undefined)).toBeNull();
  });
});
