import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/call-screen")({
  head: () => ({
    meta: [
      { title: "Call Workspace — Hezo CRM" },
      { name: "description", content: "Focused telecalling workspace for agents." },
    ],
  }),
  // The dedicated call workspace lives inside My Leads, where every lead has a
  // real CALL action and call-history update dialog.
  beforeLoad: () => {
    throw redirect({ to: "/my-leads", replace: true });
  },
  component: () => null,
});
