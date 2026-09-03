import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, History, Loader2, PhoneCall, Plus, Shuffle, Upload, UserPlus, Users2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LOAN_TYPES, inr, todayISO, type Lead } from "@/lib/crm";


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
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [page, setPage] = useState(0);


  useEffect(() => {
    if (!sessionLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [sessionLoading, session, navigate]);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Counts come from head-only count queries so folders with 10,000+ leads stay instant.
  const { data: folderStats = { total: 0, assigned: 0, unassigned: 0, called: 0, pending: 0 } } = useQuery({
    queryKey: ["daily-lead-stats", companyId, folderDate],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      try {
        const base = () => supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("company_id", companyId!).eq("folder_date", folderDate);
        const [{ count: total }, { count: assigned }, { count: called }] = await Promise.all([
          base(),
          base().not("assigned_to", "is", null),
          base().in("status", [...CONTACTED_STATUSES]),
        ]);
        return {
          total: total ?? 0,
          assigned: assigned ?? 0,
          unassigned: (total ?? 0) - (assigned ?? 0),
          called: called ?? 0,
          pending: (total ?? 0) - (called ?? 0),
        };
      } catch (err) {
        console.warn("[folderStats] fetch error:", err);
        return { total: 0, assigned: 0, unassigned: 0, called: 0, pending: 0 };
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

  /** Fetch every UNASSIGNED lead id in the current folder so distribution never reassigns already-assigned leads. */
  const fetchFolderLeadIds = async () => {
    const ids: string[] = [];
    const chunk = 1000;
    for (let from = 0; ; from += chunk) {
      const { data, error } = await supabase.from("leads").select("id")
        .eq("company_id", companyId!).eq("folder_date", folderDate)
        .is("assigned_to", null)  // Only unassigned leads
        .order("created_at", { ascending: true }).range(from, from + chunk - 1);
      if (error) throw error;
      ids.push(...(data ?? []).map((r) => r.id));
      if (!data || data.length < chunk) break;
    }
    return ids;
  };

  const assignChunked = async (leadIds: string[], agentId: string, now: string) => {
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
    if (active.length === 0) return toast.error("No active agents");
    setBusy(true);
    try {
      const pool = selected.size > 0 ? [...selected] : await fetchFolderLeadIds();
      if (pool.length === 0) { toast.error("No leads to distribute"); return; }
      const now = new Date().toISOString();
      for (let i = 0; i < active.length; i++) {
        const agent = active[i]!;
        const ids = pool.filter((_, idx) => idx % active.length === i);
        if (ids.length === 0) continue;
        await assignChunked(ids, agent.id, now);
      }
      toast.success(`${pool.length} leads distributed across ${active.length} agents`);
      setSelected(new Set());
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
          <>
            <Input type="date" value={folderDate} onChange={(e) => setFolderDate(e.target.value)} className="h-9 w-[160px]" />
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" /> Import Leads
            </Button>
            <NewLeadDialog companyId={companyId} folderDate={folderDate} userId={session?.userId ?? null} />
          </>
        }
      />

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        companyId={companyId}
        userId={session?.userId ?? null}
        folderDate={folderDate}
        onViewImported={() => { setUnassignedOnly(true); setSelected(new Set()); }}
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

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {([
          ["Total Leads", folderStats.total],
          ["Assigned", folderStats.assigned],
          ["Unassigned", folderStats.unassigned],
          ["Called", folderStats.called],
          ["Pending", folderStats.pending],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-card p-3.5 card-elevated sm:p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[11px]">{label}</p>
            <p className="mt-1 truncate text-xl font-extrabold sm:text-2xl">{value.toLocaleString("en-IN")}</p>
          </div>
        ))}
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

        <button
          type="button"
          onClick={() => { setUnassignedOnly((v) => !v); setSelected(new Set()); setPage(0); }}
          className={`hidden rounded-lg border px-3 py-1.5 text-xs font-semibold transition touch-tap sm:inline-flex ${unassignedOnly ? "gradient-brand border-transparent text-white" : "hover:bg-muted/50"}`}
        >
          Unassigned only ({folderStats.unassigned})
        </button>
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
                  <LeadStatusBadge status={l.status} />
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{l.mobile}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-foreground">{inr(Number(l.loan_amount))}</span>
                  <span className="text-muted-foreground">· {l.loan_type}</span>
                  {l.city && <span className="text-muted-foreground">· {l.city}</span>}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <div className="flex-1 min-w-[130px]">
                    <Select value={l.assigned_to ?? ""} onValueChange={(v) => assign([l.id], v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign agent" /></SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-8 px-2.5">
                    <a href={`tel:${l.mobile}`} aria-label="Call"><PhoneCall className="h-3.5 w-3.5 text-brand" /></a>
                  </Button>
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
              <th className="px-4 py-3">Loan Amount</th>
              <th className="px-4 py-3">Loan Type</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assign</th>
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
                <td className="px-4 py-3 font-semibold">{inr(Number(l.loan_amount))}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.loan_type}</td>
                <td className="px-4 py-3">{agentName(l.assigned_to)}</td>
                <td className="px-4 py-3"><LeadStatusBadge status={l.status} /></td>
                <td className="px-4 py-3">
                  <Select value={l.assigned_to ?? ""} onValueChange={(v) => assign([l.id], v)}>
                    <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Assign agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

