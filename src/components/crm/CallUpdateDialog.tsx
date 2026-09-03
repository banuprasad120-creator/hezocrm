import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CALL_RESULTS, CUSTOMER_RESPONSES, LEAD_STATUSES, addDaysISO, inr,
  type CallResult, type CustomerResponse, type Lead, type LeadStatus,
} from "@/lib/crm";

const RESPONSE_TO_STATUS: Record<CustomerResponse, LeadStatus> = {
  "Interested": "Interested",
  "Not Interested": "Not Interested",
  "Follow-up Required": "Follow-up",
  "Documents Required": "Documents Pending",
  "Application Submitted": "Application Submitted",
  "Other": "Contacted",
};

const RESULT_TO_STATUS: Record<CallResult, LeadStatus> = {
  "Connected": "Contacted",
  "No Answer": "No Response",
  "Busy": "No Response",
  "Switched Off": "No Response",
  "Wrong Number": "Wrong Number",
};

export function CallUpdateDialog({
  lead, employeeId, open, onOpenChange,
}: {
  lead: Lead | null;
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<CallResult>("Connected");
  const [response, setResponse] = useState<CustomerResponse>("Interested");
  const [status, setStatus] = useState<LeadStatus>("Interested");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setResult("Connected"); setResponse("Interested"); setStatus("Interested");
      setNotes(""); setDate(""); setTime("");
    }
  }, [open, lead?.id]);

  const needsFollowUp = result === "Connected" && response === "Follow-up Required";

  const onResultChange = (v: CallResult) => {
    setResult(v);
    setStatus(v === "Connected" ? RESPONSE_TO_STATUS[response] : RESULT_TO_STATUS[v]);
  };
  const onResponseChange = (v: CustomerResponse) => {
    setResponse(v);
    setStatus(RESPONSE_TO_STATUS[v]);
  };

  const save = async () => {
    if (!lead) return;
    if (needsFollowUp && (!date || !time)) {
      toast.error("Follow-up date and time are required");
      return;
    }
    setBusy(true);
    try {
      const { error: cErr } = await supabase.from("call_history").insert({
        lead_id: lead.id,
        company_id: lead.company_id,
        employee_id: employeeId,
        call_result: result,
        customer_response: result === "Connected" ? response : null,
        status,
        notes: notes || null,
      });
      if (cErr) throw cErr;

      const { error: lErr } = await supabase.from("leads")
        .update({ status, last_call_at: new Date().toISOString(), notes: notes || lead.notes })
        .eq("id", lead.id);
      if (lErr) throw lErr;

      if (date) {
        const { error: fErr } = await supabase.from("follow_ups").insert({
          lead_id: lead.id,
          company_id: lead.company_id,
          employee_id: employeeId,
          follow_up_date: date,
          follow_up_time: time || null,
          note: notes || null,
        });
        if (fErr) throw fErr;
      }

      toast.success("Call update saved");
      await qc.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string; hint?: string; details?: string } | null)?.message ||
            (err as { details?: string } | null)?.details ||
            "";
      console.error("[call-update] failed", err);
      toast.error(msg ? `Could not save update — ${msg}` : "Could not save update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>UPDATE CALL</DialogTitle>
          <DialogDescription>
            {lead ? `${lead.customer_name} · ${lead.mobile} · ${inr(Number(lead.loan_amount))}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Call result</Label>
            <Select value={result} onValueChange={(v) => onResultChange(v as CallResult)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CALL_RESULTS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {result === "Connected" && (
            <div className="space-y-1.5">
              <Label>Customer response</Label>
              <Select value={response} onValueChange={(v) => onResponseChange(v as CustomerResponse)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUSTOMER_RESPONSES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Lead status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did the customer say?" />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <Label className="text-xs">Follow-up schedule {needsFollowUp && <span className="text-destructive">*</span>}</Label>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setDate(addDaysISO(30)); setTime("11:00"); setNotes((n) => n ? `${n} | Callback next month` : "Busy / Callback next month"); }}
                  className="h-6 px-1.5 text-[10px] font-bold text-indigo-500 bg-indigo-500/10 hover:bg-indigo-500/20"
                >
                  +30 Days (Next Month)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setDate(addDaysISO(15)); setTime("11:00"); }}
                  className="h-6 px-1.5 text-[10px]"
                >
                  +15 Days
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setDate(addDaysISO(1)); setTime("11:00"); }}
                  className="h-6 px-1.5 text-[10px]"
                >
                  Tomorrow
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="w-full gradient-brand font-bold text-white shadow-sm sm:w-auto">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneCall className="mr-2 h-4 w-4" />}
            SAVE UPDATE
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
