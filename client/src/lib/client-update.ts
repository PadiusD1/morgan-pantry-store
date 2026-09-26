import { isSessionExpiredError } from "./queryClient";

export type RequestFn = (method: string, url: string, data?: unknown) => Promise<Response>;

/**
 * An existing person's update failed before the visit was sent. It keeps the
 * original message, so a duplicate refusal still reads as one.
 */
export class ClientUpdateFailedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ClientUpdateFailedError";
  }
}

/**
 * Sends an existing person's update. The promise it gives back rejects when
 * the update fails, so a check out that awaits it stops before the visit.
 */
export function sendClientUpdate(request: RequestFn, id: string, body: unknown): Promise<string> {
  return request("PATCH", `/api/clients/${id}`, body).then(
    () => id,
    (err) => {
      // An ended session keeps its own error and sign in message.
      throw isSessionExpiredError(err) ? err : new ClientUpdateFailedError(err);
    },
  );
}

/**
 * The text a check out shows when the person's update failed, per the shared
 * design. A refusal shows the server's message, an uncertain outcome says the
 * details may already be saved. Null for any other failure.
 */
export function clientUpdateFailureText(err: unknown): string | null {
  if (!(err instanceof Error) || err.name !== "ClientUpdateFailedError") return null;
  const status = parseInt(err.message, 10);
  if (status >= 400 && status < 500) {
    let message = "The person's details were not accepted.";
    try {
      const parsed = JSON.parse(err.message.slice(err.message.indexOf(":") + 1));
      if (parsed && typeof parsed.message === "string" && parsed.message.trim()) message = parsed.message.trim();
    } catch {
      // keep the plain message
    }
    return `${message.replace(/[.]$/, "")}. The visit was not recorded.`;
  }
  return "The visit was not recorded. The person's details may already be saved. Please try again.";
}

/**
 * Records a visit only after the person's pending create or update is
 * confirmed. A failed person write stops here and no visit is sent.
 */
export async function postVisitAfterClient(
  request: RequestFn,
  clientReady: Promise<string> | string,
  visit: (clientId: string) => unknown,
): Promise<Response> {
  const clientId = await clientReady;
  return request("POST", "/api/transactions", visit(clientId));
}
