import * as XLSX from "xlsx";
import { LOAN_TYPES } from "@/lib/crm";

export type HezoField =
  | "customer_name" | "mobile" | "alternate_mobile" | "location" | "city" | "state"
  | "employment_type" | "employer" | "monthly_income" | "loan_amount" | "loan_type"
  | "source" | "notes" | "email" | "date_of_birth" | "pan" | "pincode";

export const FIELD_DEFS: { key: HezoField; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "customer_name", label: "Customer Name", required: true, aliases: ["customer name", "customer", "name", "full name", "client name", "lead name", "applicant"] },
  { key: "mobile", label: "Mobile Number", required: true, aliases: ["mobile number", "mobile", "phone", "phone number", "contact", "contact number", "mobile no", "phone no", "cell"] },
  { key: "alternate_mobile", label: "Alternate Mobile", aliases: ["alternate mobile", "alt mobile", "alternate number", "secondary mobile", "alternate phone", "mobile 2"] },
  { key: "location", label: "Location", aliases: ["location", "area", "locality"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "region"] },
  { key: "employment_type", label: "Employment Type", aliases: ["employment type", "employment", "occupation", "job type", "profession"] },
  { key: "employer", label: "Company / Employer", aliases: ["company", "employer", "company name", "company / employer", "organisation", "organization", "working at"] },
  { key: "monthly_income", label: "Monthly Income", aliases: ["monthly income", "income", "salary", "net salary", "monthly salary"] },
  { key: "loan_amount", label: "Required Loan Amount", aliases: ["required loan amount", "loan amount", "amount", "requirement", "required amount", "loan req"] },
  { key: "loan_type", label: "Loan Type", aliases: ["loan type", "product", "loan", "product type"] },
  { key: "source", label: "Lead Source", aliases: ["lead source", "source", "campaign", "channel", "vendor"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "remark", "remarks", "comment", "comments"] },
  { key: "email", label: "Email", aliases: ["email", "email id", "e-mail", "mail"] },
  { key: "date_of_birth", label: "Date of Birth", aliases: ["date of birth", "dob", "birth date", "birthdate"] },
  { key: "pan", label: "PAN", aliases: ["pan", "pan number", "pan card", "pan no"] },
  { key: "pincode", label: "Pincode", aliases: ["pincode", "pin code", "pin", "zip", "zipcode", "postal code"] },
];

export const REQUIRED_FIELDS: HezoField[] = ["customer_name", "mobile"];

export const SAMPLE_HEADERS = FIELD_DEFS.map((f) => f.label);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function autoMap(headers: string[]): Record<number, HezoField | ""> {
  const map: Record<number, HezoField | ""> = {};
  const used = new Set<HezoField>();
  headers.forEach((h, i) => {
    const n = norm(h);
    const hit = FIELD_DEFS.find((f) => !used.has(f.key) && (norm(f.label) === n || f.aliases.includes(n)))
      ?? FIELD_DEFS.find((f) => !used.has(f.key) && n.length > 2 && f.aliases.some((a) => n.includes(a) || a.includes(n)));
    if (hit) { map[i] = hit.key; used.add(hit.key); } else map[i] = "";
  });
  return map;
}

/** Excel cells arrive as strings, numbers, or scientific notation ("9.87654E+09"). */
export function normalizeMobile(raw: unknown): { value: string; error?: string } {
  if (raw === null || raw === undefined || raw === "") return { value: "", error: "Mobile number required" };
  let s = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : raw.toFixed(0)) : String(raw).trim();
  if (/^[\d.]+e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toFixed(0);
  }
  let digits = s.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(digits.length - 10);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) return { value: digits, error: "Invalid mobile number" };
  if (!/^[6-9]\d{9}$/.test(digits)) return { value: digits, error: "Invalid Indian mobile number" };
  return { value: digits };
}

function num(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function text(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/\s+/g, " ").trim();
}

function toDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export type ParsedSheet = { headers: string[]; rows: unknown[][]; fileName: string };

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("The file has no sheets");
  const sheet = wb.Sheets[sheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  if (matrix.length === 0) throw new Error("The file is empty");
  const headers = (matrix[0] as unknown[]).map((h) => text(h));
  const rows = matrix.slice(1).filter((r) => (r as unknown[]).some((c) => text(c) !== ""));
  return { headers, rows, fileName: file.name };
}

export type LeadDraft = {
  customer_name: string; mobile: string; alternate_mobile: string | null;
  location: string | null; city: string | null; state: string | null;
  employment_type: string | null; employer: string | null; monthly_income: number | null;
  loan_amount: number; loan_type: string; source: string; notes: string | null;
  email: string | null; date_of_birth: string | null; pan: string | null; pincode: string | null;
};

export type ValidatedRow = {
  rowNumber: number;
  draft: LeadDraft;
  errors: string[];
  duplicateInFile: boolean;
  duplicateExisting: boolean;
};

export type ValidationSummary = {
  rows: ValidatedRow[];
  total: number;
  valid: number;
  errorCount: number;
  duplicateInFile: number;
  duplicateExisting: number;
};

function columnIndexes(mapping: Record<number, HezoField | "">) {
  const colOf = (field: HezoField) => {
    const entry = Object.entries(mapping).find(([, v]) => v === field);
    return entry ? Number(entry[0]) : -1;
  };
  return Object.fromEntries(FIELD_DEFS.map((f) => [f.key, colOf(f.key)])) as Record<HezoField, number>;
}

