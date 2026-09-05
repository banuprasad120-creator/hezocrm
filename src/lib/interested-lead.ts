export interface ExistingLoan {
  bank: string;
  loanType: string;
  amount?: string;
  emi?: string;
}

export interface ExistingCreditCard {
  bank: string;
  limit?: string;
  outstanding?: string;
}

export type DocumentCategory =
  | "identity"
  | "address"
  | "income"
  | "banking"
  | "employment"
  | "business"
  | "loans"
  | "property"
  | "other";

export type DocumentStatus = "pending" | "requested" | "received" | "verified" | "rejected";

export interface CandidateDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  status: DocumentStatus;
  isMandatory?: boolean;
  fileUrl?: string; // storage URL or data URI
  fileName?: string;
  fileSize?: number; // in bytes
  fileType?: string; // MIME type e.g. "application/pdf", "image/png"
  uploadedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionReason?: string;
  notes?: string;
}

export interface DocumentStats {
  total: number;
  received: number;
  verified: number;
  pending: number;
  rejected: number;
  mandatoryTotal: number;
  mandatoryCompleted: number;
  progressPercent: number;
  statusLabel: string;
}

export interface InterestedLeadData {
  serviceRequired: string;
  requiredAmount?: string;
  employmentType?: string; // Salaried, Self-Employed, Business, etc.
  salaryBank?: string; // Salary Bank Account for Salaried
  bankAccounts?: string[]; // Active Bank Accounts held by customer
  cibilScore?: string; // CIBIL / Credit Score
  monthlyIncome?: string;
  employer?: string;
  serviceYears?: string; // Years in service / work experience
  hasExistingLoans: boolean;
  loansCount: number;
  loans: ExistingLoan[];
  hasCreditCards: boolean;
  cardsCount: number;
  creditCards: ExistingCreditCard[];
  documents?: CandidateDocument[];
  notes?: string;
}

export const TOP_BANKS = [
  "HDFC Bank",
  "State Bank of India (SBI)",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "Punjab National Bank (PNB)",
  "Bank of Baroda (BOB)",
  "IndusInd Bank",
  "IDFC FIRST Bank",
  "Canara Bank",
  "Union Bank of India",
  "Federal Bank",
  "Yes Bank",
  "Bajaj Finserv",
  "Tata Capital",
  "Aditya Birla Capital",
  "L&T Finance",
  "Piramal Finance",
  "Muthoot Finance",
  "Manappuram Finance",
  "Other",
];

export const CARD_ISSUERS = [
  "HDFC Bank",
  "SBI Card",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "RBL Bank",
  "IndusInd Bank",
  "Standard Chartered",
  "American Express (Amex)",
  "HSBC",
  "IDFC FIRST Bank",
  "OneCard / Federal",
  "AU Small Finance Bank",
  "Yes Bank",
  "Other",
];

export const DOCUMENT_CATEGORIES: { id: DocumentCategory; label: string; icon: string }[] = [
  { id: "identity", label: "Identity Proof", icon: "🪪" },
  { id: "address", label: "Address Proof", icon: "📍" },
  { id: "income", label: "Income Proof", icon: "💰" },
  { id: "banking", label: "Bank Statements", icon: "🏦" },
  { id: "employment", label: "Employment Proof", icon: "👔" },
  { id: "business", label: "Business Registration", icon: "🏢" },
  { id: "loans", label: "Existing Loan Tracks", icon: "📄" },
  { id: "property", label: "Property Documents", icon: "🏠" },
  { id: "other", label: "Other Documents", icon: "📁" },
];

