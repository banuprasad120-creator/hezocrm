import { takingStatusTone } from "@/lib/crm";
import { cn } from "@/lib/utils";

interface LeadTakingBadgeProps {
  status?: string | null;
  className?: string;
  showDot?: boolean;
}

export function LeadTakingBadge({ status, className, showDot = true }: LeadTakingBadgeProps) {
  const tone = takingStatusTone(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-tight shrink-0",
        tone.badge,
        className
      )}
    >
      {showDot && <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />}
      <span>{tone.label}</span>
    </span>
  );
}

