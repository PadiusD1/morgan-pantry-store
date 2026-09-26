import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Auth-related endpoints must NOT trigger a redirect on 401 — a failed login or
// an anonymous session check is expected there and is handled by the auth layer.
const AUTH_PATH_PREFIXES = ["/api/auth"];
const LOGIN_ROUTE = "/login";

function isAuthPath(url: string): boolean {
  try {
    const path = new URL(url, window.location.origin).pathname;
    return AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * A mid-session 401 on a core (non-auth) request means the cookie/session
 * expired. Send the user to the login screen so they can re-authenticate
 * instead of leaving them staring at a broken page. Guarded against redirect
 * loops (already on /login) and against auth endpoints (login/logout/me).
 */
// After a save is refused with a 401, reads stop redirecting for a while, so the
// refetch that follows the failed save does not unload the form and its entries.
const SAVE_401_HOLD_MS = 10 * 60 * 1000;
let redirectHeldUntil = 0;

function redirectToLoginOnExpiredSession(res: Response) {
  if (typeof window === "undefined") return;
  if (res.status !== 401) return;
  if (Date.now() < redirectHeldUntil) return;
  if (isAuthPath(res.url)) return;
  if (window.location.pathname === LOGIN_ROUTE) return;
  window.location.href = LOGIN_ROUTE;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    redirectToLoginOnExpiredSession(res);
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/** A save refused because the session ended. The page keeps its entries. */
export class SessionExpiredError extends Error {
  constructor(text: string) {
    super(`401: ${text}`);
    this.name = "SessionExpiredError";
  }
}

export const SESSION_EXPIRED_MESSAGE =
  "This was not saved because you were signed out. Sign in again in another tab, then save here again.";

export function isSessionExpiredError(err: unknown): boolean {
  return err instanceof SessionExpiredError || (err instanceof Error && err.name === "SessionExpiredError");
}

/** The text a failed save shows, the sign in message for a 401, else the fallback. */
export function saveErrorMessage(err: unknown, fallback: string): string {
  return isSessionExpiredError(err) ? SESSION_EXPIRED_MESSAGE : fallback;
}

function isReadMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

// The writes that carry an Idempotency-Key, one key per logical action.
const IDEMPOTENT_WRITES = ["POST /api/transactions"];
let actionKey: string | null = null;

export type ApiRequestOptions = { idempotencyKey?: string };

function requestPath(url: string): string {
  return url.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0];
}

/**
 * Runs one logical save with its key. Inside it, the transaction write that
 * apiRequest sends carries the key, so a retry sends the same key.
 */
export async function withIdempotencyKey<T>(key: string, run: () => Promise<T>): Promise<T> {
  actionKey = key;
  try {
    return await run();
  } finally {
    if (actionKey === key) actionKey = null;
  }
}

export function idempotencyHeaders(
  method: string,
  url: string,
  options?: ApiRequestOptions,
): Record<string, string> {
  const key =
    options?.idempotencyKey ??
    (actionKey && IDEMPOTENT_WRITES.includes(`${method.toUpperCase()} ${requestPath(url)}`)
      ? actionKey
      : undefined);
  return key ? { "Idempotency-Key": key } : {};
}

// The first body sent with each Idempotency-Key. A retry resends it, so the
// server replays the first save instead of answering 422 for a new timestamp.
const sentBodies = new Map<string, string>();

/** Drops the body kept for a key, once its action has succeeded. */
export function forgetSentBody(key: string): void {
  for (const k of Array.from(sentBodies.keys())) {
    if (k === key || k.startsWith(`${key}.`)) sentBodies.delete(k);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  const keyHeaders = idempotencyHeaders(method, url, options);
  const key = keyHeaders["Idempotency-Key"];
  let body = data ? JSON.stringify(data) : undefined;
  if (key && body !== undefined) {
    const first = sentBodies.get(key);
    if (first !== undefined) body = first;
    else sentBodies.set(key, body);
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...keyHeaders,
    },
    body,
    credentials: "include",
  });
  // A plain refusal rolled back on the server and freed the key, so the next
  // try sends the form as it is then. A 409 or 422 may mean the key is held.
  if (key && res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 422) {
    sentBodies.delete(key);
  }

  // A 401 on a save must not redirect first, or the form and its entries are lost.
  if (res.status === 401 && !isReadMethod(method) && !isAuthPath(url)) {
    redirectHeldUntil = Date.now() + SAVE_401_HOLD_MS;
    const text = (await res.text()) || res.statusText;
    throw new SessionExpiredError(text);
  }
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
