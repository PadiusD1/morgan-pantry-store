import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, homePathForRole, useAuth } from "@/lib/auth";
import { GraduationCapIcon, Loader2 } from "lucide-react";

const MORGAN_EMAIL_RE = /^[A-Za-z0-9._%+-]+@morgan\.edu$/i;

export default function SignupPage() {
  const { user, isLoading, signup } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    studentId: "",
    phone: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      navigate(homePathForRole(user.role), { replace: true });
    }
  }, [isLoading, user, navigate]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (form.name.trim().length < 2) return "Enter your full name.";
    if (!MORGAN_EMAIL_RE.test(form.email.trim())) {
      return "A @morgan.edu email address is required.";
    }
    if (!/^[A-Za-z0-9-]{3,30}$/.test(form.studentId.trim())) {
      return "Enter your Morgan student ID (letters, numbers, dashes).";
    }
    if (form.password.length < 8) return "Password must be at least 8 characters.";
    if (form.password !== form.confirm) return "Passwords do not match.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await signup({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        studentId: form.studentId.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      });
      navigate(homePathForRole(created.role), { replace: true });
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Unable to create your account. Please try again."));
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-500">
        <Card className="glass-panel">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(22_92%_60%)]/10">
              <GraduationCapIcon className="h-6 w-6 text-[hsl(22_92%_60%)]" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg" data-testid="text-signup-title">
                Student account
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Request food from the Morgan State Food Resource Center. Requires
                your @morgan.edu email.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-in fade-in duration-200"
                  data-testid="text-signup-error"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="signup-name">
                  Full name
                </label>
                <Input
                  id="signup-name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Jordan Bear"
                  required
                  data-testid="input-signup-name"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="signup-email">
                  Morgan email
                </label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@morgan.edu"
                  required
                  data-testid="input-signup-email"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="signup-student-id">
                    Student ID
                  </label>
                  <Input
                    id="signup-student-id"
                    value={form.studentId}
                    onChange={(e) => set("studentId", e.target.value)}
                    placeholder="e.g. 01234567"
                    required
                    data-testid="input-signup-student-id"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="signup-phone">
                    Phone <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="signup-phone"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="410-555-0100"
                    data-testid="input-signup-phone"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="signup-password">
                  Password
                </label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  data-testid="input-signup-password"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="signup-confirm">
                  Confirm password
                </label>
                <Input
                  id="signup-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => set("confirm", e.target.value)}
                  placeholder="Repeat your password"
                  required
                  data-testid="input-signup-confirm"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
                data-testid="button-signup-submit"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create account
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 hover:underline"
                data-testid="link-signup-login"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
