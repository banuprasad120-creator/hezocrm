import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/roles")({
  head: () => ({ meta: [{ title: "Roles & Access — Hezo CRM" }, { name: "description", content: "Manage roles and permissions across your workspace." }] }),
  component: RolesPage,
});

const roles = [
  { name: "Super Admin", members: 3, tone: "bg-brand/15 text-brand" },
  { name: "Admin", members: 12, tone: "bg-brand-2/15 text-brand-2" },
  { name: "Team Lead", members: 34, tone: "bg-info/15 text-info" },
  { name: "Agent", members: 210, tone: "bg-success/15 text-success" },
  { name: "Read Only", members: 8, tone: "bg-muted text-muted-foreground" },
];

const permissions = [
  { module: "Leads", perms: ["View", "Create", "Assign", "Delete", "Export"] },
  { module: "Companies", perms: ["View", "Create", "Suspend", "Delete"] },
  { module: "Reports", perms: ["View", "Export", "Schedule"] },
  { module: "Employees", perms: ["View", "Invite", "Deactivate"] },
  { module: "Settings", perms: ["View", "Update"] },
];

function RolesPage() {
  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Fine-grained access controls across every module."
        actions={<Button size="sm" className="gradient-brand text-white"><Plus className="mr-1 h-4 w-4" /> New Role</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {roles.map((r) => (
          <div key={r.name} className="rounded-2xl border bg-card p-4 card-elevated">
            <div className={`grid h-9 w-9 place-items-center rounded-xl ${r.tone}`}><ShieldCheck className="h-4 w-4" /></div>
            <p className="mt-3 text-sm font-semibold">{r.name}</p>
            <p className="text-xs text-muted-foreground">{r.members} members</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border bg-card card-elevated">
        <div className="border-b p-4">
          <h3 className="text-sm font-semibold">Permission matrix — Team Lead</h3>
          <p className="text-xs text-muted-foreground">Toggle module-level permissions for this role.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-3">Module</th><th className="px-4 py-3">Permissions</th></tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.module} className="border-t">
                  <td className="px-4 py-4 font-semibold">{p.module}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-4">
                      {p.perms.map((perm, i) => (
                        <label key={perm} className="flex items-center gap-2 text-xs">
                          <Switch defaultChecked={i < 3} />
                          <span>{perm}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