/** Standard document presets based on candidate employment type and service */
export function getDefaultDocuments(
  employmentType = "Salaried",
  serviceRequired = "Personal Loan",
  hasExistingLoans = false
): CandidateDocument[] {
  const isSalaried = (employmentType || "").toLowerCase().includes("salar");
  const isBusiness =
    (employmentType || "").toLowerCase().includes("self") ||
    (employmentType || "").toLowerCase().includes("business");
  const isMortgage =
    (serviceRequired || "").toLowerCase().includes("home") ||
    (serviceRequired || "").toLowerCase().includes("mortgage") ||
    (serviceRequired || "").toLowerCase().includes("property");

  const docs: CandidateDocument[] = [];

  // Identity & Address (Universal)
  docs.push({
    id: "doc_pan",
    name: "PAN Card",
    category: "identity",
    status: "pending",
    isMandatory: true,
  });

  docs.push({
    id: "doc_aadhaar",
    name: "Aadhaar Card (Front & Back)",
    category: "address",
    status: "pending",
    isMandatory: true,
  });

  if (isSalaried) {
    docs.push({
      id: "doc_salary_slips",
      name: "Latest 3 Months Salary Slips",
      category: "income",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_bank_stmt",
      name: "Latest 6 Months Salary Bank Statement (e-PDF)",
      category: "banking",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_company_id",
      name: "Company ID Card / Official Work Email",
      category: "employment",
      status: "pending",
      isMandatory: false,
    });
    docs.push({
      id: "doc_form16",
      name: "Form 16 / Latest 2 Years ITR",
      category: "income",
      status: "pending",
      isMandatory: false,
    });
  } else if (isBusiness) {
    docs.push({
      id: "doc_itr_business",
      name: "Latest 2-3 Years ITR with Computation & Balance Sheet",
      category: "income",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_current_bank_stmt",
      name: "Latest 12 Months Current Bank Account Statement",
      category: "banking",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_business_proof",
      name: "GST Certificate / MSME Udyam / Trade License",
      category: "business",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_office_proof",
      name: "Business Office Electricity Bill / Rent Agreement",
      category: "address",
      status: "pending",
      isMandatory: false,
    });
  } else {
    // Professional or General
    docs.push({
      id: "doc_income_proof",
      name: "Latest 2 Years ITR / Income Proof",
      category: "income",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_bank_stmt_gen",
      name: "Latest 6-12 Months Bank Account Statement",
      category: "banking",
      status: "pending",
      isMandatory: true,
    });
    docs.push({
      id: "doc_prof_cert",
      name: "Professional Degree / Registration Certificate",
      category: "employment",
      status: "pending",
      isMandatory: false,
    });
  }

  // If candidate has active loans, request SOA
  if (hasExistingLoans) {
    docs.push({
      id: "doc_existing_soa",
      name: "Existing Loan Statement of Account (SOA) / Sanction Letters",
      category: "loans",
      status: "pending",
      isMandatory: false,
    });
  }

  // If Mortgage / Home Loan
  if (isMortgage) {
    docs.push({
      id: "doc_property_deed",
      name: "Property Title Deed / Sale Agreement / EC / Tax Receipt",
      category: "property",
      status: "pending",
      isMandatory: true,
    });
  }

  // Passport photo
  docs.push({
    id: "doc_photo",
    name: "Applicant Passport Size Photograph / Clear Selfie",
    category: "identity",
    status: "pending",
    isMandatory: false,
  });

  return docs;
}

/** Calculate summary stats for documents collection */
export function getDocumentStats(documents?: CandidateDocument[]): DocumentStats {
  if (!documents || documents.length === 0) {
    return {
      total: 0,
      received: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
      mandatoryTotal: 0,
      mandatoryCompleted: 0,
      progressPercent: 0,
      statusLabel: "No Docs Requested",
    };
  }

  const total = documents.length;
  let received = 0;
  let verified = 0;
  let pending = 0;
  let rejected = 0;
  let mandatoryTotal = 0;
  let mandatoryCompleted = 0;

  for (const doc of documents) {
    if (doc.isMandatory) {
      mandatoryTotal++;
      if (doc.status === "received" || doc.status === "verified") {
        mandatoryCompleted++;
      }
    }

    if (doc.status === "verified") {
      verified++;
      received++;
    } else if (doc.status === "received") {
      received++;
    } else if (doc.status === "rejected") {
      rejected++;
    } else {
      pending++;
    }
  }

  const progressPercent = total > 0 ? Math.round((received / total) * 100) : 0;

  let statusLabel = "Docs Pending";
  if (verified === total && total > 0) {
    statusLabel = "All Verified";
  } else if (mandatoryTotal > 0 && mandatoryCompleted === mandatoryTotal) {
    statusLabel = "Mandatory Completed";
  } else if (received > 0) {
    statusLabel = `Docs In Progress (${received}/${total})`;
  } else if (pending === total) {
    statusLabel = "Pending Collection";
  }

  return {
    total,
    received,
    verified,
    pending,
    rejected,
    mandatoryTotal,
    mandatoryCompleted,
    progressPercent,
    statusLabel,
  };
}

