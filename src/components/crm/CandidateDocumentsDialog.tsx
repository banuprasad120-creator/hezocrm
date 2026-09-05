import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Flame,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CandidateDocument,
  DOCUMENT_CATEGORIES,
  DocumentCategory,
  DocumentStatus,
  getDefaultDocuments,
  getDocumentStats,
  formatWhatsAppPhone,
  generateWhatsAppDocumentRequestMessage,
  generateWhatsAppFollowUpReminderMessage,
  generateWhatsAppLoanOfferMessage,
  parseInterestedData,
} from "@/lib/interested-lead";
import { inr, type Lead } from "@/lib/crm";
import { updateInterestedCandidateDocumentsServerFn } from "@/lib/crm.functions";

interface CandidateDocumentsDialogProps {
  lead: Lead | null;
  agentName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; tone: string; bg: string; border: string; text: string; icon: typeof CheckCircle2 }
> = {
  pending: {
    label: "Pending",
    tone: "muted",
    bg: "bg-muted/50",
    border: "border-muted-foreground/30",
    text: "text-muted-foreground",
    icon: Clock,
  },
  requested: {
    label: "Requested",
    tone: "info",
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
    text: "text-sky-600 dark:text-sky-400",
    icon: Send,
  },
  received: {
    label: "Received",
    tone: "warning",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    icon: FileText,
  },
  verified: {
    label: "Verified",
    tone: "success",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    icon: ShieldCheck,
  },
  rejected: {
    label: "Rejected",
    tone: "destructive",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    icon: XCircle,
  },
};

