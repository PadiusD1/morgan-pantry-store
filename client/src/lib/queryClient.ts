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
function redirectToLoginOnExpiredSession(res: Response) {
  if (typeof window === "undefined") return;
  if (res.status !== 401) return;
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

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...idempotencyHeaders(method, url, options),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

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
