import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, ChevronDown, ChevronRight, Loader2, PauseCircle, PlayCircle,
  Plus, Search, ShieldCheck, UserPlus, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrmSession } from "@/hooks/use-crm-session";
import { supabase } from "@/integrations/supabase/client";
import {
  createCompany, createCompanyAgent, listCompanies, setAgentActive, setCompanyStatus,
  type CompanyOverview,
} from "@/lib/companies.functions";

export const Route = createFileRoute("/_app/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Hezo CRM" },
      { name: "description", content: "Manage tenant companies, their admins and calling agents across the Hezo CRM platform." },
      { property: "og:title", content: "Companies — Hezo CRM" },
      { property: "og:description", content: "Manage tenant companies, their admins and calling agents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompaniesPage,
});

function CompaniesPage() {
  const { data: session } = useCrmSession();
  const isSuper = session?.role === "super_admin";
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const [agentFor, setAgentFor] = useState<CompanyOverview | null>(null);

  const companiesQ = useQuery({
    queryKey: ["companies-overview"],
    enabled: isSuper,
    queryFn: async () => {
      try {
        return await listCompanies();
      } catch (err) {
        console.warn("[companies] Server function fallback to client query", err);
        const { data: companies, error: cErr } = await supabase
          .from("companies").select("id, name, plan, status, created_at").order("created_at", { ascending: false });
        if (cErr) throw cErr;
        const { data: roles } = await supabase.from("user_roles").select("user_id, role, company_id");
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email, is_active, company_id");
        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
        
        return Promise.all((companies ?? []).map(async (c) => {
          const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", c.id);
          const companyRoles = (roles ?? []).filter((r) => r.company_id === c.id);
          const agentIds = companyRoles.filter((r) => r.role === "agent").map((r) => r.user_id);
          return {
            id: c.id,
            name: c.name,
            plan: c.plan,
            status: c.status,
            createdAt: c.created_at,
            adminCount: companyRoles.filter((r) => r.role === "company_admin").length,
            agentCount: agentIds.length,
            leadCount: count ?? 0,
            agents: agentIds.map((id) => {
              const p = profileById.get(id);
              return {
                id,
                fullName: p?.full_name ?? "Unknown",
                email: p?.email ?? "",
                isActive: p?.is_active ?? true,
              };
            }).sort((a, b) => a.fullName.localeCompare(b.fullName)),
          };
        }));
      }
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["companies-overview"] });

  const statusM = useMutation({
    mutationFn: (v: { companyId: string; status: "Active" | "Suspended" }) => setCompanyStatus({ data: v }),
    onSuccess: () => { toast.success("Company updated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const agentActiveM = useMutation({
    mutationFn: (v: { agentId: string; isActive: boolean }) => setAgentActive({ data: v }),
    onSuccess: () => { toast.success("Agent updated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const list = companiesQ.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(needle) ||
        c.agents.some((a) => a.fullName.toLowerCase().includes(needle) || a.email.toLowerCase().includes(needle)),
    );
  }, [companiesQ.data, q]);

  if (!isSuper) {
    return (
      <>
        <PageHeader title="Companies" description="Platform-level tenant management." />
        <div className="rounded-2xl border bg-card p-10 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">Restricted area</p>
          <p className="text-sm text-muted-foreground">
            Only platform super admins can manage companies and their agents.
          </p>
        </div>
      </>
    );
  }

  const totals = (companiesQ.data ?? []).reduce(
    (acc, c) => ({
      active: acc.active + (c.status === "Active" ? 1 : 0),
      agents: acc.agents + c.agentCount,
      leads: acc.leads + c.leadCount,
    }),
    { active: 0, agents: 0, leads: 0 },
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description="Every tenant workspace on Hezo CRM, with its admins and calling agents."
        actions={
          <Button size="sm" className="gradient-brand text-white" onClick={() => setNewCompany(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Company
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        <StatCard label="Companies" value={companiesQ.data?.length ?? 0} icon={Building2} tone="brand" />
        <StatCard label="Active" value={totals.active} icon={PlayCircle} tone="success" />
        <StatCard label="Agents" value={totals.agents} icon={Users} tone="info" />
        <StatCard label="Leads" value={totals.leads.toLocaleString("en-IN")} icon={ShieldCheck} tone="warning" />
      </div>

      <div className="mt-4 rounded-2xl border bg-card card-elevated sm:mt-6">
        <div className="flex flex-col gap-3 border-b p-3 sm:p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies or agents…" className="h-10 pl-9 text-xs sm:text-sm" />
          </div>
        </div>

        {companiesQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading companies…
          </div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No companies yet.</p>
        ) : (
          <div className="divide-y">
            {rows.map((c) => {
              const expanded = open === c.id;
              return (
                <div key={c.id}>
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      onClick={() => setOpen(expanded ? null : c.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left touch-tap"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl gradient-brand text-xs font-bold text-white shadow-sm">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-bold text-foreground">{c.name}</p>
                          <StatusBadge label={c.plan} />
                          <StatusBadge label={c.status} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {c.adminCount} admin · {c.agentCount} agent{c.agentCount === 1 ? "" : "s"} · {c.leadCount.toLocaleString("en-IN")} leads
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => setAgentFor(c)}>
                        <UserPlus className="mr-1 h-3.5 w-3.5" /> Agent
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-semibold"
                        disabled={statusM.isPending}
                        onClick={() => statusM.mutate({ companyId: c.id, status: c.status === "Active" ? "Suspended" : "Active" })}
                      >
                        {c.status === "Active"
                          ? <><PauseCircle className="mr-1 h-3.5 w-3.5" /> Suspend</>
                          : <><PlayCircle className="mr-1 h-3.5 w-3.5" /> Activate</>}
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t bg-muted/20 px-4 py-3">
                      {c.agents.length === 0 ? (
                        <p className="py-2 text-sm text-muted-foreground">No agents in this company yet.</p>
                      ) : (
                        <ul className="divide-y">
                          {c.agents.map((a) => (
                            <li key={a.id} className="flex items-center gap-3 py-2">
                              <div className="grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">
                                {a.fullName.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{a.fullName}</p>
                                <p className="truncate text-[11px] text-muted-foreground">{a.email}</p>
                              </div>
                              <span className="text-[11px] text-muted-foreground">{a.isActive ? "Active" : "Disabled"}</span>
                              <Switch
                                checked={a.isActive}
                                onCheckedChange={(v) => agentActiveM.mutate({ agentId: a.id, isActive: v })}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NewCompanyDialog open={newCompany} onOpenChange={setNewCompany} onDone={refresh} />
      <NewAgentDialog company={agentFor} onClose={() => setAgentFor(null)} onDone={refresh} />
    </>
  );
}

function NewCompanyDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [form, setForm] = useState({ companyName: "", plan: "Starter", adminName: "", adminEmail: "", adminPassword: "" });
  const m = useMutation({
    mutationFn: async () => {
      try {
        return await createCompany({ data: form });
      } catch (err) {
        console.warn("[companies] Server function fallback for createCompany", err);
        // Fallback for dev mode client-side execution using current authenticated session or standard client insert
        const { data: company, error: cErr } = await supabase
          .from("companies").insert({ name: form.companyName, plan: form.plan }).select("id").single();
        if (cErr) throw new Error(cErr.message);

        const { data: authData, error: uErr } = await supabase.auth.signUp({
          email: form.adminEmail,
          password: form.adminPassword,
          options: { data: { full_name: form.adminName } },
        });
        if (uErr || !authData.user) throw new Error(uErr?.message ?? "Could not create company admin");

        await supabase.from("profiles").upsert({
          id: authData.user.id, company_id: company.id, full_name: form.adminName, email: form.adminEmail,
        });

        await supabase.from("user_roles").upsert(
          { user_id: authData.user.id, role: "company_admin", company_id: company.id },
          { onConflict: "user_id,role" },
        );

        return { companyId: company.id };
      }
    },
    onSuccess: () => {
      toast.success("Company created with its admin");
      setForm({ companyName: "", plan: "Starter", adminName: "", adminEmail: "", adminPassword: "" });
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add company</DialogTitle>
          <DialogDescription>Creates the tenant workspace and its first company admin account.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); m.mutate(); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cname">Company name</Label>
            <Input id="cname" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan">Plan</Label>
            <Select value={form.plan} onValueChange={(val) => setForm({ ...form, plan: val })}>
              <SelectTrigger id="plan" className="w-full">
                <SelectValue placeholder="Select plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Starter">Starter</SelectItem>
                <SelectItem value="Professional">Professional</SelectItem>
                <SelectItem value="Enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aname">Admin name</Label>
            <Input id="aname" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aemail">Admin email</Label>
            <Input id="aemail" type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apass">Temporary password</Label>
            <Input id="apass" type="password" minLength={6} required value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={m.isPending} className="gradient-brand text-white">
              {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create company
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewAgentDialog({ company, onClose, onDone }: { company: CompanyOverview | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "" });
  const m = useMutation({
    mutationFn: () => createCompanyAgent({ data: { companyId: company!.id, ...form } }),
    onSuccess: () => {
      toast.success("Agent added");
      setForm({ fullName: "", email: "", phone: "", password: "" });
      onClose();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={Boolean(company)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add agent</DialogTitle>
          <DialogDescription>New calling agent for {company?.name}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="gname">Full name</Label>
            <Input id="gname" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gemail">Email</Label>
            <Input id="gemail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gphone">Phone (optional)</Label>
            <Input id="gphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gpass">Temporary password</Label>
            <Input id="gpass" type="password" minLength={6} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={m.isPending} className="gradient-brand text-white">
              {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
