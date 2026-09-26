import { describe, expect, it } from "vitest";
import {
  ALREADY_ON_FILE_MESSAGE,
  CLASSIFICATIONS,
  ID_CHANGE_MESSAGE,
  ID_EMAIL_CONFLICT_MESSAGE,
  ID_TAKEN_MESSAGE,
  buildCheckoutClient,
  findReturningClient,
  generateIdentifier,
  inputsFromClient,
  isClassification,
  isGeneratedIdentifier,
  resolveCheckoutIdentity,
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

describe("resolveCheckoutIdentity, finding 1", () => {
  const alice = { id: "a1", name: "Synthetic Alice", identifier: "IDALICE", email: "shared@example.invalid", clientType: "student" };
  const carol = { id: "c9", name: "Synthetic Carol", identifier: "IDCAROL", email: "carol@example.invalid", clientType: "student" };
  const dana = { id: "d4", name: "Synthetic Dana", identifier: "FRC3F2A9C1B7D", email: "dana@example.invalid", clientType: "student" };
  const erin = { id: "e5", name: "Synthetic Erin", identifier: "erin@example.invalid", email: null, clientType: "student" };
  const partner = { id: "p2", name: "Synthetic Partner", identifier: "IDPART", email: "shared@example.invalid", clientType: "partner" };
  const people = [alice, carol, dana, erin, partner];
  const random = () => "3f2a9c1b-7d4e-4a00-9b00-000000000000";

  it("makes Bob a new person sharing Alice's email and leaves Alice with IDALICE", () => {
    const r = resolveCheckoutIdentity(people, { studentId: "IDBOB", email: "shared@example.invalid", name: "Synthetic Bob" });
    expect(r).toEqual({ ok: true, existing: undefined, name: "Synthetic Bob" });
    if (!r.ok) throw new Error("refused");
    const payload = buildCheckoutClient({ existing: r.existing, name: r.name, studentId: "IDBOB", email: "shared@example.invalid", random });
    expect(payload).toEqual({ name: "Synthetic Bob", identifier: "IDBOB", email: "shared@example.invalid" });
    expect(alice.identifier).toBe("IDALICE");
  });

  it("refuses an ID of one person with an email of another", () => {
    expect(resolveCheckoutIdentity(people, { studentId: "IDALICE", email: "carol@example.invalid", name: "Synthetic Alice" }))
      .toEqual({ ok: false, message: ID_EMAIL_CONFLICT_MESSAGE });
  });

  it("uses the person the ID matches when the email is theirs, new or empty", () => {
    for (const email of ["shared@example.invalid", "new@example.invalid", ""]) {
      const r = resolveCheckoutIdentity(people, { studentId: " idalice ", email, name: "Someone Else" });
      expect(r).toEqual({ ok: true, existing: alice, name: "Synthetic Alice" });
    }
  });

  it("never changes the ID of the person the ID matches", () => {
    const payload = buildCheckoutClient({ existing: alice, name: "Synthetic Alice", studentId: "idalice", random });
    expect(payload.identifier).toBe("IDALICE");
    expect(payload.id).toBe("a1");
  });

  it("never pairs a person's row with a different typed ID", () => {
    const payload = buildCheckoutClient({ existing: alice, name: "Synthetic Alice", studentId: "IDBOB", email: "shared@example.invalid", random });
    expect(payload).toEqual({ id: "a1", name: "Synthetic Alice", identifier: "IDALICE", email: "shared@example.invalid" });
  });

  it("refuses the same name on the email when that person has a different stored ID", () => {
    expect(resolveCheckoutIdentity(people, { studentId: "IDNEW", email: "shared@example.invalid", name: "  synthetic   ALICE " }))
      .toEqual({ ok: false, message: ALREADY_ON_FILE_MESSAGE });
  });

  it("fills the ID of the same named person on the email who has no stored ID", () => {
    for (const q of [dana, erin]) {
      const r = resolveCheckoutIdentity(people, { studentId: "IDFILL", email: q === dana ? "dana@example.invalid" : "erin@example.invalid", name: q.name });
      expect(r).toEqual({ ok: true, existing: q, name: q.name });
      if (!r.ok) throw new Error("refused");
      const payload = buildCheckoutClient({ existing: r.existing, name: r.name, studentId: "IDFILL", random });
      expect(payload.id).toBe(q.id);
      expect(payload.identifier).toBe("IDFILL");
    }
  });

  it("makes a new person when the name differs from the one with no stored ID", () => {
    expect(resolveCheckoutIdentity(people, { studentId: "IDFRANK", email: "dana@example.invalid", name: "Synthetic Frank" }))
      .toEqual({ ok: true, existing: undefined, name: "Synthetic Frank" });
  });

  it("uses the email match when no ID is typed", () => {
    expect(resolveCheckoutIdentity(people, { email: "CAROL@example.invalid ", name: "Typed Name" }))
      .toEqual({ ok: true, existing: carol, name: "Synthetic Carol" });
    expect(resolveCheckoutIdentity(people, { email: "erin@example.invalid", name: "Typed Name" }))
      .toEqual({ ok: true, existing: erin, name: "Synthetic Erin" });
  });

  it("makes a new person when nothing matches and never matches a partner", () => {
    expect(resolveCheckoutIdentity(people, { studentId: "IDNOONE", email: "none@example.invalid", name: "Synthetic Gus" }))
      .toEqual({ ok: true, existing: undefined, name: "Synthetic Gus" });
    expect(resolveCheckoutIdentity([partner], { studentId: "IDPART", email: "shared@example.invalid", name: "Synthetic Hal" }))
      .toEqual({ ok: true, existing: undefined, name: "Synthetic Hal" });
  });

  it("keeps a picked person only with their own ID or none", () => {
    expect(resolveCheckoutIdentity(people, { selected: alice, studentId: "IDALICE", email: "shared@example.invalid", name: "Synthetic Alice" }))
      .toEqual({ ok: true, existing: alice, name: "Synthetic Alice" });
    expect(resolveCheckoutIdentity(people, { selected: dana, studentId: "IDDANA", name: "Synthetic Dana" }))
      .toEqual({ ok: true, existing: dana, name: "Synthetic Dana" });
    expect(resolveCheckoutIdentity(people, { selected: alice, studentId: "IDCAROL", name: "Synthetic Alice" }))
      .toEqual({ ok: false, message: ID_TAKEN_MESSAGE });
    expect(resolveCheckoutIdentity(people, { selected: alice, studentId: "IDOTHER", name: "Synthetic Alice" }))
      .toEqual({ ok: false, message: ID_CHANGE_MESSAGE });
  });

  it("keeps the refusal messages free of colons, semicolons and dashes", () => {
    for (const msg of [ID_EMAIL_CONFLICT_MESSAGE, ALREADY_ON_FILE_MESSAGE, ID_TAKEN_MESSAGE, ID_CHANGE_MESSAGE]) {
      expect(msg).toBeTruthy();
      expect(msg).not.toMatch(/[:;]|\s[-–—]\s/);
    }
  });
});
