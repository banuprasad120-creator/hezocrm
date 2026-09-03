import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, Loader2, RefreshCw, Upload, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  IMPORT_BATCH_SIZE, VALIDATION_CHUNK, buildBatches, createImportRecord, fetchExistingMobiles,
  runBatchedImport, updateImportRecord,
  type BatchState, type Canceller, type ImportContext,
} from "@/lib/lead-import-runner";

const STEPS = ["Upload", "Map Columns", "Preview & Validate", "Import"] as const;

type Result = {
  imported: number;
  skipped: number;
  invalid: number;
  cancelled: boolean;
  failedBatches: number;
};

export function ImportLeadsWizard({
  open, onOpenChange, companyId, userId, folderDate, onViewImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string | null;
  userId: string | null;
  folderDate: string;
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

  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<number, HezoField | "">>({});
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [dupMode, setDupMode] = useState<"skip" | "import">("skip");
  const [phase, setPhase] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<BatchState[]>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => {
    setStep(0); setParsed(null); setMapping({}); setSummary(null); setDupMode("skip");
    setPhase(""); setBusy(false); setImporting(false); setBatches([]); setCurrentBatch(0);
    setImportedCount(0); setResult(null); setSelectedCompanyId("");
    cancelRef.current = { cancelled: false };
    ctxRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };

  // Modal cannot be dismissed while an import is running.
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
      const existing = await fetchExistingMobiles(effectiveCompanyId, mobiles, (done, total) =>
        setPhase(`Checking duplicates ${done.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")}…`));
      setSummary(applyExistingDuplicates(rows, existing));
      setStep(2);
    } catch (err) {
      const detail = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
      toast.error(detail ? `Validation failed — ${detail}` : "Validation failed", { duration: 8000 });

    } finally {
      setBusy(false); setPhase("");
    }
  };

  const importable = useMemo(() => {
    if (!summary) return [] as ValidatedRow[];
    return summary.rows.filter((r) => r.errors.length === 0 && (dupMode === "import" || (!r.duplicateInFile && !r.duplicateExisting)));
  }, [summary, dupMode]);

  const finish = async (
    ctx: ImportContext,
    imported: number,
    failed: BatchState[],
    cancelled: boolean,
  ) => {
    const status = cancelled ? "cancelled" : failed.length > 0 ? "failed" : "completed";
    await updateImportRecord(ctx.importId, {
      imported_count: imported,
      processed_rows: imported + ctx.duplicates + ctx.errors,
      status,
      completed_at: new Date().toISOString(),
    });
    setResult({
      imported,
      skipped: ctx.duplicates,
      invalid: ctx.errors,
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
    if (importable.length === 0) return toast.error("No valid rows to import");

    const ctx: ImportContext = {
      companyId: effectiveCompanyId,
      userId,
      folderDate,
      fileName: parsed.fileName,
      importId: crypto.randomUUID(),
      rows: importable,
      totalRows: summary.total,
      duplicates: dupMode === "import" ? 0 : summary.duplicateInFile + summary.duplicateExisting,
      errors: summary.errorCount,
    };
    ctxRef.current = ctx;
    cancelRef.current = { cancelled: false };

    const initial = buildBatches(importable.length, IMPORT_BATCH_SIZE);
    setBatches(initial); setCurrentBatch(0); setImportedCount(0); setResult(null);
    setStep(3); setImporting(true); setPhase("Preparing import…");

    try {
      await createImportRecord(ctx, initial.length);
      const { imported, failed, cancelled } = await runBatchedImport(
        ctx, initial, cancelRef.current,
        (b, imp, cur) => { setBatches(b); setImportedCount(imp); setCurrentBatch(cur); setPhase(`Importing batch ${cur} of ${b.length}…`); },
      );
      setBatches((prev) => prev);
      await finish(ctx, imported, failed, cancelled);
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
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b bg-elevated p-4 sm:p-5">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileSpreadsheet className="h-5 w-5 text-brand" /> Import Leads
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Folder 📁 {folderDate.split("-").reverse().join("-")} · leads arrive as New &amp; Unassigned.
          </DialogDescription>
          <ol className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap pb-1 sm:mt-3 sm:flex-wrap">
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

        <div className="max-h-[60dvh] overflow-y-auto p-5">
          {step === 0 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition hover:border-brand/50 hover:bg-muted/30"
              >
                <Upload className="h-8 w-8 text-brand" />
                <span className="text-sm font-semibold">Upload Excel / CSV</span>
                <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv — first sheet is used · up to 25,000+ rows</span>
              </button>
              <input
                ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-elevated p-4">
                <div>
                  <p className="text-sm font-semibold">Not sure about the format?</p>
                  <p className="text-xs text-muted-foreground">Download the sample file with all supported columns.</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadSampleFile}>
                  <Download className="mr-1 h-4 w-4" /> Download Sample Excel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Required: <b>Customer Name</b>, <b>Mobile Number</b>. All other columns are optional.
              </p>
              {busy && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{phase}</p>}
            </div>
          )}

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
                Confirm or change how each file column maps to a Hezo field.
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

          {step === 2 && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {([
                  ["Total Rows", summary.total, "text-foreground"],
                  ["Valid", summary.valid, "text-success"],
                  ["Duplicate in file", summary.duplicateInFile, "text-warning"],
                  ["Duplicate existing", summary.duplicateExisting, "text-warning"],
                  ["Errors", summary.errorCount, "text-destructive"],
                ] as const).map(([label, value, tone]) => (
                  <div key={label} className="rounded-xl border bg-elevated p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className={cn("mt-0.5 text-xl font-extrabold", tone)}>{value.toLocaleString("en-IN")}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-elevated p-4">
                <div>
                  <p className="text-sm font-semibold">Duplicate handling</p>
                  <p className="text-xs text-muted-foreground">Existing leads are never overwritten.</p>
                </div>
                <div className="flex gap-2">
                  {([["skip", "Skip duplicates"], ["import", "Import duplicates anyway"]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setDupMode(v)}
                      className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                        dupMode === v ? "gradient-brand border-transparent text-white" : "hover:bg-muted/50")}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Customer Name</th>
                      <th className="px-3 py-2">Mobile</th>
                      <th className="px-3 py-2">Loan Amount</th>
                      <th className="px-3 py-2">Loan Type</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.slice(0, 50).map((r) => {
                      const bad = r.errors.length > 0;
                      const dup = r.duplicateInFile || r.duplicateExisting;
                      return (
                        <tr key={r.rowNumber} className={cn("border-t", bad && "bg-destructive/5", !bad && dup && "bg-warning/5")}>
                          <td className="px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                          <td className="px-3 py-2 font-medium">{r.draft.customer_name || "—"}</td>
                          <td className="px-3 py-2 font-mono">{r.draft.mobile || "—"}</td>
                          <td className="px-3 py-2">{r.draft.loan_amount.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.draft.loan_type}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.draft.source}</td>
                          <td className="px-3 py-2">
                            {bad ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                                <X className="h-3 w-3" />{r.errors.join(", ")}
                              </span>
                            ) : dup ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-warning">
                                <Copy className="h-3 w-3" />{r.duplicateInFile ? "Duplicate inside file" : "Duplicate already exists"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-success">
                                <CheckCircle2 className="h-3 w-3" />Valid
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {summary.total > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 50 of {summary.total.toLocaleString("en-IN")} rows · import runs in batches of {IMPORT_BATCH_SIZE}.
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5 py-4">
              {!result ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm font-extrabold uppercase tracking-wider">Importing Leads</p>
                    <p className="mt-1 text-xs text-muted-foreground">{phase}</p>
                  </div>
                  <Progress value={pct} className="mx-auto max-w-xl" />
                  <p className="text-center text-sm font-semibold">
                    {pct}% · {importedCount.toLocaleString("en-IN")} / {totalToImport.toLocaleString("en-IN")}
                  </p>
                  <div className="mx-auto grid max-w-xl grid-cols-4 gap-3">
                    {([
                      ["Imported", importedCount, "text-success"],
                      ["Duplicates", ctxRef.current?.duplicates ?? 0, "text-warning"],
                      ["Errors", ctxRef.current?.errors ?? 0, "text-destructive"],
                      ["Batch", `${currentBatch} / ${batches.length}`, "text-foreground"],
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
                    {result.cancelled ? "IMPORT CANCELLED" : result.failedBatches > 0 ? "IMPORT INCOMPLETE" : "IMPORT COMPLETE"}
                  </p>
                  <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
                    {([["Imported", result.imported, "text-success"], ["Skipped duplicates", result.skipped, "text-warning"], ["Invalid rows", result.invalid, "text-destructive"]] as const).map(([l, v, tone]) => (
                      <div key={l} className="rounded-xl border bg-elevated p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
                        <p className={cn("text-xl font-extrabold", tone)}>{v.toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                  </div>
                  {result.failedBatches > 0 && (
                    <div className="mx-auto max-w-xl space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      {failedBatches.map((b) => (
                        <p key={b.index}>Batch {b.index + 1} failed. Reason: {b.error}</p>
                      ))}
                      <p className="pt-1 font-semibold">Retrying is safe — already imported rows are never duplicated.</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    All imported leads are <b>New</b> and <b>Unassigned</b> in folder {folderDate}.
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
                  <Download className="mr-1 h-4 w-4" /> Download Error Report
                </Button>
              )}
              <Button onClick={startImport} disabled={busy || importing || importable.length === 0} className="gradient-brand text-white">
                Import {importable.length.toLocaleString("en-IN")} lead{importable.length === 1 ? "" : "s"}
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
                View Imported Leads
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
