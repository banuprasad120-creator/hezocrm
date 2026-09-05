import { useState } from "react";
import { Bell, CalendarClock, Command, Moon, PhoneCall, Search, Sun, Volume2, VolumeX } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { todayISO } from "@/lib/crm";
import { isSoundEnabled, setSoundEnabled, testNotificationSound } from "@/lib/notification-sound";
import { toast } from "sonner";
import { CommandPalette } from "./CommandPalette";

export function TopBar() {
  const { theme, toggle } = useTheme();
  const [openCmd, setOpenCmd] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const { data: session } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) {
      testNotificationSound();
      toast.success("🔔 Follow-up alert sound enabled");
    } else {
      toast.info("🔕 Notification sound muted");
    }
  };

  const today = todayISO();
  const { data: dueFollowUps = [] } = useQuery({
    queryKey: ["topbar-followups", session?.userId],
    enabled: Boolean(session?.userId),
    refetchInterval: 30000,
    queryFn: async () => {
      let query = supabase
        .from("follow_ups")
        .select("id, lead_id, follow_up_date, follow_up_time, note, is_done, leads(customer_name, mobile)")
        .eq("is_done", false)
        .lte("follow_up_date", today)
        .order("follow_up_date", { ascending: true })
        .limit(10);

      if (!session?.isAdmin) {
        query = query.eq("employee_id", session?.userId!);
      }

      const { data } = await query;
      return data || [];
    },
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl sm:px-5">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-5" />

      <button
        type="button"
        onClick={() => setOpenCmd(true)}
        className="group flex h-9 flex-1 max-w-md items-center gap-2 rounded-xl border bg-muted/40 px-3 text-left text-xs text-muted-foreground transition hover:bg-muted touch-tap sm:text-sm"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">Search leads, agents, folders…</span>
        <kbd className="hidden items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-semibold md:inline-flex">
          <Command className="h-3 w-3" /> K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Sound Toggle & Test */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSound}
          title={soundOn ? "Sound Alerts: ON (Click to mute)" : "Sound Alerts: MUTED (Click to enable)"}
          className={soundOn ? "text-brand" : "text-muted-foreground"}
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>

        {/* Follow-up Reminders Bell Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Follow-up Reminders">
              <Bell className="h-4 w-4" />
              {dueFollowUps.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-extrabold text-white animate-pulse">
                  {dueFollowUps.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 shadow-xl">
            <div className="flex items-center justify-between border-b p-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-500" />
                <h4 className="text-xs font-bold">Follow-up Callbacks ({dueFollowUps.length})</h4>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => testNotificationSound()}
                className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-brand"
                title="Test alarm sound"
              >
                🔊 Test Chime
              </Button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y">
              {dueFollowUps.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  <p>🎉 All scheduled follow-ups are up to date!</p>
                </div>
              ) : (
                dueFollowUps.map((item: any) => (
                  <div key={item.id} className="p-3 hover:bg-muted/40 transition-colors text-xs flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <Link
                        to="/lead/$leadId"
                        params={{ leadId: item.lead_id }}
                        className="font-bold text-foreground hover:underline truncate"
                      >
                        {item.leads?.customer_name || "Candidate"}
                      </Link>
                      <span className="rounded bg-amber-500/10 text-amber-600 px-1.5 py-0.5 text-[10px] font-bold">
                        {item.follow_up_time?.slice(0, 5) || "Today"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>📞 {item.leads?.mobile}</span>
                      {item.leads?.mobile && (
                        <a
                          href={`tel:${item.leads.mobile}`}
                          className="font-semibold text-emerald-600 hover:underline flex items-center gap-0.5"
                        >
                          <PhoneCall className="h-3 w-3" /> Call
                        </a>
                      )}
                    </div>
                    {item.note && (
                      <p className="text-[10px] text-muted-foreground truncate italic">
                        "{item.note}"
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-2 border-t bg-muted/10 text-center">
              <Button asChild variant="ghost" size="sm" className="w-full h-7 text-xs font-semibold text-brand">
                <Link to="/follow-ups">View All Follow-ups →</Link>
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-full border p-0.5 pr-2 hover:bg-muted">
              <span className="grid h-7 w-7 place-items-center rounded-full gradient-brand text-[10px] font-bold text-white">
                {(session?.fullName || session?.email || "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden max-w-[120px] truncate text-xs font-semibold sm:inline">
                {session?.fullName || session?.email || "Account"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{session?.email || "My account"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/profile">Profile</Link></DropdownMenuItem>
            {session?.isAdmin && <DropdownMenuItem asChild><Link to="/settings">Settings</Link></DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandPalette open={openCmd} onOpenChange={setOpenCmd} />
    </header>
  );
}
