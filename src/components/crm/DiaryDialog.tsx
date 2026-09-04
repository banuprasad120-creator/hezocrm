import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Calendar, Check, Flame, Loader2, Star, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { parseDiaryData, saveLeadDiary, type DiaryData } from "@/lib/diary";
import { todayISO, type Lead } from "@/lib/crm";

interface DiaryDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DiaryDialog({ lead, open, onOpenChange, onSuccess }: DiaryDialogProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [priority, setPriority] = useState<"HOT" | "HIGH" | "NORMAL">("HIGH");
  const [targetDate, setTargetDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (lead && open) {
      const existing = parseDiaryData(lead.notes);
      if (existing) {
        setPriority(existing.priority || "HIGH");
        setTargetDate(existing.targetDate || todayISO());
        setNotes(existing.notes || "");
      } else {
        setPriority("HIGH");
        setTargetDate(todayISO());
        setNotes("");
      }
    }
  }, [lead, open]);

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: DiaryData = {
        isImportant: true,
        priority,
        targetDate,
        notes: notes.trim(),
        markedAt: new Date().toISOString(),
      };

      await saveLeadDiary(lead.id, lead.notes, data);
      toast.success(`Moved ${lead.customer_name} to Important Diary! 📔`);
      
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["diary-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Failed to save to diary", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await saveLeadDiary(lead.id, lead.notes, null);
      toast.success(`Removed ${lead.customer_name} from Diary`);
      
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["diary-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Failed to update diary", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const isAlreadyInDiary = Boolean(parseDiaryData(lead.notes));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {isAlreadyInDiary ? "Update Important Diary Entry" : "Move to Important Diary"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Mark <strong>{lead.customer_name}</strong> ({lead.mobile}) as a high-priority diary lead.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-2 text-xs sm:text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Priority Level</Label>
              <Select value={priority} onValueChange={(v: "HOT" | "HIGH" | "NORMAL") => setPriority(v)}>
                <SelectTrigger className="h-9 bg-card">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOT">🔥 Hot Deal / Urgent</SelectItem>
                  <SelectItem value="HIGH">⚡ High Priority</SelectItem>
                  <SelectItem value="NORMAL">📌 Normal Diary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Target Action Date</Label>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="h-9 bg-card"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Diary Notes / Action Reminder
            </Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Customer promised salary slips tomorrow 10 AM; quotation shared..."
              className="bg-card text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 flex items-center justify-between sm:justify-between">
          {isAlreadyInDiary ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={saving}
              className="text-rose-500 hover:bg-rose-500/10 border-rose-500/30 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Remove from Diary
            </Button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold gap-1.5 shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
              <span>Save to Diary</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
