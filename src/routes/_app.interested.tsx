import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, CalendarClock, CreditCard, Download, Eye, Flame, Landmark,
  Loader2, MessageCircle, Phone, PhoneCall, RefreshCw, Search, Sparkles, User,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import { InterestedLeadDialog } from "@/components/crm/InterestedLeadDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { formatDateTime, inr, type Lead } from "@/lib/crm";
import { parseInterestedData, TOP_BANKS } from "@/lib/interested-lead";

export const Route = createFileRoute("/_app/interested")({
  head: () => ({
    meta: [
      { title: "Interested Leads — Hezo CRM" },
      { name: "description", content: "Customers who accepted service. View existing loans, credit cards and bank profiles." },
      { property: "og:title", content: "Interested Leads — Hezo CRM" },
      { property: "og:description", content: "Track interested leads, banks and loan requirements." },
    ],
  }),
  component: InterestedLeadsPage,
});

function InterestedLeadsPage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const isAdmin = session?.isAdmin ?? false;
  const companyId = session?.companyId ?? null;
  const userId = session?.userId ?? null;

  const [q, setQ] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [selectedBank, setSelectedBank] = useState("all");
  const [folderDate, setFolderDate] = useState("");
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Fetch all leads with status "Interested"
  const { data: rawLeads = [], isLoading, refetch } = useQuery({
    queryKey: ["interested-leads", companyId, userId, isAdmin],
    enabled: Boolean(companyId || userId),
    queryFn: async () => {
      let query = supabase.from("leads").select("*").eq("status", "Interested");
      if (companyId) query = query.eq("company_id", companyId);
      if (!isAdmin && userId) query = query.eq("assigned_to", userId);
      query = query.order("last_call_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  // Map of agent profiles
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      map.set(a.id, a.full_name || a.email || "Agent");
    }
    return map;
  }, [agents]);

  // Enrich leads with parsed questionnaire data
  const enrichedLeads = useMemo(() => {
    return rawLeads.map((lead) => {
      const parsed = parseInterestedData(lead.notes);
      return {
        ...lead,
        interestedData: parsed,
        agentName: lead.assigned_to ? agentMap.get(lead.assigned_to) || "Assigned Agent" : "Unassigned",
      };
    });
  }, [rawLeads, agentMap]);

  // Filtered leads
  const filteredLeads = useMemo(() => {
    const term = q.trim().toLowerCase();
    return enrichedLeads.filter((l) => {
      if (term) {
        const matchesName = l.customer_name.toLowerCase().includes(term);
        const matchesPhone = l.mobile.includes(term);
        const matchesCity = (l.city || "").toLowerCase().includes(term);
        const matchesNotes = (l.notes || "").toLowerCase().includes(term);
        if (!matchesName && !matchesPhone && !matchesCity && !matchesNotes) return false;
      }
      if (selectedAgent !== "all" && l.assigned_to !== selectedAgent) return false;
      if (folderDate && l.folder_date !== folderDate) return false;
      if (selectedBank !== "all") {
        const data = l.interestedData;
        const hasInLoans = data?.loans?.some((loan) => loan.bank.toLowerCase().includes(selectedBank.toLowerCase()));
        const hasInCards = data?.creditCards?.some((card) => card.bank.toLowerCase().includes(selectedBank.toLowerCase()));
        if (!hasInLoans && !hasInCards) return false;
      }
      return true;
    });
  }, [enrichedLeads, q, selectedAgent, selectedBank, folderDate]);

  // Metrics
  const metrics = useMemo(() => {
    let totalReqAmount = 0;
    let totalLoansCount = 0;
    let totalCardsCount = 0;

    for (const l of filteredLeads) {
      totalReqAmount += Number(l.loan_amount) || 0;
      if (l.interestedData?.hasExistingLoans) {
        totalLoansCount += l.interestedData.loans?.length || 0;
      }
      if (l.interestedData?.hasCreditCards) {
        totalCardsCount += l.interestedData.creditCards?.length || 0;
      }
    }

    return {
      count: filteredLeads.length,
      totalReqAmount,
      totalLoansCount,
      totalCardsCount,
    };
  }, [filteredLeads]);

  // CSV Export
  const exportCSV = () => {
    if (filteredLeads.length === 0) {
      toast.error("No leads to export");
      return;
    }

    const headers = [
      "Customer Name", "Mobile", "City", "Service Required", "Required Amount",
      "Service Years", "Employer", "Monthly Income",
      "Existing Loans Count", "Existing Loans Details",
      "Credit Cards Count", "Credit Cards Details",
      "Assigned Agent", "Folder Date", "Last Call Date", "Notes"
    ];

    const rows = filteredLeads.map((l) => {
      const data = l.interestedData;
      const loanDetails = data?.loans?.map((ln) => `${ln.bank} (${ln.loanType}${ln.amount ? `: Rs.${ln.amount}` : ""})`).join("; ") || "None";
      const cardDetails = data?.creditCards?.map((cd) => `${cd.bank}${cd.limit ? ` (Limit: Rs.${cd.limit})` : ""}`).join("; ") || "None";

      return [
        `"${l.customer_name.replace(/"/g, '""')}"`,
        `"${l.mobile}"`,
        `"${l.city || ""}"`,
        `"${l.loan_type}"`,
        `"${l.loan_amount || ""}"`,
        `"${data?.serviceYears || ""}"`,
        `"${l.employer || ""}"`,
        `"${l.monthly_income || ""}"`,
        `"${data?.loans?.length || 0}"`,
        `"${loanDetails.replace(/"/g, '""')}"`,
        `"${data?.creditCards?.length || 0}"`,
        `"${cardDetails.replace(/"/g, '""')}"`,
        `"${l.agentName}"`,
        `"${l.folder_date}"`,
        `"${l.last_call_at ? formatDateTime(l.last_call_at) : ""}"`,
        `"${(l.notes || "").replace(/"/g, '""')}"`,
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Interested_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Interested leads exported successfully!");
  };

  return (
    <>
      <PageHeader
        title="Interested Leads"
        description="Customers who accepted service. View captured existing loans, banks and credit cards."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} className="h-9">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Interested Leads" value={metrics.count} icon={Flame} tone="success" />
        <StatCard label="Total Requirement" value={inr(metrics.totalReqAmount)} icon={Landmark} tone="brand" />
        <StatCard label="Existing Loans Tracked" value={metrics.totalLoansCount} icon={Building2} tone="warning" />
        <StatCard label="Credit Cards Tracked" value={metrics.totalCardsCount} icon={CreditCard} tone="info" />
      </div>

      {/* Filter Bar */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, mobile, city, bank…"
            className="h-9 bg-card pl-9 text-xs sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="h-9 text-xs w-[140px]"><SelectValue placeholder="All Agents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={selectedBank} onValueChange={setSelectedBank}>
            <SelectTrigger className="h-9 text-xs w-[140px]"><SelectValue placeholder="All Banks" /></SelectTrigger>
            <SelectContent className="max-h-56">
              <SelectItem value="all">All Banks</SelectItem>
              {TOP_BANKS.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={folderDate}
            onChange={(e) => setFolderDate(e.target.value)}
            className="h-9 text-xs w-[130px]"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && filteredLeads.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border bg-card p-12 text-center card-elevated">
          <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-base font-bold text-foreground">No interested leads found</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            When agents call customers and mark them as <strong>Interested</strong>, they will appear here with existing loans and credit card details.
          </p>
        </div>
      )}

      {/* Leads List */}
      {!isLoading && filteredLeads.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredLeads.map((lead) => {
              const data = lead.interestedData;
              const hasLoans = data?.hasExistingLoans && data.loans?.length > 0;
              const hasCards = data?.hasCreditCards && data.creditCards?.length > 0;

              return (
                <div
                  key={lead.id}
                  className="rounded-2xl border bg-card p-5 shadow-sm card-elevated flex flex-col justify-between hover:border-brand/40 transition-colors"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 border-b pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-base text-foreground">{lead.customer_name}</span>
                          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success flex items-center gap-1">
                            <Flame className="h-3 w-3 fill-success" /> Interested
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          📞 {lead.mobile} {lead.city ? `· 📍 ${lead.city}` : ""}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-extrabold text-brand">{inr(Number(lead.loan_amount))}</p>
                        <p className="text-[11px] text-muted-foreground">{lead.loan_type}</p>
                      </div>
                    </div>

                    {/* Breakdown of Loans & Cards */}
                    <div className="mt-3.5 space-y-3">
                      {/* Existing Loans */}
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5 mb-1.5">
                          <Building2 className="h-3.5 w-3.5" />
                          Existing Loans: {hasLoans ? `${data!.loans.length} Loan(s)` : "None"}
                        </p>
                        {hasLoans ? (
                          <div className="space-y-1.5 text-xs">
                            {data!.loans.map((ln, i) => (
                              <div key={i} className="flex items-center justify-between border-b border-muted/50 pb-1 last:border-0 last:pb-0">
                                <span className="font-semibold text-foreground">
                                  {ln.bank} <span className="text-[11px] text-muted-foreground">({ln.loanType})</span>
                                </span>
                                <span className="text-muted-foreground font-mono text-[11px]">
                                  {ln.amount ? inr(Number(ln.amount)) : "—"} {ln.emi ? `· EMI: ${inr(Number(ln.emi))}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No active loans reported by customer.</p>
                        )}
                      </div>

                      {/* Existing Credit Cards */}
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-sky-500 flex items-center gap-1.5 mb-1.5">
                          <CreditCard className="h-3.5 w-3.5" />
                          Existing Credit Cards: {hasCards ? `${data!.creditCards.length} Card(s)` : "None"}
                        </p>
                        {hasCards ? (
                          <div className="space-y-1.5 text-xs">
                            {data!.creditCards.map((cd, i) => (
                              <div key={i} className="flex items-center justify-between border-b border-muted/50 pb-1 last:border-0 last:pb-0">
                                <span className="font-semibold text-foreground">{cd.bank}</span>
                                <span className="text-muted-foreground font-mono text-[11px]">
                                  {cd.limit ? `Limit: ${inr(Number(cd.limit))}` : ""} {cd.outstanding ? `· Dues: ${inr(Number(cd.outstanding))}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No active credit cards reported by customer.</p>
                        )}
                      </div>

                      {/* Service Years & Employment Info */}
                      {(data?.serviceYears || lead.employer || lead.monthly_income) && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded-xl p-2.5">
                          {data?.serviceYears && (
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              💼 Service: <strong className="text-brand">{data.serviceYears} Year(s)</strong>
                            </span>
                          )}
                          {lead.employer && <span>🏢 {lead.employer}</span>}
                          {lead.monthly_income && <span>💰 ₹{Number(lead.monthly_income).toLocaleString("en-IN")}/mo</span>}
                        </div>
                      )}

                      {/* Notes / Remarks */}
                      {data?.notes && (
                        <p className="text-xs text-muted-foreground bg-muted/10 rounded-lg p-2 italic">
                          "{data.notes}"
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footer & Actions */}
                  <div className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">
                      <span>Agent: <strong className="text-foreground">{lead.agentName}</strong></span>
                      {lead.last_call_at && (
                        <span> · {formatDateTime(lead.last_call_at)}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button asChild size="sm" className="h-8 gradient-brand text-white text-xs font-bold">
                        <a href={`tel:${lead.mobile}`}>
                          <PhoneCall className="mr-1 h-3.5 w-3.5" /> Call
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                        <a href={`https://wa.me/${lead.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setViewLead(lead)}>
                        View
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs font-semibold" onClick={() => setEditLead(lead)}>
                        Edit Info
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View Lead Sheet */}
      <AgentLeadSheet
        lead={viewLead}
        open={Boolean(viewLead)}
        onOpenChange={(o) => !o && setViewLead(null)}
        onUpdate={(l) => { setViewLead(null); setEditLead(l); }}
      />

      {/* Edit Interested Lead Dialog */}
      <InterestedLeadDialog
        lead={editLead}
        employeeId={userId || ""}
        open={Boolean(editLead)}
        onOpenChange={(o) => !o && setEditLead(null)}
        onSuccess={() => refetch()}
      />
    </>
  );
}
