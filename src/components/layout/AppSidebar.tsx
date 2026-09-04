import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, PhoneCall, CalendarClock, Activity,
  BarChart3, Settings, UserCircle2, FolderPlus, ListChecks,
  Building2, IdCard, FolderKanban, ArrowLeftRight, Flame, Plus, UserPlus,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { useCrmSession } from "@/hooks/use-crm-session";
import { Button } from "@/components/ui/button";
import { CreateInterestedCandidateDialog } from "@/components/crm/CreateInterestedCandidateDialog";
import { CreateLeadDialog } from "@/components/crm/CreateLeadDialog";
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
      { to: "/interested", title: "Interested Leads", icon: Flame },
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
      { to: "/interested", title: "Interested Leads", icon: Flame },
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
  const [createInterestedOpen, setCreateInterestedOpen] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);

  return (
    <>
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
                    const isMyLeadsOrInterested = item.to === "/my-leads" || item.to === "/interested";
                    return (
                      <div key={item.to} className="flex flex-col gap-0.5">
                        <SidebarMenuItem className="relative group/item">
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
                              <span className={cn("font-medium flex-1", active && "font-semibold")}>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>

                          {/* Quick side button on My Leads / Interested Leads */}
                          {isMyLeadsOrInterested && !collapsed && (
                            <button
                              type="button"
                              title="Add Interested Candidate"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCreateInterestedOpen(true);
                                closeMobile();
                              }}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-semibold text-amber-500 hover:bg-amber-500/25 bg-amber-500/10 border border-amber-500/30 transition-all shadow-xs"
                            >
                              <Plus className="h-3 w-3 stroke-[2.5]" />
                              <span className="hidden group-hover/item:inline text-[10px]">Add</span>
                            </button>
                          )}
                        </SidebarMenuItem>

                        {/* Dedicated Action Buttons directly below "My Leads" */}
                        {item.to === "/my-leads" && !collapsed && (
                          <div className="px-2 pt-1 pb-1 flex flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setCreateLeadOpen(true);
                                closeMobile();
                              }}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/20 border border-brand/25 transition-all shadow-xs group"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <UserPlus className="h-3.5 w-3.5 text-brand shrink-0 group-hover:scale-110 transition-transform" />
                                <span className="truncate">+ Add New Lead</span>
                              </div>
                              <Plus className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCreateInterestedOpen(true);
                                closeMobile();
                              }}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all shadow-xs group"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <Flame className="h-3.5 w-3.5 fill-amber-500 shrink-0 group-hover:scale-110 transition-transform" />
                                <span className="truncate">+ Add Interested Candidate</span>
                              </div>
                              <Plus className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
                            </button>
                          </div>
                        )}
                      </div>
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

      <CreateInterestedCandidateDialog
        open={createInterestedOpen}
        onOpenChange={setCreateInterestedOpen}
        companyId={session?.companyId ?? null}
        employeeId={session?.userId ?? null}
      />

      <CreateLeadDialog
        open={createLeadOpen}
        onOpenChange={setCreateLeadOpen}
        companyId={session?.companyId ?? null}
        employeeId={session?.userId ?? null}
        isAgentMode={!session?.isAdmin}
      />
    </>
  );
}

