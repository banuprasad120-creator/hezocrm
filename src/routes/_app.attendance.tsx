import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck2, ChevronLeft, ChevronRight, Clock, Coffee, Download,
  FileSpreadsheet, LogIn, LogOut, PlayCircle, RefreshCw, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/common/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { todayISO } from "@/lib/crm";
import { exportToCsv, exportToExcel } from "@/lib/export-utils";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_app/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance & Team Timesheets — Hezo CRM" },
      { name: "description", content: "Clock in, breaks, live team timesheet synchronization and Excel/CSV attendance exports." },
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
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function workedSeconds(row: { clock_in: string | null; clock_out: string | null; break_seconds: number; break_started_at: string | null } | null, now: number) {
  if (!row?.clock_in) return 0;
  const end = row.clock_out ? new Date(row.clock_out).getTime() : now;
  const live = row.break_started_at && !row.clock_out ? now - new Date(row.break_started_at).getTime() : 0;
  const total = (end - new Date(row.clock_in).getTime()) / 1000 - row.break_seconds - live / 1000;
  return Math.max(0, Math.floor(total));
}

function breakSeconds(row: { break_seconds: number; break_started_at: string | null } | null, now: number) {
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

  // Selected date for team attendance inspection
  const [teamDate, setTeamDate] = useState(() => todayISO());

  // Selected month state (year and 0-indexed month)
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["attendance-today"] });
    void qc.invalidateQueries({ queryKey: ["attendance-month"] });
    void qc.invalidateQueries({ queryKey: ["attendance-team"] });
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

  // Query: User's monthly attendance
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

  // Query: Team attendance for selected date (Includes all active agents with Absent status)
  const { data: team = [], isLoading: teamLoading } = useQuery({
    queryKey: ["attendance-team", companyId, teamDate],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 15_000,
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

  // Clock Actions Mutation
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

  const onBreak = Boolean(today?.break_started_at) && !today?.clock_out;
  const live = Boolean(today?.clock_in) && !today?.clock_out;

  const presentDays = month.filter((m) => m.status === "Present" || m.status === "Late").length;
  const lateDays = month.filter((m) => m.status === "Late").length;
  const absentDays = month.filter((m) => m.status === "Absent").length;
  const avgHours = month.length
    ? month.reduce((s, m) => s + workedSeconds(m, now), 0) / month.length / 3600
    : 0;

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const byDay = new Map(month.map((m) => [Number(m.work_date.slice(8, 10)), m]));
  const firstWeekday = (new Date(selectedYear, selectedMonth, 1).getDay() + 6) % 7;

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

  return (
    <>
      <PageHeader
        title="Attendance & Timesheets"
        description="Track daily working hours, real-time breaks, absent alerts and timesheet exports."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs font-semibold"
              onClick={refreshAll}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Sync</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs font-semibold"
              onClick={() => exportUserMonthly("xlsx")}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export Month (.xlsx)</span>
            </Button>
          </div>
        }
      />

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
                return (
                  <div
                    key={d}
                    className={`aspect-square rounded-xl ring-1 ring-inset p-1 text-left sm:p-1.5 ${
                      row ? statusColor[row.status] : "bg-muted/30 text-muted-foreground ring-border"
                    }`}
                  >
                    <p className="text-[10px] font-bold">{d}</p>
                    <p className="mt-auto text-[9px] font-semibold opacity-80">{row ? row.status[0] : ""}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Admin Team Attendance Section */}
      {isAdmin && (
        <div className="mt-6 rounded-2xl border bg-card card-elevated">
          <div className="border-b p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-brand" />
              <div>
                <h3 className="text-sm font-semibold">Team Attendance Roster</h3>
                <p className="text-xs text-muted-foreground">
                  Complete team status including clocked in, breaks, and absent employees.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Date:</span>
                <Input
                  type="date"
                  value={teamDate}
                  onChange={(e) => setTeamDate(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs font-semibold"
                  onClick={() => setTeamDate(todayISO())}
                >
                  Today
                </Button>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-semibold"
                  onClick={() => exportTeamDaily("csv")}
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-semibold border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                  onClick={() => exportTeamDaily("xlsx")}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Excel (.xlsx)
                </Button>
              </div>
            </div>
          </div>

          <div className="divide-y">
            {teamLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Loading team attendance...</p>
            ) : team.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No active agents found in company.</p>
            ) : (
              team.map((r) => {
                const isAbsent = !r.clock_in;
                const isOnBreak = Boolean(r.break_started_at) && !r.clock_out;
                const isLive = Boolean(r.clock_in) && !r.clock_out;
                const workedSec = workedSeconds(r, now);
                const overtimeSec = workedSec > 8 * 3600 ? workedSec - 8 * 3600 : 0;

                return (
                  <div
                    key={r.employee_id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 sm:flex sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${
                          isAbsent ? "bg-muted-foreground/50" : "gradient-brand"
                        }`}
                      >
                        {(r.full_name || r.email).split(" ").map((p) => p[0]).slice(0, 2).join("")}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{r.full_name || r.email}</p>
                          <span className="text-[11px] text-muted-foreground">({r.email})</span>
                        </div>
                        {isAbsent ? (
                          <p className="text-[11px] text-destructive font-semibold">Not Clocked In (Absent)</p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            In {clock(r.clock_in)} · {hm(workedSec)} worked
                            {r.break_seconds > 0 || r.break_started_at ? ` · Break ${hm(breakSeconds(r, now))}` : ""}
                            {overtimeSec > 0 ? ` · Overtime ${hm(overtimeSec)}` : ""}
                            {r.clock_out ? ` · Out ${clock(r.clock_out)}` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isAbsent ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30">
                          Absent
                        </span>
                      ) : r.clock_out ? (
                        <StatusBadge label="Clocked out" />
                      ) : isOnBreak ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-warning/15 text-warning ring-1 ring-inset ring-warning/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                          On Break
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-success/15 text-success ring-1 ring-inset ring-success/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Live ({r.status})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
