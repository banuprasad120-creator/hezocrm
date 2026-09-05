import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Filter,
  FolderPlus,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Upload,
  UserCheck,
  Users2,
  UserX,
  WifiOff,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { ImportLeadsWizard } from "@/components/crm/ImportLeadsWizard";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LEAD_STATUSES, LOAN_TYPES, formatDateTime, inr, todayISO, type Lead } from "@/lib/crm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/monitoring")({
  head: () => ({
    meta: [
      { title: "Live Monitoring & Agent Activity — Hezo CRM" },
      { name: "description", content: "Real-time lead status, agent live call progress, and performance calculated from live call records." },
      { property: "og:title", content: "Live Monitoring & Agent Activity — Hezo CRM" },
      { property: "og:description", content: "Track every lead, every call date, and agent progress in real time." },
    ],
  }),
  component: Monitoring,
});

const ALL = "__all__";

function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function Monitoring() {
  const { data: session, isLoading } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;

  useEffect(() => {
    if (!isLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [isLoading, session, navigate]);

  const [date, setDate] = useState(todayISO());
  const [allDates, setAllDates] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [importOpen, setImportOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // 1. Fetch distinct folders and counts
  const { data: folders = [] } = useQuery({
    queryKey: ["monitor-folders", companyId],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_folder_counts")
        .select("folder_date, lead_count").eq("company_id", companyId!)
        .order("folder_date", { ascending: false }).limit(60);
      if (error) throw error;
      return (data ?? []).map((r) => ({ date: r.folder_date as string, count: Number(r.lead_count) }));
    },
  });

  // 2. Fetch lead stats for the selected folder/date
  const { data: leadStats = [], refetch: refetchLeads } = useQuery({
    queryKey: ["monitor-lead-stats", companyId, date, allDates],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 12_000,
    queryFn: async () => {
      const out: Pick<Lead, "id" | "status" | "assigned_to" | "loan_type" | "folder_date">[] = [];
      const size = 1000;
      for (let from = 0; ; from += size) {
        let query = supabase.from("leads").select("id, status, assigned_to, loan_type, folder_date")
          .eq("company_id", companyId!);
        if (!allDates) query = query.eq("folder_date", date);
        const { data, error } = await query.order("id").range(from, from + size - 1);
        if (error) throw error;
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < size) break;
      }
      return out;
    },
  });

  // 3. Fetch recent leads matching filters
  const { data: recent = [], refetch: refetchRecent } = useQuery({
    queryKey: ["monitor-recent", companyId, date, allDates, agentFilter, statusFilter, typeFilter],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 12_000,
    queryFn: async () => {
      let query = supabase.from("leads").select("*").eq("company_id", companyId!);
      if (!allDates) query = query.eq("folder_date", date);
      if (agentFilter !== ALL) query = query.eq("assigned_to", agentFilter);
      if (statusFilter !== ALL) query = query.eq("status", statusFilter as Lead["status"]);
      if (typeFilter !== ALL) query = query.eq("loan_type", typeFilter);
      const { data, error } = await query
        .order("last_call_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Lead[];
    },
  });

  // 4. Fetch full call records for precise date-based calling calculation
  const { data: calls = [], refetch: refetchCalls } = useQuery({
    queryKey: ["monitor-calls-history", companyId],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 12_000,
    queryFn: async () => {
      const out: {
        id: string;
        employee_id: string;
        call_result: string;
        customer_response: string | null;
        status: string;
        lead_id: string;
        called_at: string;
      }[] = [];
      const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await supabase.from("call_history")
          .select("id, employee_id, call_result, customer_response, status, lead_id, called_at")
          .eq("company_id", companyId!)
          .order("called_at", { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < size) break;
      }
      return out;
    },
  });

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchLeads(), refetchRecent(), refetchCalls()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Calls filtered by date
  const dateCalls = useMemo(() => {
    if (allDates) return calls;
    return calls.filter((c) => c.called_at && c.called_at.slice(0, 10) === date);
  }, [calls, allDates, date]);

  // Distinct active agents who made calls on this date
  const activeAgentIdsOnDate = useMemo(() => {
    const ids = new Set<string>();
    for (const c of dateCalls) {
      if (c.employee_id) ids.add(c.employee_id);
    }
    return ids;
  }, [dateCalls]);

  const filteredLeads = useMemo(() => leadStats.filter((l) =>
    (agentFilter === ALL || l.assigned_to === agentFilter) &&
    (statusFilter === ALL || l.status === statusFilter) &&
    (typeFilter === ALL || l.loan_type === typeFilter)), [leadStats, agentFilter, statusFilter, typeFilter]);

  type LiteLead = (typeof filteredLeads)[number];
  const count = (fn: (l: LiteLead) => boolean) => filteredLeads.filter(fn).length;

  const stats = {
    totalLeads: filteredLeads.length,
    assignedLeads: count((l) => Boolean(l.assigned_to)),
    unassignedLeads: count((l) => !l.assigned_to),
    calledLeads: count((l) => CONTACTED_STATUSES.includes(l.status)),
    pendingLeads: count((l) => !CONTACTED_STATUSES.includes(l.status)),
    interestedLeads: count((l) => l.status === "Interested"),
    followUpLeads: count((l) => l.status === "Follow-up"),
    notInterestedLeads: count((l) => l.status === "Not Interested"),
    applications: count((l) => l.status === "Application Submitted"),
    approved: count((l) => l.status === "Approved"),
    disbursed: count((l) => l.status === "Disbursed"),

    // Calling metrics for the selected date
    callsLoggedOnDate: dateCalls.length,
    connectedOnDate: dateCalls.filter((c) => c.call_result === "Connected").length,
    interestedOnDate: dateCalls.filter((c) => c.customer_response === "Interested" || c.status === "Interested").length,
    followUpsOnDate: dateCalls.filter((c) => c.customer_response === "Follow-up Required" || c.status === "Follow-up").length,
    activeAgentsCount: activeAgentIdsOnDate.size,
  };

  const connectionRate = stats.callsLoggedOnDate > 0
    ? Math.round((stats.connectedOnDate / stats.callsLoggedOnDate) * 100)
    : 0;

  // Agent Performance Breakdown for this Date
  const agentPerformance = useMemo(() => {
    return agents.map((a) => {
      const ownLeads = filteredLeads.filter((l) => l.assigned_to === a.id);
      const agentDateCalls = dateCalls.filter((c) => c.employee_id === a.id);
      const uniqueLeadsCalled = new Set(agentDateCalls.map((c) => c.lead_id)).size;
      const connected = agentDateCalls.filter((c) => c.call_result === "Connected").length;
      const interested = agentDateCalls.filter((c) => c.customer_response === "Interested" || c.status === "Interested").length;
      const followUps = agentDateCalls.filter((c) => c.customer_response === "Follow-up Required" || c.status === "Follow-up").length;
      const notInterested = agentDateCalls.filter((c) => c.customer_response === "Not Interested" || c.status === "Not Interested").length;
      const lastCall = agentDateCalls[0]?.called_at || null;
      const isActive = agentDateCalls.length > 0;

      const connPercent = agentDateCalls.length > 0 ? Math.round((connected / agentDateCalls.length) * 100) : 0;

      return {
        id: a.id,
        name: a.full_name || a.email || "Agent",
        email: a.email,
        assignedFolderLeads: ownLeads.length,
        pendingFolderLeads: ownLeads.filter((l) => !CONTACTED_STATUSES.includes(l.status)).length,
        callsDoneToday: agentDateCalls.length,
        uniqueLeadsCalled,
        connected,
        connPercent,
        interested,
        followUps,
        notInterested,
        lastCall,
        isActive,
      };
    }).sort((a, b) => b.callsDoneToday - a.callsDoneToday);
  }, [agents, filteredLeads, dateCalls]);

  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.full_name || "Assigned") : "Unassigned");

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ── */}
      <PageHeader
        title="Live Monitoring & Agent Activity"
        description={
          allDates
            ? "Showing overall activity across all dates"
            : `Live tracking for ${date === todayISO() ? `Today (${date})` : `Date: ${date}`}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="gap-1.5 h-9"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-brand")} />
              <span>{isRefreshing ? "Refreshing…" : "Live Refresh"}</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setImportOpen(true)}
              className="gradient-brand text-white font-bold h-9 gap-1.5 shadow-sm"
            >
              <FolderPlus className="h-4 w-4" />
              <span>+ New Date Folder</span>
            </Button>
          </div>
        }
      />

      {/* ── Clickable Date Filters Bar ── */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm card-elevated space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-brand" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Filter by Date</span>
          </div>

          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={!allDates && date === todayISO() ? "default" : "outline"}
              className={cn("h-8 text-xs font-semibold gap-1", !allDates && date === todayISO() && "gradient-brand text-white")}
              onClick={() => { setDate(todayISO()); setAllDates(false); }}
            >
              <Sparkles className="h-3 w-3" /> Today
            </Button>
            <Button
              size="sm"
              variant={!allDates && date === getYesterdayISO() ? "default" : "outline"}
              className={cn("h-8 text-xs font-semibold", !allDates && date === getYesterdayISO() && "gradient-brand text-white")}
              onClick={() => { setDate(getYesterdayISO()); setAllDates(false); }}
            >
              Yesterday
            </Button>
            <Button
              size="sm"
              variant={allDates ? "default" : "outline"}
              className={cn("h-8 text-xs font-semibold", allDates && "gradient-brand text-white")}
              onClick={() => setAllDates(true)}
            >
              All Dates
            </Button>
            <div className="flex items-center gap-1.5 pl-2 border-l">
              <span className="text-xs text-muted-foreground hidden sm:inline">Custom:</span>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  if (e.target.value) {
                    setDate(e.target.value);
                    setAllDates(false);
                  }
                }}
                className="h-8 w-[140px] text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Clickable Date Pills for all folders */}
        {folders.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Quick Select Folder Dates ({folders.length} available):
            </p>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap pb-1">
              {folders.slice(0, 20).map((f) => {
                const isSelected = !allDates && f.date === date;
                const isToday = f.date === todayISO();
                return (
                  <button
                    key={f.date}
                    type="button"
                    onClick={() => { setDate(f.date); setAllDates(false); }}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-all touch-tap flex items-center gap-1.5",
                      isSelected
                        ? "border-brand bg-brand/15 text-brand ring-1 ring-brand font-bold shadow-xs"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <span>{f.date}</span>
                    {isToday && <span className="text-[10px] px-1 py-0.2 bg-brand/20 text-brand rounded font-extrabold">TODAY</span>}
                    <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-foreground font-mono">
                      {f.count} leads
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Key Live Metrics on Selected Date ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Calls Made"
          value={stats.callsLoggedOnDate}
          icon={PhoneCall}
          tone="brand"
          hint={`${stats.connectedOnDate} connected (${connectionRate}%)`}
        />
        <StatCard
          label="Active Callers"
          value={`${stats.activeAgentsCount} / ${agents.length}`}
          icon={UserCheck}
          tone="success"
          hint="Agents who called today"
        />
        <StatCard
          label="Interested Converted"
          value={stats.interestedOnDate || stats.interestedLeads}
          icon={Star}
          tone="success"
          hint="Service accepted"
        />
        <StatCard
          label="Follow-ups Set"
          value={stats.followUpsOnDate || stats.followUpLeads}
          icon={Clock}
          tone="warning"
          hint="Scheduled callbacks"
        />
        <StatCard
          label="Folder Leads"
          value={stats.totalLeads}
          icon={PhoneForwarded}
          tone="info"
          hint={`${stats.assignedLeads} assigned`}
        />
        <StatCard
          label="Pending in Folder"
          value={stats.pendingLeads}
          icon={Activity}
          tone="destructive"
          hint="Uncalled in queue"
        />
      </div>

      {/* ── Secondary Status Cards ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Not Interested", stats.notInterestedLeads, "text-muted-foreground"],
          ["Applications", stats.applications, "text-indigo-500"],
          ["Approved", stats.approved, "text-emerald-500"],
          ["Disbursed", stats.disbursed, "text-brand font-extrabold"],
          ["Unassigned", stats.unassignedLeads, "text-amber-500"],
          ["Connected %", `${connectionRate}%`, "text-cyan-500 font-extrabold"],
        ].map(([k, v, colorClass]) => (
          <div key={k as string} className="rounded-xl border bg-card p-3 text-center card-elevated">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</p>
            <p className={cn("mt-0.5 text-lg font-bold", colorClass)}>{v}</p>
          </div>
        ))}
      </div>

      {/* ── Filter Dropdowns ── */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm bg-card">
            <SelectValue placeholder="Filter Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Agents ({agents.length})</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.full_name || a.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm bg-card">
            <SelectValue placeholder="Filter Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm bg-card">
            <SelectValue placeholder="Filter Loan Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Loan Types</SelectItem>
            {LOAN_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Agent Calling Breakdown (Who done calls on this date) ── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm card-elevated">
        <div className="border-b p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-foreground">
                Agent Live Performance & Call Activity
              </h3>
              <span className="rounded-full bg-success/15 text-success border border-success/30 px-2 py-0.5 text-[11px] font-bold">
                {stats.activeAgentsCount} of {agents.length} Agents Calling {allDates ? "Overall" : `on ${date}`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live tally of calls made, connected rate, and conversions on {allDates ? "all dates" : date}.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-500 font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Calling Today
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted" /> Idle
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Calls Done ({allDates ? "All" : date})</th>
                <th className="px-4 py-3 text-center">Connected</th>
                <th className="px-4 py-3 text-center">Interested</th>
                <th className="px-4 py-3 text-center">Follow-ups</th>
                <th className="px-4 py-3 text-center">Not Interested</th>
                <th className="px-4 py-3 text-center">Folder Leads</th>
                <th className="px-4 py-3 text-center">Remaining</th>
                <th className="px-4 py-3">Last Call Time</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agentPerformance.map((p) => {
                const isFiltered = agentFilter === p.id;
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "hover:bg-muted/30 transition-colors",
                      isFiltered && "bg-brand/5 border-l-2 border-l-brand",
                      p.isActive && "bg-success/[0.02]"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg text-xs font-extrabold text-white shrink-0",
                          p.isActive ? "gradient-brand shadow-xs" : "bg-muted text-muted-foreground"
                        )}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-foreground truncate">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">{p.email}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {p.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 shadow-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <span>Idle</span>
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        "font-mono font-extrabold text-sm px-2 py-0.5 rounded",
                        p.callsDoneToday > 0 ? "bg-brand/10 text-brand font-bold" : "text-muted-foreground"
                      )}>
                        {p.callsDoneToday}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="font-mono font-bold text-foreground">
                        {p.connected}
                      </span>
                      {p.callsDoneToday > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          {p.connPercent}%
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center font-mono font-bold text-success">
                      {p.interested}
                    </td>

                    <td className="px-4 py-3 text-center font-mono font-bold text-amber-500">
                      {p.followUps}
                    </td>

                    <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                      {p.notInterested}
                    </td>

                    <td className="px-4 py-3 text-center font-mono font-semibold text-foreground">
                      {p.assignedFolderLeads}
                    </td>

                    <td className="px-4 py-3 text-center font-mono font-bold text-destructive">
                      {p.pendingFolderLeads}
                    </td>

                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {p.lastCall ? formatDateTime(p.lastCall) : "—"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={isFiltered ? "default" : "ghost"}
                        className={cn("h-7 text-xs font-semibold", isFiltered && "gradient-brand text-white")}
                        onClick={() => setAgentFilter(isFiltered ? ALL : p.id)}
                      >
                        {isFiltered ? "Clear Filter" : "Filter Leads"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {agentPerformance.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No agents found in company.</p>
        )}
      </div>

      {/* ── Filtered Leads Table ── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm card-elevated">
        <div className="border-b p-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-foreground">
              Leads on Folder ({filteredLeads.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              {filteredLeads.length > recent.length ? `Showing ${recent.length} most recent leads` : "All matching leads"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {agentFilter !== ALL && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAgentFilter(ALL)}>
                Clear Agent Filter ({agentName(agentFilter)})
              </Button>
            )}
            {statusFilter !== ALL && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatusFilter(ALL)}>
                Clear Status Filter ({statusFilter})
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Loan Type</th>
                <th className="px-4 py-3">Assigned Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Call Time</th>
                <th className="px-4 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent.map((l) => (
                <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to="/lead/$leadId"
                      params={{ leadId: l.id }}
                      className="font-bold text-foreground hover:underline hover:text-brand"
                    >
                      {l.customer_name}
                    </Link>
                    {l.city && <span className="block text-[11px] text-muted-foreground">{l.city}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{l.mobile}</td>
                  <td className="px-4 py-3 font-extrabold text-foreground">{inr(Number(l.loan_amount))}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{l.loan_type}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{agentName(l.assigned_to)}</td>
                  <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                    {l.last_call_at ? formatDateTime(l.last_call_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs font-semibold">
                      <Link to="/lead/$leadId" params={{ leadId: l.id }}>
                        <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> View
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recent.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No leads found matching the selected filters.
          </div>
        )}
      </div>

      {/* ── Import / Create Date Folder Wizard ── */}
      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        companyId={companyId}
        userId={session?.userId ?? null}
        folderDate={date}
        onViewImported={() => {
          handleManualRefresh();
          qc.invalidateQueries({ queryKey: ["monitor-folders"] });
        }}
      />
    </div>
  );
}
