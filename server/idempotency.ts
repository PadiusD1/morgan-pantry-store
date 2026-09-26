/**
 * Idempotency keys for release one write routes (PLAN.md defect 3).
 *
 * The key row is claimed first, inside the same database transaction as the
 * write, with INSERT ON CONFLICT DO NOTHING. A concurrent twin waits on the
 * primary key, then reads the stored response. A rolled back write frees the
 * key. Keys are scoped by user. A request without the header still runs, and
 * is logged, so tabs from before the release keep working.
 */
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "./pg";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 200;

export interface IdempotentResult {
  status: number;
  body: unknown;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Hash of the route and the request body, so a changed resubmit is caught. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${path}\n${JSON.stringify(canonical(body ?? null))}`)
    .digest("hex");
}

export type Claim =
  | { kind: "claimed" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "mismatch" }
  | { kind: "pending" };

/** Must run inside an open transaction on `client`, before the write. */
export async function claimKey(
  client: PoolClient,
  userId: string,
  key: string,
  hash: string,
): Promise<Claim> {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING key`,
    [userId, key, hash],
  );
  if (inserted.rowCount === 1) return { kind: "claimed" };

  const { rows } = await client.query(
    `SELECT request_hash, response_status, response_body
       FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );
  const row = rows[0];
  if (!row) return { kind: "pending" };
  if (row.request_hash !== hash) return { kind: "mismatch" };
  if (row.response_status === null) return { kind: "pending" };
  return { kind: "replay", status: row.response_status, body: row.response_body };
}

export async function storeResponse(
  client: PoolClient,
  userId: string,
  key: string,
  result: IdempotentResult,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb
      WHERE user_id = $1 AND key = $2`,
    [userId, key, result.status, JSON.stringify(result.body ?? null)],
  );
}

function requestKey(req: Request): { userId: string; key: string } | "invalid" | null {
  const header = req.get(IDEMPOTENCY_HEADER);
  if (header === undefined) {
    console.warn(`[idempotency] ${req.method} ${req.path} without Idempotency-Key`);
    return null;
  }
  const key = header.trim();
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return "invalid";
  const userId = req.user?.id;
  if (!userId) {
    console.warn(`[idempotency] ${req.method} ${req.path} has a key but no user`);
    return null;
  }
  return { userId, key };
}

/**
 * Call right after BEGIN on `client`. Returns null when the write may go
 * ahead, the key being claimed or absent. Otherwise roll back and pass the
 * result to sendClaim.
 */
export async function claimRequestKey(
  client: PoolClient,
  req: Request,
): Promise<Claim | { kind: "invalid" } | null> {
  const rk = requestKey(req);
  if (rk === null) return null;
  if (rk === "invalid") return { kind: "invalid" };
  const claim = await claimKey(
    client,
    rk.userId,
    rk.key,
    requestHash(req.method, req.path, req.body),
  );
  return claim.kind === "claimed" ? null : claim;
}

export function sendClaim(res: Response, claim: Claim | { kind: "invalid" }): void {
  if (claim.kind === "replay") {
    res.status(claim.status).json(claim.body);
  } else if (claim.kind === "mismatch") {
    res.status(422).json({ message: "This key was already used for a different request" });
  } else if (claim.kind === "invalid") {
    res.status(400).json({ message: "Invalid Idempotency-Key header" });
  } else {
    res.status(409).json({ message: "This request is still being saved" });
  }
}

/** Call before COMMIT so a repeat gets the same answer. */
export async function saveRequestKey(
  client: PoolClient,
  req: Request,
  status: number,
  body: unknown,
): Promise<void> {
  const rk = requestKey(req);
  if (rk === null || rk === "invalid") return;
  await storeResponse(client, rk.userId, rk.key, { status, body });
}

/**
 * Runs `work` in one database transaction with the key claimed first, then
 * sends the response. A result of 400 or more rolls back and frees the key.
 */
export async function runIdempotent(
  req: Request,
  res: Response,
  work: (client: PoolClient) => Promise<IdempotentResult>,
): Promise<void> {
  const client = await pool.connect();
  let result: IdempotentResult;
  try {
    await client.query("BEGIN");
    const claim = await claimRequestKey(client, req);
    if (claim) {
      await client.query("ROLLBACK");
      sendClaim(res, claim);
      return;
    }
    result = await work(client);
    if (result.status >= 400) {
      await client.query("ROLLBACK");
    } else {
      await saveRequestKey(client, req, result.status, result.body);
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  res.status(result.status).json(result.body);
}
