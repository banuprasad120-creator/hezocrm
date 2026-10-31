import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pause, Play, Square, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  getCompanyBatchSettings,
  startAutoAssignment,
  pauseAutoAssignment,
  stopAutoAssignment,
  type AutoAssignStatus,
} from "@/lib/lead-batch";

interface AutoAssignControlsProps {
  companyId: string;
  variant?: "toolbar" | "card";
}

export function AutoAssignControls({ companyId, variant = "toolbar" }: AutoAssignControlsProps) {
  const qc = useQueryClient();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [recallUncontacted, setRecallUncontacted] = useState(true);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["batch-settings", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getCompanyBatchSettings(companyId),
  });

  const status: AutoAssignStatus = settings?.status ?? "RUNNING";

  const handleStart = async () => {
    setLoadingAction("start");
    try {
      const res = await startAutoAssignment(companyId);
      toast.success("⚡ Auto-Assign Started!", {
        description: res.message || "Active agents with zero pending leads have been refilled.",
      });
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    } catch (err) {
      toast.error("Failed to start auto-assign", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePause = async () => {
    setLoadingAction("pause");
    try {
      const res = await pauseAutoAssignment(companyId);
      toast.info("⏸️ Auto-Assign Paused", {
        description: res.message || "Automatic refills are on hold. Existing agent leads remain intact.",
      });
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    } catch (err) {
      toast.error("Failed to pause auto-assign", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleConfirmStop = async () => {
    setLoadingAction("stop");
    try {
      const res = await stopAutoAssignment(companyId, recallUncontacted);
      toast.warning("⏹️ Auto-Assign Stopped", {
        description: res.message || "Auto-assign is fully stopped.",
      });
      setStopDialogOpen(false);
      setRecallUncontacted(true);
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["daily-lead-stats"] });
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["active-batch"] });
      qc.invalidateQueries({ queryKey: ["unassigned-leads-count"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    } catch (err) {
      toast.error("Failed to stop auto-assign", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  if (variant === "toolbar") {
    return (
      <>
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border">
          {/* Status Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : status === "RUNNING" ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-600 dark:text-emerald-400">Running</span>
              </>
            ) : status === "PAUSED" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                <span className="text-amber-600 dark:text-amber-400">Paused</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-destructive"></span>
                <span className="text-destructive">Stopped</span>
              </>
            )}
          </div>

          <div className="h-4 w-px bg-border my-auto" />

          {/* Action Buttons */}
          <Button
            size="sm"
            variant={status === "RUNNING" ? "default" : "ghost"}
            className={`h-7 px-2.5 text-xs font-semibold gap-1 ${
              status === "RUNNING"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                : "text-emerald-600 hover:bg-emerald-500/10"
            }`}
            disabled={status === "RUNNING" || Boolean(loadingAction)}
            onClick={handleStart}
            title="Start Auto-Assign (Refills zero-lead agents immediately)"
          >
            {loadingAction === "start" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            <span>Start</span>
          </Button>

          <Button
            size="sm"
            variant={status === "PAUSED" ? "default" : "ghost"}
            className={`h-7 px-2.5 text-xs font-semibold gap-1 ${
              status === "PAUSED"
                ? "bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                : "text-amber-600 hover:bg-amber-500/10"
            }`}
            disabled={status === "PAUSED" || Boolean(loadingAction)}
            onClick={handlePause}
            title="Pause Auto-Assign (Freezes auto-refill, keeps agent queues intact)"
          >
            {loadingAction === "pause" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
            <span>Pause</span>
          </Button>

          <Button
            size="sm"
            variant={status === "STOPPED" ? "default" : "ghost"}
            className={`h-7 px-2.5 text-xs font-semibold gap-1 ${
              status === "STOPPED"
                ? "bg-destructive hover:bg-destructive/90 text-white shadow-xs"
                : "text-destructive hover:bg-destructive/10"
            }`}
            disabled={status === "STOPPED" || Boolean(loadingAction)}
            onClick={() => setStopDialogOpen(true)}
            title="Stop Auto-Assign (Completely halts auto-distribution with optional lead recall)"
          >
            {loadingAction === "stop" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            <span>Stop</span>
          </Button>
        </div>

        {/* Stop Confirmation Dialog */}
        <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <DialogTitle>Stop Lead Auto-Assignment?</DialogTitle>
              </div>
              <DialogDescription className="text-sm pt-2">
                This will completely halt automatic lead distribution for all agents.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border bg-muted/30 p-4 space-y-3 mt-2">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="recall-uncontacted"
                  checked={recallUncontacted}
                  onCheckedChange={(c) => setRecallUncontacted(Boolean(c))}
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="recall-uncontacted"
                    className="text-xs font-bold leading-none cursor-pointer"
                  >
                    Recall uncontacted leads back to the unassigned queue
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Leads assigned to agents that have never been dialed will be released back to the unassigned pool so other workflows can use them.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStopDialogOpen(false)}
                disabled={Boolean(loadingAction)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmStop}
                disabled={Boolean(loadingAction)}
                className="gap-1.5"
              >
                {loadingAction === "stop" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Stop Auto-Assignment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Card Variant for Settings
  return (
    <>
      <div className="rounded-2xl border bg-card p-4 card-elevated space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-brand" /> Auto-Assign Controls
            </h4>
            <p className="text-xs text-muted-foreground">
              Manage automatic round-robin batch allocations to active agents.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border">
            {status === "RUNNING" ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                RUNNING (Active)
              </span>
            ) : status === "PAUSED" ? (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                PAUSED
              </span>
            ) : (
              <span className="text-destructive flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                STOPPED
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            size="sm"
            variant={status === "RUNNING" ? "default" : "outline"}
            className={`h-9 font-semibold gap-1.5 ${
              status === "RUNNING"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
            }`}
            disabled={status === "RUNNING" || Boolean(loadingAction)}
            onClick={handleStart}
          >
            {loadingAction === "start" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Start
          </Button>

          <Button
            size="sm"
            variant={status === "PAUSED" ? "default" : "outline"}
            className={`h-9 font-semibold gap-1.5 ${
              status === "PAUSED"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
            }`}
            disabled={status === "PAUSED" || Boolean(loadingAction)}
            onClick={handlePause}
          >
            {loadingAction === "pause" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
            Pause
          </Button>

          <Button
            size="sm"
            variant={status === "STOPPED" ? "destructive" : "outline"}
            className={`h-9 font-semibold gap-1.5 ${
              status === "STOPPED"
                ? ""
                : "border-destructive/40 text-destructive hover:bg-destructive/10"
            }`}
            disabled={status === "STOPPED" || Boolean(loadingAction)}
            onClick={() => setStopDialogOpen(true)}
          >
            {loadingAction === "stop" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop
          </Button>
        </div>
      </div>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <DialogTitle>Stop Lead Auto-Assignment?</DialogTitle>
            </div>
            <DialogDescription className="text-sm pt-2">
              This will completely halt automatic lead distribution for all agents.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border bg-muted/30 p-4 space-y-3 mt-2">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="recall-uncontacted-card"
                checked={recallUncontacted}
                onCheckedChange={(c) => setRecallUncontacted(Boolean(c))}
              />
              <div className="space-y-1">
                <Label
                  htmlFor="recall-uncontacted-card"
                  className="text-xs font-bold leading-none cursor-pointer"
                >
                  Recall uncontacted leads back to the unassigned queue
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Leads assigned to agents that have never been dialed will be released back to the unassigned pool.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStopDialogOpen(false)}
              disabled={Boolean(loadingAction)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmStop}
              disabled={Boolean(loadingAction)}
              className="gap-1.5"
            >
              {loadingAction === "stop" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Stop Auto-Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