/** Generates personalized WhatsApp message listing required documents */
export function generateWhatsAppDocumentRequestMessage(
  customerName: string,
  serviceRequired: string,
  documents: CandidateDocument[],
  agentName?: string
): string {
  const pendingDocs = documents.filter((d) => d.status === "pending" || d.status === "requested" || d.status === "rejected");
  const listToRequest = pendingDocs.length > 0 ? pendingDocs : documents;

  let msg = `Dear *${customerName.trim()}*,\n\n`;
  msg += `Greetings from Hezo Financial Advisory!\n\n`;
  msg += `Thank you for your interest in our *${serviceRequired || "Loan"}* services. To fast-track your profile evaluation and bank sanction, please share clear copies/PDFs of the following documents:\n\n`;
  msg += `📑 *REQUIRED DOCUMENTS CHECKLIST:*\n`;

  listToRequest.forEach((doc, idx) => {
    const isMandatory = doc.isMandatory ? " [Mandatory]" : "";
    const isRejected = doc.status === "rejected" ? ` ⚠️ (Resubmission: ${doc.rejectionReason || "Please provide clear copy"})` : "";
    msg += `${idx + 1}. *${doc.name}*${isMandatory}${isRejected}\n`;
  });

  msg += `\n📌 *Submission Guidelines:*\n`;
  msg += `• Photos must show all 4 corners clearly with no glare/blur.\n`;
  msg += `• For Bank Statements, please share the official downloaded e-PDF from Netbanking.\n`;
  msg += `• You can send the files directly as attachments on this WhatsApp chat.\n\n`;
  msg += `Warm regards,\n`;
  if (agentName) {
    msg += `*${agentName}*\n`;
  }
  msg += `Loan Advisory & Processing Team`;

  return msg;
}

const TAG_START = "<!--INTERESTED_DATA:";
const TAG_END = "-->";

export function serializeInterestedData(data: InterestedLeadData, userNotes?: string): string {
  const json = JSON.stringify(data);
  let summary = `📋 SERVICE ACCEPTED / INTERESTED PROFILE:\n`;
  summary += `• Requirement: ${data.serviceRequired || "Loan"}${data.requiredAmount ? ` (₹${Number(data.requiredAmount).toLocaleString("en-IN")})` : ""}\n`;

  if (data.hasExistingLoans && data.loans.length > 0) {
    summary += `• Existing Loans (${data.loans.length}):\n`;
    data.loans.forEach((l, i) => {
      summary += `   ${i + 1}. ${l.bank || "Bank"} - ${l.loanType || "Loan"}${l.amount ? ` (₹${Number(l.amount).toLocaleString("en-IN")})` : ""}${l.emi ? ` [EMI: ₹${Number(l.emi).toLocaleString("en-IN")}]` : ""}\n`;
    });
  } else {
    summary += `• Existing Loans: None\n`;
  }

  if (data.hasCreditCards && data.creditCards.length > 0) {
    summary += `• Credit Cards (${data.creditCards.length}):\n`;
    data.creditCards.forEach((c, i) => {
      summary += `   ${i + 1}. ${c.bank || "Bank"}${c.limit ? ` [Limit: ₹${Number(c.limit).toLocaleString("en-IN")}]` : ""}${c.outstanding ? ` [Dues: ₹${Number(c.outstanding).toLocaleString("en-IN")}]` : ""}\n`;
    });
  } else {
    summary += `• Credit Cards: None\n`;
  }

  if (data.cibilScore) {
    summary += `• CIBIL / Credit Score: ${data.cibilScore}\n`;
  }
  if (data.employmentType) {
    summary += `• Employment Type: ${data.employmentType}\n`;
  }
  if (data.salaryBank) {
    summary += `• Salary Account Bank: ${data.salaryBank}\n`;
  }
  if (data.bankAccounts && data.bankAccounts.length > 0) {
    summary += `• Other Bank Accounts: ${data.bankAccounts.join(", ")}\n`;
  }
  if (data.monthlyIncome) {
    summary += `• Monthly Income: ₹${Number(data.monthlyIncome).toLocaleString("en-IN")}\n`;
  }
  if (data.employer) {
    summary += `• Employer: ${data.employer}\n`;
  }
  if (data.serviceYears) {
    summary += `• Service Years / Work Experience: ${data.serviceYears} Year(s)\n`;
  }

  if (data.documents && data.documents.length > 0) {
    const stats = getDocumentStats(data.documents);
    summary += `• Documents Status: ${stats.statusLabel} (${stats.received}/${stats.total} collected, ${stats.verified} verified)\n`;
  }

  if (userNotes?.trim()) {
    summary += `• Remarks: ${userNotes.trim()}\n`;
  }

  return `${TAG_START}${json}${TAG_END}\n${summary}`;
}

