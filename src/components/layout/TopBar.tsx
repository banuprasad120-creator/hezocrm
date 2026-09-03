import { useState } from "react";
import { Command, Moon, Search, Sun } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CommandPalette } from "./CommandPalette";

export function TopBar() {
  const { theme, toggle } = useTheme();
  const [openCmd, setOpenCmd] = useState(false);
  const { data: session } = useCrmSession();
  const navigate = useNavigate();
  const qc = useQueryClient();

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
