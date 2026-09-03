import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/common/StatCard";
import { PhoneCall, CalendarCheck2, Flame, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, todayISO } from "@/lib/crm";

export const Route = createFileRoute("/_app/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — Hezo CRM" },
      { name: "description", content: "Your Hezo CRM account details and your real performance figures." },
      { property: "og:title", content: "My Profile — Hezo CRM" },
      { property: "og:description", content: "Account details and live performance from your CRM records." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { data: session } = useCrmSession();
  const qc = useQueryClient();
  const userId = session?.userId ?? null;

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["my-profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles").select("id, full_name, email, phone, is_active, created_at")
        .eq("id", userId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
    }
  }, [profile]);

  const { data: stats } = useQuery({
    queryKey: ["my-profile-stats", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const monthStart = `${todayISO().slice(0, 7)}-01`;
      const leadBase = () => supabase.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", userId!);
      const [assigned, called, interested, calls, followUps, present] = await Promise.all([
        leadBase(),
        leadBase().in("status", [...CONTACTED_STATUSES]),
        leadBase().eq("status", "Interested"),
        supabase.from("call_history").select("id", { count: "exact", head: true }).eq("employee_id", userId!),
        supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("employee_id", userId!).eq("is_done", false),
        supabase.from("attendance").select("id", { count: "exact", head: true })
          .eq("employee_id", userId!).gte("work_date", monthStart).in("status", ["Present", "Late", "Half Day"]),
      ]);
      return {
        assigned: assigned.count ?? 0,
        called: called.count ?? 0,
        interested: interested.count ?? 0,
        calls: calls.count ?? 0,
        openFollowUps: followUps.count ?? 0,
        presentDays: present.count ?? 0,
      };
    },
  });

  const save = async () => {
    if (!userId || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim(), phone: phone.trim() || null })
        .eq("id", userId);
      if (error) throw error;
      toast.success("Profile updated");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["my-profile", userId] });
      qc.invalidateQueries({ queryKey: ["crm-session"] });
    } catch (e) {
      toast.error("Could not save profile", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    setEditing(false);
  };

  const initials = (profile?.full_name || profile?.email || "?").slice(0, 2).toUpperCase();
  const roleLabel = session?.role === "super_admin" ? "Super Admin" : session?.role === "company_admin" ? "Company Admin" : "Calling Agent";

  return (
    <>
      <PageHeader title="My Profile" description="Your account details and live performance from your CRM records." />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border bg-card p-4 card-elevated sm:p-6 xl:col-span-1">
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-brand via-brand-2 to-accent" />
          <div className="relative">
            <div className="grid h-20 w-20 place-items-center rounded-2xl border-4 border-card gradient-brand text-xl font-bold text-white sm:h-24 sm:w-24 sm:text-2xl">
              {initials}
            </div>
            <h2 className="mt-3 text-lg font-bold sm:text-xl">{profile?.full_name || profile?.email || "—"}</h2>
            <p className="text-xs text-muted-foreground sm:text-sm">{roleLabel}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand">
              <ShieldCheck className="h-3 w-3" /> {profile?.is_active === false ? "Suspended" : "Active account"}
            </span>

            {!editing ? (
              <>
                <div className="mt-4 space-y-2 text-sm sm:mt-5">
                  <div className="flex items-center gap-2 rounded-lg border p-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs sm:text-sm">{profile?.email || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border p-2.5">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs sm:text-sm">{profile?.phone || "No phone saved"}</span>
                  </div>
                </div>
                <Button className="mt-4 w-full gradient-brand text-xs font-semibold text-white shadow-sm sm:mt-5 sm:text-sm" onClick={() => setEditing(true)}>Edit profile</Button>
              </>
            ) : (
              <div className="mt-4 space-y-3 sm:mt-5">
                <div className="space-y-1.5">
                  <Label htmlFor="full-name">Full name</Label>
                  <Input id="full-name" value={fullName} maxLength={100} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
                </div>
                <p className="text-xs text-muted-foreground">Email is managed by your administrator.</p>
                <div className="flex gap-2">
                  <Button className="flex-1 gradient-brand text-white" disabled={saving || !fullName.trim()} onClick={save}>
                    {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
                  </Button>
                  <Button variant="outline" className="flex-1" disabled={saving} onClick={cancel}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
            <StatCard label="Leads assigned" value={stats?.assigned ?? 0} icon={PhoneCall} tone="brand" />
            <StatCard label="Calls logged" value={stats?.calls ?? 0} icon={PhoneCall} tone="info" />
            <StatCard label="Interested" value={stats?.interested ?? 0} icon={Flame} tone="success" />
            <StatCard label="Days present" value={stats?.presentDays ?? 0} icon={CalendarCheck2} tone="warning" />
          </div>

          <div className="rounded-2xl border bg-card p-4 card-elevated sm:p-6">
            <h3 className="mb-3 text-sm font-semibold sm:mb-4">Work summary</h3>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: "Leads contacted", value: stats?.called ?? 0 },
                { label: "Leads pending call", value: Math.max(0, (stats?.assigned ?? 0) - (stats?.called ?? 0)) },
                { label: "Open follow-ups", value: stats?.openFollowUps ?? 0 },
                { label: "Member since", value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-IN") : "—" },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between rounded-xl border p-3 text-sm">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> All figures are calculated from your live CRM records.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
