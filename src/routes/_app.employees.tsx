import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/employees")({
  head: () => ({
    meta: [
      { title: "Employees — Hezo CRM" },
      { name: "description", content: "Manage the calling agents in your company." },
      { property: "og:title", content: "Employees — Hezo CRM" },
      { property: "og:description", content: "Manage the calling agents in your company." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/agents", replace: true });
  },
  component: () => null,
});
