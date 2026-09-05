import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CheckCircle2, Clock, Flame, Loader2, MessageCircle,
  PhoneCall, PhoneForwarded, RefreshCw, Star, WifiOff, Zap, Sparkles,
  Award, ShieldCheck, UserPlus, Plus, BookOpen, Download, FileCheck,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import { InterestedLeadDialog } from "@/components/crm/InterestedLeadDialog";
import { CreateInterestedCandidateDialog } from "@/components/crm/CreateInterestedCandidateDialog";
import { CandidateDocumentsDialog } from "@/components/crm/CandidateDocumentsDialog";
import { CreateLeadDialog } from "@/components/crm/CreateLeadDialog";
import { DiaryDialog } from "@/components/crm/DiaryDialog";
import { getDocumentStats, parseInterestedData } from "@/lib/interested-lead";
import { isDiaryLead, parseDiaryData } from "@/lib/diary";
import { isTrashLead } from "@/lib/trash";
import { trashLeadServerFn } from "@/lib/crm.functions";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCompanyBatchSettings, getActiveAgentBatch, allocateNextLeadBatch, getUnassignedLeadsCount, type LeadBatch,
} from "@/lib/lead-batch";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, inr, todayISO, type Lead } from "@/lib/crm";

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

function MyLeads() {
  const { data: session } = useCrmSession();
  const userId = session?.userId ?? null;
  const companyId = session?.companyId ?? null;
  const qc = useQueryClient();
  const [active, setActive] = useState<Lead | null>(null);
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const [interestedLead, setInterestedLead] = useState<Lead | null>(null);
  const [docsLead, setDocsLead] = useState<Lead | null>(null);
  const [diaryLead, setDiaryLead] = useState<Lead | null>(null);
  const [createInterestedOpen, setCreateInterestedOpen] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [autoRefill, setAutoRefill] = useState(true);
  const [claiming, setClaiming] = useState(false);

  // Manual client fetch modal state
  const [fetchModalOpen, setFetchModalOpen] = useState(false);
  const [manualCount, setManualCount] = useState<number>(100);

  /* ── Fetch Available Unassigned Leads in Company ── */
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["unassigned-leads-count", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getUnassignedLeadsCount(companyId!),
  });

  /* ── Fetch Company Batch Settings (default 100) ── */
  const { data: batchSettings } = useQuery({
    queryKey: ["batch-settings", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getCompanyBatchSettings(companyId!),
  });
  const batchSize = batchSettings?.batchSize ?? 100;
  const isAutomationEnabled = batchSettings?.enabled ?? true;

  /* ── Fetch Active Batch record ── */
  const { data: activeBatch } = useQuery({
    queryKey: ["active-batch", companyId, userId],
    enabled: Boolean(companyId && userId),
    queryFn: () => getActiveAgentBatch(companyId!, userId!),
  });

  /* ── Fetch all assigned leads ── */
  const { data: leads = [], isLoading, refetch } = useQuery({
    queryKey: ["my-leads", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads").select("*").eq("assigned_to", userId!)
        .order("folder_date", { ascending: true }).order("created_at", { ascending: true });
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

  /* ── Deduplicate leads by 10-digit mobile number and exclude Trashed / Out of Service leads ── */
  const uniqueLeads = useMemo(() => {
    const seen = new Set<string>();
    const out: Lead[] = [];
    for (const l of leads) {
      if (isTrashLead(l.notes)) continue;
      const cleanMob = (l.mobile || "").replace(/\D/g, "").slice(-10);
      if (cleanMob) {
        if (!seen.has(cleanMob)) {
          seen.add(cleanMob);
          out.push(l);
        }
      } else {
        out.push(l);
      }
    }
    return out;
  }, [leads]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const called = uniqueLeads.filter((l) => CONTACTED_STATUSES.includes(l.status)).length;
    return {
      assigned: uniqueLeads.length,
      called,
      pending: uniqueLeads.length - called,
      interested: uniqueLeads.filter((l) => l.status === "Interested").length,
    };
  }, [uniqueLeads]);

  /* ── Current lead = first uncalled lead ── */
  const pendingLeads = useMemo(
    () => uniqueLeads.filter((l) => !CONTACTED_STATUSES.includes(l.status)),
    [uniqueLeads],
  );
  const currentLead = pendingLeads[0] ?? null;

  /* ── Batch Progress Calculations ── */
  const batchTotal = activeBatch?.assigned_count || (uniqueLeads.length > 0 ? Math.max(uniqueLeads.length, batchSize) : batchSize);
  const batchCompleted = stats.called;
  const batchRemaining = stats.pending;
  const batchPercent = batchTotal > 0 ? Math.min(100, Math.round((batchCompleted / (batchCompleted + batchRemaining || batchTotal)) * 100)) : 0;

  /* ── Out of Service (Trash) Mutation ── */
  const outOfServiceM = useMutation({
    mutationFn: async (lead: Lead) => {
      await trashLeadServerFn({
        data: {
          leadId: lead.id,
          reason: "Out of Service / Invalid Number",
        },
      });
    },
    onSuccess: () => {
      toast.success("🗑️ Lead moved to Trash (Out of Service)");
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["active-batch"] });
      qc.invalidateQueries({ queryKey: ["trash-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to move lead to Trash"),
  });

  /* ── Interested Mutation ── */
  const interestedM = useMutation({
    mutationFn: async (lead: Lead) => {
      const now = new Date().toISOString();
      const { error } = await supabase.from("leads")
        .update({ status: "Interested", last_call_at: now })
        .eq("id", lead.id);
      if (error) throw error;
      await supabase.from("call_history").insert({
        lead_id: lead.id,
        company_id: lead.company_id,
        employee_id: userId!,
        call_result: "Connected",
        customer_response: "Interested",
        status: "Interested",
        notes: "Marked interested",
      });
    },
    onSuccess: () => {
      toast.success("🎉 Lead marked as Interested!");
      qc.invalidateQueries({ queryKey: ["my-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Automated / On-demand Batch Allocation & Refill ── */
  const claimNextBatch = async (customCount?: number, isAutomatic = false) => {
    if (!companyId || !userId || claiming) return;
    const requestedSize = customCount && customCount > 0 ? customCount : batchSize;
    setClaiming(true);
    try {
      const res = await allocateNextLeadBatch(
        companyId,
        userId,
        requestedSize,
        isAutomatic ? "AUTO_BATCH_REFILL" : "MANUAL_BATCH_REQUEST",
        !isAutomatic // Allow manual fetch even if pending leads exist
      );

      if (res.success && res.assigned_count && res.assigned_count > 0) {
        if (res.assigned_count < requestedSize) {
          toast.info(`⚡ ${res.assigned_count} new clients assigned. (${res.assigned_count} total available leads were allocated).`);
        } else {
          toast.success(`🎉 ${res.assigned_count} clients successfully added to your calling queue!`);
        }
        await qc.invalidateQueries({ queryKey: ["my-leads"] });
        await qc.invalidateQueries({ queryKey: ["active-batch"] });
        await qc.invalidateQueries({ queryKey: ["all-leads-stats"] });
        await qc.invalidateQueries({ queryKey: ["unassigned-leads-count"] });
        setFetchModalOpen(false);
      } else if (res.assigned_count === 0) {
        if (!isAutomatic) {
          toast.info("No unassigned clients available in company folders right now.");
        }
      }
    } catch (err) {
      console.error("Batch allocation error:", err);
      if (!isAutomatic) toast.error(err instanceof Error ? err.message : "Failed to claim clients");
    } finally {
      setClaiming(false);
    }
  };

  /* ── Automated trigger: When an agent finishes all pending leads in their batch, auto-assign next batch! ── */
  useEffect(() => {
    if (!isLoading && autoRefill && isAutomationEnabled && pendingLeads.length === 0 && !claiming) {
      claimNextBatch(undefined, true);
    }
  }, [isLoading, pendingLeads.length, autoRefill, isAutomationEnabled]);

  const isBusy = outOfServiceM.isPending || interestedM.isPending || claiming;

  const exportCsv = () => {
    if (uniqueLeads.length === 0) {
      toast.info("No leads to export");
      return;
    }
    const cols = ["Customer Name", "Mobile", "Loan Type", "Loan Amount", "City", "Status", "Folder Date", "Last Called At", "Notes"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = uniqueLeads.map((l) => [
      escape(l.customer_name),
      escape(l.mobile),
      escape(l.loan_type),
      escape(l.loan_amount || 0),
      escape(l.city || ""),
      escape(l.status),
      escape(l.folder_date),
      escape(l.last_call_at || "Not called"),
      escape(l.notes || ""),
    ].join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hezo-my-leads-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${uniqueLeads.length} leads`);
  };

  return (
    <>
      <PageHeader
        title="Agent Workspace"
        description={`${stats.pending} pending · ${stats.called} called · ${stats.assigned} total in queue`}
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
            <Button
              size="sm"
              onClick={() => setCreateInterestedOpen(true)}
              className="h-9 font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 shadow-sm"
            >
              <Flame className="mr-1.5 h-3.5 w-3.5 fill-amber-500" />
              + Add Interested Candidate
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={claiming}
              onClick={() => {
                setManualCount(batchSize || 100);
                setFetchModalOpen(true);
              }}
              className="h-9 font-bold border-brand/40 text-brand hover:bg-brand/10 shadow-sm"
            >
              {claiming ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5 fill-brand" />}
              Fetch / Add Clients
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-9 font-medium">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Assigned" value={stats.assigned} icon={PhoneCall} tone="brand" />
        <StatCard label="Called" value={stats.called} icon={PhoneForwarded} tone="info" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard label="Interested" value={stats.interested} icon={Flame} tone="success" />
      </div>

      {/* ── CURRENT LEAD BATCH CARD ── */}
      <div className="mt-4 rounded-2xl border bg-card p-4 sm:p-5 card-elevated border-brand/25 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-extrabold text-foreground">
                  CURRENT LEAD BATCH {activeBatch ? `· Batch #${activeBatch.batch_number}` : ""}
                </h3>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                  batchRemaining === 0
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-brand/10 text-brand border border-brand/20"
                }`}>
                  {batchRemaining === 0 ? "BATCH COMPLETED" : "IN PROGRESS"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Configured batch size: <strong>{batchSize} leads</strong> · Refill triggers automatically when remaining reaches 0.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-semibold">⚡ Auto-Refill:</span>
            <Switch checked={autoRefill} onCheckedChange={setAutoRefill} className="scale-75" />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">Batch Completion Progress</span>
            <span className="font-mono font-bold text-brand">{batchPercent}% ({batchCompleted} / {batchCompleted + batchRemaining || batchTotal})</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full rounded-full gradient-brand transition-all duration-500"
              style={{ width: `${batchPercent}%` }}
            />
          </div>
        </div>

        {/* 3 Metric Badges */}
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div className="rounded-xl border bg-muted/20 p-2 sm:p-2.5">
            <p className="text-[10px] sm:text-xs text-muted-foreground uppercase font-semibold">Current Batch</p>
            <p className="text-sm sm:text-lg font-extrabold text-foreground">{batchTotal} Leads</p>
          </div>
          <div className="rounded-xl border bg-success/10 border-success/20 p-2 sm:p-2.5">
            <p className="text-[10px] sm:text-xs text-success uppercase font-semibold">Completed</p>
            <p className="text-sm sm:text-lg font-extrabold text-success">{batchCompleted}</p>
          </div>
          <div className="rounded-xl border bg-warning/10 border-warning/20 p-2 sm:p-2.5">
            <p className="text-[10px] sm:text-xs text-warning uppercase font-semibold">Remaining</p>
            <p className="text-sm sm:text-lg font-extrabold text-warning">{batchRemaining}</p>
          </div>
        </div>

        {/* Next Batch Status Info */}
        <div className="rounded-xl border bg-muted/15 p-2.5 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              {batchRemaining > 0
                ? `Next Batch: ${batchSize} Leads · Waiting for current batch completion (${batchRemaining} remaining)`
                : claiming
                ? "Status: Pulling next batch from unassigned pool…"
                : "Status: NEW BATCH ASSIGNED (or ready to claim)"}
            </span>
          </div>
          {batchRemaining === 0 && !claiming && (
            <Button
              size="sm"
              onClick={() => claimNextBatch()}
              className="h-7 text-[11px] font-bold gradient-brand text-white shrink-0"
            >
              <Zap className="mr-1 h-3 w-3 fill-white" /> Get Next Batch
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── Current Lead Card (ONE at a time) ── */}
          {currentLead ? (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Current Lead — {pendingLeads.length} remaining in batch
                </p>
              </div>
              <LeadCard
                lead={currentLead}
                followUp={followUpByLead.get(currentLead.id)}
                isBusy={isBusy}
                onView={() => setViewLead(currentLead)}
                onUpdate={() => setActive(currentLead)}
                onOutOfService={() => outOfServiceM.mutate(currentLead)}
                onInterested={() => setInterestedLead(currentLead)}
                onDiary={() => setDiaryLead(currentLead)}
              />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border bg-card p-10 text-center card-elevated space-y-4">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
                {claiming ? <Loader2 className="h-8 w-8 animate-spin" /> : <CheckCircle2 className="h-8 w-8" />}
              </div>
              <div>
                <p className="text-xl font-extrabold text-foreground">
                  {claiming ? "Fetching New Batch Automatically… ⚡" : "All Batch Leads Completed! 🎉"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                  {claiming
                    ? "Pulling the next batch of fresh unassigned leads for you right now."
                    : "Great job! Click below to pull the next unassigned batch or keep auto-refill enabled."}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button
                  onClick={() => claimNextBatch()}
                  disabled={claiming}
                  className="gradient-brand text-white font-bold h-11 px-6 shadow-md"
                >
                  <Zap className="mr-2 h-4 w-4 fill-white" /> Claim Next {batchSize} Leads
                </Button>
              </div>
            </div>
          )}

          {/* ── Completed / Interested leads summary ── */}
          {stats.called > 0 && (
            <div className="mt-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Completed Leads in Queue ({stats.called})
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {leads
                  .filter((l) => CONTACTED_STATUSES.includes(l.status))
                  .map((l) => {
                    const intData = parseInterestedData(l.notes);
                    return (
                      <div
                        key={l.id}
                        className="rounded-2xl border bg-card p-4 card-elevated flex flex-col justify-between hover:border-brand/40 transition-colors"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-foreground">{l.customer_name}</p>
                              <p className="text-xs text-muted-foreground">📞 {l.mobile}</p>
                            </div>
                            <LeadStatusBadge status={l.status} />
                          </div>

                          {/* Updated Lead Data / CIBIL / Banking Profile */}
                          <div className="mt-2.5 space-y-1.5 text-xs">
                            {intData?.cibilScore && (
                              <div className="flex items-center gap-1 font-bold text-indigo-500">
                                <span>🛡️ CIBIL Score: {intData.cibilScore}</span>
                              </div>
                            )}
                            {intData?.salaryBank && (
                              <div className="text-muted-foreground">
                                🏦 Salary Bank: <strong className="text-foreground">{intData.salaryBank}</strong>
                              </div>
                            )}
                            {intData?.serviceYears && (
                              <div className="text-muted-foreground">
                                💼 Experience: <strong className="text-foreground">{intData.serviceYears} years</strong>
                              </div>
                            )}
                            {intData?.loans && intData.loans.length > 0 && (
                              <div className="text-muted-foreground">
                                💳 Active Loans: <strong className="text-foreground">{intData.loans.length}</strong>
                              </div>
                            )}
                            {intData?.documents && intData.documents.length > 0 && (
                              <div
                                className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-semibold cursor-pointer hover:underline"
                                onClick={() => setDocsLead(l)}
                              >
                                <FileCheck className="h-3.5 w-3.5" />
                                <span>Docs: {getDocumentStats(intData.documents).received}/{intData.documents.length} ({getDocumentStats(intData.documents).progressPercent}%)</span>
                              </div>
                            )}
                            {l.loan_amount && (
                              <div className="text-muted-foreground">
                                💰 Required Loan: <strong className="text-foreground">{inr(Number(l.loan_amount))}</strong> ({l.loan_type})
                              </div>
                            )}
                            {l.notes && (
                              <div className="mt-1 text-[11px] text-muted-foreground italic line-clamp-2">
                                "{l.notes}"
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                          <span className="text-[11px] text-muted-foreground">
                            {l.city || "—"} · {l.folder_date}
                          </span>
                          <div className="flex items-center gap-1">
                            {l.status === "Interested" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-semibold border-indigo-500/30 text-indigo-600 hover:bg-indigo-500/10"
                                onClick={() => setDocsLead(l)}
                              >
                                Docs
                              </Button>
                            )}
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs font-semibold">
                              <a href={`tel:${l.mobile}`}>Call</a>
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewLead(l)}>
                              Details
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Active Lead Update Sheet */}
      {active && (
        <CallUpdateDialog
          lead={active}
          employeeId={userId || ""}
          open={Boolean(active)}
          onOpenChange={(o) => {
            if (!o) setActive(null);
            qc.invalidateQueries({ queryKey: ["my-leads"] });
            qc.invalidateQueries({ queryKey: ["active-batch"] });
          }}
        />
      )}

      {/* Interested Questionnaire Dialog */}
      {interestedLead && (
        <InterestedLeadDialog
          lead={interestedLead}
          employeeId={userId || ""}
          open={Boolean(interestedLead)}
          onOpenChange={(o) => !o && setInterestedLead(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["my-leads"] });
            qc.invalidateQueries({ queryKey: ["active-batch"] });
          }}
        />
      )}

      {/* Candidate Documents Modal */}
      <CandidateDocumentsDialog
        lead={docsLead}
        agentName={session?.fullName || "Agent"}
        open={Boolean(docsLead)}
        onOpenChange={(o) => !o && setDocsLead(null)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["my-leads"] });
          qc.invalidateQueries({ queryKey: ["interested-leads"] });
        }}
      />

      {/* View Lead Sheet */}
      <AgentLeadSheet
        lead={viewLead}
        open={Boolean(viewLead)}
        onOpenChange={(o) => !o && setViewLead(null)}
      />

      {/* Manual Fetch / Add Clients Dialog */}
      <Dialog open={fetchModalOpen} onOpenChange={setFetchModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Zap className="h-4 w-4 fill-brand" />
              </div>
              Add Clients to Queue
            </DialogTitle>
            <DialogDescription>
              Select or enter the exact number of unassigned clients you want to add into your calling queue.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-3">
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Available Unassigned Leads:</span>
              <span className="font-bold text-foreground font-mono bg-background px-2.5 py-1 rounded-md border shadow-sm">
                {unassignedCount} clients ready
              </span>
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground">Quick Presets</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {[10, 25, 50, 100, 200].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={manualCount === preset ? "default" : "outline"}
                    size="sm"
                    className={`h-8 text-xs font-bold ${
                      manualCount === preset ? "gradient-brand text-white" : "border-border hover:border-brand/40"
                    }`}
                    onClick={() => setManualCount(preset)}
                  >
                    +{preset}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="manual-clients-count" className="text-xs font-semibold text-foreground">
                Or Enter Custom Number of Clients
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="manual-clients-count"
                  type="number"
                  min={1}
                  max={5000}
                  className="font-mono text-sm font-bold pl-3"
                  value={manualCount}
                  onChange={(e) => setManualCount(Math.max(1, parseInt(e.target.value) || 1))}
                  placeholder="e.g. 50"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Up to {unassignedCount > 0 ? unassignedCount : "0"} clients can be fetched directly into your queue.
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setFetchModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="gradient-brand text-white font-bold"
              size="sm"
              disabled={claiming || manualCount <= 0 || unassignedCount === 0}
              onClick={() => claimNextBatch(manualCount, false)}
            >
              {claiming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4 fill-white" />}
              Add {manualCount} Clients
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Interested Candidate Dialog */}
      <CreateInterestedCandidateDialog
        open={createInterestedOpen}
        onOpenChange={setCreateInterestedOpen}
        companyId={companyId}
        employeeId={userId}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ["my-leads"] });
        }}
      />

      {/* Create New Lead (Agent Mode) */}
      <CreateLeadDialog
        open={createLeadOpen}
        onOpenChange={setCreateLeadOpen}
        companyId={companyId}
        employeeId={userId}
        isAgentMode={true}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ["my-leads"] });
        }}
      />

      {/* Move / Edit Diary Dialog */}
      <DiaryDialog
        lead={diaryLead}
        open={Boolean(diaryLead)}
        onOpenChange={(o) => !o && setDiaryLead(null)}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ["my-leads"] });
        }}
      />
    </>
  );
}

function LeadCard({
  lead,
  followUp,
  isBusy,
  onView,
  onUpdate,
  onOutOfService,
  onInterested,
  onDiary,
}: {
  lead: Lead;
  followUp?: { date: string; time: string | null };
  isBusy: boolean;
  onView: () => void;
  onUpdate: () => void;
  onOutOfService: () => void;
  onInterested: () => void;
  onDiary: () => void;
}) {
  const initials = lead.customer_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  const inDiary = isDiaryLead(lead.notes);
  const diaryMeta = parseDiaryData(lead.notes);

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-lg card-elevated border-brand/30">
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-full bg-brand/5 pointer-events-none" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border bg-elevated text-base font-extrabold text-brand shadow-sm">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-extrabold text-foreground">{lead.customer_name}</p>
              <LeadStatusBadge status={lead.status} />
              {inDiary && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 px-2.5 py-0.5 text-xs font-bold shadow-xs">
                  <BookOpen className="h-3 w-3" />
                  <span>DIARY · {diaryMeta?.priority || "HIGH"}</span>
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-sm font-semibold text-muted-foreground">{lead.mobile}</p>
            {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={isBusy}
            onClick={onInterested}
            className="h-9 px-3.5 font-bold gradient-brand text-white shadow-sm"
          >
            <Star className="mr-1.5 h-4 w-4 fill-white" /> Interested
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={onDiary}
            className={cn(
              "h-9 px-3 font-bold transition-all shadow-xs gap-1.5",
              inDiary
                ? "bg-amber-500/15 border-amber-500/40 text-amber-500 hover:bg-amber-500/25"
                : "border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
            )}
            title="Move to Important Diary"
          >
            <BookOpen className="h-4 w-4" />
            <span>{inDiary ? "📔 In Diary" : "📔 Move to Diary"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={onOutOfService}
            className="h-9 px-3 text-destructive border-destructive/30 hover:bg-destructive/10"
            title="Mark Out of Service / Delete"
          >
            <WifiOff className="mr-1.5 h-3.5 w-3.5" /> Out of Service
          </Button>
        </div>
      </div>

      {/* Loan & details bar */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-xl border bg-muted/30 p-3 text-xs">
        <div>
          <span className="text-muted-foreground block text-[11px]">Loan Amount</span>
          <strong className="text-sm font-extrabold text-foreground">{inr(Number(lead.loan_amount))}</strong>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">Loan Type</span>
          <strong className="text-foreground">{lead.loan_type}</strong>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">City</span>
          <strong className="text-foreground">{lead.city || "—"}</strong>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">Folder Date</span>
          <strong className="text-foreground">{lead.folder_date}</strong>
        </div>
      </div>

      {/* Scheduled follow-up pill */}
      {followUp && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span>
            Scheduled follow-up: <strong>{followUp.date}</strong> {followUp.time ? `at ${followUp.time}` : ""}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="h-9 gap-1.5 bg-brand hover:bg-brand/90 text-white font-bold">
            <a href={`tel:${lead.mobile}`}><PhoneCall className="h-4 w-4" /> Call</a>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4 text-success" /> WhatsApp
            </a>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onView} className="h-9">
            Lead Sheet
          </Button>
          <Button size="sm" onClick={onUpdate} className="h-9 gradient-brand text-white font-bold">
            Update Outcome
          </Button>
        </div>
      </div>
    </div>
  );
}
