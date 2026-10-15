/** Persistent per-browser checkout event selection.
 * Only stores an event UUID, never client, cart, or student details.
 * Staff must still be authorized server-side for event assignment.
 */
export const ACTIVE_EVENT_STORAGE_KEY = "frc:checkout:active-event:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validEventId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function readActiveEvent(storage: Pick<Storage,"getItem">): string | null {
  try {
    const value = storage.getItem(ACTIVE_EVENT_STORAGE_KEY);
    return validEventId(value) ? value : null;
  } catch { return null; }
}
export function setActiveEvent(storage: Pick<Storage,"setItem" | "removeItem">, eventId: string | null): void {
  if (eventId !== null && !validEventId(eventId)) throw new Error("Invalid event identifier");
  if (eventId === null) storage.removeItem(ACTIVE_EVENT_STORAGE_KEY);
  else storage.setItem(ACTIVE_EVENT_STORAGE_KEY, eventId);
}
