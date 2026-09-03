import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/components/theme-provider";
import { useAgents, useCrmSession } from "@/hooks/use-crm-session";
import {
  getCompanyBatchSettings, updateCompanyBatchSettings, getBatchAuditLogs, type LeadBatch,
} from "@/lib/lead-batch";
import { formatDateTime } from "@/lib/crm";
import { toast } from "sonner";
import { Loader2, RefreshCw, Sparkles, Zap, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Hezo CRM" }, { name: "description", content: "Company, theme, lead batch allocation and notification preferences." }] }),
  component: SettingsPage,
});

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 self-start sm:self-auto">{control}</div>
    </div>
  );
}

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useCrmSession();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const qc = useQueryClient();

  const { data: agents = [] } = useAgents(companyId, isAdmin);

  // Batch allocation settings state
  const { data: batchSettings, isLoading: batchLoading } = useQuery({
    queryKey: ["batch-settings", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getCompanyBatchSettings(companyId!),
  });

  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [batchSize, setBatchSize] = useState("100");
  const [savingBatch, setSavingBatch] = useState(false);

  useEffect(() => {
    if (batchSettings) {
      setAutomationEnabled(batchSettings.enabled);
      setBatchSize(String(batchSettings.batchSize || 100));
    }
  }, [batchSettings]);

  // Batch audit logs
  const { data: auditLogs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["batch-audit-logs", companyId],
    enabled: Boolean(companyId && isAdmin),
    queryFn: () => getBatchAuditLogs(companyId!, 40),
  });

  const agentMap = new Map(agents.map((a) => [a.id, a.full_name || a.email]));

  const saveBatchSettings = async () => {
    if (!companyId) return;
    setSavingBatch(true);
    try {
      await updateCompanyBatchSettings(companyId, automationEnabled, Number(batchSize) || 100);
      toast.success("Lead batch allocation settings updated successfully!");
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
    } catch (e) {
      toast.error("Failed to update settings", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSavingBatch(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Tune your workspace, batch automation, and team preferences." />
      <Tabs defaultValue="allocation" className="space-y-3">
        <div className="overflow-x-auto no-scrollbar pb-1">
          <TabsList className="inline-flex w-auto whitespace-nowrap p-1">
            <TabsTrigger value="allocation" className="text-xs sm:text-sm font-bold text-brand">
              ⚡ Lead Allocation
            </TabsTrigger>
            <TabsTrigger value="company" className="text-xs sm:text-sm">Company</TabsTrigger>
            <TabsTrigger value="theme" className="text-xs sm:text-sm">Theme</TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs sm:text-sm">Notifications</TabsTrigger>
            <TabsTrigger value="preferences" className="text-xs sm:text-sm">Preferences</TabsTrigger>
          </TabsList>
        </div>

        {/* ── TAB: Lead Allocation & Batch Automation ── */}
        <TabsContent value="allocation" className="space-y-6">
          <div className="rounded-2xl border bg-card p-4 card-elevated sm:p-6 space-y-4">
            <div className="border-b pb-3">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-brand" /> Automatic Lead Batch Refill System
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically allocate batches of unassigned leads to active agents when they finish calling their current batch.
              </p>
            </div>

            <Row
              label="Lead Batch Automation"
              hint="When ON, active agents automatically receive their next batch when their pending queue reaches 0."
              control={
                <Switch
                  checked={automationEnabled}
                  onCheckedChange={setAutomationEnabled}
                  disabled={!isAdmin || batchLoading}
                />
              }
            />

            <Row
              label="Agent Lead Batch Size"
              hint="Number of unassigned leads allocated per batch to each active agent."
              control={
                <Select
                  value={batchSize}
                  onValueChange={setBatchSize}
                  disabled={!isAdmin || batchLoading}
                >
                  <SelectTrigger className="w-40 font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 Leads</SelectItem>
                    <SelectItem value="50">50 Leads</SelectItem>
                    <SelectItem value="100">100 Leads (Default)</SelectItem>
                    <SelectItem value="150">150 Leads</SelectItem>
                    <SelectItem value="200">200 Leads</SelectItem>
                  </SelectContent>
                </Select>
              }
            />

            <Row
              label="Lead Exclusivity & Never-Resend Policy"
              hint="Enforces that assigned/contacted leads are never given to another agent or duplicated."
              control={
                <div className="flex items-center gap-1.5 rounded-full bg-success/15 border border-success/30 px-3 py-1 text-xs font-bold text-success">
                  <ShieldCheck className="h-4 w-4" /> Active & Enforced
                </div>
              }
            />

            {isAdmin && (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={saveBatchSettings}
                  disabled={savingBatch || batchLoading}
                  className="gradient-brand text-white font-bold h-10 px-5"
                >
                  {savingBatch ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4 fill-white" />}
                  Save Batch Settings
                </Button>
              </div>
            )}
          </div>

          {/* ── Batch Allocation Audit Logs ── */}
          <div className="rounded-2xl border bg-card p-4 card-elevated sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-foreground">
                  Batch Allocation Audit Logs
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete history of automatic and manual lead batch refills across your team.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchLogs()}
                className="h-8 text-xs"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh Logs
              </Button>
            </div>

            {logsLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Loading audit logs…</p>
            ) : auditLogs.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No batch allocations recorded yet. When agents receive automated batches, they will appear here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/30 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Batch</th>
                      <th className="px-3 py-2.5">Agent</th>
                      <th className="px-3 py-2.5">Leads Count</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Source</th>
                      <th className="px-3 py-2.5">Allocated At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {auditLogs.map((log) => {
                      const agent = agentMap.get(log.employee_id) || "Agent";
                      return (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2.5 font-bold text-brand">
                            Batch #{log.batch_number}
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-foreground">
                            {agent}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {log.assigned_count} / {log.batch_size}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              log.status === "COMPLETED"
                                ? "bg-success/15 text-success border border-success/30"
                                : "bg-sky-500/15 text-sky-500 border border-sky-500/30"
                            }`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                            {log.assignment_source}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {formatDateTime(log.assigned_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="company" className="rounded-2xl border bg-card p-4 card-elevated sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div><Label>Company name</Label><Input className="mt-1 text-xs sm:text-sm" defaultValue="Hezo Technologies" /></div>
            <div><Label>Legal entity</Label><Input className="mt-1 text-xs sm:text-sm" defaultValue="Hezo Pvt. Ltd." /></div>
            <div><Label>Contact email</Label><Input className="mt-1 text-xs sm:text-sm" defaultValue="support@hezo.co" /></div>
            <div><Label>Phone</Label><Input className="mt-1 text-xs sm:text-sm" defaultValue="+91 90000 12345" /></div>
            <div className="sm:col-span-2"><Label>Address</Label><Input className="mt-1 text-xs sm:text-sm" defaultValue="Bandra Kurla Complex, Mumbai" /></div>
          </div>
          <div className="mt-5 flex justify-end sm:mt-6"><Button className="w-full gradient-brand text-white sm:w-auto">Save changes</Button></div>
        </TabsContent>

        <TabsContent value="theme" className="rounded-2xl border bg-card p-4 card-elevated sm:p-6">
          <Row
            label="Appearance"
            hint="Pick a light or dark theme for your workspace."
            control={
              <Select value={theme} onValueChange={(v) => setTheme(v as "light" | "dark")}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <Row label="Compact density" hint="Reduce padding across tables and lists." control={<Switch />} />
          <Row label="Reduce motion" hint="Minimize non-essential animations." control={<Switch />} />
        </TabsContent>

        <TabsContent value="notifications" className="rounded-2xl border bg-card p-6 card-elevated">
          <Row label="New lead assigned" hint="Push notification when a lead lands in your folder." control={<Switch defaultChecked />} />
          <Row label="Follow-up reminders" hint="Get a nudge 10 minutes before every scheduled call." control={<Switch defaultChecked />} />
          <Row label="Attendance alerts" hint="Reminders to clock in and clock out." control={<Switch defaultChecked />} />
          <Row label="Weekly summary" hint="Every Monday, a digest of your team's performance." control={<Switch />} />
        </TabsContent>

        <TabsContent value="preferences" className="rounded-2xl border bg-card p-6 card-elevated">
          <Row label="Language" hint="Interface language for your workspace." control={
            <Select defaultValue="en">
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
                <SelectItem value="mr">Marathi</SelectItem>
              </SelectContent>
            </Select>
          } />
          <Row label="Timezone" hint="Used across schedules and reports." control={
            <Select defaultValue="ist">
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ist">Asia/Kolkata (IST)</SelectItem>
                <SelectItem value="utc">UTC</SelectItem>
              </SelectContent>
            </Select>
          } />
          <Row label="Currency" hint="Displayed on revenue and lead amounts." control={
            <Select defaultValue="inr">
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inr">INR (₹)</SelectItem>
                <SelectItem value="usd">USD ($)</SelectItem>
              </SelectContent>
            </Select>
          } />
        </TabsContent>
      </Tabs>
    </>
  );
}
