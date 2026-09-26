import { describe, expect, it } from "vitest";
import {
  CLASSIFICATIONS,
  buildCheckoutClient,
  findReturningClient,
  generateIdentifier,
  inputsFromClient,
  isClassification,
  isGeneratedIdentifier,
  validateIdentityInputs,
} from "@shared/checkout-identity";

const clients = [
  { id: "c1", name: "Test Student One", identifier: "A1234567", email: "one@example.edu", clientType: "student" },
  { id: "c2", name: "Test Student Two", identifier: "two@example.edu", email: null, clientType: "student" },
  { id: "c3", name: "Test Student Three", identifier: "Test Student Three", email: "three@example.edu", clientType: "student" },
  { id: "p1", name: "Test Partner", identifier: "B7654321", email: "partner@example.org", clientType: "partner" },
];

describe("validateIdentityInputs", () => {
  it("accepts empty inputs and good values", () => {
    expect(validateIdentityInputs({})).toEqual({});
    expect(validateIdentityInputs({ studentId: "A1234567", email: "one@example.edu", classification: "Junior" })).toEqual({});
  });

  it("checks each input separately", () => {
    expect(validateIdentityInputs({ studentId: "A1234567", email: "not an email" })).toEqual({
      email: "Enter a valid email address",
    });
    expect(validateIdentityInputs({ studentId: "12 34", email: "one@example.edu" })).toEqual({
      studentId: "Student ID must be 3 to 20 letters or numbers",
    });
    expect(validateIdentityInputs({ studentId: "one@example.edu", email: "bad" })).toEqual({
      studentId: "Put the email in the email box",
      email: "Enter a valid email address",
    });
  });

  it("allows only the listed classifications", () => {
    expect(CLASSIFICATIONS).toEqual(["Freshman", "Sophomore", "Junior", "Senior", "Graduate", "Faculty or staff", "Other"]);
    expect(isClassification("Faculty or staff")).toBe(true);
    expect(isClassification("freshman")).toBe(false);
    expect(validateIdentityInputs({ classification: "Alumni" })).toEqual({
      classification: "Pick a classification from the list",
    });
  });

  it("keeps new messages free of colons, semicolons and dashes", () => {
    const all = validateIdentityInputs({ studentId: "x", email: "bad", classification: "Alumni" });
    for (const msg of Object.values(all)) expect(msg).not.toMatch(/[:;]|\s[-–—]\s/);
  });
});

describe("findReturningClient", () => {
  it("matches the student ID against identifier first", () => {
    expect(findReturningClient(clients, { studentId: "a1234567", email: "three@example.edu" })?.id).toBe("c1");
  });

  it("matches the email column when the ID finds nobody", () => {
    expect(findReturningClient(clients, { studentId: "Z9999999", email: "THREE@example.edu " })?.id).toBe("c3");
  });

  it("matches a legacy row that holds the email in identifier", () => {
    expect(findReturningClient(clients, { email: "two@example.edu" })?.id).toBe("c2");
  });

  it("never matches a partner and returns nothing for empty inputs", () => {
    expect(findReturningClient(clients, { studentId: "B7654321" })).toBeUndefined();
    expect(findReturningClient(clients, { email: "partner@example.org" })).toBeUndefined();
    expect(findReturningClient(clients, {})).toBeUndefined();
  });
});

describe("generateIdentifier", () => {
  it("builds a prefixed code from the random source", () => {
    const id = generateIdentifier([], () => "3f2a9c1b-7d4e-4a00-9b00-000000000000");
    expect(id).toBe("FRC3F2A9C1B7D");
    expect(isGeneratedIdentifier(id)).toBe(true);
  });

  it("skips a code that is already taken", () => {
    const values = ["3f2a9c1b-7d4e-4a00-9b00-000000000000", "aaaaaaaa-bbbb-4a00-9b00-000000000000"];
    let i = 0;
    const id = generateIdentifier(["frc3f2a9c1b7d"], () => values[i++]);
    expect(id).toBe("FRCAAAAAAAABB");
  });

  it("gives distinct codes from the real random source", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateIdentifier()));
    expect(seen.size).toBe(50);
    for (const id of seen) expect(isGeneratedIdentifier(id)).toBe(true);
  });

  it("stops when every code is taken", () => {
    expect(() => generateIdentifier(["FRC0000000000"], () => "00000000-0000-4000-8000-000000000000")).toThrow();
  });
});

describe("inputsFromClient", () => {
  it("splits a real ID and the email column", () => {
    expect(inputsFromClient(clients[0])).toEqual({ studentId: "A1234567", email: "one@example.edu" });
  });

  it("moves a legacy email identifier into the email box", () => {
    expect(inputsFromClient(clients[1])).toEqual({ studentId: "", email: "two@example.edu" });
  });

  it("leaves the ID box empty for a name, Unknown or a generated code", () => {
    expect(inputsFromClient(clients[2]).studentId).toBe("");
    expect(inputsFromClient({ id: "x", name: "Test Student Four", identifier: "Unknown" }).studentId).toBe("");
    expect(inputsFromClient({ id: "y", name: "Test Student Five", identifier: "FRC3F2A9C1B7D" }).studentId).toBe("");
  });
});

describe("buildCheckoutClient", () => {
  const random = () => "3f2a9c1b-7d4e-4a00-9b00-000000000000";

  it("gives a new record with no ID a generated identifier, never the name or Unknown", () => {
    const payload = buildCheckoutClient({ name: " Test Student Six ", classification: "Senior", random });
    expect(payload).toEqual({ name: "Test Student Six", identifier: "FRC3F2A9C1B7D", classification: "Senior" });
  });

  it("uses a typed student ID and keeps email and classification apart", () => {
    const payload = buildCheckoutClient({
      name: "Test Student Seven",
      studentId: " C7777777 ",
      email: " seven@example.edu ",
      classification: "Graduate",
      contact: "555 0100",
      random,
    });
    expect(payload).toEqual({
      name: "Test Student Seven",
      identifier: "C7777777",
      email: "seven@example.edu",
      classification: "Graduate",
      contact: "555 0100",
    });
  });

  it("keeps a returning record's identifier when no ID is typed", () => {
    const payload = buildCheckoutClient({ existing: clients[1], name: "Test Student Two", email: "two@example.edu", random });
    expect(payload).toEqual({ id: "c2", name: "Test Student Two", identifier: "two@example.edu", email: "two@example.edu" });
  });

  it("drops a classification that is not in the list", () => {
    expect(buildCheckoutClient({ name: "Test Student Eight", studentId: "D8888888", classification: "Alumni", random }))
      .toEqual({ name: "Test Student Eight", identifier: "D8888888" });
  });
});

describe("retry and returning classification", () => {
  it("regenerates the same identifier for a retry of the same save key", () => {
    const key = "9c1b7d4e-3f2a-4a00-9b00-000000000000";
    const first = buildCheckoutClient({ name: "Test Student Nine", random: () => key });
    const retry = buildCheckoutClient({ name: "Test Student Nine", random: () => key });
    expect(first.identifier).toBe("FRC9C1B7D4E3F");
    expect(retry).toEqual(first);
  });

  it("copies a returning student's stored classification when none is picked", () => {
    const existing = { id: "c4", name: "Test Student Four", identifier: "E4444444", classification: "Sophomore" };
    expect(buildCheckoutClient({ existing, name: "Test Student Four" }).classification).toBe("Sophomore");
    expect(buildCheckoutClient({ existing, name: "Test Student Four", classification: "Junior" }).classification).toBe("Junior");
  });
});
