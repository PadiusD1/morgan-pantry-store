import { saveErrorMessage } from "./queryClient";
import { serverMessage } from "./stock-change";
import { classifySaveError } from "./item-action";

export type StockFailureText = { title: string; description: string };

export const STOCK_UNCERTAIN = "The change may already be recorded. The list is refreshed to show the true count.";
const STOCK_REFUSED = "The stock was not changed. Please try again.";

/**
 * The toast a failed plus or minus click shows, per the shared design. Only a
 * 4xx other than the held 409 and 422 is a refusal the server rolled back, so
 * only then does it say the stock was not changed. A lost response, a 5xx or
 * the held 422 may already be recorded, and the caller refreshes the list.
 */
export function stockAdjustFailure(err: unknown): StockFailureText {
  const outcome = classifySaveError(err);
  if (outcome === "refused") {
    return { title: "Not saved", description: saveErrorMessage(err, serverMessage(err) ?? STOCK_REFUSED) };
  }
  if (outcome === "running") {
    return { title: "Save not confirmed", description: saveErrorMessage(err, STOCK_UNCERTAIN) };
  }
  return { title: "Save not confirmed", description: STOCK_UNCERTAIN };
}
