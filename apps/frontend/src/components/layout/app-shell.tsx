"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Building2,
  Zap,
  Bell,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Sun,
  Moon,
  Building,
  Menu,
  X,
  Mail,
  Radio,
} from "lucide-react";

import { APP_ROUTES } from "@/constants";
import { orchestratorHref } from "@/features/ai/pipeline/deep-agent/orchestrator-space-params";
import { LogoutButton } from "@/components/common";
import { useAuthStore, useUiStore } from "@/store";
import { cn } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/services/api";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import { useOrganizationStore } from "@/store/organizationStore";
import { parseOrganization } from "@/features/organizations/plenum-api";

type NavItem = { label: string; href?: string; icon: React.ElementType };
type BreadcrumbItem = { href: string; label: string; isCurrent: boolean };

const NAV_ITEMS: NavItem[] = [
  {
    label: "Orchestrator",
    href: APP_ROUTES.ai,
    icon: Radio,
  },
  {
    label: "Work Orders",
    href: orchestratorHref("work_orders"),
    icon: ClipboardList,
  },
  {
    label: "Email Inbox",
    href: APP_ROUTES.workOrderEmailInbox,
    icon: Mail,
  },
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgSelected = useOrganizationStore((s) => s.selected);
  const setOrgSelected = useOrganizationStore((s) => s.setSelected);
  const orgLabel = orgSelected?.name ?? "Select Organization";
  const orgMenuRef = useRef<HTMLDivElement | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (orgMenuOpen) {
        const el = orgMenuRef.current;
        if (el && e.target instanceof Node && !el.contains(e.target)) {
          setOrgMenuOpen(false);
        }
      }
      if (userMenuOpen) {
        const el = userMenuRef.current;
        if (el && e.target instanceof Node && !el.contains(e.target)) {
          setUserMenuOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [orgMenuOpen, userMenuOpen]);

  const initials = useMemo(() => {
    const email = user?.email ?? "";
    const parts =
      email
        .split("@")[0]
        ?.split(/[._-]+/)
        .filter(Boolean) ?? [];
    const first = (parts[0] ?? "").trim();
    const second = (parts[1] ?? "").trim();
    const a = (first[0] ?? email[0] ?? "U").toUpperCase();
    const b = (second[0] ?? first[1] ?? "D").toUpperCase();
    return `${a}${b}`.slice(0, 2);
  }, [user?.email]);

  const activeHref = useMemo(() => {
    if (!pathname) return "";
    if (pathname.startsWith("/work-orders")) {
      if (pathname === APP_ROUTES.workOrderEmailInbox) {
        return APP_ROUTES.workOrderEmailInbox;
      }
      return orchestratorHref("work_orders");
    }
    if (pathname === APP_ROUTES.ai || pathname.startsWith(`${APP_ROUTES.ai}?`) || pathname.startsWith(`${APP_ROUTES.ai}/`)) {
      return APP_ROUTES.ai;
    }
    const match = NAV_ITEMS.find(
      (item) => item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
    );
    return match?.href ?? "";
  }, [pathname]);

  const showAiFab = useMemo(() => {
    if (!pathname) return true;
    return !(pathname === APP_ROUTES.ai || pathname.startsWith(`${APP_ROUTES.ai}/`));
  }, [pathname]);

  const isAiLayout = useMemo(() => {
    if (!pathname) return false;
    return pathname === APP_ROUTES.ai || pathname.startsWith(`${APP_ROUTES.ai}/`);
  }, [pathname]);

  const routeLabelByHref = useMemo(() => {
    const map = new Map<string, string>();
    map.set(APP_ROUTES.home, "Home");
    for (const item of NAV_ITEMS) {
      if (item.href) map.set(item.href, item.label);
    }
    return map;
  }, []);

  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    if (!pathname || pathname === "/") {
      return [{ href: APP_ROUTES.home, label: "Home", isCurrent: true }];
    }

    const segments = pathname.split("/").filter(Boolean);
    const crumbs: BreadcrumbItem[] = [];

    segments.forEach((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join("/")}`;
      const routeLabel = routeLabelByHref.get(href);
      const fallbackLabel = segment
        .replace(/-/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());

      crumbs.push({
        href,
        label: routeLabel ?? fallbackLabel,
        isCurrent: index === segments.length - 1,
      });
    });

    return [{ href: APP_ROUTES.home, label: "Home", isCurrent: crumbs.length === 0 }, ...crumbs];
  }, [pathname, routeLabelByHref]);

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground font-sans antialiased">
      <div className="flex h-full">
        {/* Mobile Sidebar */}
        {mobileSidebarOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              aria-label="Close sidebar"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative h-full w-64 border-r bg-card shadow-2xl animate-in slide-in-from-left duration-300">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <Link
                  href={APP_ROUTES.home}
                  className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary"
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <Building className="h-6 w-6" />
                  <span>CAFM Pro</span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="p-4 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const active = item.href ? item.href === activeHref : false;
                  const Icon = item.icon;

                  if (!item.href) {
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/60 cursor-not-allowed"
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileSidebarOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </aside>
          </div>
        ) : null}

        {/* Desktop Sidebar */}
        {!isAiLayout ? (
          <aside
            className={cn(
              "hidden md:flex flex-col border-r bg-card transition-all duration-300",
              sidebarCollapsed ? "w-20" : "w-64",
            )}
          >
            <div className={cn("p-6 border-b", sidebarCollapsed ? "px-0 flex justify-center" : "")}>
              <Link
                href={APP_ROUTES.home}
                className={cn(
                  "flex items-center gap-2 text-xl font-bold tracking-tight text-primary",
                  sidebarCollapsed ? "justify-center" : "",
                )}
              >
                <Building className="h-6 w-6" />
                {!sidebarCollapsed && <span>CAFM Pro</span>}
              </Link>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const active = item.href ? item.href === activeHref : false;
                const Icon = item.icon;

                if (!item.href) {
                  return (
                    <div
                      key={item.label}
                      className={cn(
                        "flex items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40 cursor-not-allowed",
                        sidebarCollapsed ? "justify-center" : "gap-3",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      sidebarCollapsed ? "justify-center" : "gap-3",
                      active
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    title={sidebarCollapsed ? item.label : ""}
                  >
                    <Icon className="h-4 w-4" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t">
              <Button
                variant="ghost"
                size="sm"
                className={cn("w-full justify-start gap-3", sidebarCollapsed && "justify-center")}
                onClick={toggleSidebarCollapsed}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4" />
                    <span>Collapse</span>
                  </>
                )}
              </Button>
            </div>
          </aside>
        ) : null}

        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-6 border-b bg-background/80 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="relative w-full max-w-[480px] hidden sm:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-muted/50 border-none focus-visible:ring-1"
                  placeholder="Search assets, work orders..."
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative hidden lg:block" ref={orgMenuRef}>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex gap-2"
                  aria-haspopup="menu"
                  aria-expanded={orgMenuOpen}
                  onClick={() => {
                    setOrgMenuOpen((v) => !v);
                    setUserMenuOpen(false);
                  }}
                >
                  <Building2 className="h-4 w-4" />
                  <span className="max-w-[160px] truncate">{orgLabel}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>

                <InfiniteSelect
                  open={orgMenuOpen}
                  onClose={() => setOrgMenuOpen(false)}
                  valueLabel={orgLabel}
                  placeholder="Search organizations..."
                  pageSize={10}
                  fetchPage={async ({ limit, offset, signal }) => {
                    const params = new URLSearchParams();
                    params.set("limit", String(limit));
                    params.set("offset", String(offset));
                    try {
                      const payload = await apiFetch<unknown>(
                        `/api/v1/plenum/organizations?${params.toString()}`,
                        { signal },
                      );
                      if (typeof payload !== "object" || payload === null) {
                        console.error("[OrganizationPicker] non-object response", payload);
                        throw new Error("Invalid organizations response from server.");
                      }
                      const obj = payload as Record<string, unknown>;
                      const total = typeof obj.total === "number" ? obj.total : 0;
                      const raw = Array.isArray(obj.data) ? obj.data : [];
                      const data: InfiniteSelectItem[] = raw
                        .map((x): InfiniteSelectItem | null => {
                          const org = parseOrganization(x);
                          return org ? { id: org.id, label: org.name } : null;
                        })
                        .filter((v): v is InfiniteSelectItem => Boolean(v));
                      if (total > 0 && raw.length > 0 && data.length === 0) {
                        console.warn("[OrganizationPicker] rows dropped by parser", {
                          total,
                          sample: raw[0],
                        });
                      }
                      return { total, data };
                    } catch (err) {
                      console.error("[OrganizationPicker] fetch failed", err);
                      throw err;
                    }
                  }}
                  onSelect={(item) => {
                    setOrgSelected({ id: item.id, name: item.label });
                    setOrgMenuOpen(false);
                  }}
                  className="w-72"
                />
              </div>

              <Button
                size="sm"
                className="gap-2"
                type="button"
                onClick={() => {
                  router.push(`${APP_ROUTES.organizations}/new`);
                  setOrgMenuOpen(false);
                  setUserMenuOpen(false);
                }}
              >
                <Plus className="h-4 w-4" />
                <span>Create</span>
              </Button>

              <div className="h-8 w-[1px] bg-border mx-1 hidden sm:block" />

              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute top-2 right-2 h-2 w-2 bg-red-500 rounded-full border-2 border-background" />
              </Button>

              <Button variant="ghost" size="icon" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>

              <div className="relative ml-2" ref={userMenuRef}>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 p-1 hover:bg-muted rounded-full"
                  onClick={() => {
                    setUserMenuOpen(!userMenuOpen);
                    setOrgMenuOpen(false);
                  }}
                >
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground ring-2 ring-primary/20">
                    {initials}
                  </div>
                </Button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border bg-card shadow-lg ring-1 ring-black/5 p-1 animate-in fade-in zoom-in-95 duration-200">
                    <div className="px-3 py-2 mb-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Signed in as
                      </p>
                      <p className="text-sm font-semibold truncate">{user?.email}</p>
                    </div>
                    <div className="h-px bg-border my-1" />
                    <LogoutButton className="w-full justify-start h-9 px-3 text-red-500 hover:text-red-600 hover:bg-red-50/50 dark:hover:bg-red-950/20" />
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className={cn("border-b bg-background/50 px-6 py-2", isAiLayout && "hidden")}>
            <nav className="flex items-center gap-1.5 overflow-x-auto text-xs whitespace-nowrap">
              {breadcrumbItems.map((crumb, index) => (
                <div key={crumb.href} className="flex items-center gap-1.5">
                  {index > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground/70" /> : null}
                  {crumb.isCurrent ? (
                    <span className="font-semibold text-foreground">{crumb.label}</span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </div>
              ))}
            </nav>
          </div>

          <main className="flex-1 min-h-0 overflow-y-auto bg-muted/20">
            <div
              className={cn(
                isAiLayout ? "p-0 h-full" : "container mx-auto p-6 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500",
              )}
            >
              {children}
            </div>
          </main>

          {showAiFab ? (
            <Button
              asChild
              className="fixed bottom-6 right-6 z-[60] h-12 w-12 rounded-full p-0 shadow-lg shadow-primary/10 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] animate-in fade-in zoom-in-95"
            >
              <Link href={APP_ROUTES.ai} prefetch={false} aria-label="Open Orchestrator">
                <span className="relative h-12 w-12 rounded-full flex items-center justify-center">
                  <span className="absolute -inset-3 rounded-full bg-primary/20 blur-2xl opacity-70 animate-pulse" />
                  <Zap className="relative h-5 w-5" />
                </span>
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
