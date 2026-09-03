import { useEffect, useState } from "react";
import {
  Building2, CreditCard, Flame, Landmark, Loader2, Plus, Trash2,
  CalendarClock, CheckCircle2, User, Phone, MapPin, Briefcase, Clock,
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
  CARD_ISSUERS, TOP_BANKS, parseInterestedData, serializeInterestedData,
  type ExistingCreditCard, type ExistingLoan, type InterestedLeadData,
} from "@/lib/interested-lead";
import { LOAN_TYPES, type Lead } from "@/lib/crm";

interface InterestedLeadDialogProps {
  lead: Lead | null;
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function InterestedLeadDialog({
  lead, employeeId, open, onOpenChange, onSuccess,
}: InterestedLeadDialogProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Form State
  const [serviceRequired, setServiceRequired] = useState("Personal Loan");
  const [requiredAmount, setRequiredAmount] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [employer, setEmployer] = useState("");
  const [serviceYears, setServiceYears] = useState("");

  // Existing Loans
  const [hasExistingLoans, setHasExistingLoans] = useState(false);
  const [loans, setLoans] = useState<ExistingLoan[]>([]);

  // Existing Credit Cards
  const [hasCreditCards, setHasCreditCards] = useState(false);
  const [creditCards, setCreditCards] = useState<ExistingCreditCard[]>([]);

  // Remarks & Follow-up
  const [notes, setNotes] = useState("");
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");

  // Initialize from lead notes if previously recorded
  useEffect(() => {
    if (open && lead) {
      const parsed = parseInterestedData(lead.notes);
      if (parsed) {
        setServiceRequired(parsed.serviceRequired || lead.loan_type || "Personal Loan");
        setRequiredAmount(parsed.requiredAmount || (lead.loan_amount ? String(lead.loan_amount) : ""));
        setMonthlyIncome(parsed.monthlyIncome || (lead.monthly_income ? String(lead.monthly_income) : ""));
        setEmployer(parsed.employer || lead.employer || "");
        setServiceYears(parsed.serviceYears || "");
        setHasExistingLoans(parsed.hasExistingLoans);
        setLoans(parsed.loans || []);
        setHasCreditCards(parsed.hasCreditCards);
        setCreditCards(parsed.creditCards || []);
        setNotes(parsed.notes || "");
      } else {
        setServiceRequired(lead.loan_type || "Personal Loan");
        setRequiredAmount(lead.loan_amount ? String(lead.loan_amount) : "");
        setMonthlyIncome(lead.monthly_income ? String(lead.monthly_income) : "");
        setEmployer(lead.employer || "");
        setServiceYears("");
        setHasExistingLoans(false);
        setLoans([{ bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" }]);
        setHasCreditCards(false);
        setCreditCards([{ bank: "HDFC Bank", limit: "", outstanding: "" }]);
        setNotes("");
      }
      setScheduleFollowUp(false);
      setFollowUpDate("");
      setFollowUpTime("");
    }
  }, [open, lead?.id]);

  // Handlers for Loans
  const addLoan = () => {
    setHasExistingLoans(true);
    setLoans((prev) => [...prev, { bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" }]);
  };
  const removeLoan = (index: number) => {
    setLoans((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setHasExistingLoans(false);
      return next;
    });
  };
  const updateLoan = (index: number, field: keyof ExistingLoan, value: string) => {
    setLoans((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  // Handlers for Credit Cards
  const addCreditCard = () => {
    setHasCreditCards(true);
    setCreditCards((prev) => [...prev, { bank: "HDFC Bank", limit: "", outstanding: "" }]);
  };
  const removeCreditCard = (index: number) => {
    setCreditCards((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setHasCreditCards(false);
      return next;
    });
  };
  const updateCreditCard = (index: number, field: keyof ExistingCreditCard, value: string) => {
    setCreditCards((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const handleSave = async () => {
    if (!lead) return;
    setBusy(true);

    try {
      const interestedData: InterestedLeadData = {
        serviceRequired,
        requiredAmount: requiredAmount || undefined,
        monthlyIncome: monthlyIncome || undefined,
        employer: employer || undefined,
        serviceYears: serviceYears.trim() || undefined,
        hasExistingLoans,
        loansCount: hasExistingLoans ? loans.length : 0,
        loans: hasExistingLoans ? loans : [],
        hasCreditCards,
        cardsCount: hasCreditCards ? creditCards.length : 0,
        creditCards: hasCreditCards ? creditCards : [],
        notes: notes.trim() || undefined,
      };

      const serializedNotes = serializeInterestedData(interestedData, notes);
      const now = new Date().toISOString();

      // 1. Update the lead
      const parsedReqAmount = Number(requiredAmount.replace(/\D/g, "")) || Number(lead.loan_amount) || 0;
      const parsedIncome = Number(monthlyIncome.replace(/\D/g, "")) || lead.monthly_income || null;

      const { error: leadErr } = await supabase.from("leads").update({
        status: "Interested",
        loan_type: serviceRequired || lead.loan_type,
        loan_amount: parsedReqAmount,
        monthly_income: parsedIncome,
        employer: employer || lead.employer,
        notes: serializedNotes,
        last_call_at: now,
      }).eq("id", lead.id);

      if (leadErr) throw leadErr;

      // 2. Log in call_history
      const { error: callErr } = await supabase.from("call_history").insert({
        lead_id: lead.id,
        company_id: lead.company_id,
        employee_id: employeeId,
        call_result: "Connected",
        customer_response: "Interested",
        status: "Interested",
        notes: `Customer accepted service: ${serviceRequired}. ${hasExistingLoans ? `${loans.length} loans` : "No loans"}, ${hasCreditCards ? `${creditCards.length} cards` : "No cards"}. Experience: ${serviceYears || "N/A"} yrs. ${notes || ""}`,
      });
      if (callErr) console.warn("Call history note error:", callErr);

      // 3. Optional Follow-up
      if (scheduleFollowUp && followUpDate) {
        await supabase.from("follow_ups").insert({
          lead_id: lead.id,
          company_id: lead.company_id,
          employee_id: employeeId,
          follow_up_date: followUpDate,
          follow_up_time: followUpTime || null,
          note: `Interested lead follow-up: ${serviceRequired} for ₹${parsedReqAmount.toLocaleString("en-IN")}`,
        });
      }

      toast.success("🎉 Customer Accepted Service! Lead saved to Interested.", {
        description: `Logged ${hasExistingLoans ? `${loans.length} loan(s)` : "no loans"} and ${hasCreditCards ? `${creditCards.length} card(s)` : "no cards"}.`,
      });

      await qc.invalidateQueries();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error("[interested-dialog] failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to save interested details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/20 text-success">
              <Flame className="h-5 w-5 fill-success" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold">Customer Accepted Service</DialogTitle>
              <DialogDescription className="text-xs">
                Capture existing loans, bank names, credit card details, and service years.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {lead && (
          <div className="rounded-xl border bg-muted/30 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <User className="h-3.5 w-3.5 text-brand" /> {lead.customer_name}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" /> {lead.mobile}
            </div>
            {lead.city && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {lead.city}
              </div>
            )}
          </div>
        )}

        <div className="space-y-6 pt-2">
          {/* SECTION 1: Required Service & Employment */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-brand flex items-center gap-1.5">
              <Landmark className="h-4 w-4" /> 1. Requirement & Employment Details
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Required Service / Loan Type</Label>
                <Select value={serviceRequired} onValueChange={setServiceRequired}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                    <SelectItem value="Balance Transfer">Balance Transfer</SelectItem>
                    <SelectItem value="Debt Consolidation">Debt Consolidation</SelectItem>
                    <SelectItem value="Credit Card Settlement">Credit Card Settlement</SelectItem>
                    <SelectItem value="Loan Top-up">Loan Top-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Required Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 500000"
                  value={requiredAmount}
                  onChange={(e) => setRequiredAmount(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Monthly Income (₹, optional)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 45000"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Employer / Business Name (optional)</Label>
                <Input
                  placeholder="e.g. TCS / Self Employed"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              {/* Service Years of Employee / Applicant */}
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5 text-brand" /> Service Years / Work Experience
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="e.g. 3.5"
                    value={serviceYears}
                    onChange={(e) => setServiceYears(e.target.value)}
                    className="h-9 text-xs"
                  />
                  <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Years in Service</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Existing Loans */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" /> 2. Existing Loans
                </p>
                <p className="text-[11px] text-muted-foreground">Does the customer currently have loans from any bank?</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={addLoan}
                  className="h-7 text-xs font-bold text-amber-500 hover:bg-amber-500/10 border-amber-500/30"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Loan (+)
                </Button>
                <Switch
                  checked={hasExistingLoans}
                  onCheckedChange={(checked) => {
                    setHasExistingLoans(checked);
                    if (checked && loans.length === 0) {
                      setLoans([{ bank: "HDFC Bank", loanType: "Personal Loan", amount: "", emi: "" }]);
                    }
                  }}
                />
              </div>
            </div>

            {hasExistingLoans && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-1">
                  <span>List of existing loans ({loans.length})</span>
                  <Button size="sm" variant="outline" onClick={addLoan} className="h-7 text-xs font-bold text-amber-600 bg-amber-500/10 hover:bg-amber-500/20">
                    <Plus className="mr-1 h-3.5 w-3.5" /> + Add Another Loan
                  </Button>
                </div>

                {loans.map((loan, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted-foreground">Loan #{idx + 1}</span>
                      {loans.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeLoan(idx)}
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Bank / Lender</Label>
                        <Select value={loan.bank} onValueChange={(v) => updateLoan(idx, "bank", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select bank" /></SelectTrigger>
                          <SelectContent className="max-h-56">
                            {TOP_BANKS.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px]">Loan Type</Label>
                        <Select value={loan.loanType} onValueChange={(v) => updateLoan(idx, "loanType", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Loan type" /></SelectTrigger>
                          <SelectContent>
                            {LOAN_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px]">Loan / Outstanding Amount (₹)</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 200000"
                          value={loan.amount || ""}
                          onChange={(e) => updateLoan(idx, "amount", e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px]">Monthly EMI (₹, optional)</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 7500"
                          value={loan.emi || ""}
                          onChange={(e) => updateLoan(idx, "emi", e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Big Plus Button to Add Another Loan */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addLoan}
                  className="w-full h-10 border-dashed border-amber-500/40 text-amber-500 font-bold hover:bg-amber-500/10 text-xs"
                >
                  <Plus className="mr-1.5 h-4 w-4" /> + Add Another Loan
                </Button>
              </div>
            )}
          </div>

          {/* SECTION 3: Existing Credit Cards */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-sky-500 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4" /> 3. Existing Credit Cards
                </p>
                <p className="text-[11px] text-muted-foreground">Does the customer have credit cards from any bank?</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={addCreditCard}
                  className="h-7 text-xs font-bold text-sky-500 hover:bg-sky-500/10 border-sky-500/30"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Card (+)
                </Button>
                <Switch
                  checked={hasCreditCards}
                  onCheckedChange={(checked) => {
                    setHasCreditCards(checked);
                    if (checked && creditCards.length === 0) {
                      setCreditCards([{ bank: "HDFC Bank", limit: "", outstanding: "" }]);
                    }
                  }}
                />
              </div>
            </div>

            {hasCreditCards && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-1">
                  <span>List of credit cards ({creditCards.length})</span>
                  <Button size="sm" variant="outline" onClick={addCreditCard} className="h-7 text-xs font-bold text-sky-600 bg-sky-500/10 hover:bg-sky-500/20">
                    <Plus className="mr-1 h-3.5 w-3.5" /> + Add Another Card
                  </Button>
                </div>

                {creditCards.map((card, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted-foreground">Credit Card #{idx + 1}</span>
                      {creditCards.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeCreditCard(idx)}
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="space-y-1 sm:col-span-1">
                        <Label className="text-[11px]">Bank / Issuer</Label>
                        <Select value={card.bank} onValueChange={(v) => updateCreditCard(idx, "bank", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select bank" /></SelectTrigger>
                          <SelectContent className="max-h-56">
                            {CARD_ISSUERS.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1 sm:col-span-1">
                        <Label className="text-[11px]">Total Limit (₹, optional)</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 100000"
                          value={card.limit || ""}
                          onChange={(e) => updateCreditCard(idx, "limit", e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1 sm:col-span-1">
                        <Label className="text-[11px]">Outstanding Dues (₹, optional)</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 25000"
                          value={card.outstanding || ""}
                          onChange={(e) => updateCreditCard(idx, "outstanding", e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Big Plus Button to Add Another Card */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCreditCard}
                  className="w-full h-10 border-dashed border-sky-500/40 text-sky-500 font-bold hover:bg-sky-500/10 text-xs"
                >
                  <Plus className="mr-1.5 h-4 w-4" /> + Add Another Credit Card
                </Button>
              </div>
            )}
          </div>

          {/* SECTION 4: Notes & Follow-up */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Agent Notes & Remarks</Label>
              <Textarea
                rows={2}
                placeholder="What did the customer confirm? Any special requirements or documents promised?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="pt-2 border-t flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-brand" />
                <Label className="text-xs cursor-pointer" htmlFor="fu-check">Schedule a follow-up callback</Label>
              </div>
              <Switch id="fu-check" checked={scheduleFollowUp} onCheckedChange={setScheduleFollowUp} />
            </div>

            {scheduleFollowUp && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px]">Follow-up Date</Label>
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Follow-up Time</Label>
                  <Input
                    type="time"
                    value={followUpTime}
                    onChange={(e) => setFollowUpTime(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t pt-4 flex flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-10">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={busy}
            className="h-10 font-bold bg-success hover:bg-success/90 text-white shadow-md flex-1 sm:flex-none"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save & Accept Service (Mark Interested)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
