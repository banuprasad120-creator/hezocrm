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

const createLeadSchema = z.object({
  companyId: z.string().optional().nullable(),
  customerName: z.string().min(1),
  mobile: z.string().min(6),
  city: z.string().optional().nullable(),
  loanType: z.string().default("Personal Loan"),
  loanAmount: z.number().default(0),
  monthlyIncome: z.number().optional().nullable(),
  employer: z.string().optional().nullable(),
  employmentType: z.string().default("Salaried"),
  source: z.string().default("External Lead / Direct"),
  folderDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
});

/** Securely creates a lead for admins or agents, bypassing client RLS */
export const createLeadServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createLeadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = data.companyId || userProfile?.company_id;
    if (!companyId) throw new Error("User is not associated with any company");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some(
      (r) => r.role === "company_admin" || r.role === "super_admin"
    );

    // If caller is agent, force assignment to themselves
    const finalAssignedTo = isAdmin
      ? data.assignedTo && data.assignedTo !== "unassigned"
        ? data.assignedTo
        : null
      : userId;

    const isAssigned = Boolean(finalAssignedTo);
    const now = new Date().toISOString();
    const cleanMobile = data.mobile.replace(/\D/g, "");
    const folderDate = data.folderDate || now.slice(0, 10);

    const { data: newLead, error: leadErr } = await supabaseAdmin
      .from("leads")
      .insert({
        company_id: companyId,
        customer_name: data.customerName.trim(),
        mobile: cleanMobile,
        city: data.city?.trim() || null,
        loan_type: data.loanType || "Personal Loan",
        loan_amount: data.loanAmount || 0,
        monthly_income: data.monthlyIncome ?? null,
        employer: data.employer?.trim() || null,
        employment_type: data.employmentType || "Salaried",
        source: data.source || "External Lead / Direct",
        folder_date: folderDate,
        status: isAssigned ? "Assigned" : "New",
        assigned_to: finalAssignedTo,
        assigned_at: isAssigned ? now : null,
        notes: data.notes?.trim() || null,
        created_at: now,
      })
      .select("id, customer_name, mobile, assigned_to")
      .single();

    if (leadErr || !newLead) {
      throw new Error(leadErr?.message || "Failed to create lead");
    }

    if (isAssigned && finalAssignedTo) {
      await supabaseAdmin.from("lead_assignments").insert({
        lead_id: newLead.id,
        company_id: companyId,
        employee_id: finalAssignedTo,
        assigned_by: userId,
      });

      // Lock any other leads in same company with same phone to the agent
      await supabaseAdmin
        .from("leads")
        .update({
          assigned_to: finalAssignedTo,
          status: "Assigned",
          assigned_at: now,
        })
        .eq("company_id", companyId)
        .eq("mobile", cleanMobile)
        .neq("id", newLead.id)
        .is("assigned_to", null);
    }

    return { lead: newLead };
  });

const createInterestedCandidateSchema = z.object({
  companyId: z.string().optional().nullable(),
  customerName: z.string().min(1),
  mobile: z.string().min(6),
  city: z.string().optional().nullable(),
  serviceRequired: z.string().default("Personal Loan"),
  requiredAmount: z.string().optional().nullable(),
  employmentType: z.string().default("Salaried"),
  salaryBank: z.string().optional().nullable(),
  cibilScore: z.string().optional().nullable(),
  monthlyIncome: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  hasExistingLoans: z.boolean().default(false),
  loans: z
    .array(
      z.object({
        bank: z.string(),
        loanType: z.string(),
        amount: z.string().optional(),
        emi: z.string().optional(),
      })
    )
    .default([]),
  hasCreditCards: z.boolean().default(false),
  creditCards: z
    .array(
      z.object({
        bank: z.string(),
        limit: z.string().optional(),
        outstanding: z.string().optional(),
      })
    )
    .default([]),
  notes: z.string().optional().nullable(),
  scheduleFollowUp: z.boolean().default(false),
  followUpDate: z.string().optional().nullable(),
  followUpTime: z.string().optional().nullable(),
});

