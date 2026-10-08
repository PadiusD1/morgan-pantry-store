import { describe, expect, it } from "vitest";
import { localStackDatabaseUrl } from "../scripts/local-stack/safety.mjs";

describe("synthetic database seed boundaries", () => {
  it("accepts the development database and the exact generated E2E namespace", () => {
    for (const name of ["frc_stack", "frc_e2e_abcdefghijklmnop", "frc_e2e_nmeamumsazcmhiyh"]) {
      expect(localStackDatabaseUrl(`postgres://frc@localhost:55417/${name}`).pathname).toBe(`/${name}`);
    }
  });
  it("does not seed arbitrary local databases or malformed names", () => {
    for (const name of ["postgres", "production", "frc_e2e", "frc_e2e_short", "frc_e2e_abcdefghijklmno1", "frc_e2e_ABCDEFGHIJKLMNOP", "frc_stack_backup", "frc_e2e_abcdefghijklmnop/extra", "frc_e2e_abcdefghijklmnop%22"]) {
      expect(() => localStackDatabaseUrl(`postgres://frc@localhost:55417/${name}`)).toThrow("synthetic namespace");
    }
  });
  it("refuses remote endpoints, host overrides, non-Postgres protocols and missing URLs", () => {
    for (const value of [undefined, "not a URL", "postgres://frc@prod.example/frc_stack", "postgres://frc@localhost.example/frc_stack", "postgres://frc@localhost/frc_stack?host=prod.example", "postgres://frc@localhost/frc_stack#override", "https://localhost/frc_stack"]) {
      expect(() => localStackDatabaseUrl(value)).toThrow();
    }
  });
});
