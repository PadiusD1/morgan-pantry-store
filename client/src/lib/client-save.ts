import type { ClientRecord } from "./repository";
import { toApiClientBody } from "./api-types";

/**
 * The request the Clients page sends for its form. A new person is always a
 * create, so the server's duplicate rule can refuse someone already on file,
 * and it is never matched to an existing record by student ID, which used to
 * change that other person in place. Only an edit of a known record patches.
 */
export function clientSaveRequest(id: string | undefined, fields: Partial<ClientRecord>) {
  const body = toApiClientBody(fields);
  return id
    ? { method: "PATCH" as const, url: `/api/clients/${id}`, body }
    : { method: "POST" as const, url: "/api/clients", body };
}