export function CandidateDocumentsDialog({
  lead,
  agentName,
  open,
  onOpenChange,
  onSuccess,
}: CandidateDocumentsDialogProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [activeDocForUpload, setActiveDocForUpload] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Custom document adder state
  const [customDocOpen, setCustomDocOpen] = useState(false);
  const [customDocName, setCustomDocName] = useState("");
  const [customDocCategory, setCustomDocCategory] = useState<DocumentCategory>("other");
  const [customDocMandatory, setCustomDocMandatory] = useState(false);

  // Rejection modal state
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("Blurry / Incomplete document");

  // Document preview state
  const [previewDoc, setPreviewDoc] = useState<CandidateDocument | null>(null);

  // WhatsApp message preview modal
  const [waPreviewOpen, setWaPreviewOpen] = useState(false);

  // Parse lead data and initialize documents
  useEffect(() => {
    if (open && lead) {
      const parsed = parseInterestedData(lead.notes);
      if (parsed?.documents && parsed.documents.length > 0) {
        setDocuments(parsed.documents);
      } else {
        // Generate default document list based on profile
        const initial = getDefaultDocuments(
          parsed?.employmentType || lead.employment_type || "Salaried",
          parsed?.serviceRequired || lead.loan_type || "Personal Loan",
          parsed?.hasExistingLoans || false
        );
        setDocuments(initial);
      }
      setFilterCategory("all");
      setFilterStatus("all");
      setSearchQuery("");
    }
  }, [open, lead?.id]);

  const stats = useMemo(() => getDocumentStats(documents), [documents]);

  const parsedLeadData = useMemo(() => parseInterestedData(lead?.notes), [lead?.notes]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (filterCategory !== "all" && doc.category !== filterCategory) return false;
      if (filterStatus !== "all" && doc.status !== filterStatus) return false;
      if (q) {
        const matchesName = doc.name.toLowerCase().includes(q);
        const matchesNotes = (doc.notes || "").toLowerCase().includes(q);
        const matchesFile = (doc.fileName || "").toLowerCase().includes(q);
        if (!matchesName && !matchesNotes && !matchesFile) return false;
      }
      return true;
    });
  }, [documents, filterCategory, filterStatus, searchQuery]);

  // Status changers
  const updateDocStatus = (
    docId: string,
    status: DocumentStatus,
    reason?: string
  ) => {
    const now = new Date().toISOString();
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        return {
          ...d,
          status,
          verifiedAt: status === "verified" ? now : d.verifiedAt,
          verifiedBy: status === "verified" ? agentName || "Agent" : d.verifiedBy,
          rejectionReason: status === "rejected" ? reason || d.rejectionReason : undefined,
        };
      })
    );
  };

  const handleSetStatus = (doc: CandidateDocument, targetStatus: DocumentStatus) => {
    if (targetStatus === "rejected") {
      setRejectingDocId(doc.id);
      setRejectionReason(doc.rejectionReason || "Blurry / Illegible copy. Please resend clear original.");
    } else {
      updateDocStatus(doc.id, targetStatus);
    }
  };

  const confirmRejection = () => {
    if (rejectingDocId) {
      updateDocStatus(rejectingDocId, "rejected", rejectionReason.trim());
      setRejectingDocId(null);
      toast.info("Document marked as Rejected with feedback.");
    }
  };

  // Upload handler
  const triggerUpload = (docId: string) => {
    setActiveDocForUpload(docId);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeDocForUpload) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File is too large (max 10MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const now = new Date().toISOString();

      setDocuments((prev) =>
        prev.map((d) => {
          if (d.id !== activeDocForUpload) return d;
          return {
            ...d,
            fileUrl: dataUrl,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            uploadedAt: now,
            status: d.status === "verified" ? "verified" : "received",
          };
        })
      );
      toast.success(`Attached "${file.name}" to document.`);
      setActiveDocForUpload(null);
    };

    reader.onerror = () => {
      toast.error("Failed to read file.");
      setActiveDocForUpload(null);
    };

    reader.readAsDataURL(file);
  };

  const removeAttachment = (docId: string) => {
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        return {
          ...d,
          fileUrl: undefined,
          fileName: undefined,
          fileSize: undefined,
          fileType: undefined,
          uploadedAt: undefined,
          status: d.status === "received" || d.status === "verified" ? "pending" : d.status,
        };
      })
    );
    toast.info("Attachment removed");
  };

  const updateDocNotes = (docId: string, notes: string) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, notes: notes.trim() || undefined } : d))
    );
  };

  const deleteDocument = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    toast.info("Document requirement removed.");
  };

  const handleAddCustomDoc = () => {
    if (!customDocName.trim()) {
      return toast.error("Please enter a document name");
    }

    const newDoc: CandidateDocument = {
      id: `doc_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: customDocName.trim(),
      category: customDocCategory,
      status: "pending",
      isMandatory: customDocMandatory,
    };

    setDocuments((prev) => [...prev, newDoc]);
    setCustomDocName("");
    setCustomDocMandatory(false);
    setCustomDocOpen(false);
    toast.success(`Added "${newDoc.name}" to checklist.`);
  };

  const handleResetChecklist = () => {
    if (!lead) return;
    const initial = getDefaultDocuments(
      parsedLeadData?.employmentType || lead.employment_type || "Salaried",
      parsedLeadData?.serviceRequired || lead.loan_type || "Personal Loan",
      parsedLeadData?.hasExistingLoans || false
    );
    setDocuments(initial);
    toast.info("Checklist reset to standard requirements.");
  };

  const [waTab, setWaTab] = useState<"docs" | "followup" | "offer">("docs");

  // Dynamic 3 WhatsApp messages
  const currentWaMessage = useMemo(() => {
    if (!lead) return "";
    if (waTab === "followup") {
      return generateWhatsAppFollowUpReminderMessage(
        lead.customer_name,
        parsedLeadData?.serviceRequired || lead.loan_type || "Loan",
        parsedLeadData?.notes?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "Today",
        parsedLeadData?.notes?.match(/\d{2}:\d{2}/)?.[0] || null,
        agentName
      );
    }
    if (waTab === "offer") {
      return generateWhatsAppLoanOfferMessage(
        lead.customer_name,
        parsedLeadData?.serviceRequired || lead.loan_type || "Loan",
        lead.loan_amount || parsedLeadData?.requiredAmount || null,
        agentName
      );
    }
    return generateWhatsAppDocumentRequestMessage(
      lead.customer_name,
      parsedLeadData?.serviceRequired || lead.loan_type || "Loan",
      documents,
      agentName
    );
  }, [lead, parsedLeadData, documents, agentName, waTab]);

  const sendWhatsApp = (openWeb: boolean = false) => {
    if (!lead) return;
    const phone = formatWhatsAppPhone(lead.mobile);
    if (!phone) {
      toast.error("Candidate mobile number is missing or invalid");
      return;
    }
    const encoded = encodeURIComponent(currentWaMessage);
    const url = openWeb
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`
      : `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;

    window.open(url, "_blank");
    toast.success("Opening WhatsApp chat with pre-filled message!");
  };

  const copyWhatsAppText = () => {
    navigator.clipboard.writeText(currentWaMessage);
    toast.success("Copied WhatsApp message text to clipboard!");
  };

  // Download single document file
  const handleDownloadDoc = (doc: CandidateDocument) => {
    if (!doc.fileUrl) {
      toast.error(`No file attached for "${doc.name}"`);
      return;
    }
    const cleanName = (lead?.customer_name || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
    const docClean = doc.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = doc.fileName || `${cleanName}_${docClean}.pdf`;

    const link = document.createElement("a");
    link.href = doc.fileUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Downloading ${doc.name} (${filename})`);
  };

  // Download all uploaded files in batch
  const handleDownloadAllAttached = () => {
    const attached = documents.filter((d) => Boolean(d.fileUrl));
    if (attached.length === 0) {
      toast.info("No documents have been uploaded yet to download.");
      return;
    }

    attached.forEach((doc, idx) => {
      setTimeout(() => {
        handleDownloadDoc(doc);
      }, idx * 350);
    });

    toast.success(`Starting download for ${attached.length} attached document(s)...`);
  };

  // Export full verification summary / dossier
  const handleDownloadDossierReport = () => {
    if (!lead) return;
    const lines = [
      `=============================================================`,
      `HEZO ENTERPRISE SUITE - CANDIDATE LOAN DOCUMENT DOSSIER`,
      `=============================================================`,
      `Candidate Name  : ${lead.customer_name}`,
      `Mobile Number   : ${lead.mobile}`,
      `City            : ${lead.city || "N/A"}`,
      `Loan / Service  : ${parsedLeadData?.serviceRequired || lead.loan_type || "N/A"}`,
      `Required Amount : ${lead.loan_amount ? inr(Number(lead.loan_amount)) : "N/A"}`,
      `Employment Type : ${parsedLeadData?.employmentType || lead.employment_type || "Salaried"}`,
      `Salary Bank     : ${parsedLeadData?.salaryBank || "N/A"}`,
      `Monthly Income  : ${parsedLeadData?.monthlyIncome ? inr(Number(parsedLeadData.monthlyIncome)) : "N/A"}`,
      `Employer / Co.  : ${parsedLeadData?.employer || "N/A"}`,
      `CIBIL Score     : ${parsedLeadData?.cibilScore || "N/A"}`,
      `Generated Date  : ${new Date().toLocaleString()}`,
      ``,
      `=============================================================`,
      `DOCUMENT VERIFICATION STATUS (${stats.received}/${stats.total} Collected - ${stats.progressPercent}%)`,
      `=============================================================`,
      ...documents.map((d, i) => {
        const check =
          d.status === "verified"
            ? "[✓ VERIFIED]"
            : d.status === "received"
            ? "[✓ RECEIVED]"
            : d.status === "rejected"
            ? "[✗ REJECTED]"
            : "[ ] PENDING";
        const fileInfo = d.fileName
          ? ` (File: ${d.fileName}${d.fileSize ? ` - ${(d.fileSize / 1024).toFixed(0)}KB` : ""})`
          : " (No file attached)";
        const notes = d.notes ? ` - Notes: ${d.notes}` : "";
        const rej = d.rejectionReason ? ` - Rejection Reason: ${d.rejectionReason}` : "";
        return `${i + 1}. ${check} ${d.name} [${d.category.toUpperCase()}]${
          d.isMandatory ? " *REQUIRED*" : ""
        }${fileInfo}${notes}${rej}`;
      }),
      ``,
      `=============================================================`,
      `END OF REPORT`,
      `=============================================================`,
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(lead.customer_name || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_")}_Document_Dossier.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Downloaded candidate document dossier summary!");
  };

  // Save changes to database
  const handleSave = async () => {
    if (!lead) return;

    setBusy(true);
    try {
      await updateInterestedCandidateDocumentsServerFn({
        data: {
          leadId: lead.id,
          documents,
          logCallHistory: true,
        },
      });

      toast.success("🎉 Candidate documents updated successfully!", {
        description: `Status: ${stats.statusLabel} (${stats.received}/${stats.total} collected, ${stats.verified} verified)`,
      });

      await qc.invalidateQueries({ queryKey: ["interested-leads"] });
      await qc.invalidateQueries({ queryKey: ["my-leads"] });
      await qc.invalidateQueries({ queryKey: ["daily-leads"] });
      await qc.invalidateQueries({ queryKey: ["call-history", lead.id] });

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      console.error("[CandidateDocumentsDialog] save error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to save documents");
    } finally {
      setBusy(false);
    }
  };

  if (!lead) return null;

  return (
    <>
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelected}
        accept="image/*,application/pdf"
        className="hidden"
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-background">
          {/* Header */}
          <DialogHeader className="p-5 border-b bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500 font-bold">
                    📑
                  </span>
                  <DialogTitle className="text-lg font-extrabold tracking-tight">
                    Candidate Documents & Verification
                  </DialogTitle>
                </div>
                <DialogDescription className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{lead.customer_name}</span>
                  <span>·</span>
                  <span>📞 {lead.mobile}</span>
                  <span>·</span>
                  <span className="font-medium text-brand">
                    {parsedLeadData?.serviceRequired || lead.loan_type} ({inr(Number(lead.loan_amount))})
                  </span>
                  <span>·</span>
                  <span>👔 {parsedLeadData?.employmentType || lead.employment_type || "Salaried"}</span>
                </DialogDescription>
              </div>

              {/* Action Buttons in Header */}
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadAllAttached}
                  disabled={documents.filter((d) => Boolean(d.fileUrl)).length === 0}
                  title="Download all attached documents"
                  className="h-8 text-xs gap-1.5 border-indigo-500/30 text-indigo-600 hover:bg-indigo-500/10 font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download All ({documents.filter((d) => Boolean(d.fileUrl)).length})</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadDossierReport}
                  title="Export complete dossier summary report as text"
                  className="h-8 text-xs gap-1.5 border-border text-foreground hover:bg-muted"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-brand" />
                  <span>Dossier</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWaPreviewOpen(true)}
                  className="h-8 text-xs gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 font-semibold"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>WhatsApp</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCustomDocOpen(true)}
                  className="h-8 text-xs gap-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Doc
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetChecklist}
                  title="Reset to default template"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Progress & Stat summary banner */}
            <div className="mt-4 rounded-xl border bg-card p-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">Collection Progress:</span>
                  <Badge
                    variant="outline"
                    className={
                      stats.progressPercent === 100
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                        : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                    }
                  >
                    {stats.statusLabel}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <ShieldCheck className="h-3.5 w-3.5" /> {stats.verified} Verified
                  </span>
                  <span className="flex items-center gap-1 text-amber-600">
                    <FileText className="h-3.5 w-3.5" /> {stats.received} Received
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> {stats.pending} Pending
                  </span>
                  {stats.rejected > 0 && (
                    <span className="flex items-center gap-1 text-rose-600">
                      <XCircle className="h-3.5 w-3.5" /> {stats.rejected} Rejected
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-3">
                <Progress value={stats.progressPercent} className="h-2 flex-1" />
                <span className="text-xs font-mono font-bold text-foreground min-w-[36px] text-right">
                  {stats.progressPercent}%
                </span>
              </div>
            </div>
          </DialogHeader>

          {/* Filters Bar */}
          <div className="p-3 border-b bg-card flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search document name or file…"
                className="h-8 pl-8 text-xs bg-muted/20"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs w-[130px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status ({stats.total})</SelectItem>
                  <SelectItem value="pending">Pending ({stats.pending})</SelectItem>
                  <SelectItem value="requested">Requested</SelectItem>
                  <SelectItem value="received">Received ({stats.received})</SelectItem>
                  <SelectItem value="verified">Verified ({stats.verified})</SelectItem>
                  <SelectItem value="rejected">Rejected ({stats.rejected})</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 text-xs w-[140px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Document Items List */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            {filteredDocs.length === 0 ? (
              <div className="py-12 text-center rounded-xl border border-dashed bg-muted/10 p-8">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-semibold text-foreground">No documents matching filter</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Try clearing search filters or click "Add Doc" to create a new requirement.
                </p>
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const cfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending;
                const StatusIcon = cfg.icon;
                const catObj = DOCUMENT_CATEGORIES.find((c) => c.id === doc.category);

                return (
                  <div
                    key={doc.id}
                    className={`rounded-xl border p-4 transition-all duration-200 ${
                      doc.status === "verified"
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : doc.status === "rejected"
                        ? "bg-rose-500/5 border-rose-500/20"
                        : doc.status === "received"
                        ? "bg-amber-500/5 border-amber-500/20"
                        : "bg-card hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                      {/* Left: Info & Badges */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{doc.name}</span>
                          {doc.isMandatory && (
                            <Badge variant="destructive" className="h-5 text-[10px] px-1.5 font-semibold">
                              Required
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <span>{catObj?.icon || "📁"}</span>
                            <span>{catObj?.label || doc.category}</span>
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold flex items-center gap-1 border ${cfg.bg} ${cfg.border} ${cfg.text}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {cfg.label}
                          </span>
                        </div>

                        {/* File details, download button & upload prompt */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                          {doc.fileUrl ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 px-3 py-1.5 shadow-xs">
                              <Paperclip className="h-3.5 w-3.5 text-brand shrink-0" />
                              <span className="font-mono text-xs font-medium truncate max-w-[180px]" title={doc.fileName}>
                                {doc.fileName || "Uploaded File"}
                              </span>
                              {doc.fileSize && (
                                <span className="text-[10px] text-muted-foreground">
                                  ({(doc.fileSize / 1024).toFixed(0)} KB)
                                </span>
                              )}

                              <div className="flex items-center gap-1 border-l pl-2 ml-1">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleDownloadDoc(doc)}
                                  className="h-6 text-[11px] px-2 gap-1 bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 font-semibold"
                                  title="Download this document file"
                                >
                                  <Download className="h-3 w-3" />
                                  <span>Download</span>
                                </Button>

                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setPreviewDoc(doc)}
                                  className="h-6 text-[11px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                                  title="Preview Document"
                                >
                                  <Eye className="h-3 w-3" />
                                  <span>Preview</span>
                                </Button>

                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeAttachment(doc.id)}
                                  className="h-6 w-6 p-0 text-rose-500 hover:bg-rose-500/10"
                                  title="Remove File"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => triggerUpload(doc.id)}
                              className="h-7 text-[11px] gap-1.5 border-dashed hover:border-brand hover:text-brand"
                            >
                              <UploadCloud className="h-3.5 w-3.5" />
                              <span>Attach / Upload Copy</span>
                            </Button>
                          )}

                          {doc.verifiedBy && (
                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                              ✓ Verified by {doc.verifiedBy}
                            </span>
                          )}
                        </div>

                        {/* Rejection reason banner */}
                        {doc.status === "rejected" && doc.rejectionReason && (
                          <div className="mt-2 text-xs rounded-lg bg-rose-500/10 border border-rose-500/20 p-2 text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                              <strong>Rejection Feedback:</strong> {doc.rejectionReason}
                            </span>
                          </div>
                        )}

                        {/* Inline Document Notes */}
                        <div className="mt-2">
                          <Input
                            placeholder="Add agent notes / remarks for this document…"
                            defaultValue={doc.notes || ""}
                            onBlur={(e) => updateDocNotes(doc.id, e.target.value)}
                            className="h-7 text-xs bg-muted/10 border-muted placeholder:text-muted-foreground/50"
                          />
                        </div>
                      </div>

                      {/* Right: Status Action Buttons */}
                      <div className="flex flex-wrap items-center gap-1 sm:self-start border-t sm:border-t-0 pt-2 sm:pt-0">
                        <Button
                          size="sm"
                          variant={doc.status === "pending" ? "secondary" : "ghost"}
                          onClick={() => handleSetStatus(doc, "pending")}
                          className="h-7 text-[11px] px-2"
                        >
                          <Clock className="h-3 w-3 mr-1 text-muted-foreground" />
                          Pending
                        </Button>
                        <Button
                          size="sm"
                          variant={doc.status === "requested" ? "secondary" : "ghost"}
                          onClick={() => handleSetStatus(doc, "requested")}
                          className="h-7 text-[11px] px-2 text-sky-600 hover:text-sky-700"
                        >
                          <Send className="h-3 w-3 mr-1" />
                          Request
                        </Button>
                        <Button
                          size="sm"
                          variant={doc.status === "received" ? "secondary" : "ghost"}
                          onClick={() => handleSetStatus(doc, "received")}
                          className="h-7 text-[11px] px-2 text-amber-600 hover:text-amber-700"
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          Received
                        </Button>
                        <Button
                          size="sm"
                          variant={doc.status === "verified" ? "default" : "outline"}
                          onClick={() => handleSetStatus(doc, "verified")}
                          className={`h-7 text-[11px] px-2 ${
                            doc.status === "verified"
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                              : "text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                          }`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant={doc.status === "rejected" ? "destructive" : "ghost"}
                          onClick={() => handleSetStatus(doc, "rejected")}
                          className="h-7 text-[11px] px-2 text-rose-600 hover:text-rose-700"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Reject
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteDocument(doc.id)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500 ml-1"
                          title="Delete Requirement"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <DialogFooter className="p-4 border-t bg-muted/20 flex flex-row items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="hidden sm:inline">Changes persist immediately upon clicking save:</span>
              <strong className="text-foreground">{stats.received} of {stats.total}</strong> documents ready
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-9">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={busy}
                className="h-9 gap-1.5 gradient-brand text-white font-bold px-4"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>Save Documents</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Reason Modal */}
      <Dialog open={Boolean(rejectingDocId)} onOpenChange={(o) => !o && setRejectingDocId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <XCircle className="h-5 w-5" /> Document Rejection Feedback
            </DialogTitle>
            <DialogDescription className="text-xs">
              Explain why this document copy is rejected so the agent or customer knows what needs to be fixed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs font-bold">Reason for Rejection</Label>
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Blurry / Illegible copy. Please resend clear original.">
                  Blurry / Illegible copy
                </SelectItem>
                <SelectItem value="Missing pages or incomplete statement (e.g. 6 months needed).">
                  Missing pages or incomplete dates
                </SelectItem>
                <SelectItem value="Password protected PDF without password.">
                  Password protected PDF
                </SelectItem>
                <SelectItem value="Document expired or older than validity period.">
                  Document expired / outdated
                </SelectItem>
                <SelectItem value="Name or date of birth mismatch.">
                  Name / DOB mismatch
                </SelectItem>
                <SelectItem value="Custom reason">Other / Custom</SelectItem>
              </SelectContent>
            </Select>

            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter custom rejection notes..."
              className="text-xs min-h-[70px]"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejectingDocId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmRejection}>
              Mark as Rejected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Custom Document Modal */}
      <Dialog open={customDocOpen} onOpenChange={setCustomDocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-brand" /> Add Custom Document Requirement
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a specialized document requirement for this candidate (e.g., Rent Agreement, Electricity Bill, Form 26AS).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            <div>
              <Label className="text-xs font-bold">Document Title *</Label>
              <Input
                value={customDocName}
                onChange={(e) => setCustomDocName(e.target.value)}
                placeholder="e.g. Rent Agreement / Electricity Bill / Form 26AS"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-bold">Category</Label>
              <Select
                value={customDocCategory}
                onValueChange={(v) => setCustomDocCategory(v as DocumentCategory)}
              >
                <SelectTrigger className="mt-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isMandatoryCheck"
                checked={customDocMandatory}
                onChange={(e) => setCustomDocMandatory(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <Label htmlFor="isMandatoryCheck" className="text-xs font-medium cursor-pointer">
                Mandatory document (required for loan sanction)
              </Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setCustomDocOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddCustomDoc} className="gradient-brand text-white font-bold">
              Add Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Message Preview Modal */}
      <Dialog open={waPreviewOpen} onOpenChange={setWaPreviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <MessageSquare className="h-5 w-5" /> WhatsApp Message Generator
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select from 3 personalized templates to send directly to <strong>{lead.customer_name}</strong> ({lead.mobile}):
            </DialogDescription>
          </DialogHeader>

          {/* 3 WhatsApp Templates Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl border">
            <button
              type="button"
              onClick={() => setWaTab("docs")}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                waTab === "docs"
                  ? "bg-background text-emerald-600 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              📑 1. Document Checklist
            </button>
            <button
              type="button"
              onClick={() => setWaTab("followup")}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                waTab === "followup"
                  ? "bg-background text-emerald-600 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🔔 2. Follow-up Reminder
            </button>
            <button
              type="button"
              onClick={() => setWaTab("offer")}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                waTab === "offer"
                  ? "bg-background text-emerald-600 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              💰 3. Loan Offer / Sanction
            </button>
          </div>

          <div className="py-2">
            <div className="rounded-xl border bg-muted/30 p-3.5 font-mono text-xs whitespace-pre-wrap max-h-[260px] overflow-y-auto leading-relaxed text-foreground">
              {currentWaMessage}
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={copyWhatsAppText} className="h-9 gap-1 text-xs w-full sm:w-auto">
              <Copy className="h-3.5 w-3.5" /> Copy Message Text
            </Button>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  sendWhatsApp(true);
                  setWaPreviewOpen(false);
                }}
                className="h-9 text-xs gap-1 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10"
              >
                💻 WhatsApp Web
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  sendWhatsApp(false);
                  setWaPreviewOpen(false);
                }}
                className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                <Send className="h-3.5 w-3.5" /> Send WhatsApp
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document File Preview Modal */}
      <Dialog open={Boolean(previewDoc)} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-4 border-b bg-muted/20 flex flex-row items-center justify-between">
            <div className="min-w-0 pr-6">
              <DialogTitle className="text-base truncate">{previewDoc?.name}</DialogTitle>
              <DialogDescription className="text-xs truncate font-mono text-muted-foreground">
                {previewDoc?.fileName}
              </DialogDescription>
            </div>
            {previewDoc?.fileUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = previewDoc.fileUrl!;
                  link.download = previewDoc.fileName || "document";
                  link.click();
                }}
                className="h-8 text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/5 min-h-[400px]">
            {previewDoc?.fileType?.includes("pdf") ? (
              <iframe
                src={previewDoc.fileUrl}
                title={previewDoc.name}
                className="w-full h-[550px] rounded-lg border bg-white"
              />
            ) : previewDoc?.fileUrl ? (
              <img
                src={previewDoc.fileUrl}
                alt={previewDoc.name}
                className="max-h-[550px] max-w-full rounded-lg object-contain shadow-md"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No preview available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
