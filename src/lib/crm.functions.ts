import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const setupSchema = z.object({
  companyName: z.string().min(2),
  fullName: z.string().min(1),
});

/** Creates the company for a brand-new signup and makes the caller its admin. */
export const setupCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: existing } = await supabaseAdmin
      .from("profiles").select("company_id").eq("id", userId).maybeSingle();
    if (existing?.company_id) return { companyId: existing.company_id };

    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies").insert({ name: data.companyName }).select("id").single();
    if (cErr) throw new Error(cErr.message);

    const email = (context.claims["email"] as string | undefined) ?? "";
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: userId, company_id: company.id, full_name: data.fullName, email,
    });
    if (pErr) throw new Error(pErr.message);

    const { error: rErr } = await supabaseAdmin.from("user_roles")
      .upsert({ user_id: userId, role: "company_admin", company_id: company.id }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);

    return { companyId: company.id };
  });

const agentSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6),
});

/** Company admin creates a calling agent account. */
export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => agentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roles ?? []).some(
      (r) => r.role === "company_admin" || r.role === "super_admin",
    );
    if (!isAdmin) throw new Error("Forbidden: only company admins can create agents");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: adminProfile } = await supabaseAdmin
      .from("profiles").select("company_id").eq("id", context.userId).maybeSingle();
    const companyId = adminProfile?.company_id;
    if (!companyId) throw new Error("Your account is not linked to a company yet");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Could not create agent");

    const agentId = created.user.id;
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: agentId, company_id: companyId, full_name: data.fullName, email: data.email, phone: data.phone ?? null,
    });
    if (pErr) throw new Error(pErr.message);

    const { error: rErr } = await supabaseAdmin.from("user_roles")
      .upsert({ user_id: agentId, role: "agent", company_id: companyId }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);

    return { agentId };
  });

const updateAgentPhoneSchema = z.object({
  agentId: z.string(),
  phone: z.string().optional().nullable(),
});

/** Company admin updates an agent's calling / phone number. */
export const updateAgentPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateAgentPhoneSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roles ?? []).some(
      (r) => r.role === "company_admin" || r.role === "super_admin",
    );
    if (!isAdmin) throw new Error("Forbidden: only company admins can update agent numbers");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ phone: data.phone ? data.phone.trim() : null })
      .eq("id", data.agentId);
    if (updateErr) throw new Error(updateErr.message);

    return { success: true };
  });
