import { isSessionExpiredError, saveErrorMessage } from "./queryClient";
import { serverMessage } from "./stock-change";
import { classifySaveError, type SaveOutcome } from "./item-action";

const REQUEST_ACTION_FALLBACK = "The request was not changed. The list is refreshed, please check it and try again.";
const REQUEST_ACTION_UNCERTAIN = "The change may already be recorded. The list is refreshed to show the current status.";

/**
 * Sorts a failed transition per the shared design. Only a 4xx other than the
 * held 409 and 422, or an ended session, is a refusal the server rolled back.
 * A lost response, a 5xx or anything else may already be recorded.
 */
function requestOutcome(err: unknown): SaveOutcome {
  return isSessionExpiredError(err) ? "refused" : classifySaveError(err);
}

/** The server's refusal in plain words, without quotes, underscores or punctuation people should not see. */
function plainWords(message: string): string {
  const words = message
    .replace(/['"`{}\[\]:;]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+-\s+|\s*[–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return REQUEST_ACTION_FALLBACK;
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

/** The title a failed request transition shows. Only a refusal says Not changed. */
export function requestActionErrorTitle(err: unknown): string {
  return requestOutcome(err) === "refused" ? "Not changed" : "Change not confirmed";
}

/** The text a failed request transition shows on the staff Requests page, never a status code or braces. */
export function requestActionErrorText(err: unknown): string {
  const outcome = requestOutcome(err);
  if (outcome !== "refused") return saveErrorMessage(err, REQUEST_ACTION_UNCERTAIN);
  const message = serverMessage(err);
  return saveErrorMessage(err, message ? plainWords(message) : REQUEST_ACTION_FALLBACK);
}

const REQUEST_ACTION_DONE: Record<string, string> = {
  approve: "Request approved.",
  deny: "Request denied.",
  fulfill: "Request fulfilled.",
  cancel: "Request cancelled.",
  "no-show": "Request marked as no show.",
};

/** The text a successful request transition shows on the staff Requests page, in plain words with no hyphen. */
export function requestActionSuccessText(action: string): string {
  return REQUEST_ACTION_DONE[action] ?? "Request updated.";
}
