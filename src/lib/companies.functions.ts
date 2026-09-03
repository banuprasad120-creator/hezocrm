import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles").select("role").eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  const ok = (data ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (!ok) throw new Error("Forbidden: only platform super admins can manage companies");
}

export type CompanyOverview = {
  id: string;
  name: string;
  plan: string;
  status: string;
  createdAt: string;
  adminCount: number;
  agentCount: number;
  leadCount: number;
  agents: { id: string; fullName: string; email: string; isActive: boolean }[];
};

/** Platform-wide list of companies with their agents. */
export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyOverview[]> => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: companies, error: cErr }, { data: roles, error: rErr }, { data: profiles, error: pErr }] =
      await Promise.all([
        supabaseAdmin.from("companies").select("id, name, plan, status, created_at").order("created_at", { ascending: false }),
        supabaseAdmin.from("user_roles").select("user_id, role, company_id"),
        supabaseAdmin.from("profiles").select("id, full_name, email, is_active, company_id"),
      ]);
    if (cErr) throw new Error(cErr.message);
    if (rErr) throw new Error(rErr.message);
    if (pErr) throw new Error(pErr.message);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const counts = new Map<string, { leads: number }>();
    for (const c of companies ?? []) {
      const { count } = await supabaseAdmin
        .from("leads").select("id", { count: "exact", head: true }).eq("company_id", c.id);
      counts.set(c.id, { leads: count ?? 0 });
    }

    return (companies ?? []).map((c) => {
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
        leadCount: counts.get(c.id)?.leads ?? 0,
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
    });
  });

const createCompanySchema = z.object({
  companyName: z.string().min(2),
  plan: z.string().min(1).default("Starter"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

/** Super admin creates a new tenant company plus its first company admin. */
export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createCompanySchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies").insert({ name: data.companyName, plan: data.plan }).select("id").single();
    if (cErr) throw new Error(cErr.message);

    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.adminEmail,
      password: data.adminPassword,
      email_confirm: true,
      user_metadata: { full_name: data.adminName },
    });
    if (uErr || !created.user) throw new Error(uErr?.message ?? "Could not create the company admin");

    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: created.user.id, company_id: company.id, full_name: data.adminName, email: data.adminEmail,
    });
    if (pErr) throw new Error(pErr.message);

    const { error: rErr } = await supabaseAdmin.from("user_roles")
      .upsert({ user_id: created.user.id, role: "company_admin", company_id: company.id }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);

    return { companyId: company.id };
  });

const companyAgentSchema = z.object({
  companyId: z.string().uuid(),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6),
});

/** Super admin adds a calling agent to any company. */
export const createCompanyAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => companyAgentSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (uErr || !created.user) throw new Error(uErr?.message ?? "Could not create agent");

    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: created.user.id, company_id: data.companyId, full_name: data.fullName,
      email: data.email, phone: data.phone ?? null,
    });
    if (pErr) throw new Error(pErr.message);

    const { error: rErr } = await supabaseAdmin.from("user_roles")
      .upsert({ user_id: created.user.id, role: "agent", company_id: data.companyId }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);

    return { agentId: created.user.id };
  });

const statusSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["Active", "Suspended"]),
});

/** Super admin activates or suspends a company. */
export const setCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => statusSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("companies")
      .update({ status: data.status }).eq("id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const agentActiveSchema = z.object({
  agentId: z.string().uuid(),
  isActive: z.boolean(),
});

/** Super admin enables or disables an agent account. */
export const setAgentActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => agentActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles")
      .update({ is_active: data.isActive }).eq("id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
