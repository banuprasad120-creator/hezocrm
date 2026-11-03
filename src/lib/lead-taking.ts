import { supabase } from "@/integrations/supabase/client";

export type LeadTakingStatus =
  | "Assigned"
  | "Accepted"
  | "In Progress"
  | "Completed"
  | "Follow-up Required";

export type LeadTakingAction =
  | "ASSIGNED"
  | "ACCEPTED"
  | "OPENED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FOLLOW_UP_REQUIRED";

export interface EmployeeTakingMetrics {
  employee_id: string;
  employee_name: string;
  employee_email: string;
  is_active: boolean;
  total_assigned: number;
  total_accepted: number;
  not_accepted: number;
  in_progress: number;
  completed: number;
  follow_up_required: number;
  idle_accepted_count: number;
  last_lead_taken_at: string | null;
}

export interface TakingSummaryTotals {
  total_assigned: number;
  total_accepted: number;
  not_accepted: number;
  in_progress: number;
  completed: number;
  follow_up_required: number;
  idle_accepted_count: number;
  acceptance_rate: number;
}

export interface TakingSummaryResponse {
  employees: EmployeeTakingMetrics[];
  totals: TakingSummaryTotals;
}

export interface LeadTakingActivityLog {
  id: string;
  lead_id: string;
  customer_name: string | null;
  mobile: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  folder_date: string | null;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  action: string;
  prev_status: string | null;
  new_status: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Record an employee lead-taking action (Accept, Open/Work, Complete, Follow-up).
 */
export async function recordLeadTakingAction(params: {
  companyId: string;
  employeeId: string;
  leadIds: string[];
  action: LeadTakingAction;
  notes?: string;
}): Promise<{ success: boolean; count: number; message: string; new_status?: string }> {
  if (!params.leadIds || params.leadIds.length === 0) {
    return { success: false, count: 0, message: "No leads selected" };
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (supabase.rpc as any)("record_lead_taking_action", {
    p_company_id: params.companyId,
    p_employee_id: params.employeeId,
    p_lead_ids: params.leadIds,
    p_action: params.action,
    p_notes: params.notes || null,
  });

  if (error) throw error;
  return data;
}

/**
 * Fetch aggregated Lead Taking statistics for Admin monitoring.
 */
export async function fetchLeadTakingSummary(params: {
  companyId: string;
  folderDate?: string | null;
  employeeId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<TakingSummaryResponse> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (supabase.rpc as any)("get_lead_taking_summary", {
    p_company_id: params.companyId,
    p_folder_date: params.folderDate && params.folderDate !== "all" ? params.folderDate : null,
    p_employee_id: params.employeeId && params.employeeId !== "all" ? params.employeeId : null,
    p_date_from: params.dateFrom || null,
    p_date_to: params.dateTo || null,
  });

  if (error) throw error;
  return (
    (data as TakingSummaryResponse) || {
      employees: [],
      totals: {
        total_assigned: 0,
        total_accepted: 0,
        not_accepted: 0,
        in_progress: 0,
        completed: 0,
        follow_up_required: 0,
        idle_accepted_count: 0,
        acceptance_rate: 0,
      },
    }
  );
}

/**
 * Fetch detailed Lead Taking audit activity logs for Admin.
 */
export async function fetchLeadTakingLogs(params: {
  companyId: string;
  employeeId?: string | null;
  folderDate?: string | null;
  action?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; logs: LeadTakingActivityLog[] }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (supabase.rpc as any)("get_lead_taking_logs", {
    p_company_id: params.companyId,
    p_employee_id: params.employeeId && params.employeeId !== "all" ? params.employeeId : null,
    p_folder_date: params.folderDate && params.folderDate !== "all" ? params.folderDate : null,
    p_action: params.action && params.action !== "all" ? params.action : null,
    p_limit: params.limit || 100,
    p_offset: params.offset || 0,
  });

  if (error) throw error;
  return data || { total: 0, logs: [] };
}

