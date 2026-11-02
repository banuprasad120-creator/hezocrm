import { supabase } from "@/integrations/supabase/client";

export type AutoAssignStatus = "RUNNING" | "PAUSED" | "STOPPED";

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
  status: AutoAssignStatus;
  activeFolder?: string | null;
}

export interface ControlActionResult {
  success: boolean;
  status: AutoAssignStatus;
  message: string;
  folder?: string | null;
  agents_refilled?: number;
  total_leads_assigned?: number;
  recalled_count?: number;
}

export interface DistributeResult {
  success: boolean;
  agents_count: number;
  total_assigned: number;
  message: string;
}

/**
 * Fetch company lead batch automation settings.
 * Defaults to enabled: true, batchSize: 100, status: 'RUNNING'.
 */
export async function getCompanyBatchSettings(companyId: string): Promise<CompanyBatchSettings> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.from as any)("companies")
      .select("lead_batch_automation_enabled, agent_lead_batch_size, auto_assign_status, active_auto_assign_folder")
      .eq("id", companyId)
      .maybeSingle();

    if (error || !data) {
      return { enabled: true, batchSize: 100, status: "RUNNING", activeFolder: null };
    }

    const rawStatus = (data.auto_assign_status as string) || (data.lead_batch_automation_enabled ? "RUNNING" : "PAUSED");
    const status: AutoAssignStatus = rawStatus === "STOPPED" ? "STOPPED" : rawStatus === "PAUSED" ? "PAUSED" : "RUNNING";

    return {
      enabled: status === "RUNNING",
      batchSize: Number(data.agent_lead_batch_size) || 100,
      status,
      activeFolder: (data.active_auto_assign_folder as string) || null,
    };
  } catch {
    return { enabled: true, batchSize: 100, status: "RUNNING", activeFolder: null };
  }
}

/**
 * Update company lead batch automation settings.
 */
export async function updateCompanyBatchSettings(
  companyId: string,
  enabled: boolean,
  batchSize: number,
  status?: AutoAssignStatus,
  activeFolder?: string | null
): Promise<void> {
  const currentStatus: AutoAssignStatus = status ?? (enabled ? "RUNNING" : "PAUSED");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const payload: any = {
    lead_batch_automation_enabled: currentStatus === "RUNNING",
    auto_assign_status: currentStatus,
    agent_lead_batch_size: Math.max(1, batchSize),
  };
  if (activeFolder !== undefined) {
    payload.active_auto_assign_folder = activeFolder && activeFolder !== "all" ? activeFolder : null;
  }
  const { error } = await (supabase.from as any)("companies")
    .update(payload)
    .eq("id", companyId);

  if (error) throw error;
}

/**
 * Set active folder target for auto-assignment.
 */
export async function setActiveAutoAssignFolder(
  companyId: string,
  folderDate: string | null
): Promise<ControlActionResult> {
  try {
    const cleanFolder = folderDate && folderDate !== "all" ? folderDate : null;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.rpc as any)("set_auto_assign_folder", {
      p_company_id: companyId,
      p_folder_date: cleanFolder,
    });
    if (error) throw error;
    return (data as ControlActionResult) || {
      success: true,
      status: "RUNNING",
      folder: cleanFolder,
      message: `Auto-assign folder set to ${cleanFolder || "all folders"}.`,
    };
  } catch {
    await updateCompanyBatchSettings(companyId, true, 100, undefined, folderDate);
    return {
      success: true,
      status: "RUNNING",
      folder: folderDate,
      message: `Auto-assign target folder updated to ${folderDate || "all folders"}.`,
    };
  }
}

/**
 * Start Auto-Assignment (RUNNING):
 * Sets status to RUNNING and immediately triggers batch allocation for all active agents with 0 pending leads.
 */
