import React from "react";
import { Link, useLocation } from "wouter";
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSeparator, SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { RefreshNotice } from "@/lib/repository";
import { BoxesIcon, ClipboardListIcon, ExternalLinkIcon, FileTextIcon, Handshake, HeartHandshakeIcon, HistoryIcon, HomeIcon, InboxIcon, LayersIcon, LogOutIcon, MonitorIcon, PackageIcon, SettingsIcon, ShoppingCartIcon, UsersIcon } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: HomeIcon, testId: "nav-dashboard" },
  { href: "/inventory", label: "Inventory", icon: BoxesIcon, testId: "nav-inventory" },
  { href: "/check-in", label: "Check-In", icon: ClipboardListIcon, testId: "nav-check-in" },
  { href: "/check-out", label: "Check-Out", icon: ShoppingCartIcon, testId: "nav-check-out" },
  { href: "/clients", label: "Clients", icon: UsersIcon, testId: "nav-clients" },
  { href: "/partners", label: "Partners", icon: Handshake, testId: "nav-partners" },
  { href: "/donors", label: "Donors", icon: HeartHandshakeIcon, testId: "nav-donors" },
  { href: "/item-groups", label: "Item Groups", icon: LayersIcon, testId: "nav-item-groups" },
  { href: "/requests", label: "Requests", icon: InboxIcon, testId: "nav-requests" },
  { href: "/reports", label: "Reports", icon: FileTextIcon, testId: "nav-reports" },
  { href: "/activity", label: "Activity / History", icon: HistoryIcon, testId: "nav-activity" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, testId: "nav-settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const visibleNavItems = navItems.filter(
    (item) => item.href !== "/settings" || user?.role === "admin",
  );

  return (
    <SidebarProvider className="app-shell">
      <Sidebar collapsible="icon" variant="inset" className="border-r border-sidebar-border/80">
        <SidebarHeader className="pt-3 pb-1 px-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-foreground/5 text-sidebar-foreground shadow-sm text-xs font-semibold tracking-tight"
              data-testid="img-logo-placeholder"
            >
              FRC
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold tracking-tight leading-tight" data-testid="text-app-title">
                Morgan State Repository
              </span>
              <span className="text-[11px] text-sidebar-foreground/70" data-testid="text-app-tagline">
                Food Resource Center
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <SidebarTrigger data-testid="button-toggle-sidebar" />
            </div>
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="uppercase tracking-[0.16em] text-[10px] text-sidebar-foreground/60">
              Modules
            </SidebarGroupLabel>
            <SidebarMenu>
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = location === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      data-testid={item.testId}
                    >
                      <Link href={item.href} data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                        <Icon className="shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <div className="mt-auto p-3 pt-1 space-y-2 group-data-[collapsible=icon]:hidden">
            <div className="grid grid-cols-1 gap-2">
              <Button asChild variant="default" size="sm" className="w-full min-w-0 text-xs">
                <a href="/portal" target="_blank" rel="noopener">
                  <ExternalLinkIcon className="h-3 w-3 mr-1" />
                  Student Portal
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full min-w-0 text-xs">
                <a href="/kiosk" target="_blank" rel="noopener">
                  <MonitorIcon className="h-3 w-3 mr-1" />
                  Kiosk Mode
                </a>
              </Button>
            </div>
            <Card className="glass-panel border-dashed border-sidebar-border/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate" data-testid="text-session-user-name">
                    {user?.name ?? "Signed in"}
                  </p>
                  <p className="text-[11px] text-muted-foreground capitalize" data-testid="text-session-user-role">
                    <span className={user?.role === "admin" ? "badge-orange" : "badge-blue"}>
                      {user?.role ?? ""}
                    </span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={() => logout()}
                  data-testid="button-logout"
                >
                  <LogOutIcon className="h-3.5 w-3.5 mr-1" />
                  Sign out
                </Button>
              </div>
            </Card>
          </div>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="relative overflow-hidden">
        {/* Mobile top bar — the ONLY way to reach navigation on phones,
            since the sidebar is an off-canvas sheet below md. */}
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur md:hidden">
          <SidebarTrigger
            className="h-9 w-9"
            aria-label="Open navigation menu"
            data-testid="button-mobile-menu"
          />
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-[10px] font-semibold">
              FRC
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">
              {pageTitleForPath(location)}
            </span>
          </div>
        </div>
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 px-4 pb-8 pt-4 md:px-6">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1
                className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
                data-testid="text-page-title"
              >
                {pageTitleForPath(location)}
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
                {pageSubtitleForPath(location)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="hidden md:inline-flex border-dashed"
                data-testid="button-export-data-shortcut"
              >
                <Link href="/reports" data-testid="link-export-data-shortcut">
                  <span className="mr-1">Go to reports &amp; export</span>
                  <span className="kbd">Ctrl + E</span>
                </Link>
              </Button>
            </div>
          </header>
          <RefreshNotice />
          <main className="flex-1 min-h-0">
            {children}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function pageTitleForPath(path: string) {
  if (path.startsWith("/inventory")) return "Inventory";
  if (path.startsWith("/check-in")) return "Check-In (Receiving)";
  if (path.startsWith("/check-out")) return "Check-Out (Distribution)";
  if (path.startsWith("/clients")) return "Clients";
  if (path.startsWith("/partners")) return "Partners Hub";
  if (path.startsWith("/donors")) return "Donors";
  if (path.startsWith("/item-groups")) return "Item Groups";
  if (path.startsWith("/requests")) return "Requests";
  if (path.startsWith("/reports")) return "Reports";
  if (path.startsWith("/activity")) return "Activity & History";
  if (path.startsWith("/settings")) return "Settings";
  return "Dashboard";
}

function pageSubtitleForPath(path: string) {
  if (path.startsWith("/inventory")) return "Manage product catalog, quantities, categories, and barcodes.";
  if (path.startsWith("/check-in")) return "Receive new product into inventory and log sources.";
  if (path.startsWith("/check-out")) return "Build distribution carts, track visits, and decrement stock.";
  if (path.startsWith("/clients")) return "Maintain client records and visit history with gentle frequency checks.";
  if (path.startsWith("/partners")) return "Manage partner organizations that receive bulk distributions from the pantry.";
  if (path.startsWith("/donors")) return "Track donor profiles, donation history, and generate donor reports.";
  if (path.startsWith("/item-groups")) return "Create pre-built distribution bundles for quick check-out.";
  if (path.startsWith("/requests")) return "Review and manage item requests from students and visitors.";
  if (path.startsWith("/reports")) return "Generate inventory and distribution summaries for any date range.";
  if (path.startsWith("/activity")) return "Browse and filter the full transaction log across IN and OUT moves.";
  if (path.startsWith("/settings")) return "Configure organization details, visit policies, and system preferences.";
  return "At-a-glance overview of pantry stock, clients, and activity.";
}
