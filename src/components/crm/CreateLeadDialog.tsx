import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Building2, CheckCircle2, ChevronRight, Contact, DollarSign,
  FileText, Loader2, Phone, Plus, Sparkles, User, UserCheck, UserPlus
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAgents } from "@/hooks/use-crm-session";
import { LOAN_TYPES, todayISO } from "@/lib/crm";
import { createLeadServerFn } from "@/lib/crm.functions";

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

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
  adminUserId?: string | null;
  employeeId?: string | null;
  isAgentMode?: boolean;
  defaultFolderDate?: string;
  onSuccess?: () => void;
}

export function CreateLeadDialog({
  open,
  onOpenChange,
  companyId,
  adminUserId,
  employeeId,
  isAgentMode = false,
  defaultFolderDate,
  onSuccess,
}: CreateLeadDialogProps) {
  const qc = useQueryClient();
  const { data: agents = [] } = useAgents(companyId, true);

  const defaultAssignee = isAgentMode && employeeId ? employeeId : "unassigned";

  const [saving, setSaving] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [city, setCity] = useState("");
  const [loanType, setLoanType] = useState<string>("Personal Loan");
  const [loanAmount, setLoanAmount] = useState<string>("");
  const [monthlyIncome, setMonthlyIncome] = useState<string>("");
  const [employer, setEmployer] = useState<string>("");
  const [employmentType, setEmploymentType] = useState<string>("Salaried");
  const [source, setSource] = useState<string>("External Lead / Direct");
  const [assignedTo, setAssignedTo] = useState<string>(defaultAssignee);
  const [folderDate, setFolderDate] = useState<string>(defaultFolderDate || todayISO());
  const [notes, setNotes] = useState("");

  // Update assignedTo whenever isAgentMode / employeeId changes or modal opens
  useState(() => {
    if (isAgentMode && employeeId) setAssignedTo(employeeId);
  });

  // Live duplicate check when mobile is entered (at least 8 digits)
  const cleanMobile = mobile.replace(/\D/g, "");
  const { data: existingLead } = useQuery({
    queryKey: ["check-duplicate-mobile", companyId, cleanMobile],
    enabled: Boolean(companyId && cleanMobile.length >= 8),
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

  const resetForm = () => {
    setCustomerName("");
    setMobile("");
    setCity("");
    setLoanType("Personal Loan");
    setLoanAmount("");
    setMonthlyIncome("");
    setEmployer("");
    setEmploymentType("Salaried");
    setSource("External Lead / Direct");
    setAssignedTo(isAgentMode && employeeId ? employeeId : "unassigned");
    setFolderDate(defaultFolderDate || todayISO());
    setNotes("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) {
      toast.error("Company identification missing");
      return;
    }

    const trimmedName = customerName.trim();
    const digitsOnly = mobile.replace(/\D/g, "");

    if (!trimmedName) {
      toast.error("Please enter the customer's full name");
      return;
    }

    if (digitsOnly.length < 10) {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }

    setSaving(true);
    try {
      const isAssigned = assignedTo !== "unassigned" && Boolean(assignedTo);
      const parsedAmount = loanAmount ? Number(loanAmount) : 0;
      const parsedIncome = monthlyIncome ? Number(monthlyIncome) : null;
      const formattedNotes = notes.trim()
        ? `[Added Manually - ${source}]: ${notes.trim()}`
        : `[Added Manually - ${source}]`;

      await createLeadServerFn({
        data: {
          companyId,
          customerName: trimmedName,
          mobile: digitsOnly,
          city: city.trim() || null,
          loanType,
          loanAmount: parsedAmount,
          monthlyIncome: parsedIncome,
          employer: employer.trim() || null,
          employmentType: employmentType || "Salaried",
          source: source || "External Lead / Direct",
          folderDate: folderDate || todayISO(),
          notes: formattedNotes,
          assignedTo: isAssigned ? assignedTo : null,
        },
      });

      const assignedAgent = agents.find((a) => a.id === assignedTo);
      toast.success(
        isAssigned
          ? `Lead added & assigned to ${assignedAgent?.full_name || assignedAgent?.email || "Agent"}!`
          : "New lead added to company pipeline!"
      );

      // Refresh relevant data
      qc.invalidateQueries({ queryKey: ["all-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads-stats"] });
      qc.invalidateQueries({ queryKey: ["agent-lead-counts"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["unassigned-leads-count"] });
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["interested-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error("Error creating lead:", err);
      toast.error("Failed to add lead", {
        description: err instanceof Error ? err.message : "Please check database permissions",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-base sm:text-lg">Add New Lead (External / Direct)</DialogTitle>
              <DialogDescription className="text-xs">
                Manually register an incoming client into the CRM and send directly to an agent.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1 text-xs sm:text-sm">
          {/* Duplicate Mobile Banner */}
          {existingLead && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Note: A lead with this mobile already exists!</p>
                <p className="mt-0.5 text-[11px] opacity-90">
                  Customer: <strong>{existingLead.customer_name}</strong> · Status:{" "}
                  <strong>{existingLead.status}</strong> · Folder: {existingLead.folder_date}
                </p>
              </div>
            </div>
          )}

          {/* Section 1: Customer Profile */}
          <div className="rounded-xl border bg-muted/20 p-3 sm:p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Contact className="h-3.5 w-3.5 text-brand" /> Customer Profile
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Customer Full Name <span className="text-destructive">*</span></Label>
                <Input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="h-9 bg-card"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Mobile Number <span className="text-destructive">*</span></Label>
                <Input
                  required
                  type="tel"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                  placeholder="10-digit mobile (e.g. 9876543210)"
                  className="h-9 bg-card font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">City / Location</Label>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai, Bengaluru, Delhi"
                  className="h-9 bg-card"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Lead Source / Origin</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-9 bg-card text-xs">
                    <SelectValue placeholder="Select Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Section 2: Requirement & Financials */}
          <div className="rounded-xl border bg-muted/20 p-3 sm:p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-brand" /> Requirement & Income
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Service / Loan Type</Label>
                <Select value={loanType} onValueChange={setLoanType}>
                  <SelectTrigger className="h-9 bg-card text-xs">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Required Amount (₹)</Label>
                <Input
                  type="number"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  placeholder="e.g. 500000"
                  className="h-9 bg-card font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger className="h-9 bg-card text-xs">
                    <SelectValue placeholder="Employment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salaried">Salaried</SelectItem>
                    <SelectItem value="Self-Employed">Self-Employed</SelectItem>
                    <SelectItem value="Business Owner">Business Owner</SelectItem>
                    <SelectItem value="Professional / Doctor / CA">Professional / Doctor / CA</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Monthly Income (₹)</Label>
                <Input
                  type="number"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                  placeholder="e.g. 65000"
                  className="h-9 bg-card font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Company / Employer</Label>
                <Input
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  placeholder="e.g. TCS, Infosys, Self"
                  className="h-9 bg-card"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Agent Allocation & Pipeline */}
          <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 sm:p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-brand flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5" /> Pipeline & Assignment
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isAgentMode ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Pipeline Assignment</Label>
                  <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-brand/30 bg-card text-xs font-semibold text-brand">
                    <CheckCircle2 className="h-4 w-4 text-brand shrink-0" />
                    <span className="truncate">Assigned directly to Your Workspace</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Send / Assign Directly To Agent
                  </Label>
                  <Select value={assignedTo} onValueChange={setAssignedTo}>
                    <SelectTrigger className="h-9 bg-card font-medium text-xs">
                      <SelectValue placeholder="Select Agent or Leave Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned" className="text-muted-foreground font-normal">
                        ⚠️ Unassigned (General Lead Pool)
                      </SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="font-medium">
                          👤 {a.full_name || a.email} {a.phone ? `(${a.phone})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Folder Date / Batch</Label>
                <Input
                  type="date"
                  value={folderDate}
                  onChange={(e) => setFolderDate(e.target.value)}
                  className="h-9 bg-card"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Initial Notes / Requirement Details</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Mention customer requirements, caller comments, or referral details..."
                className="bg-card text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !customerName.trim() || cleanMobile.length < 10}
              className="gradient-brand text-white font-bold gap-1.5 shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span>{assignedTo !== "unassigned" ? "Create & Send to Agent" : "Create Lead"}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
