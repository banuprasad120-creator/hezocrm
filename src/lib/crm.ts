import type { Database } from "@/integrations/supabase/types";

export type LeadStatus = Database["public"]["Enums"]["lead_status"];
export type CallResult = Database["public"]["Enums"]["call_result"];
export type CustomerResponse = Database["public"]["Enums"]["customer_response"];
export type AppRole = Database["public"]["Enums"]["app_role"];
export type Lead = Database["public"]["Tables"]["leads"]["Row"];
export type CallRecord = Database["public"]["Tables"]["call_history"]["Row"];
export type FollowUp = Database["public"]["Tables"]["follow_ups"]["Row"];

export const LEAD_STATUSES: LeadStatus[] = [
  "New", "Assigned", "Contacted", "Interested", "Follow-up", "Documents Pending",
  "Application Submitted", "Processing", "Approved", "Disbursed",
  "Not Interested", "Not Eligible", "Wrong Number", "No Response", "Closed",
];

export const CALL_RESULTS: CallResult[] = ["Connected", "No Answer", "Busy", "Switched Off", "Wrong Number"];

export const CUSTOMER_RESPONSES: CustomerResponse[] = [
  "Interested", "Not Interested", "Follow-up Required", "Documents Required", "Application Submitted", "Other",
];

export const LOAN_TYPES = [
  "Personal Loan", "Home Loan", "Business Loan", "Auto Loan", "Gold Loan",
  "Loan Against Property", "Credit Card", "Insurance",
];

export const CONTACTED_STATUSES: LeadStatus[] = [
  "Contacted", "Interested", "Follow-up", "Documents Pending", "Application Submitted",
  "Processing", "Approved", "Disbursed", "Not Interested", "Not Eligible", "Wrong Number", "No Response", "Closed",
];

export function statusTone(status: LeadStatus): string {
  switch (status) {
    case "New":
    case "Assigned":
      return "bg-brand/15 text-brand ring-brand/25";
    case "Interested":
    case "Approved":
    case "Disbursed":
      return "bg-success/15 text-success ring-success/25";
    case "Follow-up":
    case "Documents Pending":
    case "Processing":
      return "bg-warning/20 text-warning ring-warning/30";
    case "Contacted":
    case "Application Submitted":
      return "bg-info/15 text-info ring-info/25";
    case "Not Interested":
    case "Not Eligible":
    case "Wrong Number":
    case "No Response":
      return "bg-destructive/15 text-destructive ring-destructive/25";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

export function inr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Formats phone number to international WhatsApp format (+91 for India) */
export function formatWhatsAppPhone(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  return digits;
}

/** Generates direct WhatsApp chat URL that opens the conversation and pre-fills message text */
export function getWhatsAppUrl(rawPhone?: string | null, text?: string): string {
  const phone = formatWhatsAppPhone(rawPhone);
  if (!phone) return "https://api.whatsapp.com";
  if (text) {
    return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
  }
  return `https://api.whatsapp.com/send?phone=${phone}`;
}
