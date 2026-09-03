import { supabase } from "@/integrations/supabase/client";
import type { ValidatedRow } from "@/lib/lead-import";

/** Configurable batch size for bulk inserts. 500 is safe for the Data API payload limit. */
export const IMPORT_BATCH_SIZE = 500;
/** Chunk size used when checking existing mobiles with a single `in()` query. */
export const DUPLICATE_LOOKUP_CHUNK = 500;
/** Rows validated per animation frame so the browser never freezes. */
export const VALIDATION_CHUNK = 1000;

export const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

/** Above this many mobiles, scanning the company's own leads once is cheaper than many `in()` queries. */
const FULL_SCAN_THRESHOLD = 2000;
const FULL_SCAN_PAGE = 1000;

const asError = (e: unknown, fallback: string) => {
  if (e instanceof Error) return e;
  const m = (e as { message?: string; hint?: string } | null)?.message;
  return new Error(m ? `${fallback}: ${m}` : fallback);
};

/**
 * Duplicate detection, scoped to the company.
 * Small files: chunked `in()` queries. Large files: one paged scan of the company's mobiles.
 * Never one query per row.
 */
export async function fetchExistingMobiles(
  companyId: string,
  mobiles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const unique = [...new Set(mobiles.filter(Boolean))];
  const existing = new Set<string>();
  if (unique.length === 0) return existing;

  if (unique.length > FULL_SCAN_THRESHOLD) {
    for (let from = 0; ; from += FULL_SCAN_PAGE) {
      const { data, error } = await supabase
        .from("leads")
        .select("mobile")
        .eq("company_id", companyId)
        .order("mobile", { ascending: true })
        .range(from, from + FULL_SCAN_PAGE - 1);
      if (error) throw asError(error, "Could not check existing leads for duplicates");
      for (const r of data ?? []) existing.add(r.mobile);
      onProgress?.(existing.size, unique.length);
      await yieldToBrowser();
      if (!data || data.length < FULL_SCAN_PAGE) break;
    }
    return existing;
  }

  for (let i = 0; i < unique.length; i += DUPLICATE_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + DUPLICATE_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("leads")
      .select("mobile")
      .eq("company_id", companyId)
      .in("mobile", chunk);
    if (error) throw asError(error, "Could not check existing leads for duplicates");
    for (const r of data ?? []) existing.add(r.mobile);
    onProgress?.(Math.min(i + chunk.length, unique.length), unique.length);
    await yieldToBrowser();
  }
  return existing;
}


export type BatchState = {
  index: number;
  from: number;
  to: number;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  inserted: number;
  error?: string;
};

export type ImportProgress = {
  phase: "idle" | "importing" | "completed" | "cancelled" | "failed";
  processed: number;
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  currentBatch: number;
  totalBatches: number;
  batches: BatchState[];
  message: string;
};

export type ImportContext = {
  companyId: string;
  userId: string | null;
  folderDate: string;
  fileName: string;
  importId: string;
  rows: ValidatedRow[]; // importable rows only
  totalRows: number; // rows in the file
  duplicates: number;
  errors: number;
};

export function buildBatches(count: number, size = IMPORT_BATCH_SIZE): BatchState[] {
  const batches: BatchState[] = [];
  for (let from = 0, i = 0; from < count; from += size, i++) {
    batches.push({ index: i, from, to: Math.min(from + size, count), status: "pending", inserted: 0 });
  }
  return batches;
}

function toRecords(ctx: ImportContext, batch: BatchState) {
  return ctx.rows.slice(batch.from, batch.to).map((r, i) => ({
    ...r.draft,
    company_id: ctx.companyId,
    folder_date: ctx.folderDate,
    status: "New" as const,
    assigned_to: null,
    created_by: ctx.userId,
    import_id: ctx.importId,
    // Stable per-import row key -> retrying a batch can never duplicate rows.
    import_row: batch.from + i,
  }));
}

/**
 * Insert one batch. Idempotent: `(import_id, import_row)` is uniquely indexed and
 * we upsert on that key, so a retry of a partially-applied batch inserts nothing new.
 */
export async function insertBatch(ctx: ImportContext, batch: BatchState): Promise<number> {
  const records = toRecords(ctx, batch);
  const { data, error } = await supabase
    .from("leads")
    .upsert(records, { onConflict: "import_id,import_row", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("[import] batch failed", batch.index + 1, error);
    throw new Error(error.message || error.code || "Insert failed");
  }
  // With ignoreDuplicates the response only contains newly inserted rows on a retry.
  return data?.length ?? records.length;
}

export async function createImportRecord(ctx: ImportContext, totalBatches: number) {
  const { error } = await supabase.from("lead_imports").insert({
    id: ctx.importId,
    company_id: ctx.companyId,
    imported_by: ctx.userId,
    file_name: ctx.fileName,
    folder_date: ctx.folderDate,
    total_rows: ctx.totalRows,
    imported_count: 0,
    duplicate_count: ctx.duplicates,
    error_count: ctx.errors,
    processed_rows: 0,
    current_batch: 0,
    total_batches: totalBatches,
    status: "processing",
  });
  if (error) throw error;
}

export type ImportPatch = Partial<{
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  processed_rows: number;
  current_batch: number;
  status: string;
  completed_at: string | null;
}>;

export async function updateImportRecord(importId: string, patch: ImportPatch) {
  const { error } = await supabase.from("lead_imports").update(patch).eq("id", importId);
  if (error) console.error("[import] progress update failed", error.message);
}

export type Canceller = { cancelled: boolean };

/**
 * Runs (or resumes) the batched import. Only batches that are not already `done`
 * are processed, so this doubles as retry/resume.
 */
export async function runBatchedImport(
  ctx: ImportContext,
  batches: BatchState[],
  canceller: Canceller,
  onUpdate: (batches: BatchState[], imported: number, currentBatch: number) => void,
): Promise<{ imported: number; failed: BatchState[]; cancelled: boolean }> {
  const state = batches.map((b) => ({ ...b }));
  let imported = state.reduce((s, b) => s + (b.status === "done" ? b.inserted : 0), 0);

  for (const batch of state) {
    if (batch.status === "done") continue;
    if (canceller.cancelled) {
      return { imported, failed: state.filter((b) => b.status === "failed"), cancelled: true };
    }
    batch.status = "running";
    batch.error = undefined as string | undefined;
    onUpdate([...state], imported, batch.index + 1);
    try {
      const inserted = await insertBatch(ctx, batch);
      batch.inserted = inserted;
      batch.status = "done";
      imported += inserted;
      onUpdate([...state], imported, batch.index + 1);
      await updateImportRecord(ctx.importId, {
        imported_count: imported,
        processed_rows: batch.to,
        current_batch: batch.index + 1,
      });
    } catch (err) {
      batch.status = "failed";
      batch.error = err instanceof Error ? err.message : "Unknown error";
      onUpdate([...state], imported, batch.index + 1);
    }
    await yieldToBrowser();
  }

  return { imported, failed: state.filter((b) => b.status === "failed"), cancelled: false };
}
