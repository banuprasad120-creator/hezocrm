import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Database, Download, FileSpreadsheet,
  Flame, Loader2, Phone, Play, Plus, PlusCircle, Sparkles, Upload, User, UserPlus
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { LOAN_TYPES, todayISO, PRIORITY_LEVELS, priorityTone } from "@/lib/crm";
import { createLeadServerFn } from "@/lib/crm.functions";
import { downloadSampleFile } from "@/lib/lead-import";
import {
  getCompanyBatchSettings,
  startAutoAssignment,
  type AutoAssignStatus
} from "@/lib/lead-batch";

export const LEAD_SOURCES = [
  "External Lead / Direct",
  "Website / Landing Page",
  "Walk-in / Office Visit",
  "Customer Referral",
  "Meta / Facebook Ads",
  "Google Ads",
  "Cold Calling / Database",
  "Partner / DSA Channel",
  "WhatsApp Inquiry",
  "Other",
] as const;

interface AddNewDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
  adminUserId?: string | null;
  defaultFolderDate?: string;
  onOpenImportWizard?: () => void;
  onSuccess?: () => void;
}

export function AddNewDataDialog({
  open,
  onOpenChange,
  companyId,
  adminUserId,
  defaultFolderDate,
  onOpenImportWizard,
  onSuccess,
}: AddNewDataDialogProps) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"bulk" | "single">("bulk");

  // Fetch company auto-assign settings
  const { data: settings } = useQuery({
    queryKey: ["batch-settings", companyId],
    enabled: Boolean(companyId && open),
    queryFn: () => getCompanyBatchSettings(companyId!),
  });
  const status: AutoAssignStatus = settings?.status ?? "STOPPED";

  // Single Lead Form State
  const [savingSingle, setSavingSingle] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [alternateMobile, setAlternateMobile] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [loanType, setLoanType] = useState<string>("Personal Loan");
  const [loanAmount, setLoanAmount] = useState<string>("");
  const [source, setSource] = useState<string>("External Lead / Direct");
  const [folderDate, setFolderDate] = useState<string>(defaultFolderDate || todayISO());
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("LOW");
  const [startingAutoAssign, setStartingAutoAssign] = useState(false);

  // Live duplicate check for single entry
  const cleanMobile = mobile.replace(/\D/g, "");
  const { data: existingLead } = useQuery({
    queryKey: ["check-duplicate-mobile-add-data", companyId, cleanMobile],
    enabled: Boolean(companyId && cleanMobile.length >= 8 && open),
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, customer_name, mobile, status, assigned_to, folder_date")
        .eq("company_id", companyId!)
        .eq("mobile", cleanMobile)
        .maybeSingle();
      return data;
    },
  });

  const resetSingleForm = () => {
    setCustomerName("");
    setMobile("");
    setAlternateMobile("");
    setCity("");
    setState("");
    setLoanType("Personal Loan");
    setLoanAmount("");
    setSource("External Lead / Direct");
    setFolderDate(defaultFolderDate || todayISO());
    setNotes("");
    setPriority("LOW");
  };

  const handleStartAutoAssign = async () => {
    if (!companyId) return;
    setStartingAutoAssign(true);
    try {
      const res = await startAutoAssignment(companyId);
      toast.success("⚡ Auto-Assign Started!", {
        description: res.message || "Queue assignment is now active.",
      });
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (err) {
      toast.error("Failed to start auto-assign", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setStartingAutoAssign(false);
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) {
      toast.error("Company identification missing");
      return;
    }

    const digitsOnly = mobile.replace(/\D/g, "");
    if (digitsOnly.length !== 10 || !/^[6-9]\d{9}$/.test(digitsOnly)) {
      toast.error("Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9");
      return;
    }

    if (existingLead) {
      toast.error(
        `Duplicate mobile number! Lead already exists for "${existingLead.customer_name}" in folder ${existingLead.folder_date}.`
      );
      return;
    }

    const trimmedName = customerName.trim() || `Customer ${digitsOnly.slice(-4)}`;

    setSavingSingle(true);
    try {
      const parsedAmount = loanAmount ? Number(loanAmount) : 0;
      const formattedNotes = notes.trim()
        ? `[Added Data - ${source}]: ${notes.trim()}`
        : `[Added Data - ${source}]`;

      await createLeadServerFn({
        data: {
          companyId,
          customerName: trimmedName,
          mobile: digitsOnly,
          alternateMobile: alternateMobile.replace(/\D/g, "") || null,
          city: city.trim() || null,
          state: state.trim() || null,
          loanType,
          loanAmount: parsedAmount,
          monthlyIncome: null,
          employer: null,
          employmentType: "Salaried",
          source: source || "External Lead / Direct",
          folderDate: folderDate || todayISO(),
          notes: formattedNotes,
          priority,
          assignedTo: null, // Always unassigned when adding to queue
        },
      });

      toast.success(
        status === "STOPPED"
          ? `🎉 Lead added to folder ${folderDate} queue (Auto-assign is STOPPED — lead is safely queued).`
          : `🎉 Lead added to folder ${folderDate} with ${priority} priority!`
      );

      qc.invalidateQueries({ queryKey: ["all-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads-stats"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["daily-lead-stats"] });
      qc.invalidateQueries({ queryKey: ["unassigned-leads-count"] });
      qc.invalidateQueries({ queryKey: ["leads"] });

      resetSingleForm();
      onSuccess?.();
    } catch (err) {
      console.error("Error creating lead:", err);
      toast.error("Failed to add lead", {
        description: err instanceof Error ? err.message : "Database error",
      });
    } finally {
      setSavingSingle(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-5 border-b bg-card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Add New Data</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Folder 📁 {folderDate} · Upload Excel/CSV files or enter single leads into the queue.
                </DialogDescription>
              </div>
            </div>

            {/* Status Pill */}
            <div className="shrink-0">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border ${
                status === "RUNNING"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : status === "PAUSED"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : "bg-destructive/10 text-destructive border-destructive/30"
              }`}>
                <span className={`h-2 w-2 rounded-full ${
                  status === "RUNNING" ? "bg-emerald-500 animate-ping" : status === "PAUSED" ? "bg-amber-500" : "bg-destructive"
                }`} />
                {status === "RUNNING" ? "Auto-Assign Running" : status === "PAUSED" ? "Auto-Assign Paused" : "Auto-Assign Stopped"}
              </span>
            </div>
          </div>

          {/* Contextual Banner Explaining Behavior */}
          <div className={`mt-3.5 rounded-xl border p-3 text-xs flex items-start justify-between gap-3 ${
            status === "STOPPED"
              ? "bg-destructive/5 border-destructive/20 text-foreground"
              : status === "PAUSED"
              ? "bg-amber-500/5 border-amber-500/20 text-foreground"
              : "bg-emerald-500/5 border-emerald-500/20 text-foreground"
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-sm">
                {status === "STOPPED" ? "⏹️" : status === "PAUSED" ? "⏸️" : "⚡"}
              </span>
              <div>
                <p className="font-bold">
                  {status === "STOPPED"
                    ? "Auto-Assignment is currently Stopped"
                    : status === "PAUSED"
                    ? "Auto-Assignment is Paused"
                    : "Auto-Assignment is Live & Running"}
                </p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  {status === "STOPPED"
                    ? "All newly added leads will be safely saved in the unassigned queue with priority. Agents will NOT receive them until you click Start."
                    : status === "PAUSED"
                    ? "New data will be saved in queue and held until resumed."
                    : "New data will be automatically prioritized and dispatched to active agents."}
                </p>
              </div>
            </div>

            {status !== "RUNNING" && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStartAutoAssign}
                disabled={startingAutoAssign}
                className="h-7 text-xs font-bold border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 shrink-0 gap-1"
              >
                {startingAutoAssign ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                <span>Start Now</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="p-5">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4 h-10">
              <TabsTrigger value="bulk" className="gap-2 text-xs font-bold">
                <FileSpreadsheet className="h-4 w-4" />
                <span>Bulk Spreadsheet (Excel / CSV)</span>
              </TabsTrigger>
              <TabsTrigger value="single" className="gap-2 text-xs font-bold">
                <UserPlus className="h-4 w-4" />
                <span>Quick Single Lead</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: BULK IMPORT */}
            <TabsContent value="bulk" className="space-y-4 m-0">
              <div className="rounded-2xl border-2 border-dashed border-border/80 bg-muted/20 p-6 text-center hover:bg-muted/30 transition">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand mb-3">
                  <Upload className="h-7 w-7" />
                </div>
                <h4 className="text-base font-bold text-foreground">Upload Excel or CSV File</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  Upload multiple leads at once. Mobile duplicates are automatically skipped, and lead priority is detected automatically.
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      onOpenImportWizard?.();
                    }}
                    className="gradient-brand text-white font-bold gap-2 shadow-sm"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Launch Spreadsheet Import Wizard</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => downloadSampleFile()}
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Sample Template (.xlsx)</span>
                  </Button>
                </div>
              </div>

              {/* Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border p-3 bg-card space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Duplicate Protected</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Existing phone numbers across your CRM database are automatically identified and skipped.
                  </p>
                </div>

                <div className="rounded-xl border p-3 bg-card space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <Flame className="h-3.5 w-3.5 text-rose-500" />
                    <span>Auto Priority Tagging</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Urgent or interested leads are categorized as HIGH priority and moved to the front of the queue.
                  </p>
                </div>

                <div className="rounded-xl border p-3 bg-card space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <Database className="h-3.5 w-3.5 text-primary" />
                    <span>Safe Queue Storage</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Leads are safely retained in folder {folderDate}. No leads are lost or overwritten.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: SINGLE LEAD ENTRY */}
            <TabsContent value="single" className="m-0">
              <form onSubmit={handleSingleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Customer Name */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Customer Name <span className="text-muted-foreground font-normal">(Optional)</span>
                    </Label>
                    <Input
                      placeholder="e.g. Rahul Sharma (leave blank for Customer XXXX)"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  {/* Mobile Number */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">
                        Mobile Number <span className="text-destructive">*</span>
                      </Label>
                      {existingLead && (
                        <span className="text-[10px] font-bold text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> Duplicate Mobile!
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        maxLength={10}
                        placeholder="10-digit mobile (e.g. 9876543210)"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                        className={`h-9 pl-9 text-xs font-mono font-semibold ${
                          existingLead ? "border-destructive ring-1 ring-destructive/30" : ""
                        }`}
                        required
                      />
                    </div>
                  </div>

                  {/* Alternate Phone */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Alternate Mobile <span className="text-muted-foreground font-normal">(Optional)</span>
                    </Label>
                    <Input
                      type="tel"
                      maxLength={10}
                      placeholder="Alternate phone number"
                      value={alternateMobile}
                      onChange={(e) => setAlternateMobile(e.target.value.replace(/\D/g, ""))}
                      className="h-9 text-xs font-mono"
                    />
                  </div>

                  {/* Priority Selector */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Priority Level</Label>
                    <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                      <SelectTrigger className="h-9 text-xs font-semibold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIGH">
                          <span className="flex items-center gap-1.5 font-bold text-rose-600 dark:text-rose-400">
                            <Flame className="h-3.5 w-3.5" /> High Priority (Front of Queue)
                          </span>
                        </SelectItem>
                        <SelectItem value="MEDIUM">
                          <span className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                            <Sparkles className="h-3.5 w-3.5" /> Medium Priority (Follow-up)
                          </span>
                        </SelectItem>
                        <SelectItem value="LOW">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-400">
                            <Database className="h-3.5 w-3.5" /> Low Priority (Standard)
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Loan Amount */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Loan Amount (₹)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 500000"
                      value={loanAmount}
                      onChange={(e) => setLoanAmount(e.target.value)}
                      className="h-9 text-xs font-mono"
                    />
                  </div>

                  {/* Loan Type */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Loan Type</Label>
                    <Select value={loanType} onValueChange={setLoanType}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOAN_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* City */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">City</Label>
                    <Input
                      placeholder="e.g. Hyderabad"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  {/* State */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">State</Label>
                    <Input
                      placeholder="e.g. Telangana"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  {/* Folder Date */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Folder Date</Label>
                    <Input
                      type="date"
                      value={folderDate}
                      onChange={(e) => setFolderDate(e.target.value)}
                      className="h-9 text-xs font-semibold"
                    />
                  </div>

                  {/* Lead Source */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Lead Source</Label>
                    <Select value={source} onValueChange={setSource}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_SOURCES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Notes / Customer Requirements</Label>
                  <Textarea
                    rows={2}
                    placeholder="Enter any initial notes, specific requirements or remarks..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetSingleForm}
                    disabled={savingSingle}
                  >
                    Reset
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="gradient-brand text-white font-bold gap-1.5 shadow-sm"
                    disabled={savingSingle || Boolean(existingLead) || !mobile}
                  >
                    {savingSingle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
                    <span>Add to Queue</span>
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
