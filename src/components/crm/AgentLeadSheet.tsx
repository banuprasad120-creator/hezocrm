import { useQuery } from "@tanstack/react-query";
import { History, MessageCircle, PhoneCall } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, inr, type Lead } from "@/lib/crm";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-right text-[13px] font-medium">{v}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-elevated p-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function AgentLeadSheet({
  lead, open, onOpenChange, onUpdate,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdate?: (lead: Lead) => void;
}) {
  const leadId = lead?.id ?? "";

  const { data: calls = [] } = useQuery({
    queryKey: ["call-history", leadId],
    enabled: open && Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase.from("call_history")
        .select("*").eq("lead_id", leadId).order("called_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: statusHistory = [] } = useQuery({
    queryKey: ["status-history", leadId],
    enabled: open && Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_status_history")
        .select("*").eq("lead_id", leadId).order("changed_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["lead-followups", leadId],
    enabled: open && Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase.from("follow_ups")
        .select("*").eq("lead_id", leadId).order("follow_up_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: agentName } = useQuery({
    queryKey: ["lead-agent-name", lead?.assigned_to],
    enabled: open && Boolean(lead?.assigned_to),
    queryFn: async () => {
      const { data } = await supabase.from("profiles")
        .select("full_name, email").eq("id", lead!.assigned_to!).maybeSingle();
      return data?.full_name || data?.email || "—";
    },
  });

  if (!lead) return null;
  const initials = lead.customer_name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto bg-card p-0 sm:max-w-md">
        <SheetHeader className="border-b bg-elevated p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl gradient-brand text-sm font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{lead.customer_name}</SheetTitle>
              <p className="truncate font-mono text-xs text-muted-foreground">{lead.mobile}</p>
            </div>
          </div>
          <div className="mt-3"><LeadStatusBadge status={lead.status} /></div>
          <div className="mt-4 flex gap-2">
            <Button asChild className="h-10 flex-1 gradient-brand text-white">
              <a href={`tel:${lead.mobile}`}><PhoneCall className="mr-1.5 h-4 w-4" /> CALL</a>
            </Button>
            <Button asChild variant="outline" className="h-10">
              <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" />
              </a>
            </Button>
            {onUpdate && (
              <Button variant="outline" className="h-10" onClick={() => onUpdate(lead)}>UPDATE</Button>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-4 p-5">
          <Section title="Customer information">
            <Row k="Mobile" v={lead.mobile} />
            <Row k="Email" v={lead.email ?? "—"} />
            <Row k="City" v={lead.city ?? "—"} />
            <Row k="Source" v={lead.source ?? "—"} />
          </Section>

          <Section title="Loan information">
            <Row k="Loan amount" v={inr(Number(lead.loan_amount))} />
            <Row k="Loan type" v={lead.loan_type} />
            <Row k="Folder date" v={lead.folder_date} />
          </Section>

          <Section title="Assignment">
            <Row k="Current status" v={<LeadStatusBadge status={lead.status} />} />
            <Row k="Assigned agent" v={agentName ?? "Unassigned"} />
            <Row k="Last call" v={lead.last_call_at ? formatDateTime(lead.last_call_at) : "Never"} />
          </Section>

          <Section title={`Call history (${calls.length})`}>
            <div className="mt-2 space-y-2">
              {calls.length === 0 && <p className="text-sm text-muted-foreground">No calls recorded yet.</p>}
              {calls.map((c) => (
                <div key={c.id} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold">{formatDateTime(c.called_at)}</p>
                    <LeadStatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <History className="mr-1 inline h-3 w-3" />
                    {c.call_result}{c.customer_response ? ` · ${c.customer_response}` : ""}
                  </p>
                  {c.notes && <p className="mt-1 text-[13px]">{c.notes}</p>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Status history">
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {statusHistory.length === 0 && <p className="text-sm text-muted-foreground">No status changes yet.</p>}
              {statusHistory.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1.5">
                  {i === 0 && s.old_status && (
                    <><LeadStatusBadge status={s.old_status} /><span className="text-muted-foreground">→</span></>
                  )}
                  <LeadStatusBadge status={s.new_status} />
                  {i < statusHistory.length - 1 && <span className="text-muted-foreground">→</span>}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Follow-ups">
            <div className="mt-2 space-y-2">
              {followUps.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>}
              {followUps.map((f) => (
                <div key={f.id} className="rounded-lg border p-2.5">
                  <p className="text-[13px] font-medium">
                    {f.follow_up_date}{f.follow_up_time ? ` at ${String(f.follow_up_time).slice(0, 5)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{f.is_done ? "Completed" : "Pending"}{f.note ? ` — ${f.note}` : ""}</p>
                </div>
              ))}
            </div>
          </Section>

          <Button asChild variant="outline" className="w-full">
            <Link to="/lead/$leadId" params={{ leadId: lead.id }}>Open full lead page</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
