import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, ExternalLink, PhoneCall, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { inr, todayISO } from "@/lib/crm";
import { isSoundEnabled, playFollowUpChime, playUrgentAlertChime, setSoundEnabled } from "@/lib/notification-sound";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "@tanstack/react-router";

interface FollowUpAlarmItem {
  id: string;
  lead_id: string;
  follow_up_date: string;
  follow_up_time: string | null;
  note: string | null;
  is_done: boolean;
  leads: {
    id: string;
    customer_name: string;
    mobile: string;
    loan_amount?: number | null;
    loan_type?: string | null;
    notes?: string | null;
  } | null;
}

export function FollowUpAlarmManager() {
  const { data: session } = useCrmSession();
  const userId = session?.userId;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getTodayStorageKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `hezo_alerted_followups_${year}-${month}-${day}`;
  };

  // Track follow-up IDs that have already alerted today to avoid duplicate rings
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const [activeAlarm, setActiveAlarm] = useState<FollowUpAlarmItem | null>(null);
  const [clockTick, setClockTick] = useState<number>(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(getTodayStorageKey());
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            alertedIdsRef.current = new Set(parsed);
          }
        }
      } catch {}
    }
  }, []);

  // Real-time clock tick every 2 seconds to catch minute changes immediately
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Ask for notification permission once
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [userId]);

  // Fetch today's pending follow-ups for this user
  const today = todayISO();
  const { data: pendingFollowUps = [] } = useQuery({
    queryKey: ["follow-up-alarms", userId, session?.companyId],
    enabled: Boolean(userId),
    refetchInterval: 10000, // Recheck every 10 seconds
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("follow_ups")
        .select("id, lead_id, follow_up_date, follow_up_time, note, is_done, leads(id, customer_name, mobile, loan_amount, loan_type, notes)")
        .eq("is_done", false)
        .eq("employee_id", userId)
        .lte("follow_up_date", today);

      if (error) {
        console.error("[FollowUpAlarmManager] query error:", error);
        return [];
      }
      return (data || []) as unknown as FollowUpAlarmItem[];
    },
  });

function isFollowUpDueRightNow(itemDate: string, itemTime: string | null): boolean {
  if (!itemTime) return false; // Must have a selected callback time

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayLocal = `${year}-${month}-${day}`;

  // Parse itemDate to local YYYY-MM-DD
  let itemDateLocal = itemDate;
  if (itemDate.includes("T")) {
    const d = new Date(itemDate);
    const itemYear = d.getFullYear();
    const itemMonth = String(d.getMonth() + 1).padStart(2, "0");
    const itemDay = String(d.getDate()).padStart(2, "0");
    itemDateLocal = `${itemYear}-${itemMonth}-${itemDay}`;
  }

  // Must match today's date
  if (itemDateLocal !== todayLocal) return false;

  const [targetH, targetM] = itemTime.slice(0, 5).split(":").map(Number);
  if (isNaN(targetH) || isNaN(targetM)) return false;

  const currentH = now.getHours();
  const currentM = now.getMinutes();

  const currentTotalMinutes = currentH * 60 + currentM;
  const targetTotalMinutes = targetH * 60 + targetM;

  // Due at the exact scheduled minute or within current minute (diff >= 0 && diff <= 1)
  const diff = currentTotalMinutes - targetTotalMinutes;
  return diff >= 0 && diff <= 1;
}

// Alarm checker loop - fires alarm strictly at the scheduled callback minute
useEffect(() => {
  if (!pendingFollowUps || pendingFollowUps.length === 0) return;

  for (const item of pendingFollowUps) {
    if (alertedIdsRef.current.has(item.id)) continue;

    const isDueNow = isFollowUpDueRightNow(item.follow_up_date, item.follow_up_time);

      if (isDueNow) {
        alertedIdsRef.current.add(item.id);
        try {
          sessionStorage.setItem(
            getTodayStorageKey(),
            JSON.stringify(Array.from(alertedIdsRef.current))
          );
        } catch {}

        // Play alarm chime strictly at scheduled time
        playFollowUpChime();

        // Set active alarm banner
        setActiveAlarm(item);

        // Browser Desktop Push Notification
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(`🔔 Follow-up Reminder: ${item.leads?.customer_name || "Candidate"}`, {
              body: `Scheduled callback at ${item.follow_up_time?.slice(0, 5) || "Today"} · Phone: ${item.leads?.mobile || ""}\n${item.note || ""}`,
              icon: "/favicon.ico",
              tag: `followup_${item.id}`,
            });
          } catch (e) {
            console.error("Browser notification failed", e);
          }
        }

        // Sonner toast notification
        toast.warning(
          `🔔 Follow-up Due: ${item.leads?.customer_name || "Interested Candidate"}`,
          {
            description: `Time: ${item.follow_up_time?.slice(0, 5) || "Today"} · 📞 ${item.leads?.mobile || "No phone"} ${item.note ? `— ${item.note}` : ""}`,
            duration: 12000,
            action: {
              label: "Call Now",
              onClick: () => {
                if (item.leads?.mobile) {
                  window.location.href = `tel:${item.leads.mobile}`;
                }
              },
            },
          }
        );

        break; // Alert one at a time
      }
    }
  }, [pendingFollowUps, today, clockTick]);

  if (!activeAlarm) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-md w-[92vw] sm:w-[420px] animate-in slide-in-from-bottom-5 duration-300">
      <div className="rounded-2xl border-2 border-amber-500/80 bg-background/95 p-4 shadow-2xl backdrop-blur-xl ring-4 ring-amber-500/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold animate-bounce">
              🔔
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-extrabold text-foreground">Follow-up Callback Due!</h4>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  {activeAlarm.follow_up_time?.slice(0, 5) || "Today"}
                </span>
              </div>
              <p className="text-xs font-semibold text-brand mt-0.5">
                {activeAlarm.leads?.customer_name || "Interested Candidate"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveAlarm(null)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2.5 space-y-1 rounded-xl bg-muted/40 p-2.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>📞 Mobile: <strong className="text-foreground">{activeAlarm.leads?.mobile}</strong></span>
            {activeAlarm.leads?.loan_amount && (
              <span>💰 {inr(Number(activeAlarm.leads.loan_amount))}</span>
            )}
          </div>
          {activeAlarm.note && (
            <p className="text-foreground text-[11px] font-medium pt-1 border-t border-border/50 truncate">
              📝 {activeAlarm.note}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              playFollowUpChime();
            }}
            title="Replay notification chime"
            className="h-8 text-xs text-muted-foreground hover:text-foreground px-2"
          >
            <Volume2 className="h-3.5 w-3.5 mr-1" /> Replay Sound
          </Button>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              asChild
              className="h-8 text-xs font-semibold"
              onClick={() => setActiveAlarm(null)}
            >
              <Link to="/lead/$leadId" params={{ leadId: activeAlarm.lead_id }}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> View Lead
              </Link>
            </Button>
            <Button
              size="sm"
              asChild
              className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              onClick={() => setActiveAlarm(null)}
            >
              <a href={`tel:${activeAlarm.leads?.mobile}`}>
                <PhoneCall className="h-3.5 w-3.5 mr-1" /> Call Now
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
