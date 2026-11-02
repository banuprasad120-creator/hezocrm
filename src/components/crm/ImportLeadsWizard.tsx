import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Copy, Download, FileSpreadsheet, FolderInput,
  History, Info, Loader2, RefreshCw, RotateCcw, Search, ShieldAlert, ShieldCheck,
  Sparkles, Upload, User, UserCheck, Users, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FIELD_DEFS, REQUIRED_FIELDS, applyExistingDuplicates, autoMap, buildRowsProgressive,
  downloadErrorReport, downloadSampleFile, parseSpreadsheet,
  type HezoField, type ParsedSheet, type ValidatedRow, type ValidationSummary,
} from "@/lib/lead-import";
import {
  IMPORT_BATCH_SIZE, VALIDATION_CHUNK, buildBatches, createImportRecord,
  fetchExistingLeadsDetails, executeExistingLeadsStrategy,
  runBatchedImport, updateImportRecord,
  type BatchState, type Canceller, type ImportContext, type ExistingLeadsAction,
} from "@/lib/lead-import-runner";
import { getCompanyBatchSettings } from "@/lib/lead-batch";
import { useAgents } from "@/hooks/use-crm-session";
import { todayISO } from "@/lib/crm";

const STEPS = ["Upload", "Map Columns", "Preview & Validate", "Import"] as const;

type Result = {
  imported: number;
  skipped: number;
  invalid: number;
  existingCount: number;
  reassignedCount: number;
  strategy: ExistingLeadsAction;
  cancelled: boolean;
  failedBatches: number;
};