/** Securely creates an interested candidate for agent or admin */
export const createInterestedCandidateServerFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    createInterestedCandidateSchema.parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { serializeInterestedData } = await import("@/lib/interested-lead");
    const userId = context.userId;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = data.companyId || userProfile?.company_id;
    if (!companyId) throw new Error("User is not associated with any company");

    const todayISO = new Date().toISOString().slice(0, 10);
    const nowISO = new Date().toISOString();
    const cleanMobile = data.mobile.replace(/\D/g, "");

    const interestedData = {
      serviceRequired: data.serviceRequired,
      requiredAmount: data.requiredAmount || undefined,
      employmentType: data.employmentType,
      salaryBank:
        data.employmentType === "Salaried"
          ? data.salaryBank || undefined
          : undefined,
      cibilScore: data.cibilScore?.trim() || undefined,
      monthlyIncome: data.monthlyIncome || undefined,
      employer: data.employer?.trim() || undefined,
      hasExistingLoans: data.hasExistingLoans,
      loansCount: data.hasExistingLoans ? data.loans.length : 0,
      loans: data.hasExistingLoans ? data.loans : [],
      hasCreditCards: data.hasCreditCards,
      cardsCount: data.hasCreditCards ? data.creditCards.length : 0,
      creditCards: data.hasCreditCards ? data.creditCards : [],
      notes: data.notes?.trim() || undefined,
    };

    const serializedNotes = serializeInterestedData(
      interestedData,
      data.notes || undefined
    );
    const parsedReqAmount =
      Number((data.requiredAmount || "").replace(/\D/g, "")) || 0;
    const parsedIncome =
      Number((data.monthlyIncome || "").replace(/\D/g, "")) || null;

    // 1. Insert Lead
    const { data: newLead, error: leadErr } = await supabaseAdmin
      .from("leads")
      .insert({
        company_id: companyId,
        assigned_to: userId,
        customer_name: data.customerName.trim(),
        mobile: cleanMobile,
        city: data.city?.trim() || null,
        loan_type: data.serviceRequired,
        loan_amount: parsedReqAmount,
        employment_type: data.employmentType,
        monthly_income: parsedIncome,
        employer: data.employer?.trim() || null,
        status: "Interested",
        notes: serializedNotes,
        folder_date: todayISO,
        last_call_at: nowISO,
        assigned_at: nowISO,
        created_at: nowISO,
      })
      .select("id")
      .single();

    if (leadErr || !newLead) {
      throw new Error(leadErr?.message || "Failed to create candidate");
    }

    // 2. Insert call history
    await supabaseAdmin.from("call_history").insert({
      lead_id: newLead.id,
      company_id: companyId,
      employee_id: userId,
      call_result: "Connected",
      customer_response: "Interested",
      status: "Interested",
      notes: `New interested candidate created: ${data.serviceRequired} (${data.customerName.trim()})`,
      called_at: nowISO,
    });

    // 3. Insert assignment
    await supabaseAdmin.from("lead_assignments").insert({
      lead_id: newLead.id,
      company_id: companyId,
      employee_id: userId,
      assigned_by: userId,
    });

    // 4. Follow-up if scheduled
    if (data.scheduleFollowUp && data.followUpDate) {
      const scheduledAt = data.followUpTime
        ? new Date(`${data.followUpDate}T${data.followUpTime}:00`).toISOString()
        : new Date(`${data.followUpDate}T10:00:00`).toISOString();

      await supabaseAdmin.from("follow_ups").insert({
        lead_id: newLead.id,
        company_id: companyId,
        employee_id: userId,
        scheduled_at: scheduledAt,
        status: "Pending",
        notes: `Follow-up for ${data.serviceRequired} requirement`,
      });
    }

    // 5. Lock other leads with same mobile
    await supabaseAdmin
      .from("leads")
      .update({
        assigned_to: userId,
        status: "Interested",
        assigned_at: nowISO,
      })
      .eq("company_id", companyId)
      .eq("mobile", cleanMobile)
      .neq("id", newLead.id)
      .is("assigned_to", null);

    return { leadId: newLead.id };
  });

