import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import InventoryPage from "@/pages/inventory";
import CheckInPage from "@/pages/check-in";
import CheckOutPage from "@/pages/check-out";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import ItemGroupsPage from "@/pages/item-groups";
import RequestsPage from "@/pages/requests";
import ReportsPage from "@/pages/reports";
import ActivityPage from "@/pages/activity";
import SettingsPage from "@/pages/settings";
import PublicRequestPage from "@/pages/public-request";
import KioskPage from "@/pages/kiosk";
import DonorsPage from "@/pages/donors";
import DonorDetailPage from "@/pages/donor-detail";
import PartnersPage from "@/pages/partners";
import PartnerDetailPage from "@/pages/partner-detail";
import { AppShell } from "@/components/layout/AppShell";
import { RepositoryProvider } from "@/lib/repository";

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
        <RepositoryProvider>
          <Toaster />
          <Switch>
            <Route path="/portal">
              <PublicRequestPage />
            </Route>
            <Route path="/kiosk">
              <KioskPage />
            </Route>
            <Route>
              <AppShell>
                <Router />
              </AppShell>
            </Route>
          </Switch>
        </RepositoryProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