export async function startAutoAssignment(
  companyId: string,
  folderDate?: string | null
): Promise<ControlActionResult> {
  try {
    const cleanFolder = folderDate && folderDate !== "all" ? folderDate : null;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.rpc as any)("start_auto_assignment", {
      p_company_id: companyId,
      p_folder_date: cleanFolder,
    });
    if (error) throw error;
    return (data as ControlActionResult) || {
      success: true,
      status: "RUNNING",
      folder: cleanFolder,
      message: `Auto-assign started for ${cleanFolder || "all folders"}.`,
    };
  } catch (err) {
    // Fallback: update status directly
    await updateCompanyBatchSettings(companyId, true, 100, "RUNNING", folderDate);
    return {
      success: true,
      status: "RUNNING",
      folder: folderDate,
      message: err instanceof Error ? err.message : "Auto-assign started.",
    };
  }
}

/**
 * Pause Auto-Assignment (PAUSED):
 * Freezes automatic batch distribution without touching existing agent queues.
 */
export async function pauseAutoAssignment(companyId: string): Promise<ControlActionResult> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.rpc as any)("pause_auto_assignment", {
      p_company_id: companyId,
    });
    if (error) throw error;
    return (data as ControlActionResult) || { success: true, status: "PAUSED", message: "Auto-assign paused." };
  } catch {
    await updateCompanyBatchSettings(companyId, false, 100, "PAUSED");
    return { success: true, status: "PAUSED", message: "Auto-assign paused." };
  }
}

/**
 * Stop Auto-Assignment (STOPPED):
 * Completely halts auto-assignment. Optionally recalls uncontacted assigned leads back to the unassigned queue.
 */
export async function stopAutoAssignment(
  companyId: string,
  recallUncontacted = true,
  folderDate?: string | null
): Promise<ControlActionResult> {
  try {
    const cleanFolder = folderDate && folderDate !== "all" ? folderDate : null;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.rpc as any)("stop_auto_assignment", {
      p_company_id: companyId,
      p_recall_uncontacted: Boolean(recallUncontacted),
      p_folder_date: cleanFolder,
    });
    if (error) throw error;
    return (data as ControlActionResult) || {
      success: true,
      status: "STOPPED",
      folder: cleanFolder,
      message: "Auto-assign stopped.",
    };
  } catch {
    await updateCompanyBatchSettings(companyId, false, 100, "STOPPED");
    let recalledCount = 0;
    if (recallUncontacted) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let query = (supabase.from as any)("leads")
        .update({ assigned_to: null, status: "New", assigned_at: null })
        .eq("company_id", companyId)
        .eq("status", "Assigned")
        .is("last_call_at", null);

      if (folderDate && folderDate !== "all") {
        query = query.eq("folder_date", folderDate);
      }
      const { data: recalled } = await query.select("id");
      recalledCount = recalled?.length ?? 0;

      await (supabase.from as any)("lead_batches")
        .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("status", "IN_PROGRESS");
    }
    return {
      success: true,
      status: "STOPPED",
      folder: folderDate,
      recalled_count: recalledCount,
      message: "Auto-assign stopped." + (recalledCount > 0 ? ` ${recalledCount} uncontacted leads recalled to queue.` : ""),
    };
  }
}

/**
 * Distribute Leads Equally among selected active agents.
 */
export async function distributeLeadsEqually(
  companyId: string,
  agentIds: string[],
  leadsPerAgent = 100,
  folderDate?: string | null
): Promise<DistributeResult> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (supabase.rpc as any)("distribute_leads_equally", {
    p_company_id: companyId,
    p_agent_ids: agentIds,
    p_leads_per_agent: leadsPerAgent,
    p_folder_date: folderDate && folderDate !== "all" ? folderDate : null,
  });
  if (error) throw error;
  return data as DistributeResult;
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
 * Get count of unassigned available leads in company.
 */
