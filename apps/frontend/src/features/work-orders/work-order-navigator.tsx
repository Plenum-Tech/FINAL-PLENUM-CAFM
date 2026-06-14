"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Bot, Mail, Activity } from "lucide-react";
import type { ComponentType } from "react";

import { APP_ROUTES } from "@/constants";
import { orchestratorHref } from "@/features/ai/pipeline/deep-agent/orchestrator-space-params";
import { cn } from "@/utils/cn";

type NavigatorItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavigatorItem[] = [
  {
    href: APP_ROUTES.workOrdersList,
    label: "All Work Orders",
    icon: ClipboardList,
    isActive: (pathname) =>
      pathname === APP_ROUTES.workOrdersList ||
      /^\/work-orders\/[^/]+(\/edit)?$/.test(pathname),
  },
  {
    href: orchestratorHref("work_orders"),
    label: "Create in Orchestrator",
    icon: Bot,
    isActive: (pathname) => pathname === APP_ROUTES.ai || pathname.startsWith(`${APP_ROUTES.ai}/`),
  },
  {
    href: APP_ROUTES.workOrderEmailInbox,
    label: "Email Inbox",
    icon: Mail,
    isActive: (pathname) => pathname === APP_ROUTES.workOrderEmailInbox,
  },
  {
    href: APP_ROUTES.workOrderCommandCenter,
    label: "Command Center",
    icon: Activity,
    isActive: (pathname) =>
      pathname === APP_ROUTES.workOrderCommandCenter || pathname === APP_ROUTES.workOrders,
  },
];

export function WorkOrderNavigator() {
  const pathname = usePathname() ?? "";

  return (
    <div className="sticky top-2 z-20 rounded-2xl border border-slate-200/80 bg-white/85 p-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-slate-800 dark:bg-slate-950/70">
      <nav className="flex items-center gap-1.5 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all duration-200",
                active
                  ? "bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-[0_8px_20px_-10px_rgba(37,99,235,0.8)]"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  active ? "text-white" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              {item.label}
              <span
                className={cn(
                  "absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full transition-opacity duration-200",
                  active ? "bg-white/80 opacity-100" : "bg-primary/40 opacity-0 group-hover:opacity-70",
                )}
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
