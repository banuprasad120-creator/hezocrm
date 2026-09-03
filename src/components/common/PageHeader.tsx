import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Home } from "lucide-react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const segments = path.split("/").filter(Boolean);
  return (
    <div className="mb-6">
      <nav className="mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap text-xs text-muted-foreground">
        <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
          <Home className="h-3.5 w-3.5" /> Hezo
        </Link>
        {segments.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className={i === segments.length - 1 ? "font-semibold text-foreground capitalize" : "capitalize"}>{s.replace(/-/g, " ")}</span>
          </span>
        ))}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">{title}</h1>
          {description && <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">{actions}</div>}
      </div>
    </div>
  );
}
