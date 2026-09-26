export type RequestFn = (method: string, url: string, data?: unknown) => Promise<Response>;

/**
 * Sends an existing person's update. The promise it gives back rejects when
 * the update fails, so a check out that awaits it stops before the visit.
 */
export function sendClientUpdate(request: RequestFn, id: string, body: unknown): Promise<string> {
  return request("PATCH", `/api/clients/${id}`, body).then(() => id);
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
