import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useCrmSession } from "@/hooks/use-crm-session";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Hezo CRM" },
      { name: "description", content: "Your Hezo CRM workspace — admins land on live monitoring, agents on their assigned leads." },
      { property: "og:title", content: "Dashboard — Hezo CRM" },
      { property: "og:description", content: "Role-aware workspace for admins and calling agents." },
    ],
  }),
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const { data: session, isLoading } = useCrmSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || !session) return;
    if (session.isAdmin) navigate({ to: "/monitoring", replace: true });
    else if (session.isAgent) navigate({ to: "/my-leads", replace: true });
  }, [isLoading, session, navigate]);

  return (
    <div className="grid min-h-[40dvh] place-items-center text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Opening your workspace…</span>
    </div>
  );
}
