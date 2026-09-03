import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, PhoneCall, CalendarClock, Activity,
  BarChart3, Settings, UserCircle2, FolderPlus, ListChecks,
  Building2, IdCard, FolderKanban, ArrowLeftRight,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { useCrmSession } from "@/hooks/use-crm-session";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { to: string; title: string; icon: typeof Users };
type NavGroup = { label: string; items: NavItem[] };

const adminGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", title: "Dashboard", icon: LayoutDashboard },
      { to: "/monitoring", title: "Live Monitoring", icon: Activity },
      { to: "/analytics", title: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/daily-leads", title: "Daily Leads", icon: FolderPlus },
      { to: "/leads", title: "All Leads", icon: PhoneCall },
      { to: "/follow-ups", title: "Follow-ups", icon: CalendarClock },
      { to: "/agents", title: "Agents", icon: Users },
      { to: "/attendance", title: "Attendance", icon: CalendarClock },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/folders", title: "Folders", icon: FolderKanban },
      { to: "/companies", title: "Companies", icon: Building2 },
      { to: "/employees", title: "Employees", icon: IdCard },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/tasks", title: "Tasks", icon: ArrowLeftRight },
      { to: "/settings", title: "Settings", icon: Settings },
      { to: "/profile", title: "Profile", icon: UserCircle2 },
    ],
  },
];

const agentGroups: NavGroup[] = [
  {
    label: "My Work",
    items: [
      { to: "/my-leads", title: "My Leads", icon: ListChecks },
      { to: "/follow-ups", title: "Follow-ups", icon: CalendarClock },
      { to: "/attendance", title: "Attendance", icon: CalendarClock },
    ],
  },
  {
    label: "Account",
    items: [{ to: "/profile", title: "Profile", icon: UserCircle2 }],
  },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const { data: session, isLoading: sessionLoading } = useCrmSession();
  const groups = sessionLoading ? [] : session?.isAdmin ? adminGroups : agentGroups;
  const closeMobile = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b">
        <div className={cn("flex h-12 items-center", collapsed ? "justify-center px-1" : "px-2")}>
          <Logo showText={!collapsed} />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="py-1.5">
            <SidebarGroupLabel className="h-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.items.map((item) => {
                  const active = isActive(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={cn(
                          "relative h-9 rounded-lg text-[13.5px] text-muted-foreground transition-colors",
                          "hover:bg-sidebar-accent hover:text-foreground",
                          active &&
                            "bg-brand/12 text-foreground hover:bg-brand/16 hover:text-foreground",
                        )}
                      >
                        <Link to={item.to} onClick={closeMobile}>
                          {active && !collapsed && (
                            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />
                          )}
                          <item.icon className={cn("h-[18px] w-[18px]", active && "text-brand")} />
                          <span className={cn("font-medium", active && "font-semibold")}>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 rounded-xl border bg-elevated p-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg gradient-brand text-[11px] font-bold text-white">
              {(session?.fullName || session?.email || "?").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{session?.fullName || session?.email || "—"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{session?.isAdmin ? "Admin" : "Agent"}</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_0_3px_oklch(0.72_0.19_150_/_0.2)]" />
          </div>
        ) : (
          <div className="grid place-items-center py-1">
            <span className="grid h-8 w-8 place-items-center rounded-lg gradient-brand text-[11px] font-bold text-white">
              {(session?.fullName || session?.email || "?").slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
