/** Shared transport concerns for every barcode provider adapter. */

/**
 * Open Food Facts asks every reuser to identify its application so they can
 * contact a misbehaving client instead of blocking a whole address range. The
 * same header is sent to the other providers for the same reason.
 */
export const USER_AGENT =
  "MorganStateFRC/2.0 (pantry inventory; https://github.com/PadiusD1/morgan-pantry-store)";

export const API_TIMEOUT_MS = 8000;

export const JSON_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" } as const;

/** Today in ISO date form, for stamping when a figure was read. */
export const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * A provider that could not answer the question.
 *
 * It must reach the caller as a failure, because "we were not allowed to ask"
 * is not "the product does not exist". A rate limit, a rejected credential, a
 * server fault and a transport error all belong here: each one leaves the
 * question open, and recording any of them as a missing product would teach the
 * cache a fact nobody established.
 */
export class ProviderUnavailableError extends Error {
  readonly status: number | null;
  constructor(provider: string, status: number | null, detail?: string) {
    super(
      status === 429
        ? `${provider} rate limit reached (HTTP 429), so this lookup is unproven`
        : status === 401 || status === 403
          ? `${provider} rejected our credentials (HTTP ${status}), so this lookup is unproven`
          : status === null
            ? `${provider} could not be reached: ${detail ?? "transport error"}`
            : `${provider} returned an unexpected HTTP ${status}`,
    );
    this.name = "ProviderUnavailableError";
    this.status = status;
  }
}

/**
 * Fetch one provider response, bounded and with status handling in one place.
 *
 * `notFound` lists the statuses this provider documents as "no such product".
 * Only those become a miss; every other non-success status is an outage. The
 * request is aborted at the deadline rather than merely losing a race, so a
 * stalled provider does not hold a socket open behind us.
 *
 * Returns null for a documented not-found, or the successful response.
 */
export async function providerFetch(
  provider: string,
  url: string,
  options: { headers?: Record<string, string>; method?: string; body?: string; notFound?: number[] } = {},
): Promise<Response | null> {
  const notFound = options.notFound ?? [];
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? { ...JSON_HEADERS },
      body: options.body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderUnavailableError(provider, null, err instanceof Error ? err.message : String(err));
  }
  if (res.ok) return res;
  if (notFound.includes(res.status)) return null;
  throw new ProviderUnavailableError(provider, res.status);
}

/** Retry a provider lookup up to `maxRetries` times with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

/**
 * A backstop around a whole provider call, covering the JSON parse and any
 * work after the fetch. providerFetch already aborts the request itself.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * A number only when the provider wrote a complete one.
 *
 * Number.parseFloat stops at the first character it cannot read, so "2,5"
 * came back as 2 and a two-and-a-half kilogram bag was recorded as two
 * kilograms. A string must therefore be the whole number and nothing else,
 * with a dot decimal separator. Anything else is a convention this code does
 * not understand, and guessing at it is how a wrong figure reaches a report.
 */
export function completeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const MASS_FACTORS: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
};

/**
 * A net quantity is only a mass when its unit is a mass unit. Millilitres,
 * litres and fluid ounces measure volume, and converting one to the other needs
 * a density nobody published, so those stay unknown.
 */
export function massFromQuantity(value: unknown, unit: unknown): number | null {
  const amount = completeNumber(value);
  if (amount === null || amount <= 0) return null;
  const factor = MASS_FACTORS[String(unit ?? "").trim().toLowerCase()];
  if (!factor) return null;
  const grams = amount * factor;
  return grams > 0 && grams <= 100_000 ? grams : null;
}
