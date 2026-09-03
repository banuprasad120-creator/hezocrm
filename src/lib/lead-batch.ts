import { supabase } from "@/integrations/supabase/client";

export interface LeadBatch {
  id: string;
  company_id: string;
  employee_id: string;
  batch_number: number;
  batch_size: number;
  assigned_count: number;
  lead_ids: string[];
  status: "IN_PROGRESS" | "COMPLETED";
  assigned_at: string;
  completed_at: string | null;
  assignment_source: string;
  created_by: string;
}

export interface CompanyBatchSettings {
  enabled: boolean;
  batchSize: number;
}

/**
 * Fetch company lead batch automation settings.
 * Defaults to enabled: true, batchSize: 100.
 */
export async function getCompanyBatchSettings(companyId: string): Promise<CompanyBatchSettings> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.from as any)("companies")
      .select("lead_batch_automation_enabled, agent_lead_batch_size")
      .eq("id", companyId)
      .maybeSingle();

    if (error || !data) {
      return { enabled: true, batchSize: 100 };
    }

    return {
      enabled: data.lead_batch_automation_enabled ?? true,
      batchSize: Number(data.agent_lead_batch_size) || 100,
    };
  } catch {
    return { enabled: true, batchSize: 100 };
  }
}

/**
 * Update company lead batch automation settings.
 */
export async function updateCompanyBatchSettings(
  companyId: string,
  enabled: boolean,
  batchSize: number
): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error } = await (supabase.from as any)("companies")
    .update({
      lead_batch_automation_enabled: enabled,
      agent_lead_batch_size: Math.max(1, batchSize),
    })
    .eq("id", companyId);

  if (error) throw error;
}

/**
 * Get active batch information for an agent.
 */
export async function getActiveAgentBatch(
  companyId: string,
  employeeId: string
): Promise<LeadBatch | null> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.from as any)("lead_batches")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .eq("status", "IN_PROGRESS")
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as LeadBatch;
  } catch {
    return null;
  }
}

/**
 * Fetch batch allocation audit logs for administrators.
 */
export async function getBatchAuditLogs(companyId: string, limit = 50): Promise<LeadBatch[]> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.from as any)("lead_batches")
      .select("*")
      .eq("company_id", companyId)
      .order("assigned_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as LeadBatch[];
  } catch {
    return [];
  }
}

export interface AllocationResult {
  success: boolean;
  message: string;
  assigned_count?: number;
  batch_number?: number;
  batch_id?: string;
  batch_size?: number;
  remaining_pending?: number;
}

/**
 * Request next batch of leads for an agent atomically via Supabase RPC.
 * Fallback to direct client transaction if RPC is unavailable.
 */
export async function allocateNextLeadBatch(
  companyId: string,
  employeeId: string,
  batchSize = 100,
  source = "AUTO_BATCH_REFILL"
): Promise<AllocationResult> {
  try {
    // 1. Try atomic PostgreSQL RPC function
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)("allocate_lead_batch", {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_batch_size: batchSize,
      p_source: source,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes as AllocationResult;
    }

    // 2. Client-side fallback if RPC is ever unreachable
    return await clientSideFallbackAllocate(companyId, employeeId, batchSize, source);
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : "Failed to allocate lead batch",
      assigned_count: 0,
    };
  }
}

/**
 * Safe client-side fallback allocation with strict deduplication
 */
async function clientSideFallbackAllocate(
  companyId: string,
  employeeId: string,
  batchSize: number,
  source: string
): Promise<AllocationResult> {
  // Check if agent already has pending leads
  const { count: pendingCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("assigned_to", employeeId)
    .in("status", ["New", "Assigned"]);

  if ((pendingCount ?? 0) > 0) {
    return {
      success: false,
      message: `Agent already has ${pendingCount} pending leads in current batch`,
      assigned_count: 0,
      remaining_pending: pendingCount ?? 0,
    };
  }

  // Fetch company history of assigned/called numbers to strictly exclude
  const { data: historyLeads } = await supabase
    .from("leads")
    .select("mobile")
    .eq("company_id", companyId)
    .or("assigned_to.not.is.null,last_call_at.not.is.null,status.neq.New");

  const alreadySentMobiles = new Set<string>();
  for (const item of historyLeads ?? []) {
    const clean = (item.mobile || "").replace(/\D/g, "").slice(-10);
    if (clean) alreadySentMobiles.add(clean);
  }

  // Fetch unassigned leads
  const { data: unassigned, error } = await supabase
    .from("leads")
    .select("id, mobile")
    .eq("company_id", companyId)
    .is("assigned_to", null)
    .eq("status", "New")
    .order("folder_date", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(batchSize * 3);

  if (error || !unassigned || unassigned.length === 0) {
    return {
      success: true,
      message: "No unassigned leads available in company",
      assigned_count: 0,
    };
  }

  const idsToAssign: string[] = [];
  const mobilesToLock: string[] = [];
  const seenMobiles = new Set<string>();

  for (const item of unassigned) {
    const cleanMob = (item.mobile || "").replace(/\D/g, "").slice(-10);
    if (cleanMob) {
      if (alreadySentMobiles.has(cleanMob)) continue;
      if (!seenMobiles.has(cleanMob)) {
        seenMobiles.add(cleanMob);
        idsToAssign.push(item.id);
        if (item.mobile) mobilesToLock.push(item.mobile);
        if (idsToAssign.length >= batchSize) break;
      }
    } else {
      idsToAssign.push(item.id);
      if (idsToAssign.length >= batchSize) break;
    }
  }

  if (idsToAssign.length === 0) {
    return {
      success: true,
      message: "No eligible unassigned leads available in company",
      assigned_count: 0,
    };
  }

  const now = new Date().toISOString();

  // Mark previous IN_PROGRESS batches completed
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (supabase.from as any)("lead_batches")
    .update({ status: "COMPLETED", completed_at: now })
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("status", "IN_PROGRESS");

  // Get next batch number
  const { data: prevBatches } = await (supabase.from as any)("lead_batches")
    .select("batch_number")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .order("batch_number", { ascending: false })
    .limit(1);

  const nextBatchNum = (prevBatches?.[0]?.batch_number ?? 0) + 1;

  // Update leads
  await supabase
    .from("leads")
    .update({ assigned_to: employeeId, assigned_at: now, status: "Assigned" })
    .in("id", idsToAssign);

  // Lock duplicate mobiles
  if (mobilesToLock.length > 0) {
    await supabase
      .from("leads")
      .update({ assigned_to: employeeId, assigned_at: now, status: "Assigned" })
      .in("mobile", mobilesToLock)
      .eq("company_id", companyId);
  }

  // Insert lead_assignments
  await supabase.from("lead_assignments").upsert(
    idsToAssign.map((id) => ({
      lead_id: id,
      company_id: companyId,
      employee_id: employeeId,
      assigned_by: employeeId,
    })),
    { onConflict: "lead_id" }
  );

  // Insert lead_batches
  const { data: newBatch } = await (supabase.from as any)("lead_batches")
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      batch_number: nextBatchNum,
      batch_size: batchSize,
      assigned_count: idsToAssign.length,
      lead_ids: idsToAssign,
      status: "IN_PROGRESS",
      assigned_at: now,
      assignment_source: source,
      created_by: "SYSTEM",
    })
    .select("id")
    .single();

  return {
    success: true,
    batch_id: newBatch?.id,
    batch_number: nextBatchNum,
    assigned_count: idsToAssign.length,
    batch_size: batchSize,
    message: `${idsToAssign.length} new leads assigned in Batch #${nextBatchNum}`,
  };
}
