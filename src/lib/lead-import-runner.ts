import { supabase } from "@/integrations/supabase/client";
import type { ValidatedRow, ExistingLeadRecord } from "@/lib/lead-import";

/** Configurable batch size for bulk inserts. 500 is safe for the Data API payload limit. */
export const IMPORT_BATCH_SIZE = 500;
/** Chunk size used when checking existing mobiles with a single `in()` query. */
export const DUPLICATE_LOOKUP_CHUNK = 500;
/** Rows validated per animation frame so the browser never freezes. */
export const VALIDATION_CHUNK = 1000;

export const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

const asError = (e: unknown, fallback: string) => {
  if (e instanceof Error) return e;
  const m = (e as { message?: string; hint?: string } | null)?.message;
  return new Error(m ? `${fallback}: ${m}` : fallback);
};

/**
 * Duplicate detection, scoped to the company.
 * Small files & large files: Uses Postgres indexed lookup via RPC check_existing_mobiles
 * with direct chunked index lookup fallback.
 * Checks candidate mobiles in chunks against idx_leads_company_mobile — fast, scalable, and memory efficient.
 */
export async function fetchExistingMobiles(
  companyId: string,
  mobiles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const unique = [...new Set(mobiles.filter(Boolean))];
  const existing = new Set<string>();
  if (unique.length === 0) return existing;

  for (let i = 0; i < unique.length; i += DUPLICATE_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + DUPLICATE_LOOKUP_CHUNK);

    try {
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)("check_existing_mobiles", {
        p_company_id: companyId,
        p_mobiles: chunk,
      });

      if (!rpcError && Array.isArray(rpcData)) {
        for (const m of (rpcData as string[])) {
          if (m) existing.add(String(m));
        }
      } else {
        const { data, error } = await supabase
          .from("leads")
          .select("mobile")
          .eq("company_id", companyId)
          .in("mobile", chunk);
        if (error) throw asError(error, "Could not check existing leads for duplicates");
        for (const r of data ?? []) existing.add(r.mobile);
      }
    } catch {
      const { data, error } = await supabase
        .from("leads")
        .select("mobile")
        .eq("company_id", companyId)
        .in("mobile", chunk);
      if (error) throw asError(error, "Could not check existing leads for duplicates");
      for (const r of data ?? []) existing.add(r.mobile);
    }

    onProgress?.(Math.min(i + chunk.length, unique.length), unique.length);
    await yieldToBrowser();
  }
  return existing;
}

/**
 * Detailed duplicate and existing lead lookup scoped to company.
 * Fetches full record metadata: id, customer_name, status, assigned agent, folder_date, last_call_at, notes, priority.
 * Used for previewing existing/old data and allowing admins to choose whether to retain or reassign.
 */
export async function fetchExistingLeadsDetails(
  companyId: string,
  mobiles: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ExistingLeadRecord>> {
  const unique = [...new Set(mobiles.filter(Boolean))];
  const existingMap = new Map<string, ExistingLeadRecord>();
  if (unique.length === 0) return existingMap;

  for (let i = 0; i < unique.length; i += DUPLICATE_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + DUPLICATE_LOOKUP_CHUNK);

    try {
      const { data, error } = await supabase
        .from("leads")
        .select("id, mobile, customer_name, status, assigned_to, folder_date, last_call_at, notes, priority, loan_amount, loan_type")
        .eq("company_id", companyId)
        .in("mobile", chunk);

      if (error) throw asError(error, "Could not check existing leads details");

      // For assigned leads, fetch agent names in batch
      const assignedUserIds = [...new Set((data ?? []).map((d) => d.assigned_to).filter(Boolean))] as string[];
      let agentNameMap = new Map<string, string>();

      if (assignedUserIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", assignedUserIds);
        if (profs) {
          for (const p of profs) {
            agentNameMap.set(p.id, p.full_name || p.email);
          }
        }
      }

      for (const row of data ?? []) {
        existingMap.set(row.mobile, {
          id: row.id,
          mobile: row.mobile,
          customer_name: row.customer_name,
          status: row.status,
          assigned_to: row.assigned_to,
          agent_name: row.assigned_to ? agentNameMap.get(row.assigned_to) || "Assigned Agent" : null,
          folder_date: row.folder_date,
          last_call_at: row.last_call_at,
          notes: row.notes,
          priority: (row.priority as any) || "LOW",
          loan_amount: row.loan_amount,
          loan_type: row.loan_type,
        });
      }
    } catch (err) {
      console.warn("[import-runner] fetchExistingLeadsDetails chunk warning:", err);
    }

    onProgress?.(Math.min(i + chunk.length, unique.length), unique.length);
    await yieldToBrowser();
  }
  return existingMap;
}

export type ExistingLeadsAction = "RETAIN" | "REASSIGN_TO_QUEUE" | "REASSIGN_TO_AGENT";

export async function executeExistingLeadsStrategy(params: {
  companyId: string;
  adminId: string | null;
  leadIds: string[];
  action: ExistingLeadsAction;
  targetFolder?: string;
  targetAgentId?: string | null;
  appendNotes?: string;
}): Promise<{ success: boolean; count: number; message: string }> {
  if (params.leadIds.length === 0 || params.action === "RETAIN") {
    return { success: true, count: params.leadIds.length, message: `Retained existing assignments for ${params.leadIds.length} leads.` };
  }

  const { data, error } = await (supabase.rpc as any)("handle_existing_leads_action", {
    p_company_id: params.companyId,
    p_admin_id: params.adminId,
    p_lead_ids: params.leadIds,
    p_action: params.action,
    p_target_folder: params.targetFolder || null,
    p_target_agent_id: params.targetAgentId || null,
    p_append_notes: params.appendNotes || null,
  });

  if (error) throw new Error(error.message || "Failed to execute existing leads strategy");
  return data;
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
  rows: ValidatedRow[]; // importable new rows
  existingRows?: ValidatedRow[]; // rows that match existing CRM records
  existingLeadIds?: string[];
  existingStrategy?: ExistingLeadsAction;
  targetAgentId?: string | null;
  totalRows: number; // rows in the file
  duplicates: number;
  existingCount: number;
  reassignedCount: number;
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
    existing_count: ctx.existingCount || 0,
    reassigned_count: ctx.reassignedCount || 0,
    strategy: ctx.existingStrategy || "retain",
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
  existing_count: number;
  reassigned_count: number;
  strategy: string;
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