export function ImportLeadsWizard({
  open, onOpenChange, companyId, userId, folderDate = todayISO(), onViewImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  userId: string | null;
  folderDate?: string;
  onViewImported: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<Canceller>({ cancelled: false });
  const ctxRef = useRef<ImportContext | null>(null);

  const companiesQ = useQuery({
    queryKey: ["import-companies-list"],
    enabled: !companyId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("created_at", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const effectiveCompanyId = companyId || selectedCompanyId || (companiesQ.data?.[0]?.id ?? null);

  // Fetch active company agents for potential old data reassignment
  const { data: agents = [] } = useAgents(effectiveCompanyId, Boolean(open));

  // Fetch company auto-assignment running state
  const autoAssignQ = useQuery({
    queryKey: ["import-wizard-auto-assign-settings", effectiveCompanyId],
    enabled: Boolean(effectiveCompanyId && open),
    queryFn: () => getCompanyBatchSettings(effectiveCompanyId!),
  });

  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<number, HezoField | "">>({});
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [phase, setPhase] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<BatchState[]>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  // Old data strategy controls
  const [existingStrategy, setExistingStrategy] = useState<ExistingLeadsAction>("RETAIN");
  const [targetAgentId, setTargetAgentId] = useState<string>("");

  // Preview table tab filter & search
  const [activeTabFilter, setActiveTabFilter] = useState<"all" | "new" | "existing" | "file_dup" | "error">("all");
  const [previewSearch, setPreviewSearch] = useState("");

  const reset = () => {
    setStep(0); setParsed(null); setMapping({}); setSummary(null);
    setPhase(""); setBusy(false); setImporting(false); setBatches([]); setCurrentBatch(0);
    setImportedCount(0); setResult(null); setSelectedCompanyId("");
    setExistingStrategy("RETAIN"); setTargetAgentId("");
    setActiveTabFilter("all"); setPreviewSearch("");
    cancelRef.current = { cancelled: false };
    ctxRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = (v: boolean) => { if (!busy && !importing) { onOpenChange(v); if (!v) reset(); } };

  const mappedFields = useMemo(() => new Set(Object.values(mapping).filter(Boolean) as HezoField[]), [mapping]);
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setPhase("Preparing file…");
    try {
      await new Promise((r) => setTimeout(r, 0));
      setPhase("Reading rows…");
      const sheet = await parseSpreadsheet(file);
      if (sheet.rows.length === 0) throw new Error("No data rows found in the file");
      setParsed(sheet);
      setMapping(autoMap(sheet.headers));
      setStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(false); setPhase("");
    }
  };

  const runValidation = async () => {
    if (!parsed) return;
    if (!effectiveCompanyId) {
      toast.error("Please create or select a tenant company before importing leads.");
      return;
    }
    if (missingRequired.length > 0) {
      toast.error(`Map the required column(s): ${missingRequired.map((f) => FIELD_DEFS.find((d) => d.key === f)!.label).join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      const rows = await buildRowsProgressive(parsed, mapping, VALIDATION_CHUNK, (done, total) =>
        setPhase(`Validating ${done.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")} rows…`));
      const mobiles = rows.filter((r) => r.errors.length === 0).map((r) => r.draft.mobile);
      
      // Full details lookup for old/existing leads to power intelligent preview & management
      const existingDetails = await fetchExistingLeadsDetails(effectiveCompanyId, mobiles, (done, total) =>
        setPhase(`Checking existing leads & duplicates ${done.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")}…`));
      
      setSummary(applyExistingDuplicates(rows, existingDetails));
      setStep(2);
    } catch (err) {
      const detail = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
      toast.error(detail ? `Validation failed — ${detail}` : "Validation failed", { duration: 8000 });
    } finally {
      setBusy(false); setPhase("");
    }
  };

  // Importable rows: clean brand-new leads
  const importable = useMemo(() => {
    if (!summary) return [] as ValidatedRow[];
    return summary.rows.filter(
      (r) => r.errors.length === 0 && !r.duplicateInFile && !r.duplicateExisting
    );
  }, [summary]);

  // Existing rows: records already in CRM
  const existingRows = useMemo(() => {
    if (!summary) return [] as ValidatedRow[];
    return summary.rows.filter((r) => r.duplicateExisting && r.existingRecord);
  }, [summary]);

  // Uncontacted existing leads (safe for queue/reassignment)
  const uncontactedExistingCount = useMemo(() => {
    return existingRows.filter((r) => !r.existingRecord?.last_call_at).length;
  }, [existingRows]);

  // Filtered rows for the preview table
  const filteredPreviewRows = useMemo(() => {
    if (!summary) return [] as ValidatedRow[];
    return summary.rows.filter((r) => {
      if (activeTabFilter === "new") {
        if (r.errors.length > 0 || r.duplicateInFile || r.duplicateExisting) return false;
      } else if (activeTabFilter === "existing") {
        if (!r.duplicateExisting) return false;
      } else if (activeTabFilter === "file_dup") {
        if (!r.duplicateInFile) return false;
      } else if (activeTabFilter === "error") {
        if (r.errors.length === 0) return false;
      }
      if (previewSearch.trim()) {
        const q = previewSearch.trim().toLowerCase();
        const matchName = r.draft.customer_name?.toLowerCase().includes(q);
        const matchMob = r.draft.mobile?.includes(q);
        if (!matchName && !matchMob) return false;
      }
      return true;
    });
  }, [summary, activeTabFilter, previewSearch]);

  const finish = async (
    ctx: ImportContext,
    imported: number,
    failed: BatchState[],
    cancelled: boolean,
  ) => {
    const status = cancelled ? "cancelled" : failed.length > 0 ? "failed" : "completed";
    let reassignedCount = 0;

    // Handle existing/old data action if admin chose an action other than RETAIN
    if (!cancelled && ctx.existingLeadIds && ctx.existingLeadIds.length > 0 && ctx.existingStrategy && ctx.existingStrategy !== "RETAIN") {
      try {
        const strategyRes = await executeExistingLeadsStrategy({
          companyId: ctx.companyId,
          adminId: ctx.userId,
          leadIds: ctx.existingLeadIds,
          action: ctx.existingStrategy,
          targetFolder: ctx.folderDate,
          targetAgentId: ctx.targetAgentId,
          appendNotes: `[Old Data Upload ${new Date().toLocaleDateString("en-IN")}]: Re-managed via ${ctx.existingStrategy}`,
        });
        reassignedCount = strategyRes.count;
        if (strategyRes.count > 0) {
          toast.success(strategyRes.message);
        }
      } catch (strategyErr) {
        console.error("[import] existing leads strategy execution failed:", strategyErr);
        toast.error(strategyErr instanceof Error ? strategyErr.message : "Failed to handle existing leads");
      }
    }

    await updateImportRecord(ctx.importId, {
      imported_count: imported,
      duplicate_count: ctx.duplicates,
      existing_count: ctx.existingCount,
      reassigned_count: reassignedCount,
      strategy: ctx.existingStrategy || "RETAIN",
      processed_rows: imported + ctx.duplicates + ctx.errors,
      status,
      completed_at: new Date().toISOString(),
    });

    // Check auto-assignment running state
    const isAutoAssignRunning = autoAssignQ.data?.status === "RUNNING";
    const totalAddedToQueue = imported + (ctx.existingStrategy === "REASSIGN_TO_QUEUE" ? reassignedCount : 0);

    if (totalAddedToQueue > 0 && isAutoAssignRunning) {
      try {
        const { data: queueRes } = await (supabase.rpc as any)("process_live_priority_queue", {
          p_company_id: ctx.companyId,
          p_folder_date: ctx.folderDate,
        });
        if (queueRes?.assigned_count > 0) {
          toast.success(
            `⚡ Priority Auto-Assign: ${queueRes.assigned_count} high-priority leads allocated to active agents immediately!`,
            { duration: 6000 }
          );
        } else if (queueRes?.status === "RUNNING") {
          toast.info(
            `📥 Leads placed in live priority queue (High: ${queueRes.high_priority_waiting || 0}, Total Waiting: ${queueRes.total_unassigned || 0})`
          );
        }
      } catch (dispatchErr) {
        console.warn("[live-dispatch] priority queue process warning:", dispatchErr);
      }
    } else if (totalAddedToQueue > 0 && !isAutoAssignRunning) {
      toast.info(
        `📥 Auto-Assign is currently ${autoAssignQ.data?.status || "STOPPED"} — ${totalAddedToQueue} leads are safely stored in the queue without auto-dispatching.`,
        { duration: 6000 }
      );
    }

    setResult({
      imported,
      skipped: ctx.duplicates,
      invalid: ctx.errors,
      existingCount: ctx.existingCount,
      reassignedCount,
      strategy: ctx.existingStrategy || "RETAIN",
      cancelled,
      failedBatches: failed.length,
    });
    setPhase(cancelled ? "Import cancelled" : failed.length > 0 ? "Some batches failed" : "Finalizing…");
    qc.invalidateQueries();
  };

  const startImport = async () => {
    if (!summary || !effectiveCompanyId || !parsed) {
      if (!effectiveCompanyId) toast.error("Please create or select a tenant company before importing leads.");
      return;
    }

    const existingLeadIds = existingRows.map((r) => r.existingRecord!.id);
    const hasNewLeads = importable.length > 0;
    const hasOldAction = existingStrategy !== "RETAIN" && existingLeadIds.length > 0;

    if (!hasNewLeads && !hasOldAction) {
      return toast.error("No valid new leads to import, and existing leads are set to Retain (no changes needed).");
    }

    if (existingStrategy === "REASSIGN_TO_AGENT" && !targetAgentId) {
      return toast.error("Please select a target agent for reassigning old leads.");
    }

    const ctx: ImportContext = {
      companyId: effectiveCompanyId,
      userId,
      folderDate,
      fileName: parsed.fileName,
      importId: crypto.randomUUID(),
      rows: importable,
      existingRows,
      existingLeadIds,
      existingStrategy,
      targetAgentId: targetAgentId || null,
      totalRows: summary.total,
      duplicates: summary.duplicateInFile,
      existingCount: summary.existingCount,
      reassignedCount: 0,
      errors: summary.errorCount,
    };
    ctxRef.current = ctx;
    cancelRef.current = { cancelled: false };

    const initial = buildBatches(importable.length, IMPORT_BATCH_SIZE);
    setBatches(initial); setCurrentBatch(0); setImportedCount(0); setResult(null);
    setStep(3); setImporting(true); setPhase("Preparing import…");

    try {
      await createImportRecord(ctx, initial.length);
      if (importable.length > 0) {
        const { imported, failed, cancelled } = await runBatchedImport(
          ctx, initial, cancelRef.current,
          (b, imp, cur) => { setBatches(b); setImportedCount(imp); setCurrentBatch(cur); setPhase(`Importing batch ${cur} of ${b.length}…`); },
        );
        setBatches((prev) => prev);
        await finish(ctx, imported, failed, cancelled);
      } else {
        // If only handling existing records with 0 new records
        await finish(ctx, 0, [], false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      setPhase("");
      setStep(2);
    } finally {
      setImporting(false);
    }
  };

  const retryFailed = async () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    cancelRef.current = { cancelled: false };
    setImporting(true); setResult(null); setPhase("Retrying failed batches…");
    const { imported, failed, cancelled } = await runBatchedImport(
      ctx, batches, cancelRef.current,
      (b, imp, cur) => { setBatches(b); setImportedCount(imp); setCurrentBatch(cur); setPhase(`Importing batch ${cur} of ${b.length}…`); },
    );
    await finish(ctx, imported, failed, cancelled);
    setImporting(false);
  };

  const totalToImport = importable.length;
  const pct = totalToImport ? Math.round((importedCount / totalToImport) * 100) : 0;
  const failedBatches = batches.filter((b) => b.status === "failed");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[94dvh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b bg-elevated p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <FileSpreadsheet className="h-5 w-5 text-brand" /> Old &amp; New Lead Data Management
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Folder 📁 {folderDate.split("-").reverse().join("-")} · Upload new leads and manage existing old data safely without overwriting.
              </DialogDescription>
            </div>

            {/* Auto Assign Status Badge */}
            <div className="shrink-0">
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border",
                autoAssignQ.data?.status === "RUNNING"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : autoAssignQ.data?.status === "PAUSED"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : "bg-destructive/10 text-destructive border-destructive/30"
              )}>
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  autoAssignQ.data?.status === "RUNNING" ? "bg-emerald-500 animate-ping" : autoAssignQ.data?.status === "PAUSED" ? "bg-amber-500" : "bg-destructive"
                )} />
                {autoAssignQ.data?.status === "RUNNING" ? "Auto-Assign Running" : autoAssignQ.data?.status === "PAUSED" ? "Auto-Assign Paused" : "Auto-Assign Stopped"}
              </span>
            </div>
          </div>

          <ol className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap pb-1 sm:mt-3 sm:flex-wrap">
            {STEPS.map((s, i) => (
              <li key={s} className={cn(
                "shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold sm:px-3 sm:py-1 sm:text-[11px]",
                i === step ? "gradient-brand border-transparent text-white shadow-sm"
                  : i < step ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground",
              )}>
                <span className="opacity-70">Step {i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="max-h-[64dvh] overflow-y-auto p-4 sm:p-5">
          {/* STEP 0: FILE SELECTION */}
          {step === 0 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition hover:border-brand/50 hover:bg-muted/30"
              >
                <Upload className="h-8 w-8 text-brand" />
                <span className="text-sm font-semibold">Upload Excel / CSV (Old or New Data)</span>
                <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv — first sheet is used · handles 25,000+ records seamlessly</span>
              </button>
              <input
                ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-elevated p-4">
                <div>
                  <p className="text-sm font-semibold">Not sure about the format?</p>
                  <p className="text-xs text-muted-foreground">Download the sample file with all supported columns including priority.</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadSampleFile}>
                  <Download className="mr-1 h-4 w-4" /> Download Sample Excel
                </Button>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Full Data Protection Guaranteed:
                </p>
                <p>• Mobile numbers are checked against company records to identify brand-new leads vs. old data.</p>
                <p>• Existing calls, follow-ups, and notes are never overwritten.</p>
                <p>• Upload safely at any time whether Auto-Assign is running, paused, or stopped.</p>
              </div>
              {busy && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{phase}</p>}
            </div>
          )}

          {/* STEP 1: COLUMN MAPPING */}
          {step === 1 && parsed && (
            <div className="space-y-4">
              {!companyId && (companiesQ.data?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-3">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-brand">Target Tenant Company *</Label>
                  <Select value={effectiveCompanyId || ""} onValueChange={(v) => setSelectedCompanyId(v)}>
                    <SelectTrigger className="mt-1.5 h-9 bg-background"><SelectValue placeholder="Select target company" /></SelectTrigger>
                    <SelectContent>
                      {companiesQ.data?.map((c: { id: string; name: string }) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                <b>{parsed.fileName}</b> · {parsed.rows.length.toLocaleString("en-IN")} rows · {parsed.headers.length} columns detected.
                Confirm or change how each file column maps to a Hezo CRM field.
              </p>
              {missingRequired.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Required field(s) not mapped: {missingRequired.map((f) => FIELD_DEFS.find((d) => d.key === f)!.label).join(", ")}
                </div>
              )}
              {busy && (
                <p className="text-sm font-medium text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{phase}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {parsed.headers.map((h, i) => (
                  <div key={`${h}-${i}`} className="rounded-xl border bg-elevated p-3">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">File column</Label>
                    <p className="truncate text-sm font-semibold">{h || `Column ${i + 1}`}</p>
                    <p className="mb-2 truncate text-[11px] text-muted-foreground">
                      e.g. {String(parsed.rows[0]?.[i] ?? "—") || "—"}
                    </p>
                    <Select
                      value={mapping[i] || "__skip"}
                      onValueChange={(v) => setMapping({ ...mapping, [i]: v === "__skip" ? "" : (v as HezoField) })}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip">Do not import</SelectItem>
                        {FIELD_DEFS.map((f) => (
                          <SelectItem key={f.key} value={f.key} disabled={mappedFields.has(f.key) && mapping[i] !== f.key}>
                            {f.label}{f.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: PREVIEW, VALIDATE & OLD DATA STRATEGY */}
          {step === 2 && summary && (
            <div className="space-y-4">
              {/* Stat Cards Breakdown */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                {([
                  ["Total Rows", summary.total, "text-foreground", "File Records"],
                  ["New Leads", summary.newCount, "text-emerald-500", "Ready to Add"],
                  ["Old / Existing CRM", summary.existingCount, "text-amber-500", "Already in CRM"],
                  ["In-File Duplicates", summary.duplicateInFile, "text-rose-400", "Repeated in File"],
                  ["Validation Errors", summary.errorCount, "text-destructive", "Invalid Mobile/Format"],
                ] as const).map(([label, value, tone, sub]) => (
                  <div key={label} className="rounded-xl border bg-elevated p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className={cn("mt-0.5 text-xl font-extrabold", tone)}>{value.toLocaleString("en-IN")}</p>
                    <p className="text-[10px] text-muted-foreground">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Automatic Priority Detection Breakdown */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-elevated p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground">Priority Breakdown (New Leads):</span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-bold text-rose-600 dark:text-rose-400">
                    ⚡ High ({summary.highCount.toLocaleString("en-IN")}) — Front of Queue
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-600 dark:text-amber-400">
                    🔶 Medium ({summary.mediumCount.toLocaleString("en-IN")}) — Follow-ups
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 font-bold text-slate-600 dark:text-slate-400">
                    🔷 Low ({summary.lowCount.toLocaleString("en-IN")}) — New Enquiries
                  </span>
                </div>
                {autoAssignQ.data?.status === "STOPPED" && (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                    <Info className="h-3.5 w-3.5" /> Auto-assign stopped: Leads stay in queue
                  </span>
                )}
              </div>

              {/* OLD DATA MANAGEMENT STRATEGY SELECTOR */}
              {summary.existingCount > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
                      <History className="h-4 w-4" />
                      <span>Old Data Management ({summary.existingCount} existing leads detected)</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Uncontacted: <b>{uncontactedExistingCount}</b> · Already Contacted: <b>{summary.existingCount - uncontactedExistingCount}</b> (Protected)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose how the system should handle records that already exist in your CRM database:
                  </p>

                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {/* Option 1: Retain Existing (Default) */}
                    <div
                      onClick={() => setExistingStrategy("RETAIN")}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3 transition flex flex-col justify-between",
                        existingStrategy === "RETAIN"
                          ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                          : "border-border bg-card hover:border-muted-foreground/40"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-foreground flex items-center gap-1.5">
                            <ShieldCheck className="h-4 w-4 text-emerald-500" /> Retain Existing
                          </span>
                          {existingStrategy === "RETAIN" && <Check className="h-4 w-4 text-emerald-500" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Keep all existing lead details, assigned agents, call history, and notes 100% intact. Zero changes to old records.
                        </p>
                      </div>
                      <span className="mt-2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        Recommended &amp; Safe
                      </span>
                    </div>

                    {/* Option 2: Reassign Uncontacted to Folder Queue */}
                    <div
                      onClick={() => setExistingStrategy("REASSIGN_TO_QUEUE")}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3 transition flex flex-col justify-between",
                        existingStrategy === "REASSIGN_TO_QUEUE"
                          ? "border-amber-500 bg-amber-500/10 shadow-sm"
                          : "border-border bg-card hover:border-muted-foreground/40"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-foreground flex items-center gap-1.5">
                            <RotateCcw className="h-4 w-4 text-amber-500" /> Re-queue Uncontacted
                          </span>
                          {existingStrategy === "REASSIGN_TO_QUEUE" && <Check className="h-4 w-4 text-amber-500" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Move {uncontactedExistingCount} uncalled old leads into the unassigned queue for folder {folderDate}. Contacted leads stay preserved.
                        </p>
                      </div>
                      <span className="mt-2 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {uncontactedExistingCount} Eligible Leads
                      </span>
                    </div>

                    {/* Option 3: Reassign to Specific Agent */}
                    <div
                      onClick={() => setExistingStrategy("REASSIGN_TO_AGENT")}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3 transition flex flex-col justify-between",
                        existingStrategy === "REASSIGN_TO_AGENT"
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border bg-card hover:border-muted-foreground/40"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-foreground flex items-center gap-1.5">
                            <UserCheck className="h-4 w-4 text-primary" /> Assign to Agent
                          </span>
                          {existingStrategy === "REASSIGN_TO_AGENT" && <Check className="h-4 w-4 text-primary" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Reassign uncontacted old leads directly to a selected agent. Preserves all contacted leads and logs assignment history.
                        </p>
                      </div>

                      {existingStrategy === "REASSIGN_TO_AGENT" && (
                        <div className="mt-2">
                          <Select value={targetAgentId} onValueChange={setTargetAgentId}>
                            <SelectTrigger className="h-7 text-xs bg-background">
                              <SelectValue placeholder="Select target agent" />
                            </SelectTrigger>
                            <SelectContent>
                              {agents.map((a) => (
                                <SelectItem key={a.id} value={a.id} className="text-xs">
                                  {a.full_name || a.email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Table Search & Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border bg-elevated p-1 text-xs">
                  {([
                    ["all", `All (${summary.total})`],
                    ["new", `New Leads (${summary.newCount})`],
                    ["existing", `Old / CRM Data (${summary.existingCount})`],
                    ["file_dup", `File Duplicates (${summary.duplicateInFile})`],
                    ["error", `Errors (${summary.errorCount})`],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setActiveTabFilter(k)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap",
                        activeTabFilter === k
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search name or mobile…"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              {/* Preview Table */}
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Customer Name</th>
                      <th className="px-3 py-2">Mobile</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Loan Details</th>
                      <th className="px-3 py-2">Record Classification</th>
                      <th className="px-3 py-2">Existing Status / Assignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.slice(0, 50).map((r) => {
                      const bad = r.errors.length > 0;
                      const fileDup = r.duplicateInFile;
                      const existing = r.duplicateExisting;

                      return (
                        <tr
                          key={r.rowNumber}
                          className={cn(
                            "border-t transition",
                            bad && "bg-destructive/5",
                            !bad && fileDup && "bg-rose-500/5",
                            !bad && existing && "bg-amber-500/5"
                          )}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                          <td className="px-3 py-2 font-medium">{r.draft.customer_name || "—"}</td>
                          <td className="px-3 py-2 font-mono">{r.draft.mobile || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border",
                              r.draft.priority === "HIGH" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30" :
                              r.draft.priority === "MEDIUM" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" :
                              "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30"
                            )}>
                              {r.draft.priority === "HIGH" ? "⚡ High" : r.draft.priority === "MEDIUM" ? "🔶 Med" : "🔷 Low"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold">₹{r.draft.loan_amount.toLocaleString("en-IN")}</span>
                            <span className="text-muted-foreground ml-1">· {r.draft.loan_type}</span>
                          </td>
                          <td className="px-3 py-2">
                            {bad ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                                <X className="h-3 w-3" />{r.errors.join(", ")}
                              </span>
                            ) : fileDup ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-rose-500">
                                <Copy className="h-3 w-3" />Duplicate in File
                              </span>
                            ) : existing ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                                <History className="h-3 w-3" />Existing CRM Record
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />New Lead
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {existing && r.existingRecord ? (
                              <div className="flex flex-col text-[11px] leading-tight">
                                <span className="font-semibold text-foreground">
                                  {r.existingRecord.agent_name ? `Assigned to ${r.existingRecord.agent_name}` : "Unassigned"}
                                </span>
                                <span className="text-muted-foreground text-[10px]">
                                  Folder: {r.existingRecord.folder_date || "—"} · Status: {r.existingRecord.status}
                                  {r.existingRecord.last_call_at ? " · (Called)" : " · (Never Called)"}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredPreviewRows.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 50 of {filteredPreviewRows.length.toLocaleString("en-IN")} filtered rows.
                </p>
              )}
            </div>
          )}

          {/* STEP 3: PROGRESS & COMPLETION */}
          {step === 3 && (
            <div className="space-y-5 py-4">
              {!result ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm font-extrabold uppercase tracking-wider">Processing Lead Data</p>
                    <p className="mt-1 text-xs text-muted-foreground">{phase}</p>
                  </div>
                  <Progress value={pct} className="mx-auto max-w-xl" />
                  <p className="text-center text-sm font-semibold">
                    {pct}% · {importedCount.toLocaleString("en-IN")} / {totalToImport.toLocaleString("en-IN")} new leads imported
                  </p>
                  <div className="mx-auto grid max-w-xl grid-cols-4 gap-3">
                    {([
                      ["New Imported", importedCount, "text-success"],
                      ["Existing CRM", ctxRef.current?.existingCount ?? 0, "text-amber-500"],
                      ["File Duplicates", ctxRef.current?.duplicates ?? 0, "text-warning"],
                      ["Errors", ctxRef.current?.errors ?? 0, "text-destructive"],
                    ] as const).map(([l, v, tone]) => (
                      <div key={l} className="rounded-xl border bg-elevated p-3 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
                        <p className={cn("text-lg font-extrabold", tone)}>{typeof v === "number" ? v.toLocaleString("en-IN") : v}</p>
                      </div>
                    ))}
                  </div>
                  {failedBatches.length > 0 && (
                    <div className="mx-auto max-w-xl space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      {failedBatches.map((b) => (
                        <p key={b.index}>Batch {b.index + 1} failed. Reason: {b.error}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  {result.cancelled ? <XCircle className="mx-auto h-10 w-10 text-warning" />
                    : result.failedBatches > 0 ? <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
                    : <CheckCircle2 className="mx-auto h-10 w-10 text-success" />}
                  <p className="text-lg font-extrabold tracking-tight">
                    {result.cancelled ? "IMPORT CANCELLED" : result.failedBatches > 0 ? "IMPORT INCOMPLETE" : "DATA PROCESSING COMPLETE"}
                  </p>
                  <div className="mx-auto grid max-w-xl grid-cols-4 gap-3">
                    {([
                      ["New Leads Added", result.imported, "text-success"],
                      ["Old Data Handled", result.reassignedCount > 0 ? result.reassignedCount : result.existingCount, "text-amber-500"],
                      ["Skipped Duplicates", result.skipped, "text-warning"],
                      ["Validation Errors", result.invalid, "text-destructive"]
                    ] as const).map(([l, v, tone]) => (
                      <div key={l} className="rounded-xl border bg-elevated p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
                        <p className={cn("text-xl font-extrabold", tone)}>{v.toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                  </div>

                  {result.strategy !== "RETAIN" && result.reassignedCount > 0 && (
                    <p className="text-xs font-semibold text-primary">
                      ⚡ Strategy Applied: {result.reassignedCount} uncontacted old leads were successfully {
                        result.strategy === "REASSIGN_TO_QUEUE" ? "moved to the folder queue" : "reassigned to the selected agent"
                      }.
                    </p>
                  )}

                  {result.failedBatches > 0 && (
                    <div className="mx-auto max-w-xl space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      {failedBatches.map((b) => (
                        <p key={b.index}>Batch {b.index + 1} failed. Reason: {b.error}</p>
                      ))}
                      <p className="pt-1 font-semibold">Retrying is safe — already imported rows are never duplicated.</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    All new leads are saved in folder <b>{folderDate}</b> and auto-prioritized.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 border-t bg-elevated p-4">
          {step === 1 && (
            <>
              <Button variant="ghost" onClick={() => setStep(0)} disabled={busy}>Back</Button>
              <Button onClick={runValidation} disabled={busy || missingRequired.length > 0} className="gradient-brand text-white">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Preview &amp; Validate
              </Button>
            </>
          )}

          {step === 2 && summary && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>Back</Button>
              {(summary.errorCount > 0 || summary.duplicateInFile > 0 || summary.duplicateExisting > 0) && (
                <Button variant="outline" onClick={() => downloadErrorReport(summary.rows, parsed?.fileName ?? "leads")}>
                  <Download className="mr-1 h-4 w-4" /> Download Report
                </Button>
              )}
              <Button
                onClick={startImport}
                disabled={busy || importing || (importable.length === 0 && (existingStrategy === "RETAIN" || existingRows.length === 0))}
                className="gradient-brand text-white"
              >
                {importable.length > 0
                  ? `Process ${importable.length.toLocaleString("en-IN")} New Lead${importable.length === 1 ? "" : "s"}`
                  : `Execute Old Data Strategy (${uncontactedExistingCount} Leads)`}
              </Button>
            </>
          )}

          {step === 3 && !result && (
            <Button variant="outline" onClick={() => { cancelRef.current.cancelled = true; setPhase("Cancelling after current batch…"); }}>
              <XCircle className="mr-1 h-4 w-4" /> Cancel Import
            </Button>
          )}

          {step === 3 && result && (
            <>
              {result.failedBatches > 0 && (
                <Button variant="outline" onClick={retryFailed} disabled={importing}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Retry Failed Batches
                </Button>
              )}
              {result.cancelled && (
                <Button variant="outline" onClick={retryFailed} disabled={importing}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Resume Import
                </Button>
              )}
              {summary && (summary.errorCount > 0 || result.skipped > 0) && (
                <Button variant="outline" onClick={() => downloadErrorReport(summary.rows, parsed?.fileName ?? "leads")}>
                  <Download className="mr-1 h-4 w-4" /> Download Error Report
                </Button>
              )}
              <Button variant="outline" onClick={() => { close(false); }}>Go To Daily Leads</Button>
              <Button className="gradient-brand text-white" onClick={() => { onViewImported(); close(false); }}>
                View Leads
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
