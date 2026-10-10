import React, { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { RefreshNotice } from "@/lib/repository";
import { BRAND, BRAND_MARK_PATH } from "@shared/brand";
import { BoxesIcon, ClipboardListIcon, ExternalLinkIcon, FileTextIcon, Handshake, HeartHandshakeIcon, HistoryIcon, HomeIcon, InboxIcon, LayersIcon, LogOutIcon, MonitorIcon, SettingsIcon, ShoppingCartIcon, UsersIcon } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: HomeIcon, group: "Operate", testId: "nav-dashboard" },
  { href: "/inventory", label: "Inventory", icon: BoxesIcon, group: "Operate", testId: "nav-inventory" },
  { href: "/check-in", label: "Check-In", icon: ClipboardListIcon, group: "Operate", testId: "nav-check-in" },
  { href: "/check-out", label: "Check-Out", icon: ShoppingCartIcon, group: "Operate", testId: "nav-check-out" },
  { href: "/requests", label: "Requests", icon: InboxIcon, group: "Operate", testId: "nav-requests" },
  { href: "/item-groups", label: "Item Groups", icon: LayersIcon, group: "Operate", testId: "nav-item-groups" },
  { href: "/clients", label: "Clients", icon: UsersIcon, group: "Relationships", testId: "nav-clients" },
  { href: "/partners", label: "Partners", icon: Handshake, group: "Relationships", testId: "nav-partners" },
  { href: "/donors", label: "Donors", icon: HeartHandshakeIcon, group: "Relationships", testId: "nav-donors" },
  { href: "/reports", label: "Reports", icon: FileTextIcon, group: "Review", testId: "nav-reports" },
  { href: "/activity", label: "Activity / History", icon: HistoryIcon, group: "Review", testId: "nav-activity" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, group: "Review", testId: "nav-settings" },
];

function BrandSignature() {
  return <div className="sbd-signature group-data-[collapsible=icon]:hidden" data-testid="sbd-brand-signature">
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--sbd-blue)" /><g transform="translate(12,12) scale(0.15625)"><path d={BRAND_MARK_PATH} fill="var(--sbd-paper)" /></g></svg>
    <div className="group-data-[collapsible=icon]:hidden"><strong>{BRAND.name}</strong><small>Designed to work better.</small></div>
  </div>;
}

