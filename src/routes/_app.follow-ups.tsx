import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { inr, todayISO, type Lead } from "@/lib/crm";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { CallUpdateDialog } from "@/components/crm/CallUpdateDialog";
import { useState } from "react";

export const Route = createFileRoute("/_app/follow-ups")({
  head: () => ({
    meta: [
      { title: "My Follow-ups — Hezo CRM" },
      { name: "description", content: "Today, tomorrow, upcoming and overdue follow-ups for your assigned leads." },
      { property: "og:title", content: "My Follow-ups — Hezo CRM" },
      { property: "og:description", content: "Never miss a scheduled customer callback." },
    ],
  }),
  component: FollowUpsPage,
});

type Row = {
  id: string; lead_id: string; follow_up_date: string; follow_up_time: string | null;
  note: string | null; is_done: boolean; leads: Lead | null;
};




function FollowUpsPage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const userId = session?.userId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const [active, setActive] = useState<Lead | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["follow-ups", userId, isAdmin],
    enabled: Boolean(userId),
    queryFn: async () => {
      let query = supabase.from("follow_ups")
        .select("id, lead_id, follow_up_date, follow_up_time, note, is_done, leads(*)")
        .order("follow_up_date");
      if (!isAdmin) query = query.eq("employee_id", userId!);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const today = todayISO();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

  const pending = rows.filter((r) => !r.is_done);
  const buckets = {
    today: pending.filter((r) => r.follow_up_date === today),
    tomorrow: pending.filter((r) => r.follow_up_date === tomorrow),
    upcoming: pending.filter((r) => r.follow_up_date > tomorrow),
    overdue: pending.filter((r) => r.follow_up_date < today),
    done: rows.filter((r) => r.is_done),
  };

  const markDone = async (id: string) => {
    const { error } = await supabase.from("follow_ups").update({ is_done: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Follow-up completed");
    qc.invalidateQueries({ queryKey: ["follow-ups"] });
  };

  const List = ({ items }: { items: Row[] }) => (
    <div className="space-y-3">
      {items.length === 0 && <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Nothing here.</p>}
      {items.map((r) => (
        <div key={r.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 card-elevated sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/lead/$leadId" params={{ leadId: r.lead_id }} className="font-bold hover:underline">
                {r.leads?.customer_name ?? "Lead"}
              </Link>
              {r.leads && <LeadStatusBadge status={r.leads.status} />}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              📞 {r.leads?.mobile} · {r.leads ? inr(Number(r.leads.loan_amount)) : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <CalendarClock className="mr-1 inline h-3 w-3" />
              {r.follow_up_date}{r.follow_up_time ? ` at ${r.follow_up_time.slice(0, 5)}` : ""}
              {r.note ? ` — ${r.note}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {r.leads && (
              <Button asChild size="sm" className="gradient-brand text-white">
                <a href={`tel:${r.leads.mobile}`}><PhoneCall className="mr-1 h-4 w-4" /> CALL</a>
              </Button>
            )}
            {r.leads && (
              <Button size="sm" variant="outline" onClick={() => setActive(r.leads)}>UPDATE</Button>
            )}
            {!r.is_done && (
              <Button size="sm" variant="outline" onClick={() => markDone(r.id)}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Done
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title={isAdmin ? "Follow-ups" : "My Follow-ups"} description="Scheduled callbacks grouped by due date." />
      <Tabs defaultValue="today" className="space-y-3">
        <div className="overflow-x-auto no-scrollbar pb-1">
          <TabsList className="inline-flex w-auto whitespace-nowrap p-1">
            <TabsTrigger value="today" className="text-xs sm:text-sm">Today ({buckets.today.length})</TabsTrigger>
            <TabsTrigger value="tomorrow" className="text-xs sm:text-sm">Tomorrow ({buckets.tomorrow.length})</TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs sm:text-sm">Upcoming ({buckets.upcoming.length})</TabsTrigger>
            <TabsTrigger value="overdue" className="text-xs sm:text-sm text-destructive font-semibold">Overdue ({buckets.overdue.length})</TabsTrigger>
            <TabsTrigger value="done" className="text-xs sm:text-sm">Done ({buckets.done.length})</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="today"><List items={buckets.today} /></TabsContent>
        <TabsContent value="tomorrow"><List items={buckets.tomorrow} /></TabsContent>
        <TabsContent value="upcoming"><List items={buckets.upcoming} /></TabsContent>
        <TabsContent value="overdue"><List items={buckets.overdue} /></TabsContent>
        <TabsContent value="done"><List items={buckets.done} /></TabsContent>
      </Tabs>

      <CallUpdateDialog
        lead={active}
        employeeId={userId ?? ""}
        open={Boolean(active)}
        onOpenChange={(o) => !o && setActive(null)}
      />
    </>
  );
}
