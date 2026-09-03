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