export async function getUnassignedLeadsCount(companyId: string, folderDate?: string | null): Promise<number> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase.rpc as any)("get_unassigned_leads_count", {
      p_company_id: companyId,
      p_folder_date: folderDate && folderDate !== "all" ? folderDate : null,
    });
    if (!error && typeof data === "number") {
      return data;
    }

    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("assigned_to", null)
      .eq("status", "New");
    if (folderDate && folderDate !== "all") {
      q = q.eq("folder_date", folderDate);
    }
    const { count, error: qErr } = await q;
    if (qErr) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Request next batch of leads for an agent atomically via Supabase RPC.
 */
export async function allocateNextLeadBatch(
  companyId: string,
  employeeId: string,
  batchSize = 100,
  source = "AUTO_BATCH_REFILL",
  allowWhenPending = false,
  folderDate?: string | null
): Promise<AllocationResult> {
  try {
    const isManual = source === "MANUAL_ADMIN_DIRECT" || source === "MANUAL_DISTRIBUTE" || source.startsWith("ADMIN_");
    if (!isManual) {
      const settings = await getCompanyBatchSettings(companyId);
      if (settings.status !== "RUNNING") {
        return {
          success: false,
          message: `Auto-assignment is currently ${settings.status}. Automatic lead allocation is blocked.`,
          assigned_count: 0,
        };
      }
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)("allocate_lead_batch", {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_batch_size: batchSize,
      p_source: source,
      p_allow_when_pending: Boolean(allowWhenPending),
      p_folder_date: folderDate && folderDate !== "all" ? folderDate : null,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes as AllocationResult;
    }

    if (rpcErr) {
      console.warn("[allocateNextLeadBatch] RPC warning, falling back to client-side:", rpcErr);
    }

    return await clientSideFallbackAllocate(companyId, employeeId, batchSize, source, allowWhenPending, folderDate);
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : "Failed to allocate lead batch",
      assigned_count: 0,
    };
  }
}

/**
 * Client-side fallback allocation with strict deduplication
 */
async function clientSideFallbackAllocate(
  companyId: string,
  employeeId: string,
  batchSize: number,
  source: string,
  allowWhenPending = false,
  folderDate?: string | null
): Promise<AllocationResult> {
  const isManual = allowWhenPending || (source === "MANUAL_ADMIN_DIRECT" || source === "MANUAL_DISTRIBUTE" || source.startsWith("ADMIN_"));

  if (!isManual) {
    const settings = await getCompanyBatchSettings(companyId);
    if (settings.status !== "RUNNING") {
      return {
        success: false,
        message: `Auto-assignment is currently ${settings.status}. Automatic lead allocation is blocked.`,
        assigned_count: 0,
      };
    }

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
  }

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

  let query = supabase
    .from("leads")
    .select("id, mobile")
    .eq("company_id", companyId)
    .is("assigned_to", null)
    .eq("status", "New");

  if (folderDate && folderDate !== "all") {
    query = query.eq("folder_date", folderDate);
  }

  const { data: unassigned, error } = await query
    .order("folder_date", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(Math.max(batchSize * 3, 300));

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

  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (supabase.from as any)("lead_batches")
    .update({ status: "COMPLETED", completed_at: now })
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("status", "IN_PROGRESS");

  const { data: prevBatches } = await (supabase.from as any)("lead_batches")
    .select("batch_number")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .order("batch_number", { ascending: false })
    .limit(1);

  const nextBatchNum = (prevBatches?.[0]?.batch_number ?? 0) + 1;

  await supabase
    .from("leads")
    .update({ assigned_to: employeeId, assigned_at: now, status: "Assigned" })
    .in("id", idsToAssign);

  if (mobilesToLock.length > 0) {
    await supabase
      .from("leads")
      .update({ assigned_to: employeeId, assigned_at: now, status: "Assigned" })
      .in("mobile", mobilesToLock)
      .eq("company_id", companyId);
  }

  await supabase.from("lead_assignments").upsert(
    idsToAssign.map((id) => ({
      lead_id: id,
      company_id: companyId,
      employee_id: employeeId,
      assigned_by: employeeId,
    })),
    { onConflict: "lead_id" }
  );

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
