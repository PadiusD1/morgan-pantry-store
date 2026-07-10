import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, homePathForRole, useAuth } from "@/lib/auth";
import { Loader2, LogInIcon } from "lucide-react";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      navigate(homePathForRole(user.role), { replace: true });
    }
  }, [isLoading, user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !email.trim() || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login({ email: email.trim(), password });
      navigate(homePathForRole(signedIn.role), { replace: true });
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Unable to sign in. Please try again."));
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-500">
        <Card className="glass-panel">
          <CardHeader className="text-center space-y-3">
            <div className="flex items-center justify-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-semibold tracking-tight shadow-md"
                data-testid="img-login-logo"
              >
                FRC
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold tracking-tight leading-tight">
                  Morgan State University
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Food Resource Center
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg" data-testid="text-login-title">
                Sign in
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Access the pantry workspace or your student portal.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-in fade-in duration-200"
                  data-testid="text-login-error"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="login-email">
                  Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@morgan.edu"
                  required
                  data-testid="input-login-email"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="login-password">
                  Password
                </label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  data-testid="input-login-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !email.trim() || !password}
                data-testid="button-login-submit"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <LogInIcon className="h-4 w-4 mr-2" />
                )}
                Sign in
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Morgan student?{" "}
              <Link
                href="/signup"
                className="font-medium text-primary underline-offset-4 hover:underline"
                data-testid="link-login-signup"
              >
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
