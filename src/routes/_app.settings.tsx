import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/components/theme-provider";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Hezo CRM" }, { name: "description", content: "Company, theme and notification preferences." }] }),
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
  return (
    <>
      <PageHeader title="Settings" description="Tune your workspace to match how your team works." />
      <Tabs defaultValue="company" className="space-y-3">
        <div className="overflow-x-auto no-scrollbar pb-1">
          <TabsList className="inline-flex w-auto whitespace-nowrap p-1">
            <TabsTrigger value="company" className="text-xs sm:text-sm">Company</TabsTrigger>
            <TabsTrigger value="theme" className="text-xs sm:text-sm">Theme</TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs sm:text-sm">Notifications</TabsTrigger>
            <TabsTrigger value="preferences" className="text-xs sm:text-sm">Preferences</TabsTrigger>
          </TabsList>
        </div>

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
