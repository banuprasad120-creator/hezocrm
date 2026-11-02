import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertCircle, Clock, Download, FileSpreadsheet, Flame, FolderPlus, History, Inbox, Layers, Loader2,
  PhoneCall, Plus, PlusCircle, Shuffle, Trash2, Upload, UserCheck, UserPlus, Users2, Zap
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { ImportLeadsWizard } from "@/components/crm/ImportLeadsWizard";
import { CreateLeadDialog } from "@/components/crm/CreateLeadDialog";
import { AddNewDataDialog } from "@/components/crm/AddNewDataDialog";
import { AutoAssignControls } from "@/components/crm/AutoAssignControls";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LOAN_TYPES, inr, todayISO, priorityTone, type Lead, type LeadPriority } from "@/lib/crm";
import { bulkPermanentDeleteLeadsServerFn, deleteFolderServerFn, permanentDeleteLeadServerFn, updateLeadPriorityServerFn } from "@/lib/crm.functions";
import { getCompanyBatchSettings, distributeLeadsEqually } from "@/lib/lead-batch";
import { exportToExcel, exportToCsv } from "@/lib/export-utils";


export const Route = createFileRoute("/_app/daily-leads")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search["date"] === "string" ? search["date"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Daily Leads — Hezo CRM" },
      { name: "description", content: "Create daily lead folders and assign leads to calling agents individually, in bulk, or distributed equally." },
      { property: "og:title", content: "Daily Leads — Hezo CRM" },
      { property: "og:description", content: "Assign daily lead folders to your calling agents in seconds." },
    ],
  }),
  component: DailyLeads,
});

