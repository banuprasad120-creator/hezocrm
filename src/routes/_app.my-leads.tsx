import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CheckCircle2, Clock, Flame, Loader2, MessageCircle,
  PhoneCall, PhoneForwarded, RefreshCw, Star, WifiOff, Zap, Sparkles,
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
import { parseInterestedData } from "@/lib/interested-lead";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, inr, type Lead } from "@/lib/crm";

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
  const [autoRefill, setAutoRefill] = useState(true);
  const [claiming, setClaiming] = useState(false);

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

  /* ── Deduplicate leads by 10-digit mobile number so agent never sees repeated phone numbers ── */
  const uniqueLeads = useMemo(() => {
    const seen = new Set<string>();
    const out: Lead[] = [];
    for (const l of leads) {
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

  /* ── "Out of Service" — marks lead Wrong Number and unassigns it ── */
  const outOfServiceM = useMutation({
    mutationFn: async (lead: Lead) => {
      const cleanMobile = lead.mobile.trim();
      const { error } = await supabase.from("leads")
        .update({ status: "Wrong Number", assigned_to: null, last_call_at: new Date().toISOString() })
        .eq("mobile", cleanMobile)
        .eq("company_id", lead.company_id);
      if (error) throw error;
      // Log call history
      await supabase.from("call_history").insert({
        lead_id: lead.id,
        company_id: lead.company_id,
        employee_id: userId!,
        call_result: "Wrong Number",
        customer_response: null,
        status: "Wrong Number",
        notes: "Number out of service",
      });
    },
    onSuccess: () => {
      toast.success("Lead removed — number marked as out of service");
      qc.invalidateQueries({ queryKey: ["my-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── "Interested" quick action ── */
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

  /* ── Automated / On-demand Lead Claiming & Assignment ── */
  const claimNextLeads = async (count = 10, isAutomatic = false) => {
    if (!companyId || !userId || claiming) return;
    setClaiming(true);
    try {
      // 1. Fetch all mobile numbers that have EVER been assigned or called in the company
      const { data: historyLeads } = await supabase
        .from("leads")
        .select("mobile")
        .eq("company_id", companyId)
        .or("assigned_to.not.is.null,last_call_at.not.is.null,status.neq.New");

      const alreadySentMobiles = new Set<string>();
      for (const item of historyLeads ?? []) {
        const clean = (item.mobile || "").replace(/\D/g, "").slice(-10);
        if (clean) alreadySentMobiles.add(clean);
      }

      // 2. Find fresh unassigned leads in this company (from latest folder)
      const { data: unassigned, error } = await supabase
        .from("leads")
        .select("id, mobile")
        .eq("company_id", companyId)
        .is("assigned_to", null)
        .order("folder_date", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(count * 5);

      if (error) throw error;
      if (!unassigned || unassigned.length === 0) {
        if (!isAutomatic) toast.info("No fresh unassigned leads available in company folders right now.");
        return;
      }

      // Deduplicate by clean mobile number AND strictly exclude already sent numbers
      const seen = new Set<string>();
      const idsToClaim: string[] = [];
      for (const item of unassigned) {
        const cleanMob = (item.mobile || "").replace(/\D/g, "").slice(-10);
        if (cleanMob) {
          // STRICT RULE: Never re-send numbers that have ever been assigned or called to any agent!
          if (alreadySentMobiles.has(cleanMob)) continue;

          if (!seen.has(cleanMob)) {
            seen.add(cleanMob);
            idsToClaim.push(item.id);
            if (idsToClaim.length >= count) break;
          }
        } else {
          idsToClaim.push(item.id);
          if (idsToClaim.length >= count) break;
        }
      }

      if (idsToClaim.length === 0) {
        if (!isAutomatic) toast.info("All available leads in this folder have already been contacted. Please import fresh leads.");
        return;
      }

      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("leads")
        .update({ assigned_to: userId, assigned_at: now, status: "Assigned" })
        .in("id", idsToClaim)
        .eq("company_id", companyId);
      if (updErr) throw updErr;

      // Record lead assignments history
      await supabase.from("lead_assignments").upsert(
        idsToClaim.map((id) => ({
          lead_id: id,
          company_id: companyId,
          employee_id: userId,
          assigned_by: userId,
        })),
        { onConflict: "lead_id" }
      );

      toast.success(`⚡ Automated refill: ${idsToClaim.length} new leads assigned to your queue!`);
      await qc.invalidateQueries({ queryKey: ["my-leads"] });
    } catch (err) {
      console.error("Auto claim error:", err);
      if (!isAutomatic) toast.error(err instanceof Error ? err.message : "Failed to claim leads");
    } finally {
      setClaiming(false);
    }
  };

  // Automated trigger: When an agent finishes all pending leads, auto-assign next 10 leads!
  useEffect(() => {
    if (!isLoading && leads.length > 0 && pendingLeads.length === 0 && autoRefill && !claiming) {
      claimNextLeads(10, true);
    }
  }, [isLoading, leads.length, pendingLeads.length, autoRefill]);

  const isBusy = outOfServiceM.isPending || interestedM.isPending || claiming;

  return (
    <>
      <PageHeader
        title="My Leads"
        description={`${stats.pending} pending · ${stats.called} called · ${stats.assigned} total`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={claiming}
              onClick={() => claimNextLeads(10, false)}
              className="h-9 font-bold border-brand/40 text-brand hover:bg-brand/10"
            >
              {claiming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5 fill-brand" />}
              Fetch +10 Leads
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
                  Current Lead — {pendingLeads.length} remaining
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>⚡ Auto-Refill:</span>
                  <Switch checked={autoRefill} onCheckedChange={setAutoRefill} className="scale-75" />
                </div>
              </div>
              <LeadCard
                lead={currentLead}
                followUp={followUpByLead.get(currentLead.id)}
                isBusy={isBusy}
                onView={() => setViewLead(currentLead)}
                onUpdate={() => setActive(currentLead)}
                onOutOfService={() => outOfServiceM.mutate(currentLead)}
                onInterested={() => setInterestedLead(currentLead)}
              />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border bg-card p-10 text-center card-elevated space-y-4">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
                {claiming ? <Loader2 className="h-8 w-8 animate-spin" /> : <CheckCircle2 className="h-8 w-8" />}
              </div>
              <div>
                <p className="text-xl font-extrabold text-foreground">
                  {claiming ? "Fetching New Leads Automatically… ⚡" : "All Assigned Leads Completed! 🎉"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                  {claiming
                    ? "Pulling the next batch of fresh unassigned leads for you right now."
                    : "Great job! Click below to pull the next unassigned batch or keep auto-refill enabled."}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button
                  onClick={() => claimNextLeads(10, false)}
                  disabled={claiming}
                  className="gradient-brand text-white font-bold h-11 px-5 shadow-md"
                >
                  <Zap className="mr-2 h-4 w-4 fill-white" /> Claim Next 10 Leads
                </Button>
                <Button
                  onClick={() => claimNextLeads(25, false)}
                  disabled={claiming}
                  variant="outline"
                  className="font-bold h-11 px-5 border-brand/40 text-brand hover:bg-brand/10"
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Claim Next 25 Leads
                </Button>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                <span>⚡ Auto-refill next leads on completion:</span>
                <Switch checked={autoRefill} onCheckedChange={setAutoRefill} />
              </div>
            </div>
          )}

          {/* ── Completed / Interested leads summary ── */}
          {stats.called > 0 && (
            <div className="mt-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Completed Leads ({stats.called})
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
                                💼 Experience: <strong className="text-foreground">{intData.serviceYears} yrs</strong>
                              </div>
                            )}
                            {(intData?.hasExistingLoans || intData?.hasCreditCards) && (
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                {intData?.hasExistingLoans && <span>🏛️ {intData.loans.length} Loans</span>}
                                {intData?.hasCreditCards && <span>💳 {intData.creditCards.length} Cards</span>}
                              </div>
                            )}
                            {followUpByLead.get(l.id) && (
                              <p className="text-xs text-warning font-semibold">
                                <CalendarClock className="mr-1 inline h-3 w-3" />
                                {followUpByLead.get(l.id)!.date}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-3 pt-2.5 border-t flex items-center justify-between gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setViewLead(l)}>
                            View Details
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 font-semibold"
                            onClick={() => {
                              if (l.status === "Interested") {
                                setInterestedLead(l);
                              } else {
                                setActive(l);
                              }
                            }}
                          >
                            Update
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

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

      <InterestedLeadDialog
        lead={interestedLead}
        employeeId={userId ?? ""}
        open={Boolean(interestedLead)}
        onOpenChange={(o) => !o && setInterestedLead(null)}
        onSuccess={() => {
          setInterestedLead(null);
          refetch();
        }}
      />
    </>
  );
}

/* ── LeadCard component — shows ONE lead with all action buttons ── */
function LeadCard({
  lead, followUp, isBusy, onView, onUpdate, onOutOfService, onInterested,
}: {
  lead: Lead;
  followUp?: { date: string; time: string | null };
  isBusy: boolean;
  onView: () => void;
  onUpdate: () => void;
  onOutOfService: () => void;
  onInterested: () => void;
}) {
  const intData = parseInterestedData(lead.notes);

  return (
    <div className="rounded-2xl border-2 border-brand/30 bg-card p-5 shadow-lg card-elevated">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onView} className="truncate text-lg font-extrabold hover:underline text-left w-full">
            {lead.customer_name}
          </button>
          <p className="mt-0.5 text-base font-semibold text-muted-foreground">📞 {lead.mobile}</p>
          <p className="text-sm">
            Loan: <span className="font-bold text-foreground">{inr(Number(lead.loan_amount))}</span>
          </p>
          <p className="text-xs text-muted-foreground">{lead.loan_type}{lead.city ? ` · ${lead.city}` : ""}</p>
          
          {/* If already has CIBIL / updated data */}
          {intData && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs bg-muted/30 rounded-lg p-2">
              {intData.cibilScore && <span className="font-bold text-indigo-500">🛡️ CIBIL: {intData.cibilScore}</span>}
              {intData.salaryBank && <span>🏦 {intData.salaryBank}</span>}
              {intData.serviceYears && <span>💼 {intData.serviceYears} yrs</span>}
            </div>
          )}

          {followUp && (
            <p className="mt-1 text-xs font-semibold text-warning">
              <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
              Follow-up: {followUp.date}{followUp.time ? ` at ${String(followUp.time).slice(0, 5)}` : ""}
            </p>
          )}
        </div>
        <LeadStatusBadge status={lead.status} />
      </div>

      {/* Primary: CALL button */}
      <div className="mt-5 space-y-2.5">
        <Button asChild className="h-14 w-full gradient-brand text-lg font-extrabold text-white shadow-md">
          <a href={`tel:${lead.mobile}`}>
            <PhoneCall className="mr-2 h-6 w-6" /> CALL NOW
          </a>
        </Button>

        {/* Quick action buttons */}
        <div className="grid grid-cols-2 gap-2">
          {/* INTERESTED */}
          <Button
            className="h-12 w-full bg-success/15 border border-success/30 text-success font-bold hover:bg-success/25"
            variant="outline"
            disabled={isBusy}
            onClick={onInterested}
          >
            {isBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Star className="mr-2 h-4 w-4 fill-success" />
            )}
            INTERESTED
          </Button>

          {/* OUT OF SERVICE */}
          <Button
            className="h-12 w-full bg-destructive/10 border border-destructive/30 text-destructive font-bold hover:bg-destructive/20"
            variant="outline"
            disabled={isBusy}
            onClick={onOutOfService}
          >
            <WifiOff className="mr-2 h-4 w-4" />
            OUT OF SERVICE
          </Button>
        </div>

        {/* Secondary actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button asChild variant="outline" className="h-10">
            <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="outline" className="h-10" onClick={onView}>VIEW</Button>
          <Button variant="outline" className="h-10 font-semibold" onClick={onUpdate}>UPDATE</Button>
        </div>
      </div>
    </div>
  );
}


