import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Eye, Folder, Loader2, Phone, Plus, Sparkles, Trash2, UserPlus, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { createAgent, updateAgentPhone } from "@/lib/crm.functions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { allocateNextLeadBatch, getUnassignedLeadsCount } from "@/lib/lead-batch";

export const Route = createFileRoute("/_app/agents")({
  head: () => ({
    meta: [
      { title: "Agents — Hezo CRM" },
      { name: "description", content: "Create calling agent accounts, manage phone numbers, and manually allocate clients." },
      { property: "og:title", content: "Agents — Hezo CRM" },
      { property: "og:description", content: "Manage the calling agents in your company." },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { data: session, isLoading } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const companyId = session?.companyId ?? null;

  useEffect(() => {
    if (!isLoading && session && !session.isAdmin) navigate({ to: "/my-leads", replace: true });
  }, [isLoading, session, navigate]);

  const { data: agents = [] } = useAgents(companyId, session?.isAdmin ?? false);

  const { data: counts = {} } = useQuery({
    queryKey: ["agent-lead-counts", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("assigned_to").eq("company_id", companyId!);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) if (row.assigned_to) map[row.assigned_to] = (map[row.assigned_to] ?? 0) + 1;
      return map;
    },
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "" });

  // Add / Edit Phone state
  const [phoneModal, setPhoneModal] = useState<{
    open: boolean;
    agent: { id: string; name: string; email: string; phone?: string | null } | null;
  }>({
    open: false,
    agent: null,
  });
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);

  // Manual Client Allocation Modal State
  const [allocateModal, setAllocateModal] = useState<{
    open: boolean;
    agent: { id: string; name: string; email: string } | null;
  }>({
    open: false,
    agent: null,
  });
  const [allocateCount, setAllocateCount] = useState<number>(100);
  const [allocateFolderDate, setAllocateFolderDate] = useState<string>("all");
  const [allocateBusy, setAllocateBusy] = useState(false);

  /* ── Total Unassigned Leads in Company ── */
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["unassigned-leads-count", companyId, allocateFolderDate],
    enabled: Boolean(companyId),
    queryFn: () => getUnassignedLeadsCount(companyId!, allocateFolderDate === "all" ? null : allocateFolderDate),
  });

  /* ── Folder Dates for optional targeting ── */
  const { data: folders = [] } = useQuery({
    queryKey: ["lead-folder-dates", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_folder_counts")
        .select("folder_date, lead_count")
        .eq("company_id", companyId!)
        .order("folder_date", { ascending: false });
      if (error) return [];
      return (data ?? []).map((r) => ({
        date: String(r.folder_date),
        count: Number(r.lead_count ?? 0),
      }));
    },
  });

  const openPhoneModal = (agent: { id: string; full_name?: string | null; email: string; phone?: string | null }) => {
    setPhoneModal({
      open: true,
      agent: { id: agent.id, name: agent.full_name || agent.email, email: agent.email, phone: agent.phone || "" },
    });
    setPhoneInput(agent.phone || "");
  };

  const openAllocateModal = (agent: { id: string; full_name?: string | null; email: string }) => {
    setAllocateModal({
      open: true,
      agent: { id: agent.id, name: agent.full_name || agent.email, email: agent.email },
    });
    setAllocateCount(100);
    setAllocateFolderDate("all");
  };

  const executeAllocation = async () => {
    if (!companyId || !allocateModal.agent) return;
    setAllocateBusy(true);
    try {
      const res = await allocateNextLeadBatch(
        companyId,
        allocateModal.agent.id,
        allocateCount,
        "ADMIN_MANUAL_ALLOCATION",
        true, // allow manual allocation
        allocateFolderDate === "all" ? null : allocateFolderDate
      );
      if (res.success && res.assigned_count && res.assigned_count > 0) {
        toast.success(`🎉 Allocated ${res.assigned_count} clients to ${allocateModal.agent.name}!`);
        qc.invalidateQueries({ queryKey: ["agent-lead-counts"] });
        qc.invalidateQueries({ queryKey: ["unassigned-leads-count"] });
        setAllocateModal({ open: false, agent: null });
      } else {
        toast.info(res.message || "No eligible unassigned clients found to allocate");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to allocate clients");
    } finally {
      setAllocateBusy(false);
    }
  };

  const savePhone = async () => {
    if (!phoneModal.agent) return;
    setPhoneBusy(true);
    try {
      await updateAgentPhone({
        data: {
          agentId: phoneModal.agent.id,
          phone: phoneInput.trim() || null,
        },
      });
      toast.success(
        phoneInput.trim()
          ? `Calling number set to ${phoneInput.trim()} for ${phoneModal.agent.name}`
          : `Phone number removed for ${phoneModal.agent.name}`,
      );
      setPhoneModal({ open: false, agent: null });
      qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update phone number");
    } finally {
      setPhoneBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await createAgent({ data: { fullName: form.fullName, email: form.email.trim(), phone: form.phone, password: form.password } });
      toast.success("Agent created — they can sign in with this email and password");
      setForm({ fullName: "", email: "", phone: "", password: "" });
      setOpen(false);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["agents"] });
  };

  const deleteAgent = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete agent "${name}"? This action cannot be undone.`)) return;
    // Unassign their leads
    await supabase.from("leads").update({ assigned_to: null }).eq("assigned_to", id);
    // Remove role
    await supabase.from("user_roles").delete().eq("user_id", id);
    // Remove profile
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Agent deleted");
    qc.invalidateQueries({ queryKey: ["agents"] });
    qc.invalidateQueries({ queryKey: ["agent-lead-counts"] });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    );
  }
  if (!session?.isAdmin) return null;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Calling agents in your company. Manage phone numbers, allocate client workloads, and track status."
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span>Available Unassigned:</span>
              <strong className="text-foreground font-mono font-bold">{unassignedCount}</strong>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gradient-brand text-white"><UserPlus className="mr-1.5 h-4 w-4" /> New Agent</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Calling Agent</DialogTitle>
                  <DialogDescription>Create a login for a team member who will make calls in Hezo CRM.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Priya Sharma" /></div>
                  <div><Label>Email (Login ID)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@company.com" /></div>
                  <div><Label>Calling Number / Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
                  <div><Label>Temporary Password</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button className="gradient-brand text-white" disabled={busy || !form.email || !form.password} onClick={submit}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Create Agent
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Mobile Agents List (< md) */}
      <div className="space-y-3 md:hidden">
        {agents.map((a) => (
          <div key={a.id} className="rounded-2xl border bg-card p-4 card-elevated">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{a.full_name || "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email}</p>
              </div>
              <StatusBadge label={a.is_active ? "Active" : "Suspended"} />
            </div>

            {/* Mobile Phone / Number Section */}
            <div className="mt-3 flex items-center justify-between bg-muted/40 rounded-xl px-3 py-2 text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                <Phone className="h-3.5 w-3.5 text-brand" /> Number:
              </span>
              {a.phone ? (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold text-foreground">{a.phone}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openPhoneModal(a)}
                    title="Edit phone number"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] font-semibold text-brand border-brand/40 hover:bg-brand/10"
                  onClick={() => openPhoneModal(a)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add Number
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">Assigned: <strong className="text-foreground">{counts[a.id] ?? 0} leads</strong></span>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold"
                  onClick={() => navigate({ to: "/leads", search: { agent: a.id } })}
                  title="View leads assigned to this agent"
                >
                  <Eye className="mr-1 h-3.5 w-3.5 text-brand" /> View Leads ({counts[a.id] ?? 0})
                </Button>
                {a.is_active && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-bold border-brand/40 text-brand hover:bg-brand/10"
                    onClick={() => openAllocateModal(a)}
                  >
                    <Zap className="mr-1 h-3 w-3 fill-brand" /> Assign Clients
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-8 text-xs font-semibold" onClick={() => toggleActive(a.id, !a.is_active)}>
                  {a.is_active ? "Deactivate" : "Activate"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border-rose-500/30" onClick={() => deleteAgent(a.id, a.full_name || a.email)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {agents.length === 0 && <p className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">No agents yet. Create your first agent.</p>}
      </div>

      {/* Desktop Agents Table (>= md) */}
      <div className="hidden overflow-x-auto rounded-2xl border bg-card card-elevated md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone / Number</th>
              <th className="px-4 py-3">Assigned Leads</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3 font-semibold">{a.full_name || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.email}</td>
                <td className="px-4 py-3">
                  {a.phone ? (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-brand shrink-0" />
                      <span className="font-mono text-xs font-medium text-foreground">{a.phone}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground rounded-full"
                        onClick={() => openPhoneModal(a)}
                        title="Edit calling number"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-semibold text-brand border-brand/30 hover:bg-brand/10 hover:border-brand"
                      onClick={() => openPhoneModal(a)}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Add Number
                    </Button>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/leads", search: { agent: a.id } })}
                    className="flex items-center gap-1 font-mono font-semibold text-brand hover:underline"
                    title="Click to view leads for this agent"
                  >
                    <span>{counts[a.id] ?? 0} leads</span>
                    <Eye className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </td>
                <td className="px-4 py-3"><StatusBadge label={a.is_active ? "Active" : "Suspended"} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-semibold"
                      onClick={() => navigate({ to: "/leads", search: { agent: a.id } })}
                      title="View leads assigned to this agent"
                    >
                      <Eye className="mr-1 h-3.5 w-3.5 text-brand" /> View Leads
                    </Button>
                    {a.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-bold border-brand/40 text-brand hover:bg-brand/10"
                        onClick={() => openAllocateModal(a)}
                        title="Manually assign custom number of clients"
                      >
                        <Zap className="mr-1 h-3.5 w-3.5 fill-brand" /> Assign Clients
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-medium"
                      onClick={() => openPhoneModal(a)}
                      title="Manage phone number"
                    >
                      <Phone className="mr-1 h-3 w-3 text-brand" /> {a.phone ? "Edit No." : "Add No."}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={() => toggleActive(a.id, !a.is_active)}>
                      {a.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-600 border-rose-500/30"
                      onClick={() => deleteAgent(a.id, a.full_name || a.email)}
                      title="Delete agent"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {agents.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No agents yet. Create your first agent.</p>}
      </div>

      {/* Manual Client Allocation Dialog */}
      <Dialog open={allocateModal.open} onOpenChange={(v) => !allocateBusy && setAllocateModal((p) => ({ ...p, open: v }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Users className="h-4 w-4" />
              </div>
              Assign Clients to Agent
            </DialogTitle>
            <DialogDescription>
              Allocate a specific number of unassigned clients to <strong className="text-foreground">{allocateModal.agent?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-3">
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Available Unassigned Leads:</span>
              <span className="font-bold text-foreground font-mono bg-background px-2.5 py-1 rounded-md border shadow-sm">
                {unassignedCount} clients ready
              </span>
            </div>

            {folders.length > 0 && (
              <div>
                <Label className="text-xs font-semibold text-foreground">Select Source Folder (Optional)</Label>
                <div className="mt-1.5">
                  <Select value={allocateFolderDate} onValueChange={setAllocateFolderDate}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="All Available Folders" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Folders (Default)</SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f.date} value={f.date}>
                          Folder: {f.date} ({f.count} leads)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs font-semibold text-foreground">Quick Quantity Presets</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {[25, 50, 100, 200, 500].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={allocateCount === preset ? "default" : "outline"}
                    size="sm"
                    className={`h-8 text-xs font-bold ${
                      allocateCount === preset ? "gradient-brand text-white" : "border-border hover:border-brand/40"
                    }`}
                    onClick={() => setAllocateCount(preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="manual-allocate-count" className="text-xs font-semibold text-foreground">
                Or Enter Custom Number of Clients
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="manual-allocate-count"
                  type="number"
                  min={1}
                  max={5000}
                  className="font-mono text-sm font-bold pl-3"
                  value={allocateCount}
                  onChange={(e) => setAllocateCount(Math.max(1, parseInt(e.target.value) || 1))}
                  placeholder="e.g. 75"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Current workload: {counts[allocateModal.agent?.id || ""] ?? 0} leads assigned.
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={allocateBusy}
              onClick={() => setAllocateModal({ open: false, agent: null })}
            >
              Cancel
            </Button>
            <Button
              className="gradient-brand text-white font-bold"
              size="sm"
              disabled={allocateBusy || allocateCount <= 0 || unassignedCount === 0}
              onClick={executeAllocation}
            >
              {allocateBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Zap className="mr-1.5 h-4 w-4 fill-white" />}
              Assign {allocateCount} Clients
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Phone Number Dialog */}
      <Dialog open={phoneModal.open} onOpenChange={(v) => !phoneBusy && setPhoneModal((p) => ({ ...p, open: v }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Phone className="h-4 w-4" />
              </div>
              {phoneModal.agent?.phone ? "Edit Calling Number" : "Assign Calling Number"}
            </DialogTitle>
            <DialogDescription>
              Set the phone / mobile number for <strong className="text-foreground">{phoneModal.agent?.name}</strong>. This number is used for outbound calling and identification in Hezo CRM.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-3">
            <div>
              <Label htmlFor="agent-phone-input">Phone Number</Label>
              <div className="relative mt-1.5">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="agent-phone-input"
                  className="pl-9 font-mono text-sm"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+91 98765 43210"
                  autoFocus
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Enter the agent&apos;s direct mobile/caller number with country code (e.g., +91 98765 43210).
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            {phoneModal.agent?.phone ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                disabled={phoneBusy}
                onClick={() => setPhoneInput("")}
              >
                Clear Number
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={phoneBusy}
                onClick={() => setPhoneModal({ open: false, agent: null })}
              >
                Cancel
              </Button>
              <Button
                className="gradient-brand text-white"
                size="sm"
                disabled={phoneBusy}
                onClick={savePhone}
              >
                {phoneBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Save Number
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