// Closing the sheet after a route change prevents a mobile navigation overlay
// from hiding the very page the user just selected.
function WorkspaceNavigation() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { setOpenMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [location, setOpenMobile]);
  return <nav aria-label="Workspace navigation">{["Operate", "Relationships", "Review"].map(group => <SidebarGroup key={group}>
    <SidebarGroupLabel className="text-[10px] uppercase tracking-widest">{group}</SidebarGroupLabel>
    <SidebarMenu>{navItems.filter(item => item.group === group && (item.href !== "/settings" || user?.role === "admin")).map(item => {
      const Icon = item.icon;
      const active = item.href === "/" ? location === "/" : location === item.href || location.startsWith(`${item.href}/`);
      return <SidebarMenuItem key={item.href}><SidebarMenuButton asChild isActive={active} tooltip={item.label} data-testid={item.testId}>
        <Link href={item.href} onClick={() => setOpenMobile(false)} aria-current={active ? "page" : undefined} data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}><Icon className="shrink-0" /><span>{item.label}</span></Link>
      </SidebarMenuButton></SidebarMenuItem>;
    })}</SidebarMenu>
  </SidebarGroup>)}</nav>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const section = navItems.find(item => item.href !== "/" && (location === item.href || location.startsWith(`${item.href}/`)))?.group || "Operate";
  return <SidebarProvider className="app-shell sbd-surface">
    <a href="#workspace-main" className="sbd-skip">Skip to workspace</a>
    <Sidebar collapsible="icon" variant="sidebar" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center justify-between gap-2"><BrandSignature /><SidebarTrigger className="shrink-0" data-testid="button-toggle-sidebar" /></div>
        <div className="sbd-client group-data-[collapsible=icon]:hidden"><strong data-testid="text-app-title">Morgan State Repository</strong><span data-testid="text-app-tagline">Food Resource Center</span></div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <WorkspaceNavigation />
        <div className="mt-auto p-3 pt-1 space-y-2 group-data-[collapsible=icon]:hidden">
          <div className="grid grid-cols-1 gap-2">
            <Button asChild variant="outline" size="sm" className="w-full min-w-0 text-xs"><a href="/portal" target="_blank" rel="noopener"><ExternalLinkIcon className="h-3 w-3 mr-1" />Student Portal</a></Button>
            <Button asChild variant="outline" size="sm" className="w-full min-w-0 text-xs"><a href="/kiosk" target="_blank" rel="noopener"><MonitorIcon className="h-3 w-3 mr-1" />Kiosk Mode</a></Button>
          </div>
          <Card className="glass-panel px-3 py-2.5"><div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><p className="text-xs font-medium text-foreground truncate" data-testid="text-session-user-name">{user?.name ?? "Signed in"}</p><p className="text-[11px] text-muted-foreground capitalize" data-testid="text-session-user-role">{user?.role ?? ""}</p></div>
            <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => logout()} data-testid="button-logout"><LogOutIcon className="h-3.5 w-3.5 mr-1" />Sign out</Button>
          </div></Card>
        </div>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="relative min-w-0">
      <div className="sbd-mobile-bar sticky top-0 z-30 flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <SidebarTrigger className="h-11 w-11" aria-label="Open navigation menu" data-testid="button-mobile-menu" />
        <div className="min-w-0"><span className="text-sm font-semibold">Food Resource Center</span><span className="block text-[10px] text-muted-foreground">A Systems by Design workspace</span></div>
      </div>
      <div className="sbd-workspace mx-auto flex w-full flex-1 flex-col gap-4">
        <header className="sbd-page-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="sbd-eyebrow">{section} / Morgan FRC</p><h1 data-testid="text-page-title">{pageTitleForPath(location)}</h1><p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">{pageSubtitleForPath(location)}</p></div>
          {location !== "/reports" && <Button asChild variant="outline" size="sm" className="self-start shrink-0" data-testid="button-export-data-shortcut"><Link href="/reports" data-testid="link-export-data-shortcut">Go to reports &amp; export</Link></Button>}
        </header>
        <RefreshNotice />
        <main id="workspace-main" tabIndex={-1} className="flex-1 min-w-0 min-h-0">{children}</main>
        <footer className="sbd-page-footer"><span>System design by <strong>{BRAND.name}</strong></span><span>{BRAND.program} / {BRAND.client}</span></footer>
      </div>
    </SidebarInset>
  </SidebarProvider>;
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
  if (path.startsWith("/inventory")) return "Know what is on hand. Keep product details and shelf counts aligned.";
  if (path.startsWith("/check-in")) return "Receive stock, connect its source, and keep a complete record.";
  if (path.startsWith("/check-out")) return "Build the cart. Confirm the visit. Record what leaves the pantry.";
  if (path.startsWith("/clients")) return "Client records and service history, in one place.";
  if (path.startsWith("/partners")) return "Manage the organizations receiving bulk distributions.";
  if (path.startsWith("/donors")) return "Connect each contribution to the people and organizations behind it.";
  if (path.startsWith("/item-groups")) return "Reusable item bundles for a more consistent checkout.";
  if (path.startsWith("/requests")) return "Move each request from review to a recorded pickup.";
  if (path.startsWith("/reports")) return "From pantry activity to a board-ready picture of service and resources.";
  if (path.startsWith("/activity")) return "Follow the recorded movement of stock into and out of the pantry.";
  if (path.startsWith("/settings")) return "Organization details, visit policies, and workspace preferences.";
  return "The operating picture: stock, service, and what needs your attention.";
}
