import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { FollowUpAlarmManager } from "@/components/crm/FollowUpAlarmManager";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/" });
    return { user: data.session.user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { data: session } = useCrmSession();
  const hasUser = Boolean(session?.userId);

  return (
    <SidebarProvider>
      <div className="flex min-h-dvh w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <TopBar />
          <main className="relative flex-1 overflow-x-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-72 mesh-bg opacity-70" />
            <div className="relative mx-auto w-full max-w-[1400px] p-3 sm:p-6 lg:p-8">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
        <MobileBottomNav />
        {hasUser && <FollowUpAlarmManager />}
      </div>
    </SidebarProvider>
  );
}

