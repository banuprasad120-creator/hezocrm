import { useState } from "react";
import {
  Building2, CreditCard, Flame, Landmark, Loader2, Plus, Trash2,
  CalendarClock, User, Phone, MapPin, Briefcase,
  ShieldCheck, Wallet, Sparkles, CheckCircle2,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  CARD_ISSUERS, TOP_BANKS, getDefaultDocuments, serializeInterestedData,
  type ExistingCreditCard, type ExistingLoan, type InterestedLeadData,
} from "@/lib/interested-lead";
import { LOAN_TYPES } from "@/lib/crm";
import { createInterestedCandidateServerFn } from "@/lib/crm.functions";

interface CreateInterestedCandidateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
  employeeId: string | null;
  onSuccess?: (leadId: string) => void;
}

export function CreateInterestedCandidateDialog({
  open,
  onOpenChange,
  companyId,
  employeeId,
  onSuccess,
}: CreateInterestedCandidateDialogProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Candidate Basic Details
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [city, setCity] = useState("");

  // Requirement State
  const [serviceRequired, setServiceRequired] = useState("Personal Loan");
  const [requiredAmount, setRequiredAmount] = useState("");

  // Employment & Banking Profile
  const [employmentType, setEmploymentType] = useState("Salaried");
  const [salaryBank, setSalaryBank] = useState("HDFC Bank");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [employer, setEmployer] = useState("");
  const [cibilScore, setCibilScore] = useState("");

  // Existing Loans & Credit Cards
  const [hasExistingLoans, setHasExistingLoans] = useState(false);
  const [loans, setLoans] = useState<ExistingLoan[]>([
    { bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" },
  ]);

  const [hasCreditCards, setHasCreditCards] = useState(false);
  const [creditCards, setCreditCards] = useState<ExistingCreditCard[]>([
    { bank: "HDFC Bank", limit: "", outstanding: "" },
  ]);

  // Remarks & Follow-up
  const [notes, setNotes] = useState("");
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");

  const resetForm = () => {
    setCustomerName("");
    setMobile("");
    setCity("");
    setServiceRequired("Personal Loan");
    setRequiredAmount("");
    setEmploymentType("Salaried");
    setSalaryBank("HDFC Bank");
    setMonthlyIncome("");
    setEmployer("");
    setCibilScore("");
    setHasExistingLoans(false);
    setLoans([{ bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" }]);
    setHasCreditCards(false);
    setCreditCards([{ bank: "HDFC Bank", limit: "", outstanding: "" }]);
    setNotes("");
    setScheduleFollowUp(false);
    setFollowUpDate("");
    setFollowUpTime("");
  };

  const handleAddLoan = () => {
    setHasExistingLoans(true);
    setLoans((prev) => [...prev, { bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" }]);
  };

  const handleRemoveLoan = (idx: number) => {
    setLoans((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) setHasExistingLoans(false);
      return next;
    });
  };

  const handleAddCard = () => {
    setHasCreditCards(true);
    setCreditCards((prev) => [...prev, { bank: "HDFC Bank", limit: "", outstanding: "" }]);
  };

  const handleRemoveCard = (idx: number) => {
    setCreditCards((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) setHasCreditCards(false);
      return next;
    });
  };

  const handleSave = async () => {
    if (!customerName.trim()) {
      return toast.error("Please enter the candidate's full name");
    }
    if (!mobile.trim()) {
      return toast.error("Please enter the candidate's mobile number");
    }
    if (!companyId || !employeeId) {
      return toast.error("Session information missing. Please refresh and try again.");
    }

    setBusy(true);
    try {
      const result = await createInterestedCandidateServerFn({
        data: {
          companyId,
          customerName: customerName.trim(),
          mobile: mobile.trim(),
          city: city.trim() || null,
          serviceRequired,
          requiredAmount: requiredAmount || null,
          employmentType,
          salaryBank: employmentType === "Salaried" ? salaryBank : null,
          cibilScore: cibilScore.trim() || null,
          monthlyIncome: monthlyIncome || null,
          employer: employer.trim() || null,
          hasExistingLoans,
          loans: hasExistingLoans ? loans : [],
          hasCreditCards,
          creditCards: hasCreditCards ? creditCards : [],
          documents: getDefaultDocuments(
            employmentType,
            serviceRequired,
            hasExistingLoans
          ),
          notes: notes.trim() || null,
          scheduleFollowUp,
          followUpDate: followUpDate || null,
          followUpTime: followUpTime || null,
        },
      });

      toast.success(`🎉 Interested candidate "${customerName.trim()}" successfully added!`);
      qc.invalidateQueries({ queryKey: ["my-leads"] });
      qc.invalidateQueries({ queryKey: ["interested-leads"] });
      qc.invalidateQueries({ queryKey: ["my-followups-open"] });
      qc.invalidateQueries({ queryKey: ["agent-lead-counts"] });
      qc.invalidateQueries({ queryKey: ["daily-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });

      resetForm();
      onOpenChange(false);
      onSuccess?.(result.leadId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create interested candidate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/15 text-amber-500 shadow-sm">
              <Flame className="h-6 w-6" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold">Add Interested Candidate</DialogTitle>
              <DialogDescription className="text-xs">
                Directly add a new interested client with their service requirement, banking details, and profile.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* 1. Basic Candidate Info */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <User className="h-3.5 w-3.5 text-brand" /> 1. Candidate Details
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Full Name *</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Rahul Sharma"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Mobile Number *</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="e.g. 9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">City / Location</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Hyderabad, Bangalore, Mumbai"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 2. Requirement & Loan Details */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5 text-brand" /> 2. Requirement & Profile
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Service / Product Needed</Label>
                <Select value={serviceRequired} onValueChange={setServiceRequired}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>
                        {lt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Required Amount (₹)</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="e.g. 500000"
                  value={requiredAmount}
                  onChange={(e) => setRequiredAmount(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salaried">Salaried</SelectItem>
                    <SelectItem value="Self-Employed">Self-Employed</SelectItem>
                    <SelectItem value="Business">Business Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Monthly Net Income (₹)</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="e.g. 45000"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">Salary / Main Bank</Label>
                <Select value={salaryBank} onValueChange={setSalaryBank}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOP_BANKS.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Employer / Company Name</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Infosys, TCS, Private Ltd."
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">CIBIL Score (Approx)</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="e.g. 750"
                  value={cibilScore}
                  onChange={(e) => setCibilScore(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 3. Existing Obligations Toggle */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5 text-brand" /> 3. Existing Loans & Cards (Optional)
            </h4>

            {/* Existing Loans Switch */}
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Has Existing Loans / EMIs?</p>
                <p className="text-[11px] text-muted-foreground">Record current active loan liabilities</p>
              </div>
              <Switch checked={hasExistingLoans} onCheckedChange={setHasExistingLoans} />
            </div>

            {hasExistingLoans && (
              <div className="space-y-2.5 pt-1">
                {loans.map((loan, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-muted/40 p-2.5 rounded-lg text-xs relative">
                    <div>
                      <Label className="text-[11px]">Bank</Label>
                      <Select value={loan.bank} onValueChange={(val) => setLoans((p) => p.map((l, i) => (i === idx ? { ...l, bank: val } : l)))}>
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TOP_BANKS.map((b) => (
                            <SelectItem key={b} value={b}>{b}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Loan Amount (₹)</Label>
                      <Input
                        className="h-8 text-xs font-mono mt-1"
                        placeholder="300000"
                        value={loan.amount}
                        onChange={(e) => setLoans((p) => p.map((l, i) => (i === idx ? { ...l, amount: e.target.value } : l)))}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-[11px]">Monthly EMI (₹)</Label>
                        <Input
                          className="h-8 text-xs font-mono mt-1"
                          placeholder="8500"
                          value={loan.emi}
                          onChange={(e) => setLoans((p) => p.map((l, i) => (i === idx ? { ...l, emi: e.target.value } : l)))}
                        />
                      </div>
                      {loans.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-500/10 shrink-0"
                          onClick={() => handleRemoveLoan(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddLoan}>
                  <Plus className="mr-1 h-3 w-3" /> Add Another Loan
                </Button>
              </div>
            )}

            {/* Existing Credit Cards Switch */}
            <div className="flex items-center justify-between border-t border-b py-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Has Existing Credit Cards?</p>
                <p className="text-[11px] text-muted-foreground">Record current credit card limits and usage</p>
              </div>
              <Switch checked={hasCreditCards} onCheckedChange={setHasCreditCards} />
            </div>

            {hasCreditCards && (
              <div className="space-y-2.5 pt-1">
                {creditCards.map((card, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-muted/40 p-2.5 rounded-lg text-xs relative">
                    <div>
                      <Label className="text-[11px]">Card Issuer</Label>
                      <Select value={card.bank} onValueChange={(val) => setCreditCards((p) => p.map((c, i) => (i === idx ? { ...c, bank: val } : c)))}>
                        <SelectTrigger className="h-8 text-xs mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CARD_ISSUERS.map((b) => (
                            <SelectItem key={b} value={b}>{b}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Limit (₹)</Label>
                      <Input
                        className="h-8 text-xs font-mono mt-1"
                        placeholder="100000"
                        value={card.limit}
                        onChange={(e) => setCreditCards((p) => p.map((c, i) => (i === idx ? { ...c, limit: e.target.value } : c)))}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-[11px]">Outstanding (₹)</Label>
                        <Input
                          className="h-8 text-xs font-mono mt-1"
                          placeholder="25000"
                          value={card.outstanding}
                          onChange={(e) => setCreditCards((p) => p.map((c, i) => (i === idx ? { ...c, outstanding: e.target.value } : c)))}
                        />
                      </div>
                      {creditCards.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-500/10 shrink-0"
                          onClick={() => handleRemoveCard(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddCard}>
                  <Plus className="mr-1 h-3 w-3" /> Add Another Card
                </Button>
              </div>
            )}
          </div>

          {/* 4. Notes & Follow-up */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 text-brand" /> 4. Remarks & Follow-up
            </h4>
            <div>
              <Label className="text-xs">Customer Remarks / Discussion Notes</Label>
              <Textarea
                className="mt-1 text-xs"
                rows={2}
                placeholder="Key requirements, discussion points, callback notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-warning" />
                <Label htmlFor="sched-fu" className="text-xs cursor-pointer font-semibold">
                  Schedule Follow-up Call
                </Label>
              </div>
              <Switch id="sched-fu" checked={scheduleFollowUp} onCheckedChange={setScheduleFollowUp} />
            </div>

            {scheduleFollowUp && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <Label className="text-[11px]">Follow-up Date *</Label>
                  <Input
                    type="date"
                    className="mt-1 h-8 text-xs"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Time</Label>
                  <Input
                    type="time"
                    className="mt-1 h-8 text-xs"
                    value={followUpTime}
                    onChange={(e) => setFollowUpTime(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="gradient-brand text-white font-bold"
            size="sm"
            disabled={busy || !customerName.trim() || !mobile.trim()}
            onClick={handleSave}
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Flame className="mr-1.5 h-4 w-4 fill-white" />}
            Save Interested Candidate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
