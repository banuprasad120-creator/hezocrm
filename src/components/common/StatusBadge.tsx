import { cn } from "@/lib/utils";

const map: Record<string, string> = {
  Active: "bg-success/15 text-success ring-success/25",
  Online: "bg-success/15 text-success ring-success/25",
  Converted: "bg-success/15 text-success ring-success/25",
  Approved: "bg-success/15 text-success ring-success/25",
  Present: "bg-success/15 text-success ring-success/25",
  "On Call": "bg-info/15 text-info ring-info/25",
  "In Progress": "bg-info/15 text-info ring-info/25",
  New: "bg-brand/15 text-brand ring-brand/25",
  Trial: "bg-brand/15 text-brand ring-brand/25",
  "Follow-up": "bg-warning/20 text-warning ring-warning/30",
  Break: "bg-warning/20 text-warning ring-warning/30",
  Late: "bg-warning/20 text-warning ring-warning/30",
  Warm: "bg-warning/20 text-warning ring-warning/30",
  Suspended: "bg-destructive/15 text-destructive ring-destructive/25",
  Rejected: "bg-destructive/15 text-destructive ring-destructive/25",
  Absent: "bg-destructive/15 text-destructive ring-destructive/25",
  Hot: "bg-destructive/15 text-destructive ring-destructive/25",
  Offline: "bg-muted text-muted-foreground ring-border",
  Cold: "bg-muted text-muted-foreground ring-border",
  Starter: "bg-muted text-muted-foreground ring-border",
  Growth: "bg-info/15 text-info ring-info/25",
  Enterprise: "bg-brand/15 text-brand ring-brand/25",
};

export function StatusBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
      map[label] ?? "bg-muted text-muted-foreground ring-border",
      className,
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}
