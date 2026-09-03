import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  BarChart3, Building2, CalendarClock, FolderKanban, IdCard, LayoutDashboard, ListTodo, Loader2,
  PhoneCall, Settings, UserCircle2, Users, Activity, FolderPlus, ListChecks,
} from "lucide-react";
import { useCrmSession } from "@/hooks/use-crm-session";
import { EMPTY_RESULTS, globalSearch, type SearchHit } from "@/lib/global-search";

const adminRoutes = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/monitoring", label: "Live Monitoring", icon: Activity },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/daily-leads", label: "Daily Leads", icon: FolderPlus },
  { to: "/leads", label: "All Leads", icon: PhoneCall },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/attendance", label: "Attendance", icon: CalendarClock },
  { to: "/folders", label: "Folders", icon: FolderKanban },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/employees", label: "Employees", icon: IdCard },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
] as const;

const agentRoutes = [
  { to: "/my-leads", label: "My Leads", icon: ListChecks },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { to: "/attendance", label: "Attendance", icon: CalendarClock },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
] as const;

const kindIcon = {
  lead: PhoneCall,
  employee: IdCard,
  folder: FolderKanban,
  company: Building2,
} as const;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { data: session } = useCrmSession();
  const isAdmin = session?.isAdmin ?? false;
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(term.trim()), 220);
    return () => window.clearTimeout(id);
  }, [term]);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebounced("");
    }
  }, [open]);

  const enabled = debounced.length >= 2;
  const { data: results = EMPTY_RESULTS, isFetching } = useQuery({
    queryKey: ["global-search", debounced, isAdmin, session?.companyId],
    enabled,
    staleTime: 15_000,
    queryFn: () => globalSearch(debounced, { isAdmin, companyId: session?.companyId ?? null }),
  });

  const go = (hit: SearchHit) => {
    onOpenChange(false);
    navigate({ to: hit.href, ...(hit.search ? { search: hit.search } : {}) } as never);
  };

  const routes = isAdmin ? adminRoutes : agentRoutes;
  const filteredRoutes = routes.filter((r) => !term || r.label.toLowerCase().includes(term.toLowerCase()));
  const total = results.leads.length + results.employees.length + results.folders.length + results.companies.length;

  const group = (heading: string, hits: SearchHit[]) =>
    hits.length > 0 && (
      <CommandGroup heading={heading}>
        {hits.map((h) => {
          const Icon = kindIcon[h.kind];
          return (
            <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}-${h.title}`} onSelect={() => go(h)}>
              <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{h.title}</span>
              <span className="ml-2 truncate text-xs text-muted-foreground">{h.subtitle}</span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false} label="Global search">
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder={isAdmin ? "Search leads, employees, folders, companies…" : "Search your leads…"}
      />
      <CommandList>
        {enabled && isFetching && total === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : (
          <CommandEmpty>No results found</CommandEmpty>
        )}

        {group("Leads", results.leads)}
        {group("Employees", results.employees)}
        {group("Folders", results.folders)}
        {group("Companies", results.companies)}

        {filteredRoutes.length > 0 && (
          <>
            {total > 0 && <CommandSeparator />}
            <CommandGroup heading="Navigate">
              {filteredRoutes.map((r) => (
                <CommandItem key={r.to} value={`nav-${r.label}`} onSelect={() => { onOpenChange(false); navigate({ to: r.to }); }}>
                  <r.icon className="mr-2 h-4 w-4" />
                  {r.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
