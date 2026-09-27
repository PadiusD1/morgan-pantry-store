import { SAVE_STILL_RUNNING_MESSAGE, isSaveStillRunning, saveErrorMessage } from "./queryClient";
import { classifySaveError, itemActionFailureText } from "./item-action";

/** The text for a check out the server refused and rolled back. */
export const CHECK_OUT_REFUSAL = "The distribution could not be recorded. Please try again.";

/** The text for a lost response, a 5xx or a timeout. The cart and key are kept. */
export const CHECK_OUT_UNCERTAIN = "The save may already be recorded. Save again to check, the same cart is kept.";

/**
 * The toast a failed check out shows, per the shared design. The held 409 asks
 * to wait. A person refusal or a failed person update passes in its own text.
 * A known refusal shows the server's message. A lost response, a 5xx or a
 * timeout says the save may already be recorded, never that it could not be.
 */
export function checkOutFailure(err: unknown, personText: string | null | undefined): { title: string; description: string } {
  if (isSaveStillRunning(err)) return { title: "Still saving", description: SAVE_STILL_RUNNING_MESSAGE };
  if (personText) return { title: "Check-out failed", description: personText };
  if (classifySaveError(err) === "uncertain") return { title: "Save not confirmed", description: CHECK_OUT_UNCERTAIN };
  return { title: "Check-out failed", description: saveErrorMessage(err, itemActionFailureText(err, CHECK_OUT_REFUSAL)) };
}

/** The text for a fulfil the server refused. */
export const FULFIL_REFUSAL = "The request could not be completed. Check the Requests tab and try again.";

/** The text for a lost response, a 5xx or a timeout on a fulfil. The request list is refreshed. */
export const FULFIL_UNCERTAIN = "The request may already be completed. Check the Requests tab before you try again.";

/**
 * The toast a failed fulfil shows. A lost response, a 5xx or a timeout says the
 * request may already be completed, never that it could not be.
 */
export function fulfilFailure(err: unknown): { title: string; description: string } {
  if (classifySaveError(err) === "uncertain") return { title: "Fulfillment not confirmed", description: FULFIL_UNCERTAIN };
  return { title: "Fulfillment failed", description: saveErrorMessage(err, itemActionFailureText(err, FULFIL_REFUSAL)) };
}
