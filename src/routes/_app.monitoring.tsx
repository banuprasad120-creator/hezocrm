import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, PhoneCall, PhoneForwarded, Users2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LEAD_STATUSES, LOAN_TYPES, inr, todayISO, type Lead } from "@/lib/crm";

export const Route = createFileRoute("/_app/monitoring")({
  head: () => ({
    meta: [
      { title: "Live Monitoring — Hezo CRM" },
      { name: "description", content: "Real-time lead status, agent activity and performance calculated from live call records." },
      { property: "og:title", content: "Live Monitoring — Hezo CRM" },
      { property: "og:description", content: "Track every lead and every agent in real time." },
    ],
  }),
  component: Monitoring,
});

const ALL = "__all__";

function Monitoring() {
  const { data: session, isLoading } = useCrmSession();
  const navigate = useNavigate();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;

  useEffect(() => {
    if (!isLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [isLoading, session, navigate]);

  const [date, setDate] = useState(todayISO());
  const [allDates, setAllDates] = useState(false);
  const [autoPicked, setAutoPicked] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Folders that actually contain leads — used to auto-select a non-empty date.
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

  useEffect(() => {
    if (autoPicked || allDates || folders.length === 0) return;
    setAutoPicked(true);
    const hasToday = folders.some((f) => f.date === date && f.count > 0);
    if (!hasToday && folders[0]) setDate(folders[0].date);
  }, [folders, autoPicked, allDates, date]);


  // Lightweight full scan (paged) — Supabase caps a single request at 1000 rows.
  const { data: leadStats = [] } = useQuery({
    queryKey: ["monitor-lead-stats", companyId, date, allDates],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 15_000,
    queryFn: async () => {
      const out: Pick<Lead, "id" | "status" | "assigned_to" | "loan_type">[] = [];
      const size = 1000;
      for (let from = 0; ; from += size) {
        let query = supabase.from("leads").select("id, status, assigned_to, loan_type")
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

  const { data: recent = [] } = useQuery({
    queryKey: ["monitor-recent", companyId, date, allDates, agentFilter, statusFilter, typeFilter],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 15_000,
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

  const { data: calls = [] } = useQuery({
    queryKey: ["monitor-calls", companyId],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 15_000,
    queryFn: async () => {
      const out: { employee_id: string; call_result: string; lead_id: string }[] = [];
      const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await supabase.from("call_history")
          .select("employee_id, call_result, lead_id").eq("company_id", companyId!)
          .order("called_at", { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < size) break;
      }
      return out;
    },
  });

  const filtered = useMemo(() => leadStats.filter((l) =>
    (agentFilter === ALL || l.assigned_to === agentFilter) &&
    (statusFilter === ALL || l.status === statusFilter) &&
    (typeFilter === ALL || l.loan_type === typeFilter)), [leadStats, agentFilter, statusFilter, typeFilter]);

  type LiteLead = (typeof filtered)[number];
  const count = (fn: (l: LiteLead) => boolean) => filtered.filter(fn).length;
  const stats = {
    total: filtered.length,
    assigned: count((l) => Boolean(l.assigned_to)),
    called: count((l) => CONTACTED_STATUSES.includes(l.status)),
    pending: count((l) => !CONTACTED_STATUSES.includes(l.status)),
    interested: count((l) => l.status === "Interested"),
    followUp: count((l) => l.status === "Follow-up"),
    notInterested: count((l) => l.status === "Not Interested"),
    applications: count((l) => l.status === "Application Submitted"),
    approved: count((l) => l.status === "Approved"),
    disbursed: count((l) => l.status === "Disbursed"),
  };

  const leadIds = new Set(filtered.map((l) => l.id));
  const performance = agents.map((a) => {
    const own = filtered.filter((l) => l.assigned_to === a.id);
    const agentCalls = calls.filter((c) => c.employee_id === a.id && leadIds.has(c.lead_id));
    return {
      id: a.id,
      name: a.full_name || a.email,
      assigned: own.length,
      called: new Set(agentCalls.map((c) => c.lead_id)).size,
      connected: new Set(agentCalls.filter((c) => c.call_result === "Connected").map((c) => c.lead_id)).size,
      interested: own.filter((l) => l.status === "Interested").length,
      followUps: own.filter((l) => l.status === "Follow-up").length,
      applications: own.filter((l) => l.status === "Application Submitted").length,
      approved: own.filter((l) => l.status === "Approved").length,
      disbursed: own.filter((l) => l.status === "Disbursed").length,
    };
  });

  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.full_name || "Assigned") : "Unassigned");


  return (
    <>
      <PageHeader
        title="Live Monitoring"
        description={allDates ? "All lead folders" : `Folder ${date}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setAllDates(false); }} className="h-9 w-[150px] text-xs sm:w-[160px] sm:text-sm" />
            <button type="button" onClick={() => setAllDates((v) => !v)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-accent touch-tap sm:text-sm">
              {allDates ? "Filter by date" : "Show all dates"}
            </button>
          </div>
        }
      />

      {folders.length > 0 && (
        <div className="mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap pb-1">
          {folders.slice(0, 15).map((f) => (
            <button
              key={f.date}
              type="button"
              onClick={() => { setDate(f.date); setAllDates(false); }}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors touch-tap ${
                !allDates && f.date === date ? "border-brand bg-brand/15 text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {f.date} · {f.count}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total leads" value={stats.total} icon={PhoneCall} tone="brand" hint={`${stats.assigned} assigned`} />
        <StatCard label="Called" value={stats.called} icon={PhoneForwarded} tone="info" />
        <StatCard label="Pending" value={stats.pending} icon={Activity} tone="warning" />
        <StatCard label="Interested" value={stats.interested} icon={CheckCircle2} tone="success" />
        <StatCard label="Follow-ups" value={stats.followUp} icon={Users2} tone="destructive" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Not Interested", stats.notInterested], ["Applications", stats.applications],
          ["Approved", stats.approved], ["Disbursed", stats.disbursed], ["Unassigned", stats.total - stats.assigned],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border bg-card p-3 text-center card-elevated">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</p>
            <p className="mt-0.5 text-lg font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm"><SelectValue placeholder="Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All agents</SelectItem>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-full text-xs sm:text-sm"><SelectValue placeholder="Loan type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All loan types</SelectItem>
            {LOAN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border bg-card card-elevated">
        <p className="border-b p-4 text-sm font-semibold">Agent performance (live)</p>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Agent", "Assigned", "Called", "Connected", "Interested", "Follow-ups", "Applications", "Approved", "Disbursed"].map((h) => (
                <th key={h} className="px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {performance.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-3 font-semibold">{p.name}</td>
                <td className="px-4 py-3">{p.assigned}</td>
                <td className="px-4 py-3">{p.called}</td>
                <td className="px-4 py-3">{p.connected}</td>
                <td className="px-4 py-3">{p.interested}</td>
                <td className="px-4 py-3">{p.followUps}</td>
                <td className="px-4 py-3">{p.applications}</td>
                <td className="px-4 py-3">{p.approved}</td>
                <td className="px-4 py-3">{p.disbursed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {performance.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No agents yet.</p>}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border bg-card card-elevated">
        <p className="border-b p-4 text-sm font-semibold">
          Leads ({filtered.length}){filtered.length > recent.length ? ` · showing ${recent.length} most recent` : ""}
        </p>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Mobile</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Loan type</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last call</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link to="/lead/$leadId" params={{ leadId: l.id }} className="font-semibold hover:underline">{l.customer_name}</Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{l.mobile}</td>
                <td className="px-4 py-3">{inr(Number(l.loan_amount))}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.loan_type}</td>
                <td className="px-4 py-3">{agentName(l.assigned_to)}</td>
                <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                <td className="px-4 py-3 text-muted-foreground">{l.last_call_at ? new Date(l.last_call_at).toLocaleString("en-IN") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No leads match these filters.</p>}
      </div>
    </>
  );
}
