import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

export type AuthRole = "admin" | "staff" | "volunteer" | "student";

export const STAFF_ROLES: AuthRole[] = ["admin", "staff", "volunteer"];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  studentId: string | null;
  phone: string | null;
  createdAt?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  studentId: string;
  phone?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  signup: (input: SignupInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

type MeResponse = { user: AuthUser } | null;

const ME_QUERY_KEY = ["/api/auth/me"] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * apiRequest throws `Error("{status}: {body}")` where body is usually
 * `{"message":"..."}`. Extract the human message for display.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const match = error.message.match(/^\d{3}:\s*([\s\S]*)$/);
  const body = match ? match[1] : error.message;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // body was not JSON — fall through to the raw text
  }
  return body.trim() || fallback;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery<MeResponse>({
    queryKey: [...ME_QUERY_KEY],
    queryFn: getQueryFn<MeResponse>({ on401: "returnNull" }),
  });

  const seedSession = useCallback(
    (user: AuthUser) => {
      queryClient.setQueryData<MeResponse>([...ME_QUERY_KEY], { user });
      queryClient.invalidateQueries({ queryKey: [...ME_QUERY_KEY] });
    },
    [queryClient],
  );

  const loginMutation = useMutation({
    mutationFn: async (input: LoginInput): Promise<AuthUser> => {
      const res = await apiRequest("POST", "/api/auth/login", input);
      const data = (await res.json()) as { user: AuthUser };
      return data.user;
    },
    onSuccess: seedSession,
  });

  const signupMutation = useMutation({
    mutationFn: async (input: SignupInput): Promise<AuthUser> => {
      const res = await apiRequest("POST", "/api/auth/signup", input);
      const data = (await res.json()) as { user: AuthUser };
      return data.user;
    },
    onSuccess: seedSession,
  });

  const logoutMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData<MeResponse>([...ME_QUERY_KEY], null);
      // Drop every cached dataset (inventory, clients, transactions, ...)
      // so nothing from the previous session lingers on a shared machine.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0],
      });
    },
  });

  const login = useCallback(
    (input: LoginInput) => loginMutation.mutateAsync(input),
    [loginMutation],
  );
  const signup = useCallback(
    (input: SignupInput) => signupMutation.mutateAsync(input),
    [signupMutation],
  );
  const logout = useCallback(
    () => logoutMutation.mutateAsync(),
    [logoutMutation],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      isLoading: meQuery.isPending,
      login,
      signup,
      logout,
    }),
    [meQuery.data, meQuery.isPending, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export function homePathForRole(role: AuthRole): string {
  return role === "student" ? "/portal" : "/";
}

interface RequireAuthProps {
  roles: AuthRole[];
  children: React.ReactNode;
}

/**
 * Route guard: spinner while the session loads, redirect anonymous visitors
 * to /login, and bounce signed-in users to their home when the role does
 * not match (students -> /portal, staff -> /).
 */
export function RequireAuth({ roles, children }: RequireAuthProps) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  const allowed = user !== null && roles.includes(user.role);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (!allowed) {
      navigate(homePathForRole(user.role), { replace: true });
    }
  }, [isLoading, user, allowed, navigate]);

  if (isLoading) {
    return (
      <div
        className="app-shell flex min-h-screen items-center justify-center"
        data-testid="auth-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
