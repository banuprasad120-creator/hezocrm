import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/crm";

export type CrmSession = {
  userId: string | null;
  email: string | null;
  fullName: string;
  companyId: string | null;
  role: AppRole | null;
  isAdmin: boolean;
  isAgent: boolean;
};

export function useCrmSession() {
  return useQuery({
    queryKey: ["crm-session"],
    staleTime: 30_000,
    queryFn: async (): Promise<CrmSession> => {
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        return { userId: null, email: null, fullName: "", companyId: null, role: null, isAdmin: false, isAgent: false };
      }
      let profile: { full_name?: string; company_id?: string | null; email?: string } | null = null;
      let roles: { role: string; company_id?: string | null }[] | null = null;
      try {
        const [{ data: pData }, { data: rData }] = await Promise.all([
          supabase.from("profiles").select("full_name, company_id, email").eq("id", user.id).maybeSingle(),
          supabase.from("user_roles").select("role, company_id").eq("user_id", user.id),
        ]);
        profile = pData;
        roles = rData as { role: string; company_id?: string | null }[] | null;
      } catch (err) {
        console.warn("[session] profile/roles fetch issue:", err);
      }

      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      const role: AppRole | null =
        roleList.includes("super_admin") ? "super_admin"
          : roleList.includes("company_admin") ? "company_admin"
            : roleList.includes("agent") ? "agent" : null;

      let companyId = profile?.company_id ?? null;
      if (!companyId && roles && roles.length > 0) {
        companyId = roles.find((r) => r.company_id)?.company_id ?? null;
      }
      if (!companyId && (role === "super_admin" || role === "company_admin")) {
        const { data: firstCo } = await supabase.from("companies").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
        companyId = firstCo?.id ?? null;
      }

      return {
        userId: user.id,
        email: profile?.email || user.email || null,
        fullName: profile?.full_name || (user.user_metadata?.["full_name"] as string) || user.email || "",
        companyId,
        role,
        isAdmin: role === "company_admin" || role === "super_admin",
        isAgent: role === "agent",
      };
    },
  });
}

export function useAgents(companyId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["agents", companyId],
    enabled: Boolean(companyId) && enabled,
    queryFn: async () => {
      try {
        const { data: roleRows, error } = await supabase
          .from("user_roles").select("user_id").eq("role", "agent").eq("company_id", companyId!);
        if (error) return [];
        const ids = (roleRows ?? []).map((r) => r.user_id);
        if (ids.length === 0) return [] as { id: string; full_name: string; email: string; is_active: boolean }[];
        const { data: profiles, error: pErr } = await supabase
          .from("profiles").select("id, full_name, email, is_active").in("id", ids).order("full_name");
        if (pErr) return [];
        return profiles ?? [];
      } catch (err) {
        console.warn("[useAgents] issue fetching agents:", err);
        return [];
      }
    },
  });
}
