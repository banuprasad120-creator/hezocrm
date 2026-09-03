import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, PhoneCall, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/common/StatCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, todayISO } from "@/lib/crm";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Hezo CRM" },
      { name: "description", content: "Live call, conversion and agent performance analytics from your CRM data." },
      { property: "og:title", content: "Analytics — Hezo CRM" },
      { property: "og:description", content: "Live call and conversion analytics for your call center." },
    ],
  }),
  component: AnalyticsPage,
});

function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function AnalyticsPage() {
  const { data: session } = useCrmSession();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const [range, setRange] = useState("14");
  const days = Number(range);
  const { data: agents = [] } = useAgents(companyId, isAdmin);

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

  const leaderboard = (agents ?? [])
    .map((a) => ({ name: a.full_name || a.email, calls: data?.perAgent.get(a.id) ?? 0 }))
    .sort((x, y) => y.calls - x.calls)
    .slice(0, 8);

  const conversion = data && data.totalLeads > 0 ? ((data.interested / data.totalLeads) * 100).toFixed(1) : "0.0";

  const exportReport = () => {
    if (!data) return;
    const rows: string[][] = [
      ["Date", "Calls", "Connected"],
      ...data.series.map((s) => [s.day, String(s.calls), String(s.connected)]),
      [],
      ["Agent", "Calls"],
      ...leaderboard.map((l) => [l.name, String(l.calls)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hezo-analytics-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  return (
    <>
      <PageHeader
        title="Analytics & Reports"
        description="Calls, connection rate, conversion and team performance — from live data."
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
            <Button size="sm" variant="outline" className="h-9 text-xs sm:text-sm" disabled={!data} onClick={exportReport}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export Report
            </Button>
          </div>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading analytics…</p>}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        <StatCard label="Calls logged" value={data?.totalCalls ?? 0} icon={PhoneCall} tone="brand" />
        <StatCard label="Connected" value={data?.connected ?? 0} icon={PhoneCall} tone="info" />
        <StatCard label="Conversion" value={`${conversion}%`} icon={TrendingUp} tone="success" hint="interested / leads" />
        <StatCard label="Agents" value={agents.length} icon={Users} tone="warning" />
      </div>

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

      <div className="mt-4 rounded-2xl border bg-card p-5 card-elevated">
        <h3 className="mb-3 text-sm font-semibold">Lead status breakdown</h3>
        {(data?.statusRows.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No leads in this period.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data?.statusRows.map((r) => (
              <div key={r.status} className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">{r.status}</p>
                <p className="text-lg font-bold">{r.count}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
