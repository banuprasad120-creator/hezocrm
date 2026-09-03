import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, CreditCard, Flame, History, PhoneCall } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { formatDateTime, inr, type Lead } from "@/lib/crm";
import { parseInterestedData } from "@/lib/interested-lead";

export const Route = createFileRoute("/_app/lead/$leadId")({
  head: () => ({
    meta: [
      { title: "Lead details — Hezo CRM" },
      { name: "description", content: "Complete lead profile with full call history, status history and scheduled follow-ups." },
      { property: "og:title", content: "Lead details — Hezo CRM" },
      { property: "og:description", content: "Every call, status change and follow-up for a single lead." },
    ],
  }),
  component: LeadDetail,
  errorComponent: () => <p className="p-6 text-sm text-muted-foreground">This lead could not be loaded — it may not be assigned to you.</p>,
});

function LeadDetail() {
  const { leadId } = useParams({ from: "/_app/lead/$leadId" });
  const { data: session } = useCrmSession();
  const [open, setOpen] = useState(false);

  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (error) throw error;
      return data as Lead | null;
    },
  });

  const interestedData = parseInterestedData(lead?.notes);

  const { data: calls = [] } = useQuery({
    queryKey: ["call-history", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("call_history")
        .select("*").eq("lead_id", leadId).order("called_at", { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((c) => c.employee_id))];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        for (const p of profs ?? []) names.set(p.id, p.full_name || p.email);
      }
      return (data ?? []).map((c) => ({ ...c, agentName: names.get(c.employee_id) ?? "—" }));
    },
  });


  const { data: statusHistory = [] } = useQuery({
    queryKey: ["status-history", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_status_history")
        .select("*").eq("lead_id", leadId).order("changed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["lead-followups", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("follow_ups")
        .select("*").eq("lead_id", leadId).order("follow_up_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!lead) return <p className="text-sm text-muted-foreground">Loading lead…</p>;

  const canUpdate = session?.isAdmin || lead.assigned_to === session?.userId;

  return (
    <>
      <PageHeader
        title={lead.customer_name}
        description={`${lead.mobile} · ${lead.loan_type} · ${inr(Number(lead.loan_amount))}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link to="/my-leads"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back</Link>
            </Button>
            <Button asChild size="sm" className="h-9 gradient-brand text-xs font-bold text-white shadow-sm sm:text-sm">
              <a href={`tel:${lead.mobile}`}><PhoneCall className="mr-1 h-3.5 w-3.5" /> CALL</a>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 text-xs sm:text-sm">
              <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </Button>
            {canUpdate && (
              <Button size="sm" variant="outline" className="h-9 font-semibold text-xs sm:text-sm" onClick={() => setOpen(true)}>
                UPDATE
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <div className="rounded-2xl border bg-card p-5 card-elevated">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Current status</p>
              <LeadStatusBadge status={lead.status} />
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row k="Mobile" v={lead.mobile} />
              <Row k="Loan amount" v={inr(Number(lead.loan_amount))} />
              <Row k="Loan type" v={lead.loan_type} />
              <Row k="City" v={lead.city ?? "—"} />
              <Row k="Source" v={lead.source ?? "—"} />
              <Row k="Folder" v={lead.folder_date} />
              <Row k="Last call" v={lead.last_call_at ? formatDateTime(lead.last_call_at) : "Never"} />
            </dl>
          </div>

          {interestedData && (
            <div className="rounded-2xl border bg-card p-5 card-elevated space-y-3">
              <p className="text-sm font-semibold flex items-center gap-1.5 text-success">
                <Flame className="h-4 w-4 fill-success" /> Service Accepted Portfolio
              </p>

              <div className="rounded-xl border bg-success/10 p-3 text-xs space-y-1">
                <p className="font-bold text-success">Requirement: {interestedData.serviceRequired}</p>
                {interestedData.requiredAmount && (
                  <p className="text-foreground">Required Amount: <strong>{inr(Number(interestedData.requiredAmount))}</strong></p>
                )}
                {interestedData.cibilScore && (
                  <p className="text-foreground font-semibold">
                    🛡️ CIBIL / Credit Score: <strong className="text-indigo-500">{interestedData.cibilScore}</strong>
                  </p>
                )}
                {interestedData.employmentType && (
                  <p className="text-muted-foreground">Employment: <strong>{interestedData.employmentType}</strong></p>
                )}
                {interestedData.salaryBank && (
                  <p className="text-indigo-600 font-semibold">🏦 Salary Bank: <strong>{interestedData.salaryBank}</strong></p>
                )}
                {interestedData.bankAccounts && interestedData.bankAccounts.length > 0 && (
                  <p className="text-muted-foreground text-[11px]">Other Accounts: {interestedData.bankAccounts.join(", ")}</p>
                )}
                {interestedData.monthlyIncome && (
                  <p className="text-muted-foreground">Monthly Income: ₹{Number(interestedData.monthlyIncome).toLocaleString("en-IN")}</p>
                )}
                {interestedData.employer && (
                  <p className="text-muted-foreground">Employer: {interestedData.employer}</p>
                )}
                {interestedData.serviceYears && (
                  <p className="text-muted-foreground font-medium">
                    Service Experience: <strong>{interestedData.serviceYears} Year(s)</strong>
                  </p>
                )}
              </div>

              {/* Loans */}
              <div className="rounded-xl border bg-muted/20 p-3 text-xs space-y-1.5">
                <p className="font-bold text-amber-500 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> Existing Loans ({interestedData.hasExistingLoans ? interestedData.loans.length : 0})
                </p>
                {interestedData.hasExistingLoans && interestedData.loans.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    {interestedData.loans.map((ln, i) => (
                      <div key={i} className="flex items-center justify-between border-b border-muted/50 pb-1 last:border-0 last:pb-0">
                        <span className="font-semibold">{ln.bank} ({ln.loanType})</span>
                        <span className="text-muted-foreground font-mono">{ln.amount ? inr(Number(ln.amount)) : "—"} {ln.emi ? `· EMI: ${inr(Number(ln.emi))}` : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No existing loans</p>
                )}
              </div>

              {/* Credit Cards */}
              <div className="rounded-xl border bg-muted/20 p-3 text-xs space-y-1.5">
                <p className="font-bold text-sky-500 flex items-center gap-1">
                  <CreditCard className="h-3.5 w-3.5" /> Existing Credit Cards ({interestedData.hasCreditCards ? interestedData.creditCards.length : 0})
                </p>
                {interestedData.hasCreditCards && interestedData.creditCards.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    {interestedData.creditCards.map((cd, i) => (
                      <div key={i} className="flex items-center justify-between border-b border-muted/50 pb-1 last:border-0 last:pb-0">
                        <span className="font-semibold">{cd.bank}</span>
                        <span className="text-muted-foreground font-mono">{cd.limit ? `Limit: ${inr(Number(cd.limit))}` : ""} {cd.outstanding ? `· Due: ${inr(Number(cd.outstanding))}` : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No credit cards</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-5 card-elevated">
            <p className="text-sm font-semibold">Follow-ups</p>
            <div className="mt-3 space-y-2 text-sm">
              {followUps.length === 0 && <p className="text-muted-foreground">No follow-ups scheduled.</p>}
              {followUps.map((f) => (
                <div key={f.id} className="rounded-lg border p-2.5">
                  <p className="font-medium">{f.follow_up_date}{f.follow_up_time ? ` at ${String(f.follow_up_time).slice(0, 5)}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{f.is_done ? "Completed" : "Pending"}{f.note ? ` — ${f.note}` : ""}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border bg-card p-5 card-elevated">
            <p className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Call history ({calls.length})</p>
            <ol className="mt-4 space-y-3">
              {calls.length === 0 && <p className="text-sm text-muted-foreground">No calls recorded yet.</p>}
              {calls.map((c) => (
                <li key={c.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{formatDateTime(c.called_at)}</p>
                    <LeadStatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agent: {c.agentName} · Result: {c.call_result}
                    {c.customer_response ? ` · Response: ${c.customer_response}` : ""}
                  </p>
                  {c.notes && <p className="mt-1.5 text-sm">{c.notes}</p>}
                </li>
              ))}

            </ol>
          </div>

          <div className="rounded-2xl border bg-card p-5 card-elevated">
            <p className="text-sm font-semibold">Status history</p>
            <ol className="mt-3 space-y-2 text-sm">
              {statusHistory.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                  <span className="text-xs text-muted-foreground">{formatDateTime(s.changed_at)}</span>
                  {s.old_status && <><LeadStatusBadge status={s.old_status} /><span className="text-muted-foreground">→</span></>}
                  <LeadStatusBadge status={s.new_status} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <CallUpdateDialog lead={lead} employeeId={session?.userId ?? ""} open={open} onOpenChange={setOpen} />
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
