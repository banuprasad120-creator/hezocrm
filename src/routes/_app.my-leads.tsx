import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Clock, Flame, MessageCircle, PhoneCall, PhoneForwarded, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LEAD_STATUSES, LOAN_TYPES, inr, type Lead, type LeadStatus } from "@/lib/crm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/my-leads")({
  head: () => ({
    meta: [
      { title: "Agent Workspace — Hezo CRM" },
      { name: "description", content: "Your assigned leads: call customers, record outcomes and schedule follow-ups." },
      { property: "og:title", content: "Agent Workspace — Hezo CRM" },
      { property: "og:description", content: "Call assigned leads and record outcomes in a few taps." },
    ],
  }),
  component: MyLeads,
});

type Quick = "all" | "new" | "pending" | "interested" | "followup" | "completed";

const QUICK: { key: Quick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "pending", label: "Pending" },
  { key: "interested", label: "Interested" },
  { key: "followup", label: "Follow-up" },
  { key: "completed", label: "Completed" },
];

const COMPLETED: LeadStatus[] = ["Approved", "Disbursed", "Closed", "Not Interested", "Not Eligible", "Wrong Number"];

function MyLeads() {
  const { data: session } = useCrmSession();
  const userId = session?.userId ?? null;
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [status, setStatus] = useState("all");
  const [loanType, setLoanType] = useState("all");
  const [folderDate, setFolderDate] = useState("");
  const [active, setActive] = useState<Lead | null>(null);
  const [viewLead, setViewLead] = useState<Lead | null>(null);

  const { data: leads = [], isLoading, refetch } = useQuery({
    queryKey: ["my-leads", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads").select("*").eq("assigned_to", userId!)
        .order("folder_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data as Lead[];
    },
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["my-followups-open", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follow_ups").select("id, lead_id, follow_up_date, follow_up_time")
        .eq("employee_id", userId!).eq("is_done", false).order("follow_up_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const followUpByLead = useMemo(() => {
    const m = new Map<string, { date: string; time: string | null }>();
    for (const f of followUps) if (!m.has(f.lead_id)) m.set(f.lead_id, { date: f.follow_up_date, time: f.follow_up_time });
    return m;
  }, [followUps]);

  const stats = useMemo(() => {
    const called = leads.filter((l) => CONTACTED_STATUSES.includes(l.status)).length;
    return {
      assigned: leads.length,
      called,
      pending: leads.length - called,
      interested: leads.filter((l) => l.status === "Interested").length,
    };
  }, [leads]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (term && ![l.customer_name, l.mobile, l.id].some((v) => v.toLowerCase().includes(term))) return false;
      if (status !== "all" && l.status !== status) return false;
      if (loanType !== "all" && l.loan_type !== loanType) return false;
      if (folderDate && l.folder_date !== folderDate) return false;
      if (quick === "new") return l.status === "New" || l.status === "Assigned";
      if (quick === "pending") return !CONTACTED_STATUSES.includes(l.status);
      if (quick === "interested") return l.status === "Interested";
      if (quick === "followup") return followUpByLead.has(l.id) || l.status === "Follow-up";
      if (quick === "completed") return COMPLETED.includes(l.status);
      return true;
    });
  }, [leads, q, status, loanType, folderDate, quick, followUpByLead]);

  return (
    <>
      <PageHeader
        title="My Leads"
        description={`All assigned leads · ${stats.assigned} assigned · ${stats.called} called · ${stats.pending} pending`}
        actions={<Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-1 h-4 w-4" /> Refresh</Button>}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="My Leads" value={stats.assigned} icon={PhoneCall} tone="brand" />
        <StatCard label="Called" value={stats.called} icon={PhoneForwarded} tone="info" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard label="Interested" value={stats.interested} icon={Flame} tone="success" />
        <StatCard label="Follow-ups" value={followUps.length} icon={CheckCircle2} tone="destructive" />
      </div>

      <div className="mt-4 space-y-3 sm:mt-6">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, mobile or lead ID…"
            className="h-10 bg-card pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap pb-1">
          {QUICK.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setQuick(f.key)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors touch-tap",
                quick === f.key ? "gradient-brand border-transparent text-white shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-2xl">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 text-xs sm:h-10 sm:text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={loanType} onValueChange={setLoanType}>
            <SelectTrigger className="h-9 text-xs sm:h-10 sm:text-sm"><SelectValue placeholder="Loan type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All loan types</SelectItem>
              {LOAN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={folderDate} onChange={(e) => setFolderDate(e.target.value)} className="h-9 text-xs sm:h-10 sm:text-sm" />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading your leads…</p>}
        {!isLoading && rows.length === 0 && (
          <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground card-elevated">
            No leads match this view. Your admin will assign leads shortly.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => {
            const fu = followUpByLead.get(l.id);
            return (
              <div key={l.id} className="rounded-2xl border bg-card p-4 card-elevated">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button onClick={() => setViewLead(l)} className="truncate text-base font-bold hover:underline">
                      {l.customer_name}
                    </button>
                    <p className="mt-0.5 text-sm text-muted-foreground">📞 {l.mobile}</p>
                    <p className="text-sm">Loan: <span className="font-semibold">{inr(Number(l.loan_amount))}</span></p>
                    <p className="text-xs text-muted-foreground">{l.loan_type}{l.city ? ` · ${l.city}` : ""}</p>
                    {fu && (
                      <p className="mt-1 text-xs text-warning">
                        <CalendarClock className="mr-1 inline h-3 w-3" />
                        {fu.date}{fu.time ? ` at ${String(fu.time).slice(0, 5)}` : ""}
                      </p>
                    )}
                  </div>
                  <LeadStatusBadge status={l.status} />
                </div>

                <div className="mt-4 space-y-2">
                  <Button asChild className="h-12 w-full gradient-brand text-base font-bold text-white">
                    <a href={`tel:${l.mobile}`}><PhoneCall className="mr-2 h-5 w-5" /> CALL</a>
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    <Button asChild variant="outline" size="sm" className="h-10">
                      <a href={`https://wa.me/${l.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" className="h-10" onClick={() => setViewLead(l)}>VIEW</Button>
                    <Button variant="outline" size="sm" className="h-10 font-semibold" onClick={() => setActive(l)}>UPDATE</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AgentLeadSheet
        lead={viewLead}
        open={Boolean(viewLead)}
        onOpenChange={(o) => !o && setViewLead(null)}
        onUpdate={(l) => { setViewLead(null); setActive(l); }}
      />

      <CallUpdateDialog
        lead={active}
        employeeId={userId ?? ""}
        open={Boolean(active)}
        onOpenChange={(o) => !o && setActive(null)}
      />
    </>
  );
}
