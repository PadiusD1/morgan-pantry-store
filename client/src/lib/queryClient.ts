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

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
