import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Coffee, Download, Eye, FileSpreadsheet, History, LogIn,
  LogOut, PlayCircle, RefreshCw, Search, Sparkles, UserCheck, Users,
  UserX, X, AlertTriangle, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/common/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { todayISO } from "@/lib/crm";
import { exportToCsv, exportToExcel } from "@/lib/export-utils";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_app/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance & Team Timesheets — Hezo CRM" },
      { name: "description", content: "Team presence monitoring, live agent clock-in status, breaks, and timesheet exports." },
    ],
  }),
  component: AttendancePage,
});

type Attendance = Database["public"]["Tables"]["attendance"]["Row"];

interface TeamAttendanceRow {
  employee_id: string;
  full_name: string;
  email: string;
  attendance_id: string | null;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_seconds: number;
  break_started_at: string | null;
  status: string;
  note: string | null;
}

interface MonthlySummaryRow {
  employee_id: string;
  full_name: string;
  email: string;
  total_working_days?: number;
  total_days_present: number;
  total_days_late: number;
  total_days_absent: number;
  total_days_leave?: number;
  total_worked_seconds: number;
  total_break_seconds: number;
  days_in_month: number;
}

const statusColor: Record<string, string> = {
  Present: "bg-success/20 text-success ring-success/30",
  Absent: "bg-destructive/20 text-destructive ring-destructive/30",
  Late: "bg-warning/25 text-warning ring-warning/30",
  "Half Day": "bg-info/20 text-info ring-info/30",
  Leave: "bg-muted text-muted-foreground ring-border",
};

