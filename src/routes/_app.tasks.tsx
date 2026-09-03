import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { todayISO } from "@/lib/crm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Hezo CRM" },
      { name: "description", content: "Your scheduled follow-up tasks: overdue, today and upcoming." },
      { property: "og:title", content: "Tasks — Hezo CRM" },
      { property: "og:description", content: "Follow-up tasks pulled straight from your CRM." },
    ],
  }),
  component: TasksPage,
});

type Task = {
  id: string;
  lead_id: string;
  follow_up_date: string;
  follow_up_time: string | null;
  note: string | null;
  is_done: boolean;
  lead?: { customer_name: string; mobile: string } | null;
};

function TasksPage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const isAdmin = session?.isAdmin ?? false;
  const userId = session?.userId ?? null;
  const today = todayISO();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", userId, isAdmin],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Task[]> => {
      let q = supabase
        .from("follow_ups")
        .select("id, lead_id, follow_up_date, follow_up_time, note, is_done, leads(customer_name, mobile)")
        .order("follow_up_date", { ascending: true })
        .limit(200);
      if (!isAdmin) q = q.eq("employee_id", userId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        lead_id: r.lead_id,
        follow_up_date: r.follow_up_date,
        follow_up_time: r.follow_up_time,
        note: r.note,
        is_done: r.is_done,
        lead: (r as unknown as { leads: { customer_name: string; mobile: string } | null }).leads,
      }));
    },
  });

  const complete = async (id: string, done: boolean) => {
    const { error } = await supabase.from("follow_ups").update({ is_done: done }).eq("id", id);
    if (error) {
      toast.error("Could not update task", { description: error.message });
      return;
    }
    toast.success(done ? "Task completed" : "Task reopened");
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["my-followups-open"] });
  };

  const cols = [
    { key: "overdue", label: "Overdue", tone: "text-destructive", dot: "bg-destructive", rows: tasks.filter((t) => !t.is_done && t.follow_up_date < today) },
    { key: "today", label: "Today & upcoming", tone: "text-info", dot: "bg-info", rows: tasks.filter((t) => !t.is_done && t.follow_up_date >= today) },
    { key: "done", label: "Completed", tone: "text-success", dot: "bg-success", rows: tasks.filter((t) => t.is_done) },
  ];

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every scheduled follow-up, grouped by urgency."
        actions={<Button asChild size="sm" variant="outline"><Link to="/follow-ups"><CalendarClock className="mr-1 h-4 w-4" /> Follow-ups</Link></Button>}
      />

      {isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {cols.map((c) => (
          <div key={c.key} className="rounded-2xl border bg-card p-4 card-elevated">
            <div className="mb-3 flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", c.dot)} />
              <h3 className={cn("text-sm font-semibold", c.tone)}>{c.label}</h3>
              <span className="rounded-full bg-muted px-2 text-[10px] font-bold">{c.rows.length}</span>
            </div>
            <div className="space-y-2">
              {c.rows.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Nothing here</p>}
              {c.rows.slice(0, 50).map((t) => (
                <div key={t.id} className="group rounded-xl border p-3 transition hover:bg-muted/40">
                  <div className="flex items-start gap-2">
                    <Checkbox checked={t.is_done} onCheckedChange={(v) => complete(t.id, Boolean(v))} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <Link to="/lead/$leadId" params={{ leadId: t.lead_id }} className="block truncate text-sm font-semibold hover:underline">
                        {t.lead?.customer_name || "Lead"}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{t.lead?.mobile}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t.follow_up_date}{t.follow_up_time ? ` · ${String(t.follow_up_time).slice(0, 5)}` : ""}
                      </p>
                      {t.note && <p className="mt-1 line-clamp-2 text-xs">{t.note}</p>}
                    </div>
                    {t.is_done && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
