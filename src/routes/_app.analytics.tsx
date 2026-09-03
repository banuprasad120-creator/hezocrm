import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download, Eye, Flame, MessageCircle, Phone, PhoneCall, Search,
  TrendingUp, Users, ShieldCheck, User, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/common/StatCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, CUSTOMER_RESPONSES, formatDateTime, inr, todayISO, type Lead } from "@/lib/crm";
import { parseInterestedData } from "@/lib/interested-lead";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics & Connected Calls — Hezo CRM" },
      { name: "description", content: "Live call reports, connected customer list, conversion and team performance." },
      { property: "og:title", content: "Analytics & Connected Calls — Hezo CRM" },
      { property: "og:description", content: "Live call and connected customer reports for your call center." },
    ],
  }),
  component: AnalyticsPage,
});

function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface CallHistoryItem {
  id: string;
  called_at: string;
  call_result: string;
  customer_response: string | null;
  status: string;
  notes: string | null;
  employee_id: string;
  lead_id: string;
  leads: Lead | null;
}

function AnalyticsPage() {
  const { data: session } = useCrmSession();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const [range, setRange] = useState("14");
  const days = Number(range);
  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Filters for connected list
  const [searchQuery, setSearchQuery] = useState("");
  const [responseFilter, setResponseFilter] = useState("all");
  const [viewLead, setViewLead] = useState<Lead | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", companyId, days],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const fromDate = daysAgoISO(days - 1);
      const fromTs = new Date(`${fromDate}T00:00:00`).toISOString();

      const [callsRes, leadsRes] = await Promise.all([
        supabase.from("call_history")
          .select("called_at, call_result, employee_id")
          .gte("called_at", fromTs)
          .order("called_at", { ascending: true })
          .limit(20000),
        supabase.from("leads")
          .select("status, folder_date")
          .gte("folder_date", fromDate)
          .limit(20000),
      ]);
      if (callsRes.error) throw callsRes.error;
      if (leadsRes.error) throw leadsRes.error;

      const calls = callsRes.data ?? [];
      const leads = leadsRes.data ?? [];

      const byDay = new Map<string, { day: string; calls: number; connected: number }>();
      for (let i = days - 1; i >= 0; i--) {
        const d = daysAgoISO(i);
        byDay.set(d, { day: d.slice(5), calls: 0, connected: 0 });
      }
      for (const c of calls) {
        const key = new Date(c.called_at).toISOString().slice(0, 10);
        const row = byDay.get(key);
        if (!row) continue;
        row.calls += 1;
        if (c.call_result === "Connected") row.connected += 1;
      }

      const perAgent = new Map<string, number>();
      for (const c of calls) perAgent.set(c.employee_id, (perAgent.get(c.employee_id) ?? 0) + 1);

      const statusCounts = new Map<string, number>();
      for (const l of leads) statusCounts.set(l.status, (statusCounts.get(l.status) ?? 0) + 1);

      const contacted = leads.filter((l) => CONTACTED_STATUSES.includes(l.status)).length;
      const interested = leads.filter((l) => l.status === "Interested" || l.status === "Approved" || l.status === "Disbursed").length;

      return {
        series: [...byDay.values()],
        totalCalls: calls.length,
        connected: calls.filter((c) => c.call_result === "Connected").length,
        totalLeads: leads.length,
        contacted,
        interested,
        perAgent,
        statusRows: [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([status, count]) => ({ status, count })),
      };
    },
  });

  // Query detailed connected call records
  const { data: connectedCalls = [], isLoading: callsLoading } = useQuery({
    queryKey: ["connected-calls-detail", companyId, days],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const fromDate = daysAgoISO(days - 1);
      const fromTs = new Date(`${fromDate}T00:00:00`).toISOString();

      const { data, error } = await supabase
        .from("call_history")
        .select("id, called_at, call_result, customer_response, status, notes, employee_id, lead_id, leads(*)")
        .eq("company_id", companyId!)
        .eq("call_result", "Connected")
        .gte("called_at", fromTs)
        .order("called_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return (data ?? []) as unknown as CallHistoryItem[];
    },
  });

  const agentMap = useMemo(() => {
    return new Map(agents.map((a) => [a.id, a.full_name || a.email]));
  }, [agents]);

  const filteredConnectedCalls = useMemo(() => {
    return connectedCalls.filter((c) => {
      const custName = c.leads?.customer_name || "";
      const custMobile = c.leads?.mobile || "";
      const agName = agentMap.get(c.employee_id) || "";
      const notes = c.notes || "";
      const q = searchQuery.toLowerCase().trim();

      const matchesQuery = !q || (
        custName.toLowerCase().includes(q) ||
        custMobile.includes(q) ||
        agName.toLowerCase().includes(q) ||
        notes.toLowerCase().includes(q)
      );

      const matchesResponse = responseFilter === "all" || c.customer_response === responseFilter || c.status === responseFilter;

      return matchesQuery && matchesResponse;
    });
  }, [connectedCalls, searchQuery, responseFilter, agentMap]);

  const leaderboard = (agents ?? [])
    .map((a) => ({ name: a.full_name || a.email, calls: data?.perAgent.get(a.id) ?? 0 }))
    .sort((x, y) => y.calls - x.calls)
    .slice(0, 8);

  const conversion = data && data.totalLeads > 0 ? ((data.interested / data.totalLeads) * 100).toFixed(1) : "0.0";

  const exportReport = () => {
    if (filteredConnectedCalls.length === 0) {
      toast.info("No connected call records to export");
      return;
    }

    const headers = [
      "Customer Name", "Mobile", "Agent", "Customer Response", "Status",
      "Loan Required", "Amount", "CIBIL Score", "Salary Bank", "Call Notes", "Call Date & Time",
    ];

    const rows = filteredConnectedCalls.map((c) => {
      const l = c.leads;
      const intData = parseInterestedData(l?.notes);
      return [
        `"${(l?.customer_name || "").replace(/"/g, '""')}"`,
        `"${l?.mobile || ""}"`,
        `"${agentMap.get(c.employee_id) || "Agent"}"`,
        `"${c.customer_response || ""}"`,
        `"${c.status}"`,
        `"${l?.loan_type || ""}"`,
        `"${l?.loan_amount || ""}"`,
        `"${intData?.cibilScore || ""}"`,
        `"${intData?.salaryBank || ""}"`,
        `"${(c.notes || "").replace(/"/g, '""')}"`,
        `"${formatDateTime(c.called_at)}"`,
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Connected_Calls_Report_${todayISO()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Connected calls report exported successfully!");
  };

  return (
    <>
      <PageHeader
        title="Analytics & Reports"
        description="Calls, connection rate, conversion and connected customer profiles — from live data."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-9 w-32 text-xs sm:w-36 sm:text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9 text-xs sm:text-sm font-semibold" onClick={exportReport}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export Connected List
            </Button>
          </div>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading analytics…</p>}

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        <StatCard label="Calls logged" value={data?.totalCalls ?? 0} icon={PhoneCall} tone="brand" />
        <StatCard label="Connected" value={data?.connected ?? 0} icon={PhoneCall} tone="info" />
        <StatCard label="Conversion" value={`${conversion}%`} icon={TrendingUp} tone="success" hint="interested / leads" />
        <StatCard label="Agents" value={agents.length} icon={Users} tone="warning" />
      </div>

      {/* Charts Row */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5 card-elevated">
          <h3 className="mb-3 text-sm font-semibold">Call volume</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data?.series ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.2} />
                <Area type="monotone" dataKey="connected" stroke="var(--success)" fill="var(--success)" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 card-elevated">
          <h3 className="mb-3 text-sm font-semibold">Calls per agent</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={leaderboard}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" fontSize={10} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="calls" fill="var(--brand)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SECTION: Connected Calls & Updated Profiles Table */}
      <div className="mt-6 rounded-2xl border bg-card p-5 card-elevated space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
          <div>
            <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/15 text-sky-500">
                <PhoneCall className="h-4 w-4" />
              </span>
              Connected Calls & Updated Profiles ({filteredConnectedCalls.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live log of customers where the agent connected and updated notes, response, or financial profile.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, mobile, notes…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-8 text-xs bg-muted/30"
              />
            </div>

            <Select value={responseFilter} onValueChange={setResponseFilter}>
              <SelectTrigger className="h-9 text-xs w-36"><SelectValue placeholder="Response" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Responses</SelectItem>
                <SelectItem value="Interested">Interested Only</SelectItem>
                <SelectItem value="Follow-up Required">Follow-up Required</SelectItem>
                <SelectItem value="Not Interested">Not Interested</SelectItem>
                <SelectItem value="Documents Required">Documents Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {callsLoading ? (
          <p className="py-10 text-center text-xs text-muted-foreground">Loading connected calls…</p>
        ) : filteredConnectedCalls.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No connected call records matching your search.</p>
        ) : (
          <div className="space-y-3">
            {filteredConnectedCalls.map((item) => {
              const l = item.leads;
              const intData = parseInterestedData(l?.notes);
              const agent = agentMap.get(item.employee_id) || "Agent";

              return (
                <div
                  key={item.id}
                  className="rounded-xl border bg-muted/15 p-4 hover:border-brand/40 transition-colors flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm text-foreground">{l?.customer_name || "Customer"}</span>
                      <span className="font-mono text-xs text-muted-foreground">📞 {l?.mobile}</span>
                      <LeadStatusBadge status={(item.status || l?.status || "Contacted") as Lead["status"]} />
                      {item.customer_response && (
                        <span className="rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[10px] font-bold text-brand">
                          {item.customer_response}
                        </span>
                      )}
                      {intData?.cibilScore && (
                        <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-500">
                          🛡️ CIBIL: {intData.cibilScore}
                        </span>
                      )}
                    </div>

                    {/* Financial Requirements / Profile Summary */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Agent: <strong className="text-foreground">{agent}</strong></span>
                      <span>· Called: {formatDateTime(item.called_at)}</span>
                      {l?.loan_amount && <span>· Amount: <strong className="text-foreground">{inr(Number(l.loan_amount))}</strong> ({l.loan_type})</span>}
                      {intData?.salaryBank && <span>· Salary Bank: <strong className="text-indigo-500">{intData.salaryBank}</strong></span>}
                      {intData?.serviceYears && <span>· Exp: <strong className="text-foreground">{intData.serviceYears} yrs</strong></span>}
                    </div>

                    {/* Agent Notes */}
                    {item.notes && (
                      <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2 italic border border-muted">
                        "{item.notes}"
                      </p>
                    )}
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-0">
                    {l && (
                      <>
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs font-bold">
                          <a href={`tel:${l.mobile}`}><Phone className="mr-1 h-3.5 w-3.5 text-brand" /> Call</a>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                          <a href={`https://wa.me/${l.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                            <MessageCircle className="h-3.5 w-3.5 text-success" />
                          </a>
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs font-semibold" onClick={() => setViewLead(l)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View Profile
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* View Lead Drawer */}
      <AgentLeadSheet
        lead={viewLead}
        open={Boolean(viewLead)}
        onOpenChange={(o) => !o && setViewLead(null)}
      />
    </>
  );
}
