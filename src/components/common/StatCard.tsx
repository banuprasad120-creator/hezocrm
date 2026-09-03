import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "warning" | "info" | "destructive";

export function StatCard({
  label, value, delta, icon: Icon, tone = "brand", hint,
}: {
  label: string;
  value: string | number;
  delta?: number;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
}) {
  const toneMap: Record<Tone, string> = {
    brand: "from-brand/15 to-brand-2/10 text-brand",
    success: "from-success/15 to-success/5 text-success",
    warning: "from-warning/20 to-warning/5 text-warning",
    info: "from-info/15 to-info/5 text-info",
    destructive: "from-destructive/15 to-destructive/5 text-destructive",
  };
  const up = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card card-elevated transition-all hover:card-float hover:-translate-y-0.5">
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-70", toneMap[tone])} style={{ maskImage: "linear-gradient(180deg, black, transparent 60%)" }} />
      <div className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-2 truncate text-3xl font-bold tracking-tight">{value}</p>
          </div>
          <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background/80 backdrop-blur")}>
            <Icon className={cn("h-5 w-5", toneMap[tone].split(" ").pop())} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          {delta !== undefined && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
              up ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta)}%
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </div>
  );
}
