import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowUpDown, Calendar, CheckCircle2, Clock,
  Download, FileSpreadsheet, Filter, History, Info, Loader2, Play, RefreshCw,
  Search, ShieldAlert, Sparkles, UserCheck, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { formatDateTime, todayISO } from "@/lib/crm";
import { exportToExcel, exportToCsv } from "@/lib/export-utils";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchLeadTakingSummary, fetchLeadTakingLogs,
  type EmployeeTakingMetrics, type LeadTakingActivityLog,
} from "@/lib/lead-taking";
import { LeadTakingBadge } from "@/components/crm/LeadTakingBadge";
import { cn } from "@/lib/utils";

interface LeadTakingDashboardProps {
  companyId: string;
  defaultFolderDate?: string;
}

export function LeadTakingDashboard({ companyId, defaultFolderDate }: LeadTakingDashboardProps) {
  // Filters
  const [folderFilter, setFolderFilter] = useState<string>(defaultFolderDate || "all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Activity logs modal
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<{ id: string; name: string } | null>(null);
  const [logActionFilter, setLogActionFilter] = useState<string>("all");

  // Fetch folders for filter dropdown
  const { data: folderOptions = [] } = useQuery({
    queryKey: ["lead-taking-folders", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data } = await (supabase.from as any)("leads")
        .select("folder_date")
        .eq("company_id", companyId)
        .order("folder_date", { ascending: false });
      const unique = [...new Set((data ?? []).map((d: any) => d.folder_date).filter(Boolean))] as string[];
      return unique;
    },
  });

  // Fetch summary metrics
  const {
    data: summaryData,
    isLoading: loadingSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["lead-taking-summary", companyId, folderFilter, employeeFilter, dateFilter],
    enabled: Boolean(companyId),
    refetchInterval: 10_000, // Real-time poll every 10 seconds
    queryFn: () =>
      fetchLeadTakingSummary({
        companyId,
        folderDate: folderFilter,
        employeeId: employeeFilter,
        dateFrom: dateFilter ? `${dateFilter}T00:00:00.000Z` : undefined,
        dateTo: dateFilter ? `${dateFilter}T23:59:59.999Z` : undefined,
      }),
  });

  // Fetch activity logs for the logs modal
  const {
    data: activityLogsData,
    isLoading: loadingLogs,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: [
      "lead-taking-logs",
      companyId,
      selectedAgentLogs?.id,
      folderFilter,
      logActionFilter,
      logsModalOpen,
    ],
    enabled: Boolean(companyId && logsModalOpen),
    queryFn: () =>
      fetchLeadTakingLogs({
        companyId,
        employeeId: selectedAgentLogs?.id || (employeeFilter !== "all" ? employeeFilter : null),
        folderDate: folderFilter !== "all" ? folderFilter : null,
        action: logActionFilter !== "all" ? logActionFilter : null,
        limit: 200,
      }),
  });

  const totals = summaryData?.totals || {
    total_assigned: 0,
    total_accepted: 0,
    not_accepted: 0,
    in_progress: 0,
    completed: 0,
    follow_up_required: 0,
    idle_accepted_count: 0,
    acceptance_rate: 0,
  };

  const employees = summaryData?.employees || [];

  // Filtered employees for table search
  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (e.employee_name || "").toLowerCase().includes(q) ||
        (e.employee_email || "").toLowerCase().includes(q)
      );
    });
  }, [employees, searchQuery]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetchSummary();
    if (logsModalOpen) await refetchLogs();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  // Export summary report
  const handleExportSummary = (format: "xlsx" | "csv") => {
    if (employees.length === 0) {
      toast.info("No employee data to export");
      return;
    }
    const rows = employees.map((e) => ({
      "Employee Name": e.employee_name,
      "Employee Email": e.employee_email,
      "Status": e.is_active ? "Active" : "Inactive",
      "Total Leads Assigned": e.total_assigned,
      "Leads Accepted / Taken": e.total_accepted,
      "Not Yet Accepted": e.not_accepted,
      "Currently In Progress": e.in_progress,
      "Completed": e.completed,
      "Pending Follow-up": e.follow_up_required,
      "Idle (Accepted Without Calling)": e.idle_accepted_count,
      "Acceptance Rate": `${e.total_assigned > 0 ? Math.round((e.total_accepted / e.total_assigned) * 100) : 0}%`,
      "Last Lead Taken At": e.last_lead_taken_at ? formatDateTime(e.last_lead_taken_at) : "Never",
      "Folder Scope": folderFilter === "all" ? "All Folders" : folderFilter,
    }));

    const filename = `hezo-lead-taking-summary-${todayISO()}`;
    if (format === "xlsx") exportToExcel(rows, filename, "Lead Taking");
    else exportToCsv(rows, filename);
    toast.success(`Exported ${rows.length} employee records to ${format.toUpperCase()}`);
  };

  // Export detailed activity logs
  const handleExportLogs = (format: "xlsx" | "csv") => {
    const logs = activityLogsData?.logs || [];
    if (logs.length === 0) {
      toast.info("No activity logs to export");
      return;
    }
    const rows = logs.map((l) => ({
      "Date & Time": formatDateTime(l.created_at),
      "Employee": l.employee_name,
      "Action": l.action,
      "Previous Status": l.prev_status || "—",
      "New Status": l.new_status || "—",
      "Customer Name": l.customer_name || "—",
      "Mobile Number": l.mobile || "—",
      "Loan Amount": l.loan_amount ? `₹${l.loan_amount.toLocaleString("en-IN")}` : "—",
      "Loan Type": l.loan_type || "—",
      "Folder Date": l.folder_date || "—",
      "Notes": l.notes || "",
    }));

    const filename = `hezo-lead-taking-audit-logs-${todayISO()}`;
    if (format === "xlsx") exportToExcel(rows, filename, "Activity Logs");
    else exportToCsv(rows, filename);
    toast.success(`Exported ${rows.length} activity records to ${format.toUpperCase()}`);
  };

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserCheck className="h-4 w-4" />
            </span>
            <h3 className="text-base font-bold text-foreground">Lead Taking Tracker</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Tracking
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time tracking of employee lead acceptance, active progress, completed clients, and idle delays.
          </p>
        </div>

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")} />
            <span>Refresh</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedAgentLogs(null);
              setLogsModalOpen(true);
            }}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <History className="h-3.5 w-3.5 text-primary" />
            <span>Activity Trail</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleExportSummary("xlsx")}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Excel</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleExportSummary("csv")}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5 text-blue-600" />
            <span>CSV</span>
          </Button>
        </div>
      </div>

      {/* Top Aggregated Metric Cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {/* Total Assigned */}
        <div className="rounded-xl border bg-card p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assigned</p>
          <p className="mt-0.5 text-xl font-extrabold text-foreground">{totals.total_assigned.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground">Total Dispatched</p>
        </div>

        {/* Accepted / Taken */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Accepted</p>
          <div className="flex items-baseline gap-1.5">
            <p className="mt-0.5 text-xl font-extrabold text-blue-600 dark:text-blue-400">{totals.total_accepted.toLocaleString("en-IN")}</p>
            <span className="text-[11px] font-bold text-blue-500/80">({totals.acceptance_rate}%)</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Taken by Employees</p>
        </div>

        {/* Not Yet Accepted */}
        <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Not Accepted</p>
          <p className="mt-0.5 text-xl font-extrabold text-slate-700 dark:text-slate-300">{totals.not_accepted.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground">Waiting for Agent</p>
        </div>

        {/* In Progress */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">In Progress</p>
          <p className="mt-0.5 text-xl font-extrabold text-amber-600 dark:text-amber-400">{totals.in_progress.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground">Actively Calling</p>
        </div>

        {/* Completed */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Completed</p>
          <p className="mt-0.5 text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{totals.completed.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground">Processed &amp; Resolved</p>
        </div>

        {/* Follow-up Required */}
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 shadow-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">Follow-up</p>
          <p className="mt-0.5 text-xl font-extrabold text-purple-600 dark:text-purple-400">{totals.follow_up_required.toLocaleString("en-IN")}</p>
          <p className="text-[10px] text-muted-foreground">Needs Recall</p>
        </div>

        {/* Idle Warning */}
        <div className={cn(
          "rounded-xl border p-3 shadow-xs transition",
          totals.idle_accepted_count > 0
            ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            : "border-border bg-card text-muted-foreground"
        )}>
          <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1">
            {totals.idle_accepted_count > 0 && <AlertTriangle className="h-3 w-3 text-rose-500" />}
            Idle (&gt;30m)
          </p>
          <p className="mt-0.5 text-xl font-extrabold">{totals.idle_accepted_count.toLocaleString("en-IN")}</p>
          <p className="text-[10px] opacity-80">Taken But Inactive</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border bg-card p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Folder Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Folder:</span>
            <Select value={folderFilter} onValueChange={setFolderFilter}>
              <SelectTrigger className="h-8 text-xs min-w-[130px] bg-background">
                <SelectValue placeholder="All Folders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Folders</SelectItem>
                {folderOptions.map((f) => (
                  <SelectItem key={f} value={f}>
                    📁 {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Employee Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Employee:</span>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="h-8 text-xs min-w-[140px] bg-background">
                <SelectValue placeholder="All Employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.employee_id} value={e.employee_id}>
                    {e.employee_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Picker */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Date:</span>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 text-xs w-[130px] bg-background"
            />
            {dateFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDateFilter("")}
                className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Search by Name */}
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search employee name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-background"
          />
        </div>
      </div>

      {/* Main Employee Lead Taking Table */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Employee Name</th>
                <th className="px-3 py-3 text-center">Assigned</th>
                <th className="px-3 py-3 text-center">Accepted / Taken</th>
                <th className="px-3 py-3 text-center">Not Accepted</th>
                <th className="px-3 py-3 text-center">In Progress</th>
                <th className="px-3 py-3 text-center">Completed</th>
                <th className="px-3 py-3 text-center">Follow-up</th>
                <th className="px-3 py-3 text-center">Idle (&gt;30m)</th>
                <th className="px-4 py-3">Last Lead Taken</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loadingSummary ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary mb-2" />
                    <span>Loading lead taking metrics…</span>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <Users className="mx-auto h-8 w-8 opacity-40 mb-2" />
                    <p className="font-semibold text-foreground text-sm">No employees found</p>
                    <p className="text-xs">No lead taking records match your current filter selection.</p>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((e) => {
                  const rate = e.total_assigned > 0 ? Math.round((e.total_accepted / e.total_assigned) * 100) : 0;
                  const isIdleAlert = e.idle_accepted_count > 0;

                  return (
                    <tr
                      key={e.employee_id}
                      className={cn(
                        "transition hover:bg-muted/30",
                        isIdleAlert && "bg-rose-500/[0.02]"
                      )}
                    >
                      {/* Employee Info */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary text-xs">
                            {e.employee_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-foreground">
                              <span>{e.employee_name}</span>
                              {!e.is_active && (
                                <span className="text-[10px] font-normal text-muted-foreground">(Inactive)</span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground">{e.employee_email}</span>
                          </div>
                        </div>
                      </td>

                      {/* Total Assigned */}
                      <td className="px-3 py-3 text-center font-bold text-foreground">
                        {e.total_assigned.toLocaleString("en-IN")}
                      </td>

                      {/* Total Accepted */}
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-blue-600 dark:text-blue-400">
                            {e.total_accepted.toLocaleString("en-IN")}
                          </span>
                          <span className="text-[10px] text-muted-foreground">({rate}%)</span>
                        </div>
                      </td>

                      {/* Not Accepted */}
                      <td className="px-3 py-3 text-center">
                        <span className={cn(
                          "font-bold",
                          e.not_accepted > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                        )}>
                          {e.not_accepted.toLocaleString("en-IN")}
                        </span>
                      </td>

                      {/* In Progress */}
                      <td className="px-3 py-3 text-center">
                        <span className={cn(
                          "font-bold",
                          e.in_progress > 0 ? "text-amber-500" : "text-muted-foreground"
                        )}>
                          {e.in_progress.toLocaleString("en-IN")}
                        </span>
                      </td>

                      {/* Completed */}
                      <td className="px-3 py-3 text-center font-bold text-emerald-600 dark:text-emerald-400">
                        {e.completed.toLocaleString("en-IN")}
                      </td>

                      {/* Follow-up */}
                      <td className="px-3 py-3 text-center font-bold text-purple-600 dark:text-purple-400">
                        {e.follow_up_required.toLocaleString("en-IN")}
                      </td>

                      {/* Idle (>30m) */}
                      <td className="px-3 py-3 text-center">
                        {e.idle_accepted_count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-bold text-rose-600 dark:text-rose-400 border border-rose-500/30">
                            <AlertTriangle className="h-3 w-3" />
                            {e.idle_accepted_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">0</span>
                        )}
                      </td>

                      {/* Last Lead Taken */}
                      <td className="px-4 py-3 text-muted-foreground text-[11px]">
                        {e.last_lead_taken_at ? (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-primary" />
                            <span>{formatDateTime(e.last_lead_taken_at)}</span>
                          </div>
                        ) : (
                          <span className="italic opacity-60">Not taken yet</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedAgentLogs({ id: e.employee_id, name: e.employee_name });
                            setLogsModalOpen(true);
                          }}
                          className="h-7 text-xs font-semibold gap-1 text-primary hover:bg-primary/10"
                        >
                          <History className="h-3.5 w-3.5" />
                          <span>Logs</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity Logs Audit Modal */}
      <Dialog open={logsModalOpen} onOpenChange={setLogsModalOpen}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b bg-elevated p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-bold">
                  <History className="h-5 w-5 text-primary" />
                  Lead Taking Activity Trail
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedAgentLogs
                    ? `Activity logs for ${selectedAgentLogs.name}`
                    : "Complete audit history of employee lead acceptance, opened leads, and work status transitions."}
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExportLogs("xlsx")}
                  className="h-8 text-xs font-semibold gap-1"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Export Logs</span>
                </Button>
              </div>
            </div>

            {/* Modal Filter Bar */}
            <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t text-xs">
              <span className="font-semibold text-muted-foreground">Filter Action:</span>
              {(["all", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "FOLLOW_UP_REQUIRED"] as const).map((act) => (
                <button
                  key={act}
                  onClick={() => setLogActionFilter(act)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                    logActionFilter === act
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  {act === "all" ? "All Actions" : act.replace("_", " ")}
                </button>
              ))}
            </div>
          </DialogHeader>

          <div className="max-h-[60dvh] overflow-y-auto p-4 sm:p-5">
            {loadingLogs ? (
              <div className="py-16 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary mb-2" />
                <span>Loading activity logs…</span>
              </div>
            ) : (activityLogsData?.logs.length ?? 0) === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <History className="mx-auto h-8 w-8 opacity-40 mb-2" />
                <p className="font-semibold text-foreground text-sm">No activity records found</p>
                <p className="text-xs">No lead taking actions recorded for the selected filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Date &amp; Time</th>
                      <th className="px-3 py-2.5">Employee</th>
                      <th className="px-3 py-2.5">Lead Details</th>
                      <th className="px-3 py-2.5">Action</th>
                      <th className="px-3 py-2.5">Status Transition</th>
                      <th className="px-3 py-2.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activityLogsData?.logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground whitespace-nowrap">
                          {log.employee_name}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col text-[11px] leading-tight">
                            <span className="font-semibold text-foreground">{log.customer_name || "Lead"}</span>
                            <span className="font-mono text-muted-foreground text-[10px]">{log.mobile || "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border",
                            log.action === "ACCEPTED" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" :
                            log.action === "IN_PROGRESS" || log.action === "OPENED" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" :
                            log.action === "COMPLETED" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" :
                            "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                          )}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          <span className="text-muted-foreground">{log.prev_status || "Assigned"}</span>
                          <span className="mx-1 text-muted-foreground/60">→</span>
                          <span className="font-semibold text-foreground">{log.new_status}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-[11px] max-w-[200px] truncate">
                          {log.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
