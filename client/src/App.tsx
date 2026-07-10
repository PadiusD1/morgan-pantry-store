import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RepositoryProvider } from "@/lib/repository";
import { AuthProvider, RequireAuth, STAFF_ROLES } from "@/lib/auth";

// LoginPage + SignupPage are the entry points — keep them eager so the first
// paint after landing on /login or /signup has zero extra network round-trips.
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";

// Every other page is route-level code-split. React.lazy defers each page's
// JS until its route actually renders, so the initial bundle no longer ships
// the entire staff app up front.
const NotFound = lazy(() => import("@/pages/not-found"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const CheckInPage = lazy(() => import("@/pages/check-in"));
const CheckOutPage = lazy(() => import("@/pages/check-out"));
const ClientsPage = lazy(() => import("@/pages/clients"));
const ClientDetailPage = lazy(() => import("@/pages/client-detail"));
const ItemGroupsPage = lazy(() => import("@/pages/item-groups"));
const RequestsPage = lazy(() => import("@/pages/requests"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const PublicRequestPage = lazy(() => import("@/pages/public-request"));
const KioskPage = lazy(() => import("@/pages/kiosk"));
const DonorsPage = lazy(() => import("@/pages/donors"));
const DonorDetailPage = lazy(() => import("@/pages/donor-detail"));
const PartnersPage = lazy(() => import("@/pages/partners"));
const PartnerDetailPage = lazy(() => import("@/pages/partner-detail"));

/** Lightweight centered spinner shown while a lazy route chunk loads. */
function PageFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Loader2
        className="h-8 w-8 animate-spin text-primary"
        aria-label="Loading"
      />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/inventory" component={InventoryPage} />
      <Route path="/check-in" component={CheckInPage} />
      <Route path="/check-out" component={CheckOutPage} />
      <Route path="/clients" component={ClientsPage} />
      <Route path="/clients/:id" component={ClientDetailPage} />
      <Route path="/donors/:id" component={DonorDetailPage} />
      <Route path="/donors" component={DonorsPage} />
      <Route path="/partners/:id" component={PartnerDetailPage} />
      <Route path="/partners" component={PartnersPage} />
      <Route path="/item-groups" component={ItemGroupsPage} />
      <Route path="/requests" component={RequestsPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/activity" component={ActivityPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          {/* One Suspense boundary covers every lazy route (portal, kiosk, and
              the staff Switch). LoginPage/SignupPage are eager, so they never
              trigger the fallback. */}
          <Suspense fallback={<PageFallback />}>
            <Switch>
              <Route path="/login">
                <LoginPage />
              </Route>
              <Route path="/signup">
                <SignupPage />
              </Route>
              <Route path="/portal">
                {/* Students request food here; staff may preview it too. */}
                <RequireAuth roles={["student", ...STAFF_ROLES]}>
                  <PublicRequestPage />
                </RequireAuth>
              </Route>
              <Route path="/kiosk">
                {/* Walk-up kiosk is a staff-supervised device. */}
                <RequireAuth roles={STAFF_ROLES}>
                  <KioskPage />
                </RequireAuth>
              </Route>
              <Route>
                <RequireAuth roles={STAFF_ROLES}>
                  {/* RepositoryProvider stays inside the staff branch: it loads
                      the full client/transaction datasets, which are staff-only. */}
                  <RepositoryProvider>
                    <AppShell>
                      {/* Route-scoped ErrorBoundary: a crash in one staff page
                          shows the recovery screen inside the shell, so the nav
                          stays usable instead of blanking the whole app. */}
                      <ErrorBoundary>
                        <Router />
                      </ErrorBoundary>
                    </AppShell>
                  </RepositoryProvider>
                </RequireAuth>
              </Route>
            </Switch>
          </Suspense>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
