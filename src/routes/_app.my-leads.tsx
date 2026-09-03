import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CheckCircle2, Clock, Flame, Loader2, MessageCircle,
  PhoneCall, PhoneForwarded, RefreshCw, Star, WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
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
  const qc = useQueryClient();
  const [active, setActive] = useState<Lead | null>(null);
  const [viewLead, setViewLead] = useState<Lead | null>(null);

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

  /* ── Stats ── */
  const stats = useMemo(() => {
    const called = leads.filter((l) => CONTACTED_STATUSES.includes(l.status)).length;
    return {
      assigned: leads.length,
      called,
      pending: leads.length - called,
      interested: leads.filter((l) => l.status === "Interested").length,
    };
  }, [leads]);

  /* ── Current lead = first uncalled lead ── */
  const pendingLeads = useMemo(
    () => leads.filter((l) => !CONTACTED_STATUSES.includes(l.status)),
    [leads],
  );
  const currentLead = pendingLeads[0] ?? null;

  /* ── "Out of Service" — marks lead Wrong Number and unassigns it ── */
  const outOfServiceM = useMutation({
    mutationFn: async (lead: Lead) => {
      const { error } = await supabase.from("leads")
        .update({ status: "Wrong Number", assigned_to: null, last_call_at: new Date().toISOString() })
        .eq("id", lead.id);
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

  const isBusy = outOfServiceM.isPending || interestedM.isPending;

  return (
    <>
      <PageHeader
        title="My Leads"
        description={`${stats.pending} pending · ${stats.called} called · ${stats.assigned} total`}
        actions={<Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-1 h-4 w-4" /> Refresh</Button>}
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
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Lead — {pendingLeads.length} remaining
              </p>
              <LeadCard
                lead={currentLead}
                followUp={followUpByLead.get(currentLead.id)}
                isBusy={isBusy}
                onView={() => setViewLead(currentLead)}
                onUpdate={() => setActive(currentLead)}
                onOutOfService={() => outOfServiceM.mutate(currentLead)}
                onInterested={() => interestedM.mutate(currentLead)}
              />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border bg-card p-12 text-center card-elevated">
              <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
              <p className="text-lg font-bold text-foreground">All done for now! 🎉</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You've worked through all pending leads. Your admin will assign more soon.
              </p>
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
                  .map((l) => (
                    <div
                      key={l.id}
                      className="cursor-pointer rounded-2xl border bg-card/60 p-4 card-elevated opacity-80 hover:opacity-100 transition-opacity"
                      onClick={() => setViewLead(l)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{l.customer_name}</p>
                          <p className="text-xs text-muted-foreground">{l.mobile}</p>
                        </div>
                        <LeadStatusBadge status={l.status} />
                      </div>
                      {l.status === "Interested" && (
                        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-success">
                          <Star className="h-3.5 w-3.5 fill-success" /> Interested
                        </p>
                      )}
                      {followUpByLead.get(l.id) && (
                        <p className="mt-1 text-xs text-warning">
                          <CalendarClock className="mr-1 inline h-3 w-3" />
                          {followUpByLead.get(l.id)!.date}
                        </p>
                      )}
                    </div>
                  ))}
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


