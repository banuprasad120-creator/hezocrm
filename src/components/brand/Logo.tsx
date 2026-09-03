import { cn } from "@/lib/utils";

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-brand card-elevated">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6v12M20 6v12M4 12h16" />
        </svg>
        <span className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background" />
      </div>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight">Hezo<span className="gradient-text">CRM</span></span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Call Center AI</span>
        </div>
      )}
    </div>
  );
}
