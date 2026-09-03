import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import { createAgent } from "@/lib/crm.functions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { allocateNextLeadBatch } from "@/lib/lead-batch";

export const Route = createFileRoute("/_app/agents")({
  head: () => ({
    meta: [
      { title: "Agents — Hezo CRM" },
      { name: "description", content: "Create calling agent accounts and monitor their assigned lead workload." },
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

  const allocateBatchForAgent = async (agentId: string, agentName: string) => {
    if (!companyId) return;
    try {
      const res = await allocateNextLeadBatch(companyId, agentId, 100, "INITIAL_ALLOCATION");
      if (res.success && res.assigned_count && res.assigned_count > 0) {
        toast.success(`Allocated ${res.assigned_count} leads to ${agentName}`);
        qc.invalidateQueries();
      } else {
        toast.info(res.message || "No unassigned leads available to allocate");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to allocate batch");
    }
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

  return (
    <>
      <PageHeader
        title="Agents"
        description="Calling agents in your company. Each agent only ever sees their own assigned leads."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gradient-brand text-white"><UserPlus className="mr-1 h-4 w-4" /> New Agent</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Calling Agent</DialogTitle>
                <DialogDescription>Create a login for a team member who will make calls.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Priya Sharma" /></div>
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@company.com" /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
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
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
              <span className="text-muted-foreground">Assigned leads: <strong className="text-foreground">{counts[a.id] ?? 0}</strong></span>
              <div className="flex items-center gap-1.5">
                {(counts[a.id] ?? 0) === 0 && a.is_active && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-bold border-brand/40 text-brand"
                    onClick={() => allocateBatchForAgent(a.id, a.full_name || a.email)}
                  >
                    <Zap className="mr-1 h-3 w-3 fill-brand" /> +100
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
              <th className="px-4 py-3">Assigned leads</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-3 font-semibold">{a.full_name || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.email}</td>
                <td className="px-4 py-3">{counts[a.id] ?? 0}</td>
                <td className="px-4 py-3"><StatusBadge label={a.is_active ? "Active" : "Suspended"} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {(counts[a.id] ?? 0) === 0 && a.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-bold border-brand/40 text-brand hover:bg-brand/10"
                        onClick={() => allocateBatchForAgent(a.id, a.full_name || a.email)}
                      >
                        <Zap className="mr-1 h-3.5 w-3.5 fill-brand" /> Allocate Batch
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => toggleActive(a.id, !a.is_active)}>
                      {a.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600 border-rose-500/30"
                      onClick={() => deleteAgent(a.id, a.full_name || a.email)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {agents.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No agents yet. Create your first agent.</p>}
      </div>
    </>
  );
}
