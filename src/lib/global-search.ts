import { supabase } from "@/integrations/supabase/client";

export type SearchHit = {
  id: string;
  title: string;
  subtitle: string;
  kind: "lead" | "employee" | "folder" | "company";
  href: string;
  search?: Record<string, string>;
};

export type SearchResults = {
  leads: SearchHit[];
  employees: SearchHit[];
  folders: SearchHit[];
  companies: SearchHit[];
};

export const EMPTY_RESULTS: SearchResults = { leads: [], employees: [], folders: [], companies: [] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts 2026-08-11, 11-08-2026 and 11/08/2026 and returns an ISO date. */
export function parseDateTerm(term: string): string | null {
  const t = term.trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

function esc(term: string) {
  // Escape PostgREST filter separators inside an ilike pattern.
  return term.replace(/[,()%]/g, " ").trim();
}

/**
 * Global search over real data. Every query runs through the browser client so
 * RLS decides what the current user (admin or agent) is allowed to see.
 */
export async function globalSearch(rawTerm: string, opts: { isAdmin: boolean; companyId: string | null }): Promise<SearchResults> {
  const term = esc(rawTerm);
  if (term.length < 2) return EMPTY_RESULTS;

  const like = `%${term}%`;
  const isoDate = parseDateTerm(rawTerm);
  const digits = rawTerm.replace(/\D/g, "");

  const leadFilters = [`customer_name.ilike.${like}`, `mobile.ilike.${like}`];
  if (digits.length >= 4) leadFilters.push(`alternate_mobile.ilike.%${digits}%`);
  if (!isoDate) leadFilters.push(`email.ilike.${like}`);

  const leadsQuery = UUID_RE.test(term)
    ? supabase.from("leads").select("id, customer_name, mobile, status, folder_date").eq("id", term).limit(1)
    : supabase
        .from("leads")
        .select("id, customer_name, mobile, status, folder_date")
        .or(leadFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(8);

  const employeesQuery = supabase
    .from("profiles")
    .select("id, full_name, email, phone, is_active")
    .or(`full_name.ilike.${like},email.ilike.${like}`)
    .limit(6);

  const foldersQuery = opts.isAdmin && opts.companyId
    ? supabase
        .from("lead_folder_counts")
        .select("folder_date, lead_count")
        .eq("company_id", opts.companyId)
        .order("folder_date", { ascending: false })
        .limit(60)
    : null;

  const companiesQuery = opts.isAdmin
    ? supabase.from("companies").select("id, name, plan, status").ilike("name", like).limit(6)
    : null;

  const [leadsRes, employeesRes, foldersRes, companiesRes] = await Promise.all([
    leadsQuery,
    employeesQuery,
    foldersQuery,
    companiesQuery,
  ]);

  const leads: SearchHit[] = (leadsRes.data ?? []).map((l) => ({
    id: l.id,
    title: l.customer_name,
    subtitle: `${l.mobile} · ${l.status} · ${l.folder_date}`,
    kind: "lead" as const,
    href: `/lead/${l.id}`,
  }));

  const employees: SearchHit[] = (employeesRes.data ?? []).map((p) => ({
    id: p.id,
    title: p.full_name || p.email,
    subtitle: `${p.email}${p.phone ? ` · ${p.phone}` : ""}${p.is_active ? "" : " · inactive"}`,
    kind: "employee" as const,
    href: opts.isAdmin ? "/agents" : "/profile",
  }));

  const folderRows = (foldersRes?.data ?? []).filter((f) => {
    const d = String(f.folder_date);
    return isoDate ? d === isoDate : d.includes(term);
  });
  const folders: SearchHit[] = folderRows.slice(0, 6).map((f) => ({
    id: String(f.folder_date),
    title: `Folder ${f.folder_date}`,
    subtitle: `${Number(f.lead_count)} leads`,
    kind: "folder" as const,
    href: "/daily-leads",
    search: { date: String(f.folder_date) },
  }));

  const companies: SearchHit[] = (companiesRes?.data ?? []).map((c) => ({
    id: c.id,
    title: c.name,
    subtitle: `${c.plan} · ${c.status}`,
    kind: "company" as const,
    href: "/companies",
  }));

  return { leads, employees, folders, companies };
}