export function parseInterestedData(notesText?: string | null): InterestedLeadData | null {
  if (!notesText) return null;
  const startIdx = notesText.indexOf(TAG_START);

  if (startIdx !== -1) {
    const endIdx = notesText.indexOf(TAG_END, startIdx);
    if (endIdx !== -1) {
      try {
        const rawJson = notesText.slice(startIdx + TAG_START.length, endIdx);
        const parsed = JSON.parse(rawJson) as InterestedLeadData;

        // Fallback check for CIBIL in text if not set in JSON
        if (!parsed.cibilScore) {
          const cibilMatch = notesText.match(/CIBIL(?:\s*\/\s*Credit\s*Score)?\s*[:=\-]?\s*([0-9]{3}|0|No\s*CIBIL)/i);
          if (cibilMatch) parsed.cibilScore = cibilMatch[1];
        }
        if (!parsed.salaryBank) {
          const salMatch = notesText.match(/Salary\s*(?:Account)?\s*Bank\s*[:=\-]?\s*([^\n,•]+)/i);
          if (salMatch) parsed.salaryBank = salMatch[1].trim();
        }
        if (!parsed.serviceYears) {
          const expMatch = notesText.match(/(?:Service\s*Years|Experience|Service\s*Exp)\s*[:=\-]?\s*([0-9.]+(?:\s*yrs?)?)/i);
          if (expMatch) parsed.serviceYears = expMatch[1].trim();
        }

        return parsed;
      } catch {
        // Fall through to text regex parser
      }
    }
  }

  // Fallback if structured tag is missing but notes contain interested details
  const cibilMatch = notesText.match(/CIBIL(?:\s*\/\s*Credit\s*Score)?\s*[:=\-]?\s*([0-9]{3}|0|No\s*CIBIL)/i);
  const isInterested = notesText.toLowerCase().includes("interested") || notesText.toLowerCase().includes("service accepted");

  if (isInterested || cibilMatch) {
    const salMatch = notesText.match(/Salary\s*(?:Account)?\s*Bank\s*[:=\-]?\s*([^\n,•]+)/i);
    const expMatch = notesText.match(/(?:Service\s*Years|Experience|Service\s*Exp)\s*[:=\-]?\s*([0-9.]+(?:\s*yrs?)?)/i);

    return {
      serviceRequired: "Personal Loan",
      hasExistingLoans: notesText.toLowerCase().includes("loan"),
      loansCount: 0,
      loans: [],
      hasCreditCards: notesText.toLowerCase().includes("card"),
      cardsCount: 0,
      creditCards: [],
      cibilScore: cibilMatch ? cibilMatch[1] : undefined,
      salaryBank: salMatch ? salMatch[1].trim() : undefined,
      serviceYears: expMatch ? expMatch[1].trim() : undefined,
      notes: notesText,
    };
  }

  return null;
}