/**
 * Progressive validation: processes the sheet in chunks and yields to the browser
 * between chunks so a 25,000-row file never blocks the main thread.
 * Duplicate-against-database is applied afterwards via `applyExistingDuplicates`.
 */
export async function buildRowsProgressive(
  parsed: ParsedSheet,
  mapping: Record<number, HezoField | "">,
  chunkSize = 1000,
  onProgress?: (done: number, total: number) => void,
): Promise<ValidatedRow[]> {
  const cols = columnIndexes(mapping);
  const cell = (row: unknown[], field: HezoField) => (cols[field] >= 0 ? row[cols[field]] : "");
  const seen = new Set<string>();
  const out: ValidatedRow[] = [];

  for (let start = 0; start < parsed.rows.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, parsed.rows.length);
    for (let i = start; i < end; i++) {
      const row = parsed.rows[i] as unknown[];
      const errors: string[] = [];
      const name = text(cell(row, "customer_name"));
      if (!name) errors.push("Customer name required");
      const mob = normalizeMobile(cell(row, "mobile"));
      if (mob.error) errors.push(mob.error);

      const loanTypeRaw = text(cell(row, "loan_type"));
      const loanType = LOAN_TYPES.find((t) => t.toLowerCase() === loanTypeRaw.toLowerCase())
        ?? LOAN_TYPES.find((t) => loanTypeRaw && t.toLowerCase().includes(loanTypeRaw.toLowerCase()))
        ?? (loanTypeRaw || "Personal Loan");

      const duplicateInFile = !mob.error && seen.has(mob.value);
      if (!mob.error) seen.add(mob.value);

      const draft: LeadDraft = {
        customer_name: name,
        mobile: mob.value,
        alternate_mobile: normalizeMobile(cell(row, "alternate_mobile")).value || null,
        location: text(cell(row, "location")) || null,
        city: text(cell(row, "city")) || null,
        state: text(cell(row, "state")) || null,
        employment_type: text(cell(row, "employment_type")) || null,
        employer: text(cell(row, "employer")) || null,
        monthly_income: num(cell(row, "monthly_income")),
        loan_amount: num(cell(row, "loan_amount")) ?? 0,
        loan_type: loanType,
        source: text(cell(row, "source")) || "Import",
        notes: text(cell(row, "notes")) || null,
        email: text(cell(row, "email")) || null,
        date_of_birth: toDate(cell(row, "date_of_birth")),
        pan: text(cell(row, "pan")).toUpperCase() || null,
        pincode: text(cell(row, "pincode")) || null,
      };

      out.push({ rowNumber: i + 2, draft, errors, duplicateInFile, duplicateExisting: false });
    }
    onProgress?.(end, parsed.rows.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

export function applyExistingDuplicates(rows: ValidatedRow[], existingMobiles: Set<string>): ValidationSummary {
  for (const r of rows) {
    r.duplicateExisting = r.errors.length === 0 && existingMobiles.has(r.draft.mobile);
  }
  return summarize(rows);
}

export function summarize(rows: ValidatedRow[]): ValidationSummary {
  let valid = 0, errorCount = 0, duplicateInFile = 0, duplicateExisting = 0;
  for (const r of rows) {
    if (r.errors.length > 0) { errorCount++; continue; }
    if (r.duplicateInFile) duplicateInFile++;
    else if (r.duplicateExisting) duplicateExisting++;
    else valid++;
  }
  return { rows, total: rows.length, valid, errorCount, duplicateInFile, duplicateExisting };
}


export function downloadSampleFile() {
  const rows = [
    SAMPLE_HEADERS,
    ["Ravi Kumar", "9876543210", "9812345678", "Andheri East", "Mumbai", "Maharashtra", "Salaried", "Infosys Ltd", 65000, 500000, "Personal Loan", "Facebook", "Wants quick disbursal", "ravi@example.com", "1990-04-12", "ABCDE1234F", "400069"],
    ["Suresh Nair", "9876543211", "", "Kothrud", "Pune", "Maharashtra", "Self Employed", "Nair Traders", 90000, 300000, "Home Loan", "Website", "", "", "", "", "411038"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = SAMPLE_HEADERS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.writeFile(wb, "hezo-crm-sample-leads.xlsx");
}

export function downloadErrorReport(rows: ValidatedRow[], fileName: string) {
  const failed = rows.filter((r) => r.errors.length > 0 || r.duplicateInFile || r.duplicateExisting);
  const aoa: (string | number)[][] = [["Row", "Customer Name", "Mobile", "Error"]];
  for (const r of failed) {
    const reasons = [
      ...r.errors,
      r.duplicateInFile ? "Duplicate inside file" : "",
      r.duplicateExisting ? "Duplicate already exists" : "",
    ].filter(Boolean);
    aoa.push([r.rowNumber, r.draft.customer_name, r.draft.mobile, reasons.join("; ")]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Keep mobile numbers as text so Excel never reformats them to scientific notation.
  for (let r = 1; r < aoa.length; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 2 });
    if (ws[ref]) { ws[ref].t = "s"; ws[ref].v = String(ws[ref].v ?? ""); ws[ref].z = "@"; }
  }
  ws["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 46 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, `${fileName.replace(/\.[^.]+$/, "")}-error-report.xlsx`);
}
