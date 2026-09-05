import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  PhoneCall,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { addDaysISO, inr, todayISO, type Lead } from "@/lib/crm";
import { playFollowUpChime } from "@/lib/notification-sound";

interface QuickFollowUpDialogProps {
  lead: Lead | null;
  employeeId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function QuickFollowUpDialog({
  lead,
  employeeId,
  open,
  onOpenChange,
  onSuccess,
}: QuickFollowUpDialogProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Default to tomorrow 11:00 AM
  const [date, setDate] = useState(() => addDaysISO(1));
  const [time, setTime] = useState("11:00");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setDate(addDaysISO(1));
    setTime("11:00");
    setNotes("");
  };

  const handleSave = async () => {
    if (!lead) return;
    if (!date) {
      return toast.error("Please choose a follow-up date");
    }

    setBusy(true);
    try {
      const empId = employeeId || lead.assigned_to || "";

      // 1. Insert into follow_ups table
      const { error: fuErr } = await supabase.from("follow_ups").insert({
        company_id: lead.company_id,
        lead_id: lead.id,
        employee_id: empId,
        follow_up_date: date,
        follow_up_time: time || null,
        note: notes.trim() || `Callback scheduled for ${lead.customer_name}`,
        is_done: false,
      });

      if (fuErr) throw fuErr;

      // 2. Insert into call_history for complete audit trail
      if (empId) {
        await supabase.from("call_history").insert({
          company_id: lead.company_id,
          lead_id: lead.id,
          employee_id: empId,
          call_result: "Connected",
          customer_response: "Follow-up Required",
          status: lead.status,
          notes: `📅 Scheduled follow-up callback on ${date}${time ? ` at ${time}` : ""}${notes ? `: ${notes.trim()}` : ""}`,
        });
      }

      // 3. Play confirmation sound
      playFollowUpChime();

      toast.success(`🎉 Follow-up scheduled for ${lead.customer_name}!`, {
        description: `Alarm will sound on ${date}${time ? ` at ${time}` : ""}.`,
      });

      // 4. Invalidate all relevant queries
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["follow-ups"] }),
        qc.invalidateQueries({ queryKey: ["my-followups-open"] }),
        qc.invalidateQueries({ queryKey: ["follow-up-alarms"] }),
        qc.invalidateQueries({ queryKey: ["topbar-followups"] }),
        qc.invalidateQueries({ queryKey: ["interested-leads"] }),
        qc.invalidateQueries({ queryKey: ["my-leads"] }),
        qc.invalidateQueries({ queryKey: ["daily-leads"] }),
        qc.invalidateQueries({ queryKey: ["call-history", lead.id] }),
      ]);

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error("[QuickFollowUpDialog] Error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to schedule follow-up");
    } finally {
      setBusy(false);
    }
  };

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold shadow-xs">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-base font-bold">Schedule Quick Follow-up</DialogTitle>
              <DialogDescription className="text-xs">
                Set a callback alarm reminder for <strong>{lead.customer_name}</strong> (📞 {lead.mobile})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quick Presets */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">1-Click Quick Presets</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(todayISO());
                  setTime("15:30");
                }}
                className="h-8 text-[11px] font-semibold hover:border-amber-500 hover:text-amber-600"
              >
                Today (3:30 PM)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(addDaysISO(1));
                  setTime("11:00");
                }}
                className="h-8 text-[11px] font-semibold hover:border-amber-500 hover:text-amber-600"
              >
                Tomorrow (11 AM)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(addDaysISO(3));
                  setTime("11:00");
                }}
                className="h-8 text-[11px] font-semibold hover:border-amber-500 hover:text-amber-600"
              >
                +3 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(addDaysISO(7));
                  setTime("11:00");
                }}
                className="h-8 text-[11px] font-semibold hover:border-amber-500 hover:text-amber-600"
              >
                +7 Days (1 Wk)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(addDaysISO(15));
                  setTime("11:00");
                }}
                className="h-8 text-[11px] font-semibold hover:border-amber-500 hover:text-amber-600"
              >
                +15 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(addDaysISO(30));
                  setTime("11:00");
                  setNotes((n) => (n ? `${n} | 1-month CIBIL recheck` : "Recheck CIBIL & profile in 1 month"));
                }}
                className="h-8 text-[11px] font-bold text-indigo-600 bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30"
              >
                +30 Days (CIBIL)
              </Button>
            </div>
          </div>

          {/* Date and Time Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Follow-up Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Time</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          {/* Notes / Remarks */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Discussion Notes / Callback Purpose</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Customer requested call after salary credit on 10th..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs"
            />
          </div>

          {/* Sound Alarm Reminder Indicator */}
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            <span className="text-base animate-pulse">🔔</span>
            <div className="text-[11px] leading-tight">
              <span>An <strong>audible chime alarm</strong> will ring and show a call popup on your screen when this callback time arrives.</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy} className="h-9">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={busy || !date}
            className="h-9 font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs gap-1.5"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Save Follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
