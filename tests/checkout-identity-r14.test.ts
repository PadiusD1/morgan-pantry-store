import { describe, expect, it } from "vitest";
import {
  ID_EMAIL_CONFLICT_MESSAGE,
  SHARED_EMAIL_MESSAGE,
  resolveCheckoutIdentity,
} from "@shared/checkout-identity";

const alice = { id: "row-alice", name: "Alice", identifier: "IDALICE", email: "shared@x.edu", clientType: "student" };
const bob = { id: "row-bob", name: "Bob", identifier: "IDBOB", email: "shared@x.edu", clientType: "student" };
const p = { id: "row-p", name: "Pat", identifier: "IDP", email: "p@x.edu", clientType: "student" };
const q = { id: "row-q", name: "Quinn", identifier: "IDQ", email: "q@x.edu", clientType: "student" };

describe("finding B, no ID typed and a shared email", () => {
  it("probe case 4 resolves to Bob, never to the first holder", () => {
    const r = resolveCheckoutIdentity([alice, bob], { studentId: "", email: "shared@x.edu", name: "Bob" });
    expect(r.ok && r.existing?.id).toBe("row-bob");
  });

  it("resolves to Alice when her name is typed", () => {
    const r = resolveCheckoutIdentity([bob, alice], { studentId: "", email: "shared@x.edu", name: " alice " });
    expect(r.ok && r.existing?.id).toBe("row-alice");
  });

  it("refuses when several hold the email and no name matches", () => {
    const r = resolveCheckoutIdentity([alice, bob], { studentId: "", email: "shared@x.edu", name: "Carol" });
    expect(r).toEqual({ ok: false, message: SHARED_EMAIL_MESSAGE });
  });

  it("refuses when two holders share the typed name", () => {
    const bob2 = { ...bob, id: "row-bob2", identifier: "IDBOB2" };
    const r = resolveCheckoutIdentity([alice, bob, bob2], { studentId: "", email: "shared@x.edu", name: "Bob" });
    expect(r).toEqual({ ok: false, message: SHARED_EMAIL_MESSAGE });
  });

  it("keeps a single holder of the email as before", () => {
    const r = resolveCheckoutIdentity([alice], { studentId: "", email: "shared@x.edu", name: "Alice" });
    expect(r.ok && r.existing?.id).toBe("row-alice");
  });

  it("the refusal message is plain", () => {
    expect(SHARED_EMAIL_MESSAGE).not.toMatch(/[:;–—-]/);
  });
});

describe("finding H, a picked person with another person's email", () => {
  it("probe case 3b refuses like the ID of P with the email of Q", () => {
    const r = resolveCheckoutIdentity([p, q], { studentId: "IDP", email: "q@x.edu", name: "Pat", selected: p });
    expect(r).toEqual({ ok: false, message: ID_EMAIL_CONFLICT_MESSAGE });
  });

  it("refuses with no ID typed as well", () => {
    const r = resolveCheckoutIdentity([p, q], { studentId: "", email: "q@x.edu", name: "Pat", selected: p });
    expect(r).toEqual({ ok: false, message: ID_EMAIL_CONFLICT_MESSAGE });
  });

  it("allows the picked person's own email, a shared one, and a new one", () => {
    expect(resolveCheckoutIdentity([p, q], { studentId: "IDP", email: "p@x.edu", name: "Pat", selected: p })).toMatchObject({ ok: true });
    expect(resolveCheckoutIdentity([alice, bob], { studentId: "", email: "shared@x.edu", name: "Alice", selected: alice })).toMatchObject({ ok: true });
    expect(resolveCheckoutIdentity([p, q], { studentId: "", email: "new@x.edu", name: "Pat", selected: p })).toMatchObject({ ok: true });
    expect(resolveCheckoutIdentity([p, q], { studentId: "", email: "", name: "Pat", selected: p })).toMatchObject({ ok: true });
  });
});
