import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2, RotateCcw, AlertTriangle, Phone, PhoneCall, RefreshCw,
  Search, ShieldAlert, WifiOff, FileText, CheckCircle2, Loader2, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadStatusBadge } from "@/components/crm/LeadStatusBadge";
import { AgentLeadSheet } from "@/components/crm/AgentLeadSheet";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { formatDateTime, inr, type Lead } from "@/lib/crm";
import { isTrashLead, parseTrashData, type TrashData } from "@/lib/trash";
import { restoreLeadServerFn, permanentDeleteLeadServerFn } from "@/lib/crm.functions";

export const Route = createFileRoute("/_app/trash")({
  head: () => ({
    meta: [
      { title: "Trash & Out of Service — Hezo CRM" },
      { name: "description", content: "Review trashed, out of service, and invalid number leads with restore capability." },
      { property: "og:title", content: "Trash & Out of Service — Hezo CRM" },
      { property: "og:description", content: "Review and manage trashed leads." },
    ],
  }),
  component: TrashLeadsPage,
});

function TrashLeadsPage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const isAdmin = session?.isAdmin ?? false;
  const companyId = session?.companyId ?? null;
  const userId = session?.userId ?? null;

  const [q, setQ] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [viewLead, setViewLead] = useState<Lead | null>(null);

  // Fetch leads for this agent (or company if admin)
  const { data: rawLeads = [], isLoading, refetch } = useQuery({
    queryKey: ["trash-leads", companyId, userId, isAdmin],
    enabled: Boolean(companyId || userId),
    queryFn: async () => {
      let query = supabase.from("leads").select("*");
      if (companyId) query = query.eq("company_id", companyId);
      if (!isAdmin && userId) query = query.eq("assigned_to", userId);
      query = query.order("updated_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  // Filter only Trash leads and enrich with parsed metadata
  const trashLeads = useMemo(() => {
    return rawLeads
      .filter((l) => isTrashLead(l.notes))
      .map((l) => ({
        ...l,
        trashData: parseTrashData(l.notes) as TrashData | null,
      }));
  }, [rawLeads]);

  // Filtered trash leads based on search term & reason
  const filteredLeads = useMemo(() => {
    const term = q.trim().toLowerCase();
    return trashLeads.filter((l) => {
      if (term) {
        const matchesName = l.customer_name.toLowerCase().includes(term);
        const matchesPhone = l.mobile.includes(term);
        const matchesCity = (l.city || "").toLowerCase().includes(term);
        const matchesNotes = (l.notes || "").toLowerCase().includes(term);
        if (!matchesName && !matchesPhone && !matchesCity && !matchesNotes) return false;
      }
      if (reasonFilter !== "all") {
        const reason = (l.trashData?.reason || "").toLowerCase();
        if (reasonFilter === "out_of_service" && !reason.includes("out of service")) return false;
        if (reasonFilter === "wrong_number" && !reason.includes("wrong")) return false;
      }
      return true;
    });
  }, [trashLeads, q, reasonFilter]);

  const metrics = useMemo(() => {
    const total = trashLeads.length;
    const outOfService = trashLeads.filter((l) =>
      (l.trashData?.reason || "").toLowerCase().includes("out of service")
    ).length;
    const totalValue = trashLeads.reduce((acc, l) => acc + (Number(l.loan_amount) || 0), 0);

    return {
      total,
      outOfService,
      totalValue,
    };
  }, [trashLeads]);

  // Restore mutation
  const restoreM = useMutation({
    mutationFn: async (leadId: string) => {
      await restoreLeadServerFn({ data: { leadId } });
    },
    onSuccess: () => {
      toast.success("♻️ Lead restored to active queue!");
      qc.invalidateQueries({ queryKey: ["trash-leads"] });
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });
      qc.invalidateQueries({ queryKey: ["active-batch"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to restore lead"),
  });

  // Permanent delete mutation (Admins only)
  const deleteM = useMutation({
    mutationFn: async (leadId: string) => {
      await permanentDeleteLeadServerFn({ data: { leadId } });
    },
    onSuccess: () => {
      toast.success("🗑️ Lead permanently deleted");
      qc.invalidateQueries({ queryKey: ["trash-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete lead"),
  });

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Trash & Out of Service"
        description="Leads marked as Out of Service, invalid numbers, or deleted. Restore them anytime back to your queue."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-9 gap-1.5 font-medium"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="TRASHED LEADS"
          value={metrics.total}
          hint="Out of service or deleted"
          icon={Trash2}
          tone="destructive"
        />
        <StatCard
          label="OUT OF SERVICE"
          value={metrics.outOfService}
          hint="Switched off / unreachable"
          icon={WifiOff}
          tone="warning"
        />
        <StatCard
          label="PIPELINE VALUE"
          value={inr(metrics.totalValue)}
          hint="Total loan requirement"
          icon={ShieldAlert}
          tone="brand"
        />
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card p-4 rounded-xl border">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, phone number, city or remarks..."
            className="pl-9 h-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reasons</SelectItem>
              <SelectItem value="out_of_service">Out of Service</SelectItem>
              <SelectItem value="wrong_number">Wrong Number</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Leads Table / Cards List */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border bg-card/50">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-brand" />
            <p className="text-sm font-medium">Loading trash leads...</p>
          </div>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center bg-card/40">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-4">
            <Trash2 className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Trash is empty</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md">
            {q
              ? "No trashed leads match your search criteria."
              : "When you mark leads as 'Out of Service' or delete them, they will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLeads.map((lead) => {
            const trash = lead.trashData;
            return (
              <div
                key={lead.id}
                className="group relative flex flex-col justify-between rounded-xl border border-destructive/20 bg-card p-4 transition-all hover:shadow-md hover:border-destructive/40"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-foreground text-sm line-clamp-1">
                          {lead.customer_name}
                        </h4>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-destructive/15 text-destructive">
                          Trashed
                        </span>
                      </div>
                      <a
                        href={`tel:${lead.mobile}`}
                        className="mt-0.5 flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-brand"
                      >
                        <Phone className="h-3 w-3" /> {lead.mobile}
                      </a>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-destructive/15 bg-destructive/5 p-2.5 text-xs text-destructive">
                    <span className="font-semibold block text-[11px]">Reason:</span>
                    <p className="line-clamp-2 mt-0.5 text-foreground/90">
                      {trash?.reason || "Out of Service / Invalid Number"}
                    </p>
                    {trash?.trashedAt && (
                      <span className="mt-1.5 block text-[10px] text-muted-foreground">
                        Trashed: {formatDateTime(trash.trashedAt)}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div>
                      <span>Loan: </span>
                      <strong className="text-foreground">
                        {lead.loan_amount ? inr(Number(lead.loan_amount)) : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Type: </span>
                      <strong className="text-foreground">{lead.loan_type}</strong>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t pt-3 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-semibold gap-1.5 flex-1 border-success/30 text-success hover:bg-success/10 hover:text-success"
                    onClick={() => restoreM.mutate(lead.id)}
                    disabled={restoreM.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs px-2.5"
                    onClick={() => setViewLead(lead)}
                  >
                    Details
                  </Button>

                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 px-2"
                      title="Permanently Delete"
                      onClick={() => {
                        if (confirm(`Permanently delete lead ${lead.customer_name}? This cannot be undone.`)) {
                          deleteM.mutate(lead.id);
                        }
                      }}
                      disabled={deleteM.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View Lead Sheet */}
      <AgentLeadSheet
        lead={viewLead}
        open={Boolean(viewLead)}
        onOpenChange={(o) => !o && setViewLead(null)}
      />
    </div>
  );
}