function DailyLeads() {
  const { data: session, isLoading: sessionLoading } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const isAdmin = session?.isAdmin ?? false;

  const companiesQ = useQuery({
    queryKey: ["companies-list-daily-leads"],
    enabled: !session?.companyId && isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id, name").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const companyId = session?.companyId || (companiesQ.data?.[0]?.id ?? null);

  const PAGE_SIZE = 100;
  const [folderDate, setFolderDate] = useState(search.date ?? todayISO());

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignAgent, setAssignAgent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [addNewDataOpen, setAddNewDataOpen] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);

  const { data: batchSettings } = useQuery({
    queryKey: ["batch-settings", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getCompanyBatchSettings(companyId!),
  });

  const exportFolder = async (format: "xlsx" | "csv") => {
    if (!companyId) return;
    setBusy(true);
    try {
      const { data: leadsToExport, error } = await supabase
        .from("leads")
        .select("customer_name, mobile, alternate_mobile, status, priority, city, state, loan_amount, loan_type, source, folder_date, last_call_at, notes, profiles:assigned_to(full_name, email)")
        .eq("company_id", companyId)
        .eq("folder_date", folderDate)
        .order("created_at", { ascending: true })
        .limit(10000);

      if (error) throw error;
      if (!leadsToExport || leadsToExport.length === 0) {
        toast.info("No leads in this folder to export");
        return;
      }

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const rows = leadsToExport.map((l: any) => ({
        "Customer Name": l.customer_name,
        "Mobile": l.mobile,
        "Alternate Mobile": l.alternate_mobile || "",
        "Priority": l.priority || "LOW",
        "Status": l.status,
        "Assigned To": l.profiles?.full_name || l.profiles?.email || "Unassigned",
        "City": l.city || "",
        "State": l.state || "",
        "Loan Amount": l.loan_amount || "",
        "Loan Type": l.loan_type || "",
        "Lead Source": l.source || "",
        "Folder Date": l.folder_date,
        "Last Call At": l.last_call_at || "",
        "Notes": l.notes || "",
      }));

      const filename = `Leads_${folderDate}`;
      if (format === "xlsx") {
        exportToExcel(rows, filename, `Folder ${folderDate}`);
      } else {
        exportToCsv(rows, filename);
      }
      toast.success(`Exported ${rows.length} leads from folder ${folderDate} as ${format.toUpperCase()}`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const deleteFolderM = useMutation({
    mutationFn: async (date: string) => {
      return await deleteFolderServerFn({ data: { folderDate: date } });
    },
    onSuccess: (res) => {
      toast.success(`Deleted folder ${folderDate.split("-").reverse().join("-")} and removed ${res.deletedCount} leads`);
      setDeleteFolderDialogOpen(false);
      qc.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder");
    },
  });

  const bulkDeleteM = useMutation({
    mutationFn: async (ids: string[]) => {
      return await bulkPermanentDeleteLeadsServerFn({ data: { leadIds: ids } });
    },
    onSuccess: (res) => {
      toast.success(`Permanently deleted ${res.count} lead(s)`);
      setSelected(new Set());
      qc.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete leads");
    },
  });

  const singleDeleteM = useMutation({
    mutationFn: async (leadId: string) => {
      return await permanentDeleteLeadServerFn({ data: { leadId } });
    },
    onSuccess: () => {
      toast.success("Lead permanently deleted");
      setLeadToDelete(null);
      qc.invalidateQueries();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete lead");
    },
  });

  const deleteSelected = () => {
    if (selected.size === 0) return;
    if (window.confirm(`Are you sure you want to permanently delete ${selected.size} selected lead(s)? This cannot be undone.`)) {
      bulkDeleteM.mutate([...selected]);
    }
  };


  useEffect(() => {
    if (!sessionLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [sessionLoading, session, navigate]);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Priority update mutation
  const updatePriorityM = useMutation({
    mutationFn: async ({ leadId, priority }: { leadId: string; priority: LeadPriority }) => {
      return await updateLeadPriorityServerFn({ data: { leadId, priority } });
    },
    onSuccess: (res) => {
      toast.success(`Priority updated to ${res.priority}`);
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["daily-lead-stats"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update priority");
    },
  });

  const { data: companyRecord } = useQuery({
    queryKey: ["company-auto-assign-status", companyId],
    enabled: Boolean(companyId),
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("auto_assign_status, agent_lead_batch_size")
        .eq("id", companyId!)
        .maybeSingle();
      return data;
    },
  });
  const autoAssignStatus = companyRecord?.auto_assign_status || "RUNNING";

  // Counts come from head-only count queries so folders with 10,000+ leads stay instant.
  const { data: folderStats = { total: 0, assigned: 0, unassigned: 0, called: 0, pending: 0, highWaiting: 0, medWaiting: 0, lowWaiting: 0 } } = useQuery({
    queryKey: ["daily-lead-stats", companyId, folderDate],
    enabled: Boolean(companyId) && isAdmin,
    refetchInterval: 5000,
    queryFn: async () => {
      try {
        const base = () => supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("company_id", companyId!).eq("folder_date", folderDate);
        const unassignedBase = () => base().is("assigned_to", null).eq("status", "New");
        const [{ count: total }, { count: assigned }, { count: called }, { count: highWaiting }, { count: medWaiting }, { count: lowWaiting }] = await Promise.all([
          base(),
          base().not("assigned_to", "is", null),
          base().in("status", [...CONTACTED_STATUSES]),
          unassignedBase().eq("priority", "HIGH"),
          unassignedBase().eq("priority", "MEDIUM"),
          unassignedBase().eq("priority", "LOW"),
        ]);
        return {
          total: total ?? 0,
          assigned: assigned ?? 0,
          unassigned: (total ?? 0) - (assigned ?? 0),
          called: called ?? 0,
          pending: (total ?? 0) - (called ?? 0),
          highWaiting: highWaiting ?? 0,
          medWaiting: medWaiting ?? 0,
          lowWaiting: lowWaiting ?? 0,
        };
      } catch (err) {
        console.warn("[folderStats] fetch error:", err);
        return { total: 0, assigned: 0, unassigned: 0, called: 0, pending: 0, highWaiting: 0, medWaiting: 0, lowWaiting: 0 };
      }
    },
  });

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["daily-leads", companyId, folderDate, unassignedOnly, page],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      let q = supabase.from("leads").select("*", { count: "exact" })
        .eq("company_id", companyId!).eq("folder_date", folderDate);
      if (unassignedOnly) q = q.is("assigned_to", null);
      const { data, error, count } = await q
        .order("created_at", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) {
        console.warn("[daily-leads] error querying leads:", error.message);
        return { rows: [] as Lead[], count: 0 };
      }
      return { rows: (data ?? []) as Lead[], count: count ?? 0 };
    },
  });

  const visibleLeads = pageData?.rows ?? [];
  const filteredCount = pageData?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  const { data: folders = [] } = useQuery({
    queryKey: ["lead-folders", companyId],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_folder_counts")
        .select("folder_date, lead_count").eq("company_id", companyId!)
        .order("folder_date", { ascending: false }).limit(60);
      if (error) {
        const { data: rawLeads } = await supabase.from("leads")
          .select("folder_date").eq("company_id", companyId!).limit(1000);
        const counts = new Map<string, number>();
        for (const l of rawLeads ?? []) {
          if (l.folder_date) counts.set(l.folder_date, (counts.get(l.folder_date) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
      }
      return (data ?? []).map((r) => ({ date: r.folder_date as string, count: Number(r.lead_count) }));
    },
  });

  const agentName = useMemo(() => {
    const map = new Map(agents.map((a) => [a.id, a.full_name || a.email]));
    return (id: string | null) => (id ? map.get(id) ?? "Assigned" : "—");
  }, [agents]);


  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };
  const toggleAll = () => {
    setSelected(selected.size === visibleLeads.length ? new Set() : new Set(visibleLeads.map((l) => l.id)));
  };

  /** Fetch unique UNASSIGNED lead ids in the current folder, strictly excluding any mobile number that has EVER been assigned or called in the company. */
  const fetchFolderLeadIds = async () => {
    // 1. Fetch all mobile numbers already assigned or called in the company across ANY folder
    const { data: historyLeads } = await supabase
      .from("leads")
      .select("mobile")
      .eq("company_id", companyId!)
      .or("assigned_to.not.is.null,last_call_at.not.is.null,status.neq.New");

    const alreadySentMobiles = new Set<string>();
    for (const item of historyLeads ?? []) {
      const clean = (item.mobile || "").replace(/\D/g, "").slice(-10);
      if (clean) alreadySentMobiles.add(clean);
    }

    const ids: string[] = [];
    const seenMobiles = new Set<string>();
    const chunk = 1000;
    for (let from = 0; ; from += chunk) {
      const { data, error } = await supabase.from("leads").select("id, mobile")
        .eq("company_id", companyId!).eq("folder_date", folderDate)
        .is("assigned_to", null)  // Only unassigned leads
        .order("created_at", { ascending: true }).range(from, from + chunk - 1);
      if (error) throw error;
      for (const r of data ?? []) {
        const cleanMobile = (r.mobile || "").replace(/\D/g, "").slice(-10);
        if (cleanMobile) {
          // STRICT RULE: If this number has EVER been assigned or called in the company, NEVER send again!
          if (alreadySentMobiles.has(cleanMobile)) continue;

          if (!seenMobiles.has(cleanMobile)) {
            seenMobiles.add(cleanMobile);
            ids.push(r.id);
          }
        } else {
          ids.push(r.id);
        }
      }
      if (!data || data.length < chunk) break;
    }
    return ids;
  };

  const assignChunked = async (leadIds: string[], agentId: string, now: string) => {
    // 1. Fetch mobiles of all leads being assigned to lock all duplicate records
    const { data: leadsToAssign } = await supabase.from("leads").select("id, mobile").in("id", leadIds);
    const mobiles = (leadsToAssign ?? []).map((l) => l.mobile?.trim()).filter(Boolean) as string[];

    const size = 500;
    for (let i = 0; i < leadIds.length; i += size) {
      const slice = leadIds.slice(i, i + size);
      const { error } = await supabase.from("leads")
        .update({ assigned_to: agentId, assigned_at: now, status: "Assigned" })
        .in("id", slice).eq("company_id", companyId!);
      if (error) throw error;
      // Use upsert on lead_id to prevent duplicate assignment history records
      const { error: aErr } = await supabase.from("lead_assignments").upsert(
        slice.map((id) => ({ lead_id: id, company_id: companyId!, employee_id: agentId, assigned_by: session!.userId! })),
        { onConflict: "lead_id" },
      );
      if (aErr) throw aErr;
    }

    // STRICT RULE: Lock all matching phone numbers in the company to this agent so NO other agent can EVER receive this number
    if (mobiles.length > 0) {
      await supabase.from("leads")
        .update({ assigned_to: agentId, assigned_at: now, status: "Assigned" })
        .in("mobile", mobiles)
        .eq("company_id", companyId!);
    }
  };

  const assign = async (leadIds: string[], agentId: string) => {
    if (leadIds.length === 0) return toast.error("Select at least one lead");
    if (!agentId) return toast.error("Select an agent");
    setBusy(true);
    try {
      await assignChunked(leadIds, agentId, new Date().toISOString());
      toast.success(`${leadIds.length} lead(s) assigned to ${agentName(agentId)}`);
      setSelected(new Set());
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  };

  const distributeEqually = async () => {
    const active = agents.filter((a) => a.is_active);
    if (active.length === 0) return toast.error("No active agents found in company");
    if (!companyId) return;
    setBusy(true);
    try {
      if (selected.size > 0) {
        // Distribute selected leads
        const pool = [...selected];
        const now = new Date().toISOString();
        for (let i = 0; i < active.length; i++) {
          const agent = active[i]!;
          const ids = pool.filter((_, idx) => idx % active.length === i);
          if (ids.length === 0) continue;
          await assignChunked(ids, agent.id, now);
        }
        toast.success(`${pool.length} selected leads distributed across ${active.length} agents`);
        setSelected(new Set());
      } else {
        // Use atomic PostgreSQL RPC for equal distribution with row locks & audit logging
        const perAgent = batchSettings?.batchSize || 100;
        const res = await distributeLeadsEqually(companyId, active.map((a) => a.id), perAgent, folderDate);
        if (!res.success) {
          toast.error(res.message);
        } else {
          toast.success(res.message);
        }
      }
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Distribution failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Daily Leads"
        description={`📁 Folder ${folderDate} · ${folderStats.total.toLocaleString("en-IN")} leads · ${folderStats.assigned.toLocaleString("en-IN")} assigned`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {companyId && (
              <AutoAssignControls
                companyId={companyId}
                onAddNewData={() => setAddNewDataOpen(true)}
              />
            )}
            <Input
              type="date"
              value={folderDate}
              onChange={(e) => setFolderDate(e.target.value)}
              className="h-9 w-[150px] text-xs font-semibold"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1 text-xs font-semibold"
              onClick={() => exportFolder("xlsx")}
              title="Export folder leads as formatted Excel spreadsheet"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Export Excel</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1 text-xs font-semibold"
              onClick={() => exportFolder("csv")}
              title="Export folder leads as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button
              size="sm"
              className="gradient-brand text-white font-bold gap-1.5 shadow-xs h-9"
              onClick={() => setAddNewDataOpen(true)}
              title="Add new data: upload Excel/CSV or add single leads to queue"
            >
              <PlusCircle className="h-4 w-4" />
              <span>+ Add New Data</span>
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" /> Import Excel/CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-destructive hover:bg-destructive/10 border-destructive/30"
              onClick={() => setDeleteFolderDialogOpen(true)}
              title="Delete all leads in this folder"
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete Folder
            </Button>
          </div>
        }
      />

      <AddNewDataDialog
        open={addNewDataOpen}
        onOpenChange={setAddNewDataOpen}
        companyId={companyId}
        adminUserId={session?.userId ?? null}
        defaultFolderDate={folderDate}
        onOpenImportWizard={() => setImportOpen(true)}
        onSuccess={() => {
          qc.invalidateQueries();
        }}
      />

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        companyId={companyId}
        userId={session?.userId ?? null}
        folderDate={folderDate}
        onViewImported={() => { setUnassignedOnly(true); setSelected(new Set()); }}
      />

      <CreateLeadDialog
        open={createLeadOpen}
        onOpenChange={setCreateLeadOpen}
        companyId={companyId}
        adminUserId={session?.userId ?? null}
        defaultFolderDate={folderDate}
        onSuccess={() => {
          qc.invalidateQueries();
        }}
      />

      <div className="mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap pb-1">
        {folders.map((f) => (
          <button
            key={f.date}
            type="button"
            onClick={() => { setFolderDate(f.date); setSelected(new Set()); setPage(0); }}
            className={`shrink-0 rounded-xl border px-3.5 py-2 text-xs font-semibold transition touch-tap ${
              f.date === folderDate ? "gradient-brand text-white shadow-sm" : "bg-card hover:bg-muted/50"
            }`}
          >
            📁 {f.date.split("-").reverse().join("-")} · {f.count}
          </button>
        ))}
        {!folders.some((f) => f.date === todayISO()) && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setFolderDate(todayISO()); setImportOpen(true); }}>
            <FolderPlus className="mr-1 h-4 w-4" /> Create Today's Folder
          </Button>
        )}
      </div>

      {/* ── LIVE PRIORITY QUEUE INDICATOR ── */}
      <div className="mb-4 rounded-2xl border bg-gradient-to-r from-card via-card to-primary/5 p-4 card-elevated">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Activity className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold tracking-tight">Live Priority Queue</h3>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold border ${
                  autoAssignStatus === "RUNNING"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    : autoAssignStatus === "PAUSED"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    autoAssignStatus === "RUNNING" ? "bg-emerald-500 animate-ping" : autoAssignStatus === "PAUSED" ? "bg-amber-500" : "bg-slate-400"
                  }`} />
                  {autoAssignStatus === "RUNNING" ? "Live Auto-Assign Running" : autoAssignStatus === "PAUSED" ? "Auto-Assign Paused" : "Auto-Assign Stopped"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {autoAssignStatus === "RUNNING"
                  ? "New leads are auto-prioritized (HIGH first) and dispatched to active agents without interrupting ongoing calls."
                  : autoAssignStatus === "PAUSED"
                  ? "Queue paused. New uploads are safely saved with priority without auto-assigning."
                  : "Queue stopped. Click Start in controls above to resume automatic distribution."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gradient-brand text-white font-bold shadow-xs gap-1.5"
              onClick={() => setAddNewDataOpen(true)}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Add New Data</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs font-semibold"
              onClick={() => setImportOpen(true)}
              title="Direct spreadsheet import wizard"
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Upload File</span>
            </Button>
          </div>
        </div>

        {/* Stopped State Notification & Action Callout */}
        {autoAssignStatus === "STOPPED" && (
          <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2.5 text-foreground">
              <span className="text-base">⏹️</span>
              <div>
                <span className="font-bold">Auto-Assignment is Stopped:</span>{" "}
                <span className="text-muted-foreground">
                  Agents will not receive any leads. You can use <strong>Add New Data</strong> to safely queue leads by priority.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                className="gradient-brand text-white font-bold h-7 px-3 text-xs gap-1 shadow-2xs"
                onClick={() => setAddNewDataOpen(true)}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>+ Add New Data</span>
              </Button>
            </div>
          </div>
        )}

        {/* Live Priority Breakdown Grid */}
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">High Priority</span>
              <Flame className="h-3.5 w-3.5" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-rose-600 dark:text-rose-400">
              {folderStats.highWaiting.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">Front of Queue</span>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Medium Priority</span>
              <AlertCircle className="h-3.5 w-3.5" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-amber-600 dark:text-amber-400">
              {folderStats.medWaiting.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">Follow-up Leads</span>
          </div>

          <div className="rounded-xl border border-slate-500/30 bg-slate-500/5 p-3">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider">Low Priority</span>
              <Clock className="h-3.5 w-3.5" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-slate-600 dark:text-slate-400">
              {folderStats.lowWaiting.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">Standard Leads</span>
          </div>

          <div className="rounded-xl border bg-elevated p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-wider">Unassigned Waiting</span>
              <Inbox className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-foreground">
              {folderStats.unassigned.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">Ready for Calling</span>
          </div>

          <div className="rounded-xl border bg-elevated p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-wider">Total Assigned</span>
              <UserCheck className="h-3.5 w-3.5 text-success" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-success">
              {folderStats.assigned.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">Active Workload</span>
          </div>

          <div className="rounded-xl border bg-elevated p-3">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-wider">Folder Total</span>
              <Layers className="h-3.5 w-3.5 text-brand" />
            </div>
            <p className="mt-1 text-xl font-extrabold text-foreground">
              {folderStats.total.toLocaleString("en-IN")}
            </p>
            <span className="text-[10px] font-medium text-muted-foreground">All Leads in Folder</span>
          </div>
        </div>
      </div>

      {/* View Switcher Tabs (All Leads vs Unassigned Queue) */}
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setUnassignedOnly(false); setSelected(new Set()); setPage(0); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              !unassignedOnly
                ? "bg-brand text-white shadow-xs"
                : "bg-card border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>All Folder Leads ({folderStats.total.toLocaleString("en-IN")})</span>
          </button>
          <button
            type="button"
            onClick={() => { setUnassignedOnly(true); setSelected(new Set()); setPage(0); }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              unassignedOnly
                ? "gradient-brand text-white shadow-xs"
                : "bg-card border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>Unassigned Queue ({folderStats.unassigned.toLocaleString("en-IN")})</span>
          </button>
        </div>

        {unassignedOnly && folderStats.unassigned > 0 && (
          <span className="text-xs font-semibold text-brand hidden md:inline-flex items-center gap-1">
            ⚡ {folderStats.unassigned.toLocaleString("en-IN")} leads waiting to be assigned to agents
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border bg-card p-3 card-elevated sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center justify-between gap-2 sm:justify-start">
          <span className="text-xs font-semibold sm:text-sm">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => { setUnassignedOnly((v) => !v); setSelected(new Set()); setPage(0); }}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition touch-tap sm:hidden ${unassignedOnly ? "gradient-brand border-transparent text-white" : "hover:bg-muted/50"}`}
          >
            Unassigned ({folderStats.unassigned})
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <Select value={assignAgent} onValueChange={setAssignAgent}>
            <SelectTrigger className="h-9 w-full sm:w-[200px]"><SelectValue placeholder="Select agent" /></SelectTrigger>
            <SelectContent>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button size="sm" disabled={busy || selected.size === 0} className="gradient-brand text-white" onClick={() => assign([...selected], assignAgent)}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Users2 className="mr-1 h-3.5 w-3.5" />} Assign
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={distributeEqually}>
              <Shuffle className="mr-1 h-3.5 w-3.5" /> Auto-Distribute
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || bulkDeleteM.isPending}
              className="text-destructive hover:bg-destructive/10 border-destructive/30"
              onClick={deleteSelected}
            >
              {bulkDeleteM.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
              Delete Selected ({selected.size})
            </Button>
          )}
          <button
            type="button"
            onClick={() => { setUnassignedOnly((v) => !v); setSelected(new Set()); setPage(0); }}
            className={`hidden rounded-lg border px-3 py-1.5 text-xs font-semibold transition touch-tap sm:inline-flex ${unassignedOnly ? "gradient-brand border-transparent text-white" : "hover:bg-muted/50"}`}
          >
            Unassigned only ({folderStats.unassigned})
          </button>
        </div>
        {agents.length === 0 && (
          <Button asChild size="sm" variant="ghost" className="w-full sm:w-auto"><Link to="/agents"><UserPlus className="mr-1 h-4 w-4" /> Create agents first</Link></Button>
        )}
      </div>

      {/* Mobile Card List View (< md) */}
      <div className="mt-4 space-y-3 md:hidden">
        <div className="flex items-center justify-between px-1">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Checkbox checked={visibleLeads.length > 0 && selected.size === visibleLeads.length} onCheckedChange={toggleAll} />
            <span>Select all on page</span>
          </label>
          <span className="text-xs text-muted-foreground">{filteredCount} total</span>
        </div>

        {visibleLeads.map((l) => (
          <div key={l.id} className="rounded-2xl border bg-card p-4 card-elevated">
            <div className="flex items-start gap-3">
              <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link to="/lead/$leadId" params={{ leadId: l.id }} className="truncate font-bold text-foreground hover:underline">
                    {l.customer_name}
                  </Link>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Select
                      value={l.priority || "LOW"}
                      onValueChange={(val) => updatePriorityM.mutate({ leadId: l.id, priority: val as LeadPriority })}
                      disabled={updatePriorityM.isPending}
                    >
                      <SelectTrigger className={`h-6 w-[88px] border px-1.5 text-[10px] font-bold ${priorityTone(l.priority)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIGH" className="text-rose-600 font-bold">⚡ High</SelectItem>
                        <SelectItem value="MEDIUM" className="text-amber-600 font-bold">🔶 Med</SelectItem>
                        <SelectItem value="LOW" className="text-slate-600 font-bold">🔷 Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <LeadStatusBadge status={l.status} />
                  </div>
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{l.mobile}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-foreground">{inr(Number(l.loan_amount))}</span>
                  <span className="text-muted-foreground">· {l.loan_type}</span>
                  {l.city && <span className="text-muted-foreground">· {l.city}</span>}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="flex-1 min-w-[130px]">
                    <Select value={l.assigned_to ?? ""} onValueChange={(v) => assign([l.id], v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign agent" /></SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild size="sm" variant="outline" className="h-8 px-2.5">
                      <a href={`tel:${l.mobile}`} aria-label="Call"><PhoneCall className="h-3.5 w-3.5 text-brand" /></a>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete lead"
                      onClick={() => setLeadToDelete(l)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View (>= md) */}
      <div className="mt-4 hidden overflow-x-auto rounded-2xl border bg-card card-elevated md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3"><Checkbox checked={visibleLeads.length > 0 && selected.size === visibleLeads.length} onCheckedChange={toggleAll} /></th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Mobile</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Loan Amount</th>
              <th className="px-4 py-3">Loan Type</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assign</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((l) => (
              <tr key={l.id} className="border-t transition hover:bg-muted/30">
                <td className="px-4 py-3"><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></td>
                <td className="px-4 py-3">
                  <Link to="/lead/$leadId" params={{ leadId: l.id }} className="font-semibold hover:underline">{l.customer_name}</Link>
                  <p className="text-[11px] text-muted-foreground">{l.city ?? ""}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{l.mobile}</td>
                <td className="px-4 py-3">
                  <Select
                    value={l.priority || "LOW"}
                    onValueChange={(val) => updatePriorityM.mutate({ leadId: l.id, priority: val as LeadPriority })}
                    disabled={updatePriorityM.isPending}
                  >
                    <SelectTrigger className={`h-7 w-[100px] border px-2 text-[10.5px] font-bold ${priorityTone(l.priority)}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HIGH" className="text-rose-600 font-bold">
                        ⚡ High
                      </SelectItem>
                      <SelectItem value="MEDIUM" className="text-amber-600 font-bold">
                        🔶 Medium
                      </SelectItem>
                      <SelectItem value="LOW" className="text-slate-600 font-bold">
                        🔷 Low
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 font-semibold">{inr(Number(l.loan_amount))}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.loan_type}</td>
                <td className="px-4 py-3">{agentName(l.assigned_to)}</td>
                <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                <td className="px-4 py-3">
                  <Select value={l.assigned_to ?? ""} onValueChange={(v) => assign([l.id], v)}>
                    <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Assign agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title={`Delete ${l.customer_name}`}
                    onClick={() => setLeadToDelete(l)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading leads…</p>}
        {!isLoading && visibleLeads.length === 0 && (
          <p className="p-10 text-center text-sm text-muted-foreground">No leads in this folder. Add or import leads to get started.</p>
        )}
      </div>

      {/* Delete Folder Dialog */}
      <Dialog open={deleteFolderDialogOpen} onOpenChange={setDeleteFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete Folder {folderDate.split("-").reverse().join("-")}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete folder <strong>{folderDate.split("-").reverse().join("-")}</strong>?
              <br /><br />
              This will permanently delete all <strong>{folderStats.total.toLocaleString("en-IN")}</strong> leads and their call histories in this folder. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleteFolderM.isPending} onClick={() => setDeleteFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteFolderM.isPending}
              onClick={() => deleteFolderM.mutate(folderDate)}
            >
              {deleteFolderM.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Yes, Delete Entire Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Single Lead Dialog */}
      <Dialog open={Boolean(leadToDelete)} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete Lead {leadToDelete?.customer_name}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong>{leadToDelete?.customer_name}</strong> ({leadToDelete?.mobile})?
              <br /><br />
              This will permanently remove this lead and all its call records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={singleDeleteM.isPending} onClick={() => setLeadToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={singleDeleteM.isPending}
              onClick={() => {
                if (leadToDelete) singleDeleteM.mutate(leadToDelete.id);
              }}
            >
              {singleDeleteM.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Delete Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filteredCount > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border bg-card p-3 text-xs text-muted-foreground card-elevated sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {(page * PAGE_SIZE + 1).toLocaleString("en-IN")}–
            {Math.min((page + 1) * PAGE_SIZE, filteredCount).toLocaleString("en-IN")} of {filteredCount.toLocaleString("en-IN")}
          </span>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => { setPage((p) => p - 1); setSelected(new Set()); }}>Previous</Button>
            <span className="font-semibold">Page {page + 1} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => { setPage((p) => p + 1); setSelected(new Set()); }}>Next</Button>
          </div>
        </div>
      )}

      <ImportHistory companyId={companyId} />
    </>
  );
}

function NewLeadDialog({ companyId, folderDate, userId }: { companyId: string | null; folderDate: string; userId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ customer_name: "", mobile: "", loan_amount: "", loan_type: LOAN_TYPES[0]!, city: "", source: "Manual" });

  const save = async () => {
    if (!companyId) return toast.error("No company linked to your account");
    setBusy(true);
    const { error } = await supabase.from("leads").insert({
      company_id: companyId,
      customer_name: form.customer_name,
      mobile: form.mobile,
      loan_amount: Number(form.loan_amount || 0),
      loan_type: form.loan_type,
      city: form.city || null,
      source: form.source,
      folder_date: folderDate,
      created_by: userId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Lead created");
    setForm({ customer_name: "", mobile: "", loan_amount: "", loan_type: LOAN_TYPES[0]!, city: "", source: "Manual" });
    setOpen(false);
    qc.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gradient-brand text-white"><Plus className="mr-1 h-4 w-4" /> Add Lead</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New lead</DialogTitle><DialogDescription>Added to folder {folderDate}.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>Customer name</Label>
            <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Mobile</Label>
            <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Loan amount</Label>
            <Input type="number" value={form.loan_amount} onChange={(e) => setForm({ ...form, loan_amount: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Loan type</Label>
            <Select value={form.loan_type} onValueChange={(v) => setForm({ ...form, loan_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LOAN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>City</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy || !form.customer_name || !form.mobile} className="gradient-brand text-white">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportHistory({ companyId }: { companyId: string | null }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["lead-imports", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_imports")
        .select("id, file_name, folder_date, total_rows, imported_count, duplicate_count, error_count, created_at, imported_by, status, started_at, completed_at")
        .eq("company_id", companyId!).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: session } = useCrmSession();

  if (rows.length === 0) return null;

  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border bg-card card-elevated">
      <p className="flex items-center gap-2 border-b px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Import history
      </p>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Import Date</th>
            <th className="px-4 py-3">File Name</th>
            <th className="px-4 py-3">Folder</th>
            <th className="px-4 py-3">Total Rows</th>
            <th className="px-4 py-3">Imported</th>
            <th className="px-4 py-3">Duplicates</th>
            <th className="px-4 py-3">Errors</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Imported By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-3">{new Date(r.started_at ?? r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-4 py-3 font-medium">{r.file_name}</td>
              <td className="px-4 py-3 text-muted-foreground">📁 {r.folder_date.split("-").reverse().join("-")}</td>
              <td className="px-4 py-3">{r.total_rows.toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 font-semibold text-success">{r.imported_count.toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 text-warning">{r.duplicate_count.toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 text-destructive">{r.error_count.toLocaleString("en-IN")}</td>
              <td className="px-4 py-3">
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                  r.status === "completed" ? "border-success/30 bg-success/10 text-success"
                  : r.status === "processing" ? "border-brand/30 bg-brand/10 text-brand"
                  : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{r.status}</span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{r.imported_by === session?.userId ? session?.fullName || "You" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

