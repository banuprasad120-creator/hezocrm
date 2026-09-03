import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity, CalendarClock, FolderPlus, ListChecks, Menu,
  PhoneCall, UserCircle2, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmSession } from "@/hooks/use-crm-session";
import { useSidebar } from "@/components/ui/sidebar";

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session, isLoading } = useCrmSession();
  const { setOpenMobile, openMobile } = useSidebar();

  if (isLoading || !session) return null;

  const isActive = (to: string) => {
    if (to === "/dashboard") return pathname === "/dashboard" || pathname === "/monitoring";
    return pathname === to || pathname.startsWith(to + "/");
  };

  const adminTabs = [
    { to: "/monitoring", label: "Live", icon: Activity },
    { to: "/daily-leads", label: "Daily", icon: FolderPlus },
    { to: "/leads", label: "Leads", icon: PhoneCall },
    { to: "/attendance", label: "Clock", icon: Clock },
  ];

  const agentTabs = [
    { to: "/my-leads", label: "My Leads", icon: ListChecks },
    { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
    { to: "/attendance", label: "Attendance", icon: Clock },
    { to: "/profile", label: "Profile", icon: UserCircle2 },
  ];

  const tabs = session.isAdmin ? adminTabs : agentTabs;

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed inset-x-0 bottom-0 z-40 block border-t bg-background/90 backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2 pb-[env(safe-area-inset-bottom,0px)]">
        {tabs.map((tab) => {
          const active = isActive(tab.to);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "group relative flex flex-1 flex-col items-center justify-center py-1 text-center transition-all touch-tap",
                active ? "text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute -top-1.5 h-1 w-8 rounded-full gradient-brand shadow-[0_0_10px_var(--color-brand)]" />
              )}
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-xl transition-all",
                  active ? "bg-brand/12 scale-110" : "group-active:scale-95",
                )}
              >
                <Icon className={cn("h-4 w-4 transition-transform", active ? "stroke-[2.4px]" : "stroke-[1.8px]")} />
              </div>
              <span className={cn("mt-0.5 text-[10.5px] font-medium tracking-tight", active && "font-bold text-foreground")}>
                {tab.label}
              </span>
            </Link>
          );
        })}

        {/* Sidebar Trigger for extra admin tools / navigation */}
        <button
          type="button"
          onClick={() => setOpenMobile(!openMobile)}
          className={cn(
            "group relative flex flex-1 flex-col items-center justify-center py-1 text-center transition-all touch-tap",
            openMobile ? "text-brand" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-xl transition-all group-active:scale-95">
            <Menu className="h-4 w-4 stroke-[1.8px]" />
          </div>
          <span className="mt-0.5 text-[10.5px] font-medium tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}
