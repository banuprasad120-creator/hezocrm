import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Calendar, CheckCircle2, Clock, Download, Eye, Flame,
  Loader2, MessageCircle, Phone, PhoneCall, Plus, RefreshCw, Search, Star,
  Trash2, UserPlus, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { DiaryDialog } from "@/components/crm/DiaryDialog";
import { CreateLeadDialog } from "@/components/crm/CreateLeadDialog";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { formatDateTime, inr, todayISO, type Lead } from "@/lib/crm";
import { isDiaryLead, parseDiaryData, type DiaryData } from "@/lib/diary";

export const Route = createFileRoute("/_app/diary")({
  head: () => ({
    meta: [
      { title: "Daily Diary — Hezo CRM" },
      { name: "description", content: "Agent Daily Diary: High priority and important leads tracked for instant follow-up and conversion." },
      { property: "og:title", content: "Daily Diary — Hezo CRM" },
      { property: "og:description", content: "Track your important diary leads, notes and action dates." },
    ],
  }),
  component: DailyDiaryPage,
});

function DailyDiaryPage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const isAdmin = session?.isAdmin ?? false;
  const companyId = session?.companyId ?? null;
  const userId = session?.userId ?? null;

  const [q, setQ] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const [updateLead, setUpdateLead] = useState<Lead | null>(null);
  const [editDiaryLead, setEditDiaryLead] = useState<Lead | null>(null);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);

  // Fetch leads for this agent (or company if admin)
  const { data: rawLeads = [], isLoading, refetch } = useQuery({
    queryKey: ["diary-leads", companyId, userId, isAdmin],
    enabled: Boolean(companyId || userId),
    queryFn: async () => {
      let query = supabase.from("leads").select("*");
      if (companyId) query = query.eq("company_id", companyId);
      if (!isAdmin && userId) query = query.eq("assigned_to", userId);
      query = query.order("updated_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  // Filter only Diary / Important leads and enrich with parsed metadata
  const diaryLeads = useMemo(() => {
    return rawLeads
      .filter((l) => isDiaryLead(l.notes))
      .map((l) => ({
        ...l,
        diaryData: parseDiaryData(l.notes) as DiaryData,
      }));
  }, [rawLeads]);

  // Filtered diary leads based on search term & priority
  const filteredLeads = useMemo(() => {
    const term = q.trim().toLowerCase();
    return diaryLeads.filter((l) => {
      if (term) {
        const matchesName = l.customer_name.toLowerCase().includes(term);
        const matchesPhone = l.mobile.includes(term);
        const matchesCity = (l.city || "").toLowerCase().includes(term);
        const matchesNotes = (l.notes || "").toLowerCase().includes(term);
        if (!matchesName && !matchesPhone && !matchesCity && !matchesNotes) return false;
      }
      if (priorityFilter !== "all") {
        if ((l.diaryData?.priority || "HIGH") !== priorityFilter) return false;
      }
      return true;
    });
  }, [diaryLeads, q, priorityFilter]);

  const metrics = useMemo(() => {
    const total = diaryLeads.length;
    const hot = diaryLeads.filter((l) => l.diaryData?.priority === "HOT").length;
    const today = todayISO();
    const todayTargets = diaryLeads.filter((l) => l.diaryData?.targetDate === today).length;
    const totalValue = diaryLeads.reduce((acc, l) => acc + (Number(l.loan_amount) || 0), 0);
    return { total, hot, todayTargets, totalValue };
  }, [diaryLeads]);

  const exportCsv = () => {
    if (filteredLeads.length === 0) {
      toast.info("No diary leads to export");
      return;
    }
    const cols = ["Customer Name", "Mobile", "Loan Type", "Loan Amount", "City", "Status", "Diary Priority", "Target Date", "Diary Notes", "Folder Date"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filteredLeads.map((l) => [
      escape(l.customer_name),
      escape(l.mobile),
      escape(l.loan_type),
      escape(l.loan_amount || 0),
      escape(l.city || ""),
      escape(l.status),
      escape(l.diaryData?.priority || "HIGH"),
      escape(l.diaryData?.targetDate || ""),
      escape(l.diaryData?.notes || ""),
      escape(l.folder_date),
    ].join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hezo-diary-leads-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredLeads.length} diary leads`);
  };

  return (
    <>
      <PageHeader
        title="Daily Diary"
        description="High-priority and starred important leads that need special attention and rapid conversion."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setCreateLeadOpen(true)}
              className="h-9 font-bold gradient-brand text-white shadow-sm gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              + Add New Lead
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-9">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Diary Leads" value={metrics.total} icon={BookOpen} tone="brand" />
        <StatCard label="Hot Deals" value={metrics.hot} icon={Flame} tone="destructive" />
        <StatCard label="Today's Target Date" value={metrics.todayTargets} icon={Calendar} tone="warning" />
        <StatCard label="Pipeline Value" value={inr(metrics.totalValue)} icon={Star} tone="success" />
      </div>

      {/* Filter Bar */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search diary leads…"
            className="h-9 bg-card pl-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-9 text-xs w-[140px] bg-card">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="HOT">🔥 Hot Deals</SelectItem>
              <SelectItem value="HIGH">⚡ High Priority</SelectItem>
              <SelectItem value="NORMAL">📌 Normal Diary</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Leads List */}
      <div className="mt-4">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-12 text-center card-elevated">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-500">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-foreground">No leads in your Daily Diary</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                Mark any important or hot lead from your calling queue using the <strong>"Move to Diary"</strong> button to keep track of them here.
              </p>
            </div>
            <Button asChild size="sm" className="gradient-brand text-white font-bold">
              <Link to="/my-leads">Go to Agent Workspace</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredLeads.map((lead) => {
              const d = lead.diaryData;
              const isHot = d?.priority === "HOT";
              return (
                <div
                  key={lead.id}
                  className={`rounded-2xl border bg-card p-4 card-elevated flex flex-col justify-between transition-all hover:shadow-md ${
                    isHot ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-sm text-foreground truncate">{lead.customer_name}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              isHot ? "bg-rose-500 text-white" : "bg-amber-500 text-white"
                            }`}
                          >
                            {isHot ? "🔥 HOT" : "⚡ IMPORTANT"}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5">{lead.mobile}</p>
                      </div>
                      <LeadStatusBadge status={lead.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-foreground">{inr(Number(lead.loan_amount))}</span>
                      <span className="text-muted-foreground">· {lead.loan_type}</span>
                      {lead.city && <span className="text-muted-foreground">· {lead.city}</span>}
                    </div>

                    {/* Diary Notes Card */}
                    {d?.notes && (
                      <div className="rounded-xl border border-amber-500/30 bg-card p-2.5 text-xs text-foreground/90 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Diary Note
                        </p>
                        <p className="text-xs leading-relaxed">{d.notes}</p>
                      </div>
                    )}

                    {d?.targetDate && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-brand" /> Target Date: <strong>{d.targetDate}</strong>
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-t pt-3">
                    <div className="flex items-center gap-1.5">
                      <Button asChild size="sm" className="h-8 gap-1 text-xs bg-brand text-white font-bold">
                        <a href={`tel:${lead.mobile}`}><PhoneCall className="h-3.5 w-3.5" /> Call</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                        <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                          <MessageCircle className="h-3.5 w-3.5 text-success" /> WhatsApp
                        </a>
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditDiaryLead(lead)}
                        className="h-8 text-xs font-medium border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                      >
                        <BookOpen className="h-3.5 w-3.5 mr-1" /> Edit Diary
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setUpdateLead(lead)}
                        className="h-8 text-xs font-semibold"
                      >
                        Update
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Diary Dialog */}
      <DiaryDialog
        lead={editDiaryLead}
        open={Boolean(editDiaryLead)}
        onOpenChange={(o) => !o && setEditDiaryLead(null)}
        onSuccess={() => refetch()}
      />

      {/* Call Update Dialog */}
      {updateLead && (
        <CallUpdateDialog
          lead={updateLead}
          employeeId={userId || ""}
          open={Boolean(updateLead)}
          onOpenChange={(o) => {
            if (!o) setUpdateLead(null);
            refetch();
          }}
        />
      )}

      {/* Create New Lead */}
      <CreateLeadDialog
        open={createLeadOpen}
        onOpenChange={setCreateLeadOpen}
        companyId={companyId}
        employeeId={userId}
        isAgentMode={!isAdmin}
        onSuccess={() => refetch()}
      />
    </>
  );
}
