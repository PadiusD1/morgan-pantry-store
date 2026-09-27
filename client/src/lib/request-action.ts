import { saveErrorMessage } from "./queryClient";
import { serverMessage } from "./stock-change";

const REQUEST_ACTION_FALLBACK = "The request was not changed. The list is refreshed, please check it and try again.";

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

/** The text a refused request transition shows on the staff Requests page, never a status code or braces. */
export function requestActionErrorText(err: unknown): string {
  const message = serverMessage(err);
  return saveErrorMessage(err, message ? plainWords(message) : REQUEST_ACTION_FALLBACK);
}