function hm(seconds: number) {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function clock(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function workedSeconds(
  row: { clock_in: string | null; clock_out: string | null; break_seconds: number; break_started_at: string | null } | null,
  now: number
) {
  if (!row?.clock_in) return 0;
  const end = row.clock_out ? new Date(row.clock_out).getTime() : now;
  const liveBreak = row.break_started_at && !row.clock_out ? now - new Date(row.break_started_at).getTime() : 0;
  const total = (end - new Date(row.clock_in).getTime()) / 1000 - row.break_seconds - liveBreak / 1000;
  return Math.max(0, Math.floor(total));
}

function breakSeconds(
  row: { break_seconds: number; break_started_at: string | null } | null,
  now: number
) {
  if (!row) return 0;
  const live = row.break_started_at ? (now - new Date(row.break_started_at).getTime()) / 1000 : 0;
  return Math.max(0, Math.floor(row.break_seconds + live));
}

function AttendancePage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const userId = session?.userId ?? null;
  const companyId = session?.companyId ?? null;
  const isAdmin = Boolean(session?.isAdmin);
  const todayStr = todayISO();

  // Mode tab: default to "team" for admin, "my" for agents
  const [activeTab, setActiveTab] = useState<"team" | "my">(() => (isAdmin ? "team" : "my"));
  useEffect(() => {
    if (isAdmin) setActiveTab("team");
  }, [isAdmin]);

  // Team attendance sub-view: Daily roster vs Monthly summary
  const [teamViewMode, setTeamViewMode] = useState<"daily" | "monthly">("daily");

  // Selected date for team attendance
  const [teamDate, setTeamDate] = useState(() => todayISO());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Selected month state (year and 0-indexed month)
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  // Agent history modal
  const [selectedAgentHistory, setSelectedAgentHistory] = useState<{ id: string; name: string; email: string } | null>(null);

  // Manual clock-in/out modal
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualAgent, setManualAgent] = useState<TeamAttendanceRow | null>(null);
  const [manualAction, setManualAction] = useState<"CLOCK_IN" | "CLOCK_OUT" | "SET_STATUS">("CLOCK_IN");
  const [manualStatus, setManualStatus] = useState<string>("Present");
  const [manualNote, setManualNote] = useState("");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["attendance-today"] });
    void qc.invalidateQueries({ queryKey: ["attendance-month"] });
    void qc.invalidateQueries({ queryKey: ["attendance-team"] });
    void qc.invalidateQueries({ queryKey: ["attendance-monthly-summary"] });
  };

  // Real-time synchronization
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("attendance-live-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          refreshAll();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId]);

  // Query: Current user's attendance today
  const { data: today = null } = useQuery({
    queryKey: ["attendance-today", userId, todayStr],
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", userId!)
        .eq("work_date", todayStr)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Attendance | null;
    },
  });

  // Month date range calculations
  const monthStart = useMemo(() => {
    const mStr = String(selectedMonth + 1).padStart(2, "0");
    return `${selectedYear}-${mStr}-01`;
  }, [selectedYear, selectedMonth]);

  const monthEnd = useMemo(() => {
    const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const mStr = String(selectedMonth + 1).padStart(2, "0");
    return `${selectedYear}-${mStr}-${String(lastDay).padStart(2, "0")}`;
  }, [selectedYear, selectedMonth]);

  // Query: User's personal monthly attendance
  const { data: month = [] } = useQuery({
    queryKey: ["attendance-month", userId, monthStart, monthEnd],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", userId!)
        .gte("work_date", monthStart)
        .lte("work_date", monthEnd)
        .order("work_date");
      if (error) throw error;
      return (data ?? []) as Attendance[];
    },
  });

  // Query: Team attendance for selected date
  const { data: team = [], isLoading: teamLoading } = useQuery({
    queryKey: ["attendance-team", companyId, teamDate],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 10_000,
    queryFn: async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data, error } = await (supabase.rpc as any)("get_team_attendance_by_date", {
        p_company_id: companyId,
        p_work_date: teamDate,
      });
      if (error) throw error;
      return (data ?? []) as TeamAttendanceRow[];
    },
  });

  // Query: Team monthly attendance summary
  const { data: monthlySummary = [], isLoading: monthlySummaryLoading } = useQuery({
    queryKey: ["attendance-monthly-summary", companyId, selectedYear, selectedMonth + 1],
    enabled: Boolean(companyId) && isAdmin && teamViewMode === "monthly",
    queryFn: async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data, error } = await (supabase.rpc as any)("get_team_monthly_attendance_summary", {
        p_company_id: companyId,
        p_year: selectedYear,
        p_month: selectedMonth + 1,
      });
      if (error) throw error;
      return (data ?? []) as MonthlySummaryRow[];
    },
  });

  // Query: Agent monthly history modal
  const { data: agentMonthlyRecords = [] } = useQuery({
    queryKey: ["agent-monthly-history", selectedAgentHistory?.id, monthStart, monthEnd],
    enabled: Boolean(selectedAgentHistory?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", selectedAgentHistory!.id)
        .gte("work_date", monthStart)
        .lte("work_date", monthEnd)
        .order("work_date");
      if (error) throw error;
      return (data ?? []) as Attendance[];
    },
  });

  // Clock Actions Mutation (Self)
  const action = useMutation({
    mutationFn: async (kind: "in" | "break" | "resume" | "out") => {
      if (!userId || !companyId) throw new Error("Your account is not linked to a company yet");
      const stamp = new Date().toISOString();

      if (kind === "in") {
        const late = new Date().getHours() >= 10;
        const { error } = await supabase.from("attendance").insert({
          company_id: companyId,
          employee_id: userId,
          work_date: todayStr,
          clock_in: stamp,
          status: late ? "Late" : "Present",
        });
        if (error) throw error;
        return;
      }

      if (!today) throw new Error("Clock in first");
      if (kind === "break") {
        if (today.break_started_at) return;
        const { error } = await supabase
          .from("attendance")
          .update({ break_started_at: stamp })
          .eq("id", today.id);
        if (error) throw error;
        return;
      }
      if (kind === "resume") {
        if (!today.break_started_at) return;
        const add = Math.floor((Date.now() - new Date(today.break_started_at).getTime()) / 1000);
        const { error } = await supabase
          .from("attendance")
          .update({ break_started_at: null, break_seconds: today.break_seconds + add })
          .eq("id", today.id);
        if (error) throw error;
        return;
      }
      const add = today.break_started_at
        ? Math.floor((Date.now() - new Date(today.break_started_at).getTime()) / 1000)
        : 0;
      const { error } = await supabase
        .from("attendance")
        .update({
          clock_out: stamp,
          break_started_at: null,
          break_seconds: today.break_seconds + add,
        })
        .eq("id", today.id);
      if (error) throw error;
    },
    onSuccess: (_d, kind) => {
      refreshAll();
      toast.success(
        kind === "in"
          ? "Clocked in"
          : kind === "out"
            ? "Clocked out"
            : kind === "break"
              ? "Break started"
              : "Back to work"
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update attendance"),
  });

  // Admin Manual Attendance Mutation
  const adminMarkMutation = useMutation({
    mutationFn: async (params: {
      employeeId: string;
      workDate: string;
      status: string;
      action: "CLOCK_IN" | "CLOCK_OUT" | "SET_STATUS";
      note?: string;
    }) => {
      if (!companyId) throw new Error("Company ID is required");
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data, error } = await (supabase.rpc as any)("admin_mark_attendance", {
        p_company_id: companyId,
        p_employee_id: params.employeeId,
        p_work_date: params.workDate,
        p_status: params.status,
        p_action: params.action,
        p_note: params.note || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      refreshAll();
      setManualModalOpen(false);
      setManualAgent(null);
      setManualNote("");
      toast.success(
        vars.action === "CLOCK_IN"
          ? "Agent clocked in successfully!"
          : vars.action === "CLOCK_OUT"
          ? "Agent clocked out successfully!"
          : "Attendance updated!"
      );
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update attendance"),
  });

  const onBreak = Boolean(today?.break_started_at) && !today?.clock_out;
  const live = Boolean(today?.clock_in) && !today?.clock_out;

  // Personal Month Stats
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const byDay = useMemo(() => new Map(month.map((m) => [Number(m.work_date.slice(8, 10)), m])), [month]);
  const firstWeekday = (new Date(selectedYear, selectedMonth, 1).getDay() + 6) % 7;

  const presentDays = month.filter((m) => m.status === "Present" || m.status === "Late" || m.status === "Half Day").length;
  const lateDays = month.filter((m) => m.status === "Late").length;
  const absentDays = useMemo(() => {
    let abs = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const isCurrentMonth = todayDate.getFullYear() === selectedYear && todayDate.getMonth() === selectedMonth;
    const maxDay = isCurrentMonth ? todayDate.getDate() : daysInMonth;

    for (let d = 1; d <= maxDay; d++) {
      const dObj = new Date(selectedYear, selectedMonth, d);
      if (dObj.getDay() === 0) continue; // Skip Sunday
      const rec = byDay.get(d);
      if (!rec || rec.status === "Absent") {
        abs++;
      }
    }
    return abs;
  }, [byDay, daysInMonth, selectedYear, selectedMonth]);

  const avgHours = month.length
    ? month.reduce((s, m) => s + workedSeconds(m, now), 0) / (presentDays || 1) / 3600
    : 0;

  // Agent Modal Calendar helpers
  const agentByDay = useMemo(() => {
    return new Map(agentMonthlyRecords.map((m) => [Number(m.work_date.slice(8, 10)), m]));
  }, [agentMonthlyRecords]);

  const agentPresentCount = useMemo(() => {
    return agentMonthlyRecords.filter((m) => m.status === "Present" || m.status === "Late" || m.status === "Half Day").length;
  }, [agentMonthlyRecords]);

  const agentWorkedSec = useMemo(() => {
    return agentMonthlyRecords.reduce((s, m) => s + workedSeconds(m, now), 0);
  }, [agentMonthlyRecords, now]);

  const agentAbsentCount = useMemo(() => {
    let abs = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const isCurrentMonth = todayDate.getFullYear() === selectedYear && todayDate.getMonth() === selectedMonth;
    const maxDay = isCurrentMonth ? todayDate.getDate() : daysInMonth;

    for (let d = 1; d <= maxDay; d++) {
      const dObj = new Date(selectedYear, selectedMonth, d);
      if (dObj.getDay() === 0) continue; // Skip Sunday
      const rec = agentByDay.get(d);
      if (!rec || rec.status === "Absent") {
        abs++;
      }
    }
    return abs;
  }, [agentByDay, daysInMonth, selectedYear, selectedMonth]);

  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const monthLabel = new Date(selectedYear, selectedMonth, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  // Month navigation helpers
  const prevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedYear((y) => y - 1);
      setSelectedMonth(11);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedYear((y) => y + 1);
      setSelectedMonth(0);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  const currentMonth = () => {
    setSelectedYear(new Date().getFullYear());
    setSelectedMonth(new Date().getMonth());
  };

  // Team Attendance Stats
  const teamStats = useMemo(() => {
    const total = team.length;
    const livePresent = team.filter((r) => r.clock_in && !r.clock_out && !r.break_started_at).length;
    const onBreakCount = team.filter((r) => r.break_started_at && !r.clock_out).length;
    const clockedOutCount = team.filter((r) => r.clock_in && r.clock_out).length;
    const absentCount = team.filter((r) => !r.clock_in).length;
    const totalWorkedSec = team.reduce((acc, r) => acc + workedSeconds(r, now), 0);
    return {
      total,
      livePresent,
      onBreakCount,
      clockedOutCount,
      absentCount,
      totalWorkedHours: (totalWorkedSec / 3600).toFixed(1),
    };
  }, [team, now]);

  // Filtered Team Roster
  const filteredTeam = useMemo(() => {
    return team.filter((r) => {
      const isAbsent = !r.clock_in;
      const isOnBreak = Boolean(r.break_started_at) && !r.clock_out;
      const isClockedOut = Boolean(r.clock_in && r.clock_out);
      const isLive = Boolean(r.clock_in && !r.clock_out && !r.break_started_at);

      if (statusFilter === "live" && !isLive) return false;
      if (statusFilter === "break" && !isOnBreak) return false;
      if (statusFilter === "out" && !isClockedOut) return false;
      if (statusFilter === "absent" && !isAbsent) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (r.full_name || "").toLowerCase();
        const email = (r.email || "").toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
  }, [team, statusFilter, searchQuery]);

  // Export Daily Team Attendance
  const exportTeamDaily = (format: "xlsx" | "csv") => {
    if (team.length === 0) {
      toast.info("No team attendance records to export for this date");
      return;
    }
    const formatted = team.map((r) => {
      const isAbsent = !r.clock_in;
      const wSec = workedSeconds(r, now);
      const bSec = breakSeconds(r, now);
      const otSec = wSec > 8 * 3600 ? wSec - 8 * 3600 : 0;
      return {
        "Work Date": teamDate,
        "Employee Name": r.full_name || "Employee",
        Email: r.email,
        Status: isAbsent ? "Absent" : r.clock_out ? "Clocked Out" : r.break_started_at ? "On Break" : r.status,
        "Clock In": clock(r.clock_in),
        "Clock Out": clock(r.clock_out),
        "Worked Duration": isAbsent ? "0m" : hm(wSec),
        "Break Duration": isAbsent ? "0m" : hm(bSec),
        "Overtime": otSec > 0 ? hm(otSec) : "0m",
      };
    });

    const filename = `Team_Attendance_${teamDate}`;
    if (format === "xlsx") {
      exportToExcel(formatted, filename, "Team Attendance");
    } else {
      exportToCsv(formatted, filename);
    }
    toast.success(`Exported team attendance for ${teamDate} as ${format.toUpperCase()}`);
  };

  // Export Monthly Attendance
  const exportUserMonthly = (format: "xlsx" | "csv") => {
    if (month.length === 0) {
      toast.info("No attendance records found for this month");
      return;
    }
    const formatted = month.map((m) => {
      const wSec = workedSeconds(m, now);
      const bSec = breakSeconds(m, now);
      return {
        Date: m.work_date,
        Status: m.status,
        "Clock In": clock(m.clock_in),
        "Clock Out": clock(m.clock_out),
        "Worked Duration": hm(wSec),
        "Break Duration": hm(bSec),
        Overtime: wSec > 8 * 3600 ? hm(wSec - 8 * 3600) : "0m",
      };
    });

    const filename = `My_Attendance_${selectedYear}_${selectedMonth + 1}`;
    if (format === "xlsx") {
      exportToExcel(formatted, filename, "Monthly Attendance");
    } else {
      exportToCsv(formatted, filename);
    }
    toast.success(`Exported monthly attendance as ${format.toUpperCase()}`);
  };

  // Export Team Monthly Summary
  const exportTeamMonthlySummary = (format: "xlsx" | "csv") => {
    if (monthlySummary.length === 0) {
      toast.info("No monthly attendance data to export");
      return;
    }
    const formatted = monthlySummary.map((r) => ({
      "Employee Name": r.full_name,
      Email: r.email,
      "Days Present": r.total_days_present,
      "Days Late": r.total_days_late,
      "Days Absent": r.total_days_absent,
      "Total Worked Hours": `${(Number(r.total_worked_seconds) / 3600).toFixed(1)}h`,
      "Total Break Hours": `${(Number(r.total_break_seconds) / 3600).toFixed(1)}h`,
      "Avg Daily Hours": r.total_days_present > 0 ? `${(Number(r.total_worked_seconds) / r.total_days_present / 3600).toFixed(1)}h` : "0h",
    }));

    const filename = `Team_Monthly_Timesheet_${selectedYear}_${selectedMonth + 1}`;
    if (format === "xlsx") {
      exportToExcel(formatted, filename, "Team Monthly");
    } else {
      exportToCsv(formatted, filename);
    }
    toast.success(`Exported monthly timesheet as ${format.toUpperCase()}`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ── */}
      <PageHeader
        title="Attendance & Timesheets"
        description="Real-time team presence, active calling hours, break tracking, and timesheet exports."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs font-semibold"
              onClick={refreshAll}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Sync</span>
            </Button>
            {isAdmin && activeTab === "team" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-xs font-semibold border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                  onClick={() => teamViewMode === "daily" ? exportTeamDaily("xlsx") : exportTeamMonthlySummary("xlsx")}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Export Excel</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-xs font-semibold"
                  onClick={() => teamViewMode === "daily" ? exportTeamDaily("csv") : exportTeamMonthlySummary("csv")}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>CSV</span>
                </Button>
              </>
            )}
            {(!isAdmin || activeTab === "my") && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs font-semibold"
                onClick={() => exportUserMonthly("xlsx")}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Export My Month (.xlsx)</span>
              </Button>
            )}
          </div>
        }
      />

      {/* ── Top Mode Switcher: Team Attendance vs My Attendance ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              size="sm"
              variant={activeTab === "team" ? "default" : "outline"}
              onClick={() => setActiveTab("team")}
              className={cn(
                "h-9 px-4 font-bold text-xs sm:text-sm gap-2 rounded-xl transition-all",
                activeTab === "team" ? "gradient-brand text-white shadow-md shadow-brand/20" : "text-muted-foreground"
              )}
            >
              <Users className="h-4 w-4" />
              <span>Team Attendance</span>
              {teamStats.livePresent > 0 && (
                <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[10px] font-extrabold">
                  {teamStats.livePresent} Active
                </span>
              )}
            </Button>
          )}

          <Button
            size="sm"
            variant={activeTab === "my" ? "default" : "outline"}
            onClick={() => setActiveTab("my")}
            className={cn(
              "h-9 px-4 font-bold text-xs sm:text-sm gap-2 rounded-xl transition-all",
              activeTab === "my" ? "gradient-brand text-white shadow-md shadow-brand/20" : "text-muted-foreground"
            )}
          >
            <Clock className="h-4 w-4" />
            <span>My Attendance</span>
          </Button>
        </div>

        {/* Quick Clock Toggle for self */}
        <div className="flex items-center gap-2">
          {!today?.clock_in ? (
            <Button
              size="sm"
              onClick={() => action.mutate("in")}
              disabled={action.isPending}
              className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-xs"
            >
              <LogIn className="h-3.5 w-3.5" /> Clock In (Self)
            </Button>
          ) : !today.clock_out ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live ({hm(workedSeconds(today, now))})
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => action.mutate("out")}
                disabled={action.isPending}
                className="h-7 text-xs font-bold text-rose-600 border-rose-500/30 hover:bg-rose-500/10"
              >
                <LogOut className="h-3 w-3 mr-1" /> Out
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 1: TEAM ATTENDANCE (ADMIN VIEW) ──                                */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {isAdmin && activeTab === "team" && (
        <div className="space-y-5">
          {/* Top 5 Metric Cards */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-2xl border bg-card p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Team</p>
              <p className="mt-1 text-2xl font-black text-foreground">{teamStats.total}</p>
              <p className="text-[11px] text-muted-foreground">Active Call Agents</p>
            </div>

            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live Present
              </p>
              <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">{teamStats.livePresent}</p>
              <p className="text-[11px] text-muted-foreground">Actively Calling</p>
            </div>

            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Coffee className="h-3 w-3" /> On Break
              </p>
              <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">{teamStats.onBreakCount}</p>
              <p className="text-[11px] text-muted-foreground">Temporary Rest</p>
            </div>

            <div className="rounded-2xl border border-slate-500/25 bg-slate-500/5 p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Clocked Out</p>
              <p className="mt-1 text-2xl font-black text-slate-700 dark:text-slate-300">{teamStats.clockedOutCount}</p>
              <p className="text-[11px] text-muted-foreground">Shift Completed</p>
            </div>

            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Absent</p>
              <p className="mt-1 text-2xl font-black text-rose-600 dark:text-rose-400">{teamStats.absentCount}</p>
              <p className="text-[11px] text-muted-foreground">Not Yet In</p>
            </div>

            <div className="rounded-2xl border bg-card p-3.5 shadow-xs card-elevated">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand">Total Worked</p>
              <p className="mt-1 text-2xl font-black text-foreground">{teamStats.totalWorkedHours}h</p>
              <p className="text-[11px] text-muted-foreground">Cumulative Hours</p>
            </div>
          </div>

          {/* Sub-view toggle: Daily Live Roster vs Monthly Timesheet Summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm card-elevated">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={teamViewMode === "daily" ? "default" : "outline"}
                onClick={() => setTeamViewMode("daily")}
                className={cn("h-8 text-xs font-bold gap-1.5", teamViewMode === "daily" && "gradient-brand text-white")}
              >
                <Clock className="h-3.5 w-3.5" /> Daily Roster
              </Button>
              <Button
                size="sm"
                variant={teamViewMode === "monthly" ? "default" : "outline"}
                onClick={() => setTeamViewMode("monthly")}
                className={cn("h-8 text-xs font-bold gap-1.5", teamViewMode === "monthly" && "gradient-brand text-white")}
              >
                <Calendar className="h-3.5 w-3.5" /> Monthly Timesheets
              </Button>
            </div>

            {teamViewMode === "daily" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={teamDate === todayISO() ? "default" : "outline"}
                  onClick={() => setTeamDate(todayISO())}
                  className={cn("h-8 text-xs font-semibold gap-1", teamDate === todayISO() && "gradient-brand text-white")}
                >
                  <Sparkles className="h-3 w-3" /> Today
                </Button>
                <Input
                  type="date"
                  value={teamDate}
                  onChange={(e) => setTeamDate(e.target.value)}
                  className="h-8 w-36 text-xs bg-background"
                />
              </div>
            )}

            {teamViewMode === "monthly" && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-bold min-w-[120px] text-center">{monthLabel}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold" onClick={currentMonth}>
                  Current
                </Button>
              </div>
            )}
          </div>

          {/* ── SUB-VIEW A: DAILY LIVE ROSTER ── */}
          {teamViewMode === "daily" && (
            <div className="rounded-2xl border bg-card card-elevated overflow-hidden">
              {/* Filter Bar */}
              <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3 bg-muted/20">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "all", label: `All (${team.length})` },
                    { id: "live", label: `Live (${teamStats.livePresent})`, color: "emerald" },
                    { id: "break", label: `Break (${teamStats.onBreakCount})`, color: "amber" },
                    { id: "out", label: `Clocked Out (${teamStats.clockedOutCount})`, color: "slate" },
                    { id: "absent", label: `Absent (${teamStats.absentCount})`, color: "rose" },
                  ].map((f) => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={statusFilter === f.id ? "default" : "outline"}
                      onClick={() => setStatusFilter(f.id)}
                      className={cn(
                        "h-7 text-xs font-semibold",
                        statusFilter === f.id && "gradient-brand text-white",
                        f.id === "live" && teamStats.livePresent > 0 && statusFilter !== "live" && "border-emerald-500/40 text-emerald-600",
                        f.id === "absent" && teamStats.absentCount > 0 && statusFilter !== "absent" && "border-rose-500/40 text-rose-600"
                      )}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>

                <div className="relative min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search agent name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs pl-8 bg-background"
                  />
                </div>
              </div>

              {/* Roster Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground border-b">
                    <tr>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Clock In</th>
                      <th className="px-4 py-3">Clock Out</th>
                      <th className="px-4 py-3">Worked Duration</th>
                      <th className="px-4 py-3">Breaks</th>
                      <th className="px-4 py-3">Overtime</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {teamLoading ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          Loading live team attendance...
                        </td>
                      </tr>
                    ) : filteredTeam.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          No team attendance records match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredTeam.map((r) => {
                        const isAbsent = !r.clock_in;
                        const isOnBreak = Boolean(r.break_started_at) && !r.clock_out;
                        const isClockedOut = Boolean(r.clock_in && r.clock_out);
                        const isLive = Boolean(r.clock_in && !r.clock_out && !r.break_started_at);
                        const wSec = workedSeconds(r, now);
                        const bSec = breakSeconds(r, now);
                        const otSec = wSec > 8 * 3600 ? wSec - 8 * 3600 : 0;
                        const initials = (r.full_name || r.email).split(" ").map((p) => p[0]).slice(0, 2).join("");

                        return (
                          <tr key={r.employee_id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    "grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-extrabold text-white shadow-xs",
                                    isAbsent ? "bg-muted-foreground/40" : isLive ? "gradient-brand" : "bg-slate-600"
                                  )}
                                >
                                  {initials}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-extrabold text-foreground truncate">{r.full_name || "Agent"}</p>
                                  <p className="text-[11px] font-mono text-muted-foreground truncate">{r.email}</p>
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              {isAbsent ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30">
                                  <UserX className="h-3 w-3" /> Absent
                                </span>
                              ) : isClockedOut ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-400 ring-1 ring-inset ring-slate-500/30">
                                  Clocked Out
                                </span>
                              ) : isOnBreak ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold bg-warning/15 text-warning ring-1 ring-inset ring-warning/30">
                                  <Coffee className="h-3 w-3" /> On Break
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold bg-success/15 text-success ring-1 ring-inset ring-success/30">
                                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                                  Live ({r.status})
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-3 font-mono font-semibold text-foreground">
                              {clock(r.clock_in)}
                            </td>

                            <td className="px-4 py-3 font-mono text-muted-foreground">
                              {clock(r.clock_out)}
                            </td>

                            <td className="px-4 py-3 font-mono font-bold">
                              {isAbsent ? (
                                <span className="text-muted-foreground">0m</span>
                              ) : (
                                <span className={isLive ? "text-emerald-500 font-extrabold" : "text-foreground"}>
                                  {hm(wSec)}
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-3 font-mono text-muted-foreground">
                              {isAbsent ? "0m" : hm(bSec)}
                            </td>

                            <td className="px-4 py-3 font-mono">
                              {otSec > 0 ? (
                                <span className="text-amber-500 font-bold">+{hm(otSec)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs font-semibold px-2"
                                  onClick={() => setSelectedAgentHistory({ id: r.employee_id, name: r.full_name || r.email, email: r.email })}
                                  title="View monthly attendance calendar"
                                >
                                  <History className="h-3.5 w-3.5 mr-1" /> History
                                </Button>

                                {isAbsent && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setManualAgent(r);
                                      setManualAction("CLOCK_IN");
                                      setManualStatus("Present");
                                      setManualModalOpen(true);
                                    }}
                                    className="h-7 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2 shadow-xs"
                                  >
                                    <LogIn className="h-3 w-3 mr-1" /> Clock In
                                  </Button>
                                )}

                                {isLive && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setManualAgent(r);
                                      setManualAction("CLOCK_OUT");
                                      setManualModalOpen(true);
                                    }}
                                    className="h-7 text-xs font-bold text-rose-600 border-rose-500/30 hover:bg-rose-500/10 px-2"
                                  >
                                    <LogOut className="h-3 w-3 mr-1" /> Clock Out
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── SUB-VIEW B: MONTHLY TIMESHEET SUMMARY ── */}
          {teamViewMode === "monthly" && (
            <div className="rounded-2xl border bg-card card-elevated overflow-hidden">
              <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3 bg-muted/20">
                <div>
                  <h3 className="text-sm font-extrabold text-foreground">{monthLabel} — Monthly Timesheet Summary</h3>
                  <p className="text-xs text-muted-foreground">Aggregated days worked, punctuality, and overall hours per agent.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-semibold gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                    onClick={() => exportTeamMonthlySummary("xlsx")}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Export Month (.xlsx)
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground border-b">
                    <tr>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Days Present</th>
                      <th className="px-4 py-3">Days Late</th>
                      <th className="px-4 py-3">Days Absent</th>
                      <th className="px-4 py-3">Total Worked Hours</th>
                      <th className="px-4 py-3">Break Hours</th>
                      <th className="px-4 py-3">Avg Hours / Day</th>
                      <th className="px-4 py-3 text-right">Calendar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {monthlySummaryLoading ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          Calculating monthly timesheets...
                        </td>
                      </tr>
                    ) : monthlySummary.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          No monthly records found for {monthLabel}.
                        </td>
                      </tr>
                    ) : (
                      monthlySummary.map((m) => {
                        const workedH = (Number(m.total_worked_seconds) / 3600).toFixed(1);
                        const breakH = (Number(m.total_break_seconds) / 3600).toFixed(1);
                        const avgDayH = m.total_days_present > 0
                          ? (Number(m.total_worked_seconds) / m.total_days_present / 3600).toFixed(1)
                          : "0.0";

                        return (
                          <tr key={m.employee_id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-extrabold text-foreground">{m.full_name || "Agent"}</p>
                              <p className="text-[11px] font-mono text-muted-foreground">{m.email}</p>
                            </td>

                            <td className="px-4 py-3">
                              <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                                {m.total_days_present} days
                              </span>
                            </td>

                            <td className="px-4 py-3">
                              <span className={m.total_days_late > 0 ? "font-bold text-amber-500" : "text-muted-foreground"}>
                                {m.total_days_late}
                              </span>
                            </td>

                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "font-extrabold px-2 py-0.5 rounded-md inline-block text-xs",
                                  Number(m.total_days_absent) > 0
                                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                                    : "text-muted-foreground"
                                )}
                              >
                                {m.total_days_absent} {Number(m.total_days_absent) === 1 ? "day" : "days"}
                              </span>
                            </td>

                            <td className="px-4 py-3 font-mono font-black text-brand text-sm">
                              {workedH}h
                            </td>

                            <td className="px-4 py-3 font-mono text-muted-foreground">
                              {breakH}h
                            </td>

                            <td className="px-4 py-3 font-mono font-semibold">
                              {avgDayH}h / day
                            </td>

                            <td className="px-4 py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-semibold px-2.5 gap-1"
                                onClick={() => setSelectedAgentHistory({ id: m.employee_id, name: m.full_name, email: m.email })}
                              >
                                <Eye className="h-3 w-3" /> View Days
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
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: MY ATTENDANCE (PERSONAL CLOCK IN & CALENDAR) ──                */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {(!isAdmin || activeTab === "my") && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Today Clock Card */}
          <div className="rounded-2xl border p-4 card-elevated bg-gradient-to-br from-brand/10 via-brand-2/5 to-accent/10 sm:p-6 xl:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today</p>
            <p className="mt-0.5 text-2xl font-bold sm:text-3xl">{todayLabel}</p>
            <div className="mt-4 rounded-2xl border bg-card p-4 card-elevated sm:mt-6 sm:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Clocked in at</p>
                  <p className="text-xl font-bold sm:text-2xl">{clock(today?.clock_in ?? null)}</p>
                </div>
                {live && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      onBreak ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${onBreak ? "bg-warning" : "bg-success"}`} />
                    {onBreak ? "On break" : "Live"} · {hm(workedSeconds(today, now))}
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {!today?.clock_in ? (
                  <Button
                    size="sm"
                    className="h-11 w-full gradient-brand text-sm font-bold text-white shadow-sm"
                    disabled={action.isPending}
                    onClick={() => action.mutate("in")}
                  >
                    <LogIn className="mr-1.5 h-4 w-4" /> Clock In
                  </Button>
                ) : today.clock_out ? (
                  <p className="w-full text-center text-xs text-muted-foreground sm:text-sm">
                    Clocked out at {clock(today.clock_out)} · {hm(workedSeconds(today, now))} worked
                  </p>
                ) : (
                  <div className="grid w-full grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 text-xs font-semibold"
                      disabled={onBreak || action.isPending}
                      onClick={() => action.mutate("break")}
                    >
                      <Coffee className="mr-1 h-3.5 w-3.5" /> Break
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 text-xs font-semibold"
                      disabled={!onBreak || action.isPending}
                      onClick={() => action.mutate("resume")}
                    >
                      <PlayCircle className="mr-1 h-3.5 w-3.5" /> Resume
                    </Button>
                    <Button
                      size="sm"
                      className="h-10 gradient-brand text-xs font-bold text-white shadow-sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate("out")}
                    >
                      <LogOut className="mr-1 h-3.5 w-3.5" /> Out
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-3">
              <div className="rounded-xl border bg-card p-2.5 text-center sm:p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Worked</p>
                <p className="mt-0.5 text-base font-bold sm:text-lg">{hm(workedSeconds(today, now))}</p>
              </div>
              <div className="rounded-xl border bg-card p-2.5 text-center sm:p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Breaks</p>
                <p className="mt-0.5 text-base font-bold sm:text-lg">{hm(breakSeconds(today, now))}</p>
              </div>
              <div className="rounded-xl border bg-card p-2.5 text-center sm:p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Overtime</p>
                <p className="mt-0.5 text-base font-bold sm:text-lg">
                  {workedSeconds(today, now) > 8 * 3600 ? hm(workedSeconds(today, now) - 8 * 3600) : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Monthly Attendance Calendar */}
          <div className="xl:col-span-2">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
              <StatCard label="Present" value={String(presentDays)} icon={CalendarCheck2} tone="success" />
              <StatCard label="Absent" value={String(absentDays)} icon={LogIn} tone="destructive" />
              <StatCard label="Late" value={String(lateDays)} icon={Clock} tone="warning" />
              <StatCard label="Avg hours" value={`${avgHours.toFixed(1)}h`} icon={Clock} tone="info" />
            </div>

            <div className="mt-4 rounded-2xl border bg-card p-4 card-elevated sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div>
                    <h3 className="text-sm font-semibold">{monthLabel}</h3>
                    <p className="text-xs text-muted-foreground">Personal Attendance History</p>
                  </div>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold" onClick={currentMonth}>
                    This Month
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {["Present", "Late", "Absent", "Leave"].map((s) => (
                      <span
                        key={s}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${
                          statusColor[s] ?? statusColor["Present"]
                        }`}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      onClick={() => exportUserMonthly("csv")}
                    >
                      <Download className="h-3 w-3" /> CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      onClick={() => exportUserMonthly("xlsx")}
                    >
                      <FileSpreadsheet className="h-3 w-3 text-emerald-600" /> Excel
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground sm:gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const row = byDay.get(d);
                  const dayDate = new Date(selectedYear, selectedMonth, d);
                  dayDate.setHours(0, 0, 0, 0);
                  const todayMidnight = new Date();
                  todayMidnight.setHours(0, 0, 0, 0);
                  const isSunday = dayDate.getDay() === 0;
                  const isFuture = dayDate > todayMidnight;

                  let cellStyle = "bg-muted/30 text-muted-foreground ring-border";
                  let label = "";

                  if (row) {
                    cellStyle = statusColor[row.status] || statusColor["Present"];
                    label = row.status[0];
                  } else if (isFuture) {
                    cellStyle = "bg-muted/10 text-muted-foreground/30 ring-border/20";
                    label = "";
                  } else if (isSunday) {
                    cellStyle = "bg-muted/20 text-muted-foreground/50 ring-border/30";
                    label = "OFF";
                  } else {
                    cellStyle = "bg-rose-500/15 text-rose-500 ring-rose-500/30 font-bold";
                    label = "A";
                  }

                  return (
                    <div
                      key={d}
                      className={cn(
                        "aspect-square rounded-xl ring-1 ring-inset p-1 text-left sm:p-1.5 flex flex-col justify-between transition-all",
                        cellStyle
                      )}
                    >
                      <p className="text-[10px] font-bold">{d}</p>
                      <p className="mt-auto text-[9px] font-semibold opacity-80">{label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AGENT MONTHLY ATTENDANCE MODAL ── */}
      <Dialog open={Boolean(selectedAgentHistory)} onOpenChange={(o) => !o && setSelectedAgentHistory(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-brand" />
              <span>{selectedAgentHistory?.name || "Agent"} — Attendance Calendar</span>
            </DialogTitle>
            <DialogDescription>
              {selectedAgentHistory?.email} · Monthly attendance audit history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Month Navigator in Modal */}
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-extrabold">{monthLabel}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-md">
                  {agentPresentCount} Present
                </span>
                <span className="font-bold text-rose-600 bg-rose-500/10 px-2.5 py-1 rounded-md">
                  {agentAbsentCount} Absent
                </span>
                <span className="font-bold text-brand bg-brand/10 px-2.5 py-1 rounded-md">
                  {(agentWorkedSec / 3600).toFixed(1)}h Worked
                </span>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: firstWeekday }, (_, i) => (
                <div key={`modal-pad-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                const row = agentByDay.get(d);
                const dayDate = new Date(selectedYear, selectedMonth, d);
                dayDate.setHours(0, 0, 0, 0);
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const isSunday = dayDate.getDay() === 0;
                const isFuture = dayDate > todayMidnight;

                let cellStyle = "bg-muted/20 text-muted-foreground ring-border/50";
                let label = "";

                if (row) {
                  cellStyle = statusColor[row.status] || statusColor["Present"];
                  label = row.status;
                } else if (isFuture) {
                  cellStyle = "bg-muted/10 text-muted-foreground/30 ring-border/20";
                  label = "";
                } else if (isSunday) {
                  cellStyle = "bg-muted/20 text-muted-foreground/50 ring-border/30";
                  label = "OFF";
                } else {
                  // Past weekday with no attendance -> Absent
                  cellStyle = "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30 font-bold";
                  label = "ABSENT";
                }

                return (
                  <div
                    key={`modal-day-${d}`}
                    className={cn(
                      "aspect-square rounded-xl ring-1 ring-inset p-1.5 flex flex-col justify-between text-left transition-all",
                      cellStyle
                    )}
                  >
                    <p className="text-[11px] font-extrabold">{d}</p>
                    <div>
                      {label && <p className="text-[9px] font-bold uppercase tracking-tight">{label}</p>}
                      {row?.clock_in && (
                        <p className="text-[8px] font-mono opacity-80">{clock(row.clock_in)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedAgentHistory(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MANUAL CLOCK IN / OUT MODAL (ADMIN) ── */}
      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-brand" />
              <span>
                {manualAction === "CLOCK_IN"
                  ? `Clock In ${manualAgent?.full_name || "Agent"}`
                  : `Clock Out ${manualAgent?.full_name || "Agent"}`}
              </span>
            </DialogTitle>
            <DialogDescription>
              Date: <strong>{teamDate}</strong> · Administrative timesheet override.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {manualAction === "CLOCK_IN" && (
              <div>
                <Label className="text-xs font-semibold">Attendance Status</Label>
                <Select value={manualStatus} onValueChange={setManualStatus}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Present">Present</SelectItem>
                    <SelectItem value="Late">Late</SelectItem>
                    <SelectItem value="Half Day">Half Day</SelectItem>
                    <SelectItem value="Leave">Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs font-semibold">Notes / Reason (Optional)</Label>
              <Input
                placeholder="e.g. Phone network issue, manual entry by admin"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                className="mt-1.5 h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setManualModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gradient-brand text-white font-bold"
              disabled={adminMarkMutation.isPending || !manualAgent}
              onClick={() => {
                if (!manualAgent) return;
                adminMarkMutation.mutate({
                  employeeId: manualAgent.employee_id,
                  workDate: teamDate,
                  status: manualStatus,
                  action: manualAction,
                  note: manualNote,
                });
              }}
            >
              Confirm {manualAction === "CLOCK_IN" ? "Clock In" : "Clock Out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
