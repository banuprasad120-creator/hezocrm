import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Inbox, PhoneForwarded, Upload } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { formatDateTime, todayISO } from "@/lib/crm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Hezo CRM" },
      { name: "description", content: "Follow-ups due, new assignments and recent lead imports." },
      { property: "og:title", content: "Notifications — Hezo CRM" },
      { property: "og:description", content: "Live activity across your call center." },
    ],
  }),
  component: NotificationsPage,
});

type Item = {
  id: string;
  type: "followup" | "assignment" | "import";
  title: string;
  body: string;
  time: string;
  href?: string;
  params?: Record<string, string>;
};

function NotificationsPage() {
  const { data: session } = useCrmSession();
  const userId = session?.userId ?? null;
  const isAdmin = session?.isAdmin ?? false;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications", userId, isAdmin],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Item[]> => {
      const today = todayISO();
      const followQuery = supabase.from("follow_ups")
        .select("id, lead_id, follow_up_date, follow_up_time, note, created_at")
        .eq("is_done", false).lte("follow_up_date", today)
        .order("follow_up_date", { ascending: true }).limit(20);
      const assignQuery = supabase.from("lead_assignments")
        .select("id, lead_id, assigned_at").order("assigned_at", { ascending: false }).limit(15);
      const importQuery = isAdmin
        ? supabase.from("lead_imports")
            .select("id, file_name, folder_date, imported_count, duplicate_count, error_count, created_at, status")
            .order("created_at", { ascending: false }).limit(10)
        : null;

      const [follows, assigns, imports] = await Promise.all([followQuery, assignQuery, importQuery]);

      const out: Item[] = [];
      for (const f of follows.data ?? []) {
        out.push({
          id: `f-${f.id}`,
          type: "followup",
          title: f.follow_up_date < today ? "Overdue follow-up" : "Follow-up due today",
          body: `${f.follow_up_date}${f.follow_up_time ? ` at ${String(f.follow_up_time).slice(0, 5)}` : ""}${f.note ? ` · ${f.note}` : ""}`,
          time: formatDateTime(f.created_at),
          href: "/lead/$leadId",
          params: { leadId: f.lead_id },
        });
      }
      for (const a of assigns.data ?? []) {
        out.push({
          id: `a-${a.id}`,
          type: "assignment",
          title: "Lead assigned",
          body: "A lead was assigned to a calling agent.",
          time: formatDateTime(a.assigned_at),
          href: "/lead/$leadId",
          params: { leadId: a.lead_id },
        });
      }
      for (const im of imports?.data ?? []) {
        out.push({
          id: `i-${im.id}`,
          type: "import",
          title: `Import ${im.status} — ${im.file_name}`,
          body: `${im.imported_count} imported · ${im.duplicate_count} duplicates · ${im.error_count} errors · folder ${im.folder_date}`,
          time: formatDateTime(im.created_at),
        });
      }
      return out.slice(0, 40);
    },
  });

  const iconMap = { followup: PhoneForwarded, assignment: CalendarClock, import: Upload } as const;
  const toneMap = {
    followup: "bg-warning/20 text-warning",
    assignment: "bg-brand/15 text-brand",
    import: "bg-info/15 text-info",
  } as const;

  return (
    <>
      <PageHeader title="Notifications" description="Follow-ups due, lead assignments and import activity — from live data." />

      <div className="rounded-2xl border bg-card card-elevated">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading activity…</p>}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-6 w-6" /> Nothing to show right now.
          </div>
        )}
        {items.map((n) => {
          const Icon = iconMap[n.type];
          const content = (
            <div className="flex items-start gap-4 border-b p-4 transition hover:bg-muted/40 last:border-b-0">
              <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", toneMap[n.type])}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <span className="ml-auto text-[11px] text-muted-foreground">{n.time}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
              </div>
            </div>
          );
          return n.href && n.params ? (
            <Link key={n.id} to={n.href} params={n.params} className="block">{content}</Link>
          ) : (
            <div key={n.id}>{content}</div>
          );
        })}
      </div>
    </>
  );
}
