import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

/**
 * Two devices registering one person at the same moment, on real PostgreSQL.
 *
 * The duplicate rule is a read, and two devices legitimately send two
 * different idempotency keys, so idempotency cannot help here. Before the
 * identity queue both requests read an empty table, both inserted, and the
 * pantry had two records for Pastor James. These tests synchronise the two
 * transactions at the moment that used to be unsafe and assert that exactly one
 * record survives, while two genuinely different people with the same name
 * still both save.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t?.drop();
});

type Attempt = { status: number };

/**
 * Run two client creates whose duplicate check and insert are interleaved as
 * badly as possible: each transaction waits at the barrier until both have
 * taken the identity queue, which is exactly the window the queue has to close.
 */
async function race(
  rows: { name: string; email: string; clientType: string }[],
  options: { withLock: boolean },
): Promise<Attempt[]> {
  const { checkClientDuplicate, candidateLookupOn } = await import("../../server/client-duplicates");
  const { createClientWork } = await import("../../server/client-create");
  const { CLIENT_IDENTITY_SCOPE, lockIdentityScope } = await import("../../server/identity-lock");

  let arrived = 0;
  let release: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitForBoth = async () => {
    arrived += 1;
    if (arrived === 2) release();
    await barrier;
  };

  const attempt = async (row: { name: string; email: string; clientType: string }): Promise<Attempt> => {
    const connection = await t.pool.connect();
    try {
      await connection.query("BEGIN");
      if (options.withLock) {
        // Both transactions reach the queue before either may pass it.
        await waitForBoth();
        await lockIdentityScope(connection, CLIENT_IDENTITY_SCOPE);
      }
      const data = {
        ...row,
        // Each device generates its own partner identifier, so a unique index
        // on the identifier column could never catch this.
        identifier: `PARTNER-${randomUUID()}`,
      };
      const result = await createClientWork(data, {
        checkDuplicate: async (candidate) => {
          const found = await checkClientDuplicate(candidate, null, candidateLookupOn(connection));
          if (!options.withLock) await waitForBoth();
          return found;
        },
        duplicateMessage: () => "Duplicate synthetic identity",
        insert: async (value: any) =>
          (
            await connection.query(
              "INSERT INTO clients(name, identifier, email, client_type) VALUES($1,$2,$3,$4) RETURNING id",
              [value.name, value.identifier, value.email, value.clientType],
            )
          ).rows[0],
        isUniqueViolation: (error: any) => error?.code === "23505",
      });
      if (result.status >= 400) await connection.query("ROLLBACK");
      else await connection.query("COMMIT");
      return { status: result.status };
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  };

  return Promise.all(rows.map(attempt));
}

const countByEmail = async (email: string): Promise<number> =>
  (await t.pool.query("SELECT count(*)::int AS n FROM clients WHERE email = $1", [email])).rows[0].n;

describe("simultaneous registration of one shared person", () => {
  it("reproduces two rows when the duplicate check and the insert are not serialised", async () => {
    const email = `synthetic-unguarded-${randomUUID()}@example.invalid`;
    const row = { name: "Synthetic Unguarded Partner", email, clientType: "partner" };
    const results = await race([row, row], { withLock: false });
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    // The defect, kept as a test so the repair cannot quietly regress.
    expect(await countByEmail(email)).toBe(2);
  });

  it("saves one record and refuses the second device when the identity queue is held", async () => {
    const email = `synthetic-guarded-${randomUUID()}@example.invalid`;
    const row = { name: "Synthetic Guarded Partner", email, clientType: "partner" };
    const results = await race([row, row], { withLock: true });
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countByEmail(email)).toBe(1);
  });

  it("still saves two different people who happen to share a name", async () => {
    const first = `synthetic-distinct-a-${randomUUID()}@example.invalid`;
    const second = `synthetic-distinct-b-${randomUUID()}@example.invalid`;
    const results = await race(
      [
        { name: "Synthetic Same Name", email: first, clientType: "partner" },
        { name: "Synthetic Same Name", email: second, clientType: "partner" },
      ],
      { withLock: true },
    );
    // One matching field is a name, and the rule needs two, so both are saved.
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await countByEmail(first)).toBe(1);
    expect(await countByEmail(second)).toBe(1);
  });

  it("serialises the queue rather than deadlocking when both transactions hold it", async () => {
    const email = `synthetic-queue-${randomUUID()}@example.invalid`;
    const row = { name: "Synthetic Queue Partner", email, clientType: "partner" };
    // A deadlock would fail this with SQLSTATE 40P01 instead of a status pair.
    const results = await race([row, row], { withLock: true });
    expect(results).toHaveLength(2);
    expect(await countByEmail(email)).toBe(1);
  });
});

describe("donor find-or-create under the same queue", () => {
  it("creates one donor when two devices submit the same name at once", async () => {
    const { resolveDonor } = await import("../../server/donor-find-or-create");
    const { DONOR_IDENTITY_SCOPE, lockIdentityScope } = await import("../../server/identity-lock");
    const name = `Synthetic Concurrent Donor ${randomUUID().slice(0, 8)}`;

    let arrived = 0;
    let release: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const attempt = async () => {
      const connection = await t.pool.connect();
      try {
        await connection.query("BEGIN");
        arrived += 1;
        if (arrived === 2) release();
        await barrier;
        await lockIdentityScope(connection, DONOR_IDENTITY_SCOPE);
        const store = {
          findDonorsByNormalisedName: async (key: string) =>
            (
              await connection.query(
                "SELECT * FROM donors WHERE lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = $1",
                [key],
              )
            ).rows,
          createDonor: async (data: any) =>
            (
              await connection.query(
                "INSERT INTO donors(name, status) VALUES($1,$2) RETURNING *",
                [data.name, data.status ?? "active"],
              )
            ).rows[0],
        };
        const resolution = await resolveDonor(store as any, { name, status: "active" } as any);
        await connection.query("COMMIT");
        return resolution.kind;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    };

    const kinds = await Promise.all([attempt(), attempt()]);
    expect(kinds.sort()).toEqual(["created", "existing"]);
    const rows = (
      await t.pool.query("SELECT count(*)::int AS n FROM donors WHERE name = $1", [name])
    ).rows[0].n;
    expect(rows).toBe(1);
  });
});
