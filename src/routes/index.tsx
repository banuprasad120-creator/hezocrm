import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, Moon, Sparkles, Sun } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme-provider";
import { supabase } from "@/integrations/supabase/client";
import { setupCompany } from "@/lib/crm.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Hezo CRM" },
      { name: "description", content: "Sign in to Hezo CRM — lead assignment, agent calling and live lead status tracking for telecalling teams." },
      { property: "og:title", content: "Sign in — Hezo CRM" },
      { property: "og:description", content: "Lead assignment, agent calling and live lead status tracking for telecalling teams." },
    ],
  }),
  ssr: false,
  component: AuthPage,
});

async function routeAfterLogin(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "/";
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  const list = (roles ?? []).map((r) => r.role);
  if (list.includes("super_admin")) return "/companies";
  if (list.includes("company_admin")) return "/daily-leads";
  if (list.includes("agent")) return "/my-leads";
  return "/profile";
}

function AuthPage() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      // Finish company setup for admins returning from the email confirmation link.
      const pending = localStorage.getItem("hezo_pending_company");
      if (pending) {
        try {
          const p = JSON.parse(pending) as { companyName: string; fullName: string };
          await setupCompany({ data: { companyName: p.companyName, fullName: p.fullName } });
          localStorage.removeItem("hezo_pending_company");
          toast.success("Email verified — company created");
        } catch {
          /* ignore, user can retry */
        }
      }
      navigate({ to: await routeAfterLogin(), replace: true });
    });
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) {
        return toast.error("Email not confirmed in Supabase", {
          description: "Go to Supabase Dashboard -> Auth -> Users -> Confirm Email, or turn off 'Confirm email' in Auth Settings.",
          duration: 10000,
        });
      }
      return toast.error(error.message);
    }
    toast.success("Welcome back");
    navigate({ to: await routeAfterLogin(), replace: true });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    localStorage.setItem(
      "hezo_pending_company",
      JSON.stringify({ companyName: companyName.trim(), fullName: fullName.trim() }),
    );
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
    });
    if (error) { setBusy(false); return toast.error(error.message); }
    if (!data.session) {
      setBusy(false);
      setSentTo(email.trim());
      return;
    }
    try {
      await setupCompany({ data: { companyName: companyName.trim(), fullName: fullName.trim() } });
      localStorage.removeItem("hezo_pending_company");
      toast.success("Company created — you are the admin");
      navigate({ to: "/daily-leads", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setup");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sentTo) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: sentTo,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    toast[error ? "error" : "success"](error ? error.message : "Confirmation email sent again");
  };


  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 mesh-bg" />
      <div className="pointer-events-none absolute -left-40 top-1/3 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -top-24 h-96 w-96 rounded-full bg-brand-2/25 blur-3xl" />

      <div className="relative grid min-h-dvh grid-cols-1 lg:grid-cols-2">
        <div className="relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
          <Logo />
          <div className="max-w-lg">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-brand" /> AI-powered call center CRM
            </div>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight">
              Assign. Call. <span className="gradient-text">Convert.</span>
            </h1>
            <p className="mt-3 text-muted-foreground">
              Admins assign daily lead folders, agents call and update outcomes, and every status change is tracked live.
            </p>
            <ul className="mt-6 space-y-2 text-sm">
              {["Bulk & equal lead distribution", "Agents see only their own leads", "Full call history & follow-ups"].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> {t}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Hezo CRM</p>
        </div>

        <div className="flex items-center justify-center p-3.5 sm:p-6 lg:p-8">
          <div className="w-full max-w-md rounded-3xl border bg-card/85 p-5 card-elevated backdrop-blur sm:p-8">
            <div className="mb-5 flex items-center justify-between sm:mb-6">
              <div className="lg:hidden"><Logo /></div>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="ml-auto">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>

            <Tabs defaultValue="signin">
              <TabsList className="w-full">
                <TabsTrigger value="signin" className="flex-1">Sign in</TabsTrigger>
                <TabsTrigger value="signup" className="flex-1">Create company</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={signIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Work email</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input id="password" type={show ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Toggle password">
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" disabled={busy} className="w-full gradient-brand text-white">
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                {sentTo ? (
                  <div className="space-y-4 py-4 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/15">
                      <Mail className="h-6 w-6 text-brand" />
                    </div>
                    <h2 className="text-lg font-semibold">Confirm your email</h2>
                    <p className="text-sm text-muted-foreground">
                      We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>.
                      Click it to activate your admin account — your company is created right after.
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" disabled={busy} onClick={resend}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Resend email
                      </Button>
                      <Button variant="ghost" onClick={() => setSentTo(null)}>Use a different email</Button>
                    </div>
                  </div>
                ) : (
                <form onSubmit={signUp} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="cname">Company name</Label>
                    <Input id="cname" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nexus Finance" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fname">Your name</Label>
                    <Input id="fname" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Admin name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email2">Work email</Label>
                    <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pass2">Password</Label>
                    <Input id="pass2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full gradient-brand text-white">
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create company account
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">Agents are created by the admin inside the app.</p>
                </form>
                )}
              </TabsContent>
            </Tabs>

          </div>
        </div>
      </div>
    </div>
  );
}
