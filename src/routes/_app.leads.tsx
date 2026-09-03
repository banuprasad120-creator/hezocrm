import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download, Inbox, Loader2, MessageCircle, Phone, Search, Upload, Users2, Eye,
  Clock, Flame, PhoneCall, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { StatCard } from "@/components/common/StatCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { ImportLeadsWizard } from "@/components/crm/ImportLeadsWizard";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, LEAD_STATUSES, LOAN_TYPES, inr, todayISO, type Lead } from "@/lib/crm";

export const Route = createFileRoute("/_app/leads")({
  head: () => ({
    meta: [
      { title: "All Leads — Hezo CRM" },
      { name: "description", content: "Every lead, every call, every follow-up — searchable across your whole company." },
      { property: "og:title", content: "All Leads — Hezo CRM" },
      { property: "og:description", content: "Manage every lead across your call center operations." },
    ],
  }),
  component: LeadsPage,
});

const PAGE_SIZE = 50;

function LeadsPage() {
  const { data: session, isLoading: sessionLoading } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;

  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("all");
  const [loanType, setLoanType] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignAgent, setAssignAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!sessionLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [sessionLoading, session, navigate]);

  useEffect(() => {
    const id = window.setTimeout(() => { setTerm(q.trim()); setPage(0); }, 250);
    return () => window.clearTimeout(id);
  }, [q]);

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const applyFilters = (query: any): any => {
    let out = query.eq("company_id", companyId!);
    if (status !== "all") out = out.eq("status", status);
    if (loanType !== "all") out = out.eq("loan_type", loanType);
    if (term) {
      const like = `%${term.replace(/[,()%]/g, " ")}%`;
      out = out.or(`customer_name.ilike.${like},mobile.ilike.${like},city.ilike.${like}`);
    }
    return out;
  };


  const { data: stats } = useQuery({
    queryKey: ["all-leads-stats", companyId],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      const base = () => supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", companyId!);
      const [{ count: total }, { count: assigned }, { count: called }, { count: interested }] = await Promise.all([
        base(),
        base().not("assigned_to", "is", null),
        base().in("status", [...CONTACTED_STATUSES]),
        base().eq("status", "Interested"),
      ]);
      return {
        total: total ?? 0,
        assigned: assigned ?? 0,
        pending: (total ?? 0) - (called ?? 0),
        interested: interested ?? 0,
      };
    },
  });

  const { data: pageData, isFetching } = useQuery({
    queryKey: ["all-leads", companyId, term, status, loanType, page],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      const { data, error, count } = await applyFilters(supabase.from("leads").select("*", { count: "exact" }))
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Lead[], count: count ?? 0 };
    },
  });

  const rows = pageData?.rows ?? [];
  const totalRows = pageData?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const agentName = useMemo(() => {
    const map = new Map(agents.map((a) => [a.id, a.full_name || a.email]));
    return (id: string | null) => (id ? map.get(id) ?? "Assigned" : "—");
  }, [agents]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };
  const allOnPage = rows.length > 0 && rows.every((l) => selected.has(l.id));
  const toggleAll = () => {
    const n = new Set(selected);
    if (allOnPage) rows.forEach((l) => n.delete(l.id));
    else rows.forEach((l) => n.add(l.id));
    setSelected(n);
  };

  const assignSelected = async () => {
    if (!assignAgent || selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const ids = [...selected];
      const { error } = await supabase
        .from("leads")
        .update({ assigned_to: assignAgent, assigned_at: new Date().toISOString(), status: "Assigned" })
        .in("id", ids);
      if (error) throw error;
      await supabase.from("lead_assignments").insert(
        ids.map((id) => ({ lead_id: id, company_id: companyId!, employee_id: assignAgent, assigned_by: session?.userId ?? null })),
      );
      toast.success(`Assigned ${ids.length} lead${ids.length > 1 ? "s" : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["all-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads-stats"] });
    } catch (e) {
      toast.error("Could not assign leads", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const chunk = 1000;
      const out: Lead[] = [];
      for (let from = 0; from < Math.min(totalRows || chunk, 20000); from += chunk) {
        const { data, error } = await applyFilters(supabase.from("leads").select("*"))
          .order("created_at", { ascending: false })
          .range(from, from + chunk - 1);
        if (error) throw error;
        out.push(...((data ?? []) as Lead[]));
        if (!data || data.length < chunk) break;
      }
      if (out.length === 0) { toast.info("Nothing to export for these filters"); return; }
      const cols = ["id", "customer_name", "mobile", "email", "loan_type", "loan_amount", "city", "status", "folder_date", "assigned_to", "last_call_at"] as const;
      const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [
        cols.join(","),
        ...out.map((l) => cols.map((c) => escape(c === "assigned_to" ? agentName(l.assigned_to) : l[c])).join(",")),
      ].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `hezo-leads-${todayISO()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${out.length} leads`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  if (sessionLoading) return <p className="text-sm text-muted-foreground">Loading leads…</p>;
  if (!isAdmin) return null;


  return (
    <>
      <PageHeader
        title="All Leads"
        description="Every lead in your company — search, filter, assign and export."
        actions={
          <>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Import
            </Button>
            <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={exportCsv}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />} Export
            </Button>
            <Button asChild size="sm" className="h-9 gradient-brand text-white">
              <Link to="/daily-leads">Add / Assign leads</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Total Leads" value={stats?.total ?? 0} icon={PhoneCall} tone="brand" hint="in pipeline" />
        <StatCard label="Assigned" value={stats?.assigned ?? 0} icon={Users2} tone="info" hint="with agents" />
        <StatCard label="Pending calls" value={stats?.pending ?? 0} icon={Clock} tone="warning" hint="not contacted" />
        <StatCard label="Interested" value={stats?.interested ?? 0} icon={Flame} tone="success" hint="hot pipeline" />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border bg-card card-elevated sm:mt-6">
        <div className="flex flex-col gap-3 border-b p-3 sm:p-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search leads by name, mobile or city…"
                className="h-10 bg-elevated pl-9 text-xs sm:text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
                <SelectTrigger className="h-9 text-xs sm:h-10 sm:w-44 sm:text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={loanType} onValueChange={(v) => { setLoanType(v); setPage(0); }}>
                <SelectTrigger className="h-9 text-xs sm:h-10 sm:w-44 sm:text-sm"><SelectValue placeholder="Loan type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All loan types</SelectItem>
                  {LOAN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border bg-elevated p-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="text-xs font-semibold">{selected.size} selected</span>
              <Select value={assignAgent} onValueChange={setAssignAgent}>
                <SelectTrigger className="h-9 w-full sm:w-52"><SelectValue placeholder="Choose agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button size="sm" className="gradient-brand text-white" disabled={busy || !assignAgent} onClick={assignSelected}>
                  <Users2 className="mr-1.5 h-4 w-4" /> Assign
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
          )}
        </div>

        {isFetching && rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading leads…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border bg-elevated">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </span>
            <div>
              <p className="text-[15px] font-semibold">No leads found</p>
              <p className="mt-1 text-sm text-muted-foreground">Import a list or clear your filters to see leads.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Import Leads
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile Lead Cards View (< md) */}
            <div className="divide-y md:hidden">
              <div className="flex items-center justify-between bg-muted/20 px-4 py-2 text-xs font-semibold text-muted-foreground">
                <label className="flex items-center gap-2">
                  <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select page" />
                  <span>Select all on page</span>
                </label>
                <span>{totalRows} total</span>
              </div>
              {rows.map((l) => {
                const initials = l.customer_name.split(" ").map((p) => p[0]).slice(0, 2).join("");
                return (
                  <div
                    key={l.id}
                    onClick={() => navigate({ to: "/lead/$leadId", params: { leadId: l.id } })}
                    className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-elevated/70 touch-tap"
                  >
                    <div className="flex items-start gap-3">
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                        <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                      </div>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-elevated text-xs font-bold text-brand">
                        {initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-bold text-foreground">{l.customer_name}</p>
                          <LeadStatusBadge status={l.status} />
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">{l.mobile}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold">{inr(Number(l.loan_amount))}</span>
                          <span className="text-muted-foreground">· {l.loan_type}</span>
                          {l.city && <span className="text-muted-foreground">· {l.city}</span>}
                        </div>
                        {l.assigned_to && (
                          <p className="mt-1 text-[11px] text-muted-foreground">Agent: {agentName(l.assigned_to)}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
                      <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                        <a href={`tel:${l.mobile}`}><Phone className="h-3.5 w-3.5 text-brand" /> Call</a>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                        <a href={`https://wa.me/${l.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                          <MessageCircle className="h-3.5 w-3.5 text-success" /> WhatsApp
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="Open lead">
                        <Link to="/lead/$leadId" params={{ leadId: l.id }}><Eye className="h-4 w-4" /></Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View (>= md) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select page" />
                    </th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Loan</th>
                    <th className="hidden px-4 py-3 xl:table-cell">City</th>
                    <th className="hidden px-4 py-3 2xl:table-cell">Folder</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Assignee</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    const initials = l.customer_name.split(" ").map((p) => p[0]).slice(0, 2).join("");
                    return (
                      <tr
                        key={l.id}
                        onClick={() => navigate({ to: "/lead/$leadId", params: { leadId: l.id } })}
                        className="cursor-pointer border-t transition-colors hover:bg-elevated/70"
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-elevated text-[11px] font-bold text-brand">
                              {initials}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{l.customer_name}</p>
                              <p className="truncate font-mono text-[11px] text-muted-foreground">{l.mobile}</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-2.5 lg:table-cell">
                          <p className="font-medium">{inr(Number(l.loan_amount))}</p>
                          <p className="text-[11px] text-muted-foreground">{l.loan_type}</p>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground xl:table-cell">{l.city || "—"}</td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground 2xl:table-cell">{l.folder_date}</td>
                        <td className="px-4 py-2.5"><LeadStatusBadge status={l.status} /></td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{agentName(l.assigned_to)}</td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="Call">
                              <a href={`tel:${l.mobile}`}><Phone className="h-4 w-4" /></a>
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="WhatsApp">
                              <a href={`https://wa.me/${l.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="Open lead">
                              <Link to="/lead/$leadId" params={{ leadId: l.id }}><Eye className="h-4 w-4" /></Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {totalRows > 0 && (
          <div className="flex flex-col gap-2 border-t p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalRows)} of {totalRows}
            </span>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage((p) => p - 1); setSelected(new Set()); }}>Previous</Button>
              <span>Page {page + 1} / {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => { setPage((p) => p + 1); setSelected(new Set()); }}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        companyId={companyId}
        userId={session?.userId ?? null}
        folderDate={todayISO()}
        onViewImported={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ["all-leads"] }); }}
      />
    </>
  );
}
