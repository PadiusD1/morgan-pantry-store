import { describe, expect, it } from "vitest";
import {
  duplicateMessage,
  duplicateRefusal,
  findDuplicate,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  studentIdKey,
} from "@shared/identity";

const one = {
  id: "a1",
  name: "Test Student One",
  identifier: "T0000001",
  email: "student.one@example.test",
  phone: "(555) 010 0001",
  clientType: "student",
};

describe("normalisers", () => {
  it("trims and lowercases email", () => {
    expect(normaliseEmail("  Student.One@Example.TEST ")).toBe("student.one@example.test");
  });
  it("reduces phone to digits and drops a leading US 1 on 11 digits", () => {
    expect(normalisePhone("+1 (555) 010-0001")).toBe("5550100001");
    expect(normalisePhone("555.010.0001")).toBe("5550100001");
    expect(normalisePhone("25550100001")).toBe("25550100001");
    expect(normalisePhone("1555010000")).toBe("1555010000");
  });
  it("lowercases names and collapses inner spaces", () => {
    expect(normaliseName("  Test   Student\tOne ")).toBe("test student one");
  });
});

describe("findDuplicate", () => {
  it("refuses a candidate matching two fields of one person", () => {
    const d = findDuplicate(
      { name: "test student  one", email: "STUDENT.ONE@example.test", identifier: "T0000009" },
      [one],
    );
    expect(d.duplicate).toBe(true);
    if (d.duplicate) {
      expect(d.match.id).toBe("a1");
      expect(d.fields).toEqual(["name", "email"]);
      expect(duplicateMessage(d.match)).toBe("Test Student One is already in");
    }
  });

  it("allows a single matching field", () => {
    expect(findDuplicate({ name: "Test Student One", identifier: "T0000009" }, [one]).duplicate).toBe(false);
  });

  it("matches phone numbers written differently", () => {
    const d = findDuplicate({ name: "Test Student One", phone: "1 555 010 0001", identifier: "T0000009" }, [one]);
    expect(d.duplicate).toBe(true);
  });

  it("excludes the record itself", () => {
    expect(findDuplicate({ ...one }, [one]).duplicate).toBe(false);
  });

  it("never counts an empty value as a match", () => {
    const blank = { id: "b1", name: "Test Student Two", identifier: "T0000002", email: "", phone: null };
    const d = findDuplicate({ name: "Test Student Three", identifier: "T0000003", email: " ", phone: "" }, [blank]);
    expect(d.duplicate).toBe(false);
  });

  it("compares within one client type only", () => {
    const partnerContact = { ...one, id: "p1", identifier: "PARTNER-1", clientType: "partner" };
    const d = findDuplicate(
      { name: "Test Student One", email: "student.one@example.test", identifier: "T0000009", clientType: "student" },
      [partnerContact],
    );
    expect(d.duplicate).toBe(false);
    const asPartner = findDuplicate(
      { name: "Test Student One", email: "student.one@example.test", identifier: "PARTNER-2", clientType: "Partner" },
      [partnerContact],
    );
    expect(asPartner.duplicate).toBe(true);
  });

  it("treats a missing client type as student", () => {
    const d = findDuplicate({ name: "Test Student One", email: "student.one@example.test", identifier: "X1" }, [
      { ...one, clientType: null },
    ]);
    expect(d.duplicate).toBe(true);
  });

  it("never treats a name or Unknown stored as identifier as a student ID", () => {
    expect(studentIdKey({ name: "Test Student Four", identifier: " test student four" })).toBe("");
    expect(studentIdKey({ name: "Test Student Four", identifier: "Unknown" })).toBe("");
    const walkIn = { id: "w1", name: "Test Student Four", identifier: "Test Student Four", clientType: "student" };
    const unknown = { id: "w2", name: "Test Student Five", identifier: "Unknown", clientType: "student" };
    expect(findDuplicate({ name: "Test Student Four", identifier: "Test Student Four" }, [walkIn]).duplicate).toBe(false);
    expect(findDuplicate({ name: "Test Student Six", identifier: "unknown", phone: "555 010 0006" }, [
      { ...unknown, phone: "5550100006" },
    ]).duplicate).toBe(false);
  });

  it("counts a real student ID match", () => {
    const d = findDuplicate({ name: "Someone Else", identifier: " t0000001 ", phone: "555 010 0001" }, [one]);
    expect(d.duplicate).toBe(true);
    if (d.duplicate) expect(d.fields).toEqual(["studentId", "phone"]);
  });

  it("keeps a legacy duplicate editable on update", () => {
    const twin = { ...one, id: "a2", identifier: "Test Student One" };
    const before = { ...one };
    const after = { ...before, email: "new.address@example.test", phone: "555 010 0099" };
    expect(findDuplicate(after, [one, twin], before).duplicate).toBe(false);
  });

  it("refuses an update whose changed fields create the match", () => {
    const other = { id: "a3", name: "Test Student Seven", identifier: "T0000007", email: "seven@example.test", phone: "5550100007", clientType: "student" };
    const before = { ...one };
    const after = { ...before, name: "Test Student Seven", email: "seven@example.test" };
    const d = findDuplicate(after, [one, other], before);
    expect(d.duplicate).toBe(true);
    if (d.duplicate) expect(d.match.id).toBe("a3");
  });

  it("uses a neutral message when the match has no name", () => {
    expect(duplicateMessage({ name: "  " })).toBe("This person is already in");
  });
});

describe("duplicateRefusal", () => {
  it("returns the server message for a duplicate person refusal", () => {
    const err = new Error(`409: ${JSON.stringify({ message: "Test Student One is already in", duplicateOf: "a1" })}`);
    expect(duplicateRefusal(err)).toBe("Test Student One is already in");
  });
  it("ignores an identifier clash, other statuses and non errors", () => {
    expect(duplicateRefusal(new Error(`409: ${JSON.stringify({ message: "A client with identifier" })}`))).toBeNull();
    expect(duplicateRefusal(new Error("500: oops"))).toBeNull();
    expect(duplicateRefusal(new Error("409: not json"))).toBeNull();
    expect(duplicateRefusal("409: {}")).toBeNull();
  });
});
