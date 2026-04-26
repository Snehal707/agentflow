export type ReportSource = {
  name: string;
  url: string;
  usedFor?: string;
};

export type ReportFreshness = {
  label: string;
  tone: "fresh" | "stale" | "neutral";
  detail: string;
};

export type ReportEvidenceSummary = {
  confirmed: number;
  reported: number;
  analysis: number;
};

export type ReportMeta = {
  kind: "research" | "portfolio" | "execution";
  freshness?: ReportFreshness;
  evidence?: ReportEvidenceSummary;
  premiseNote?: string;
  sources?: ReportSource[];
  diagnostics?: string[];
  highlights?: string[];
};

/** Plain string or a timeline row with an optional verifiable on-chain tx link */
export type ChatTraceEntry =
  | string
  | {
      label: string;
      txHash?: string;
      explorerUrl?: string;
    };

export type LiveChatMessage = {
  id: string;
  role: "user" | "assistant";
  title?: string;
  content: string;
  attachment?: ChatAttachment;
  trace?: ChatTraceEntry[];
  reportMeta?: ReportMeta;
  activityMeta?: {
    mode?: "brain";
    clusters?: string[];
    stageBars?: number[];
  };
  paymentMeta?: {
    entries: Array<{
      requestId: string;
      agent: string;
      price?: string;
      payer?: string;
      mode?: "dcw" | "eoa" | "sponsored" | "a2a";
      sponsored?: boolean;
      buyerAgent?: string;
      sellerAgent?: string;
      transactionRef?: string | null;
      settlementTxHash?: string | null;
    }>;
  };
  confirmation?: {
    required: boolean;
    action: "swap" | "vault" | "bridge" | "execute" | "schedule" | "split" | "invoice" | "batch";
    confirmId?: string;
    confirmLabel?: string;
    choices?: Array<{ id: string; label: string; confirmId: string }>;
  };
  paymentLink?: {
    handle: string;
    displayHandle: string;
    amount: string | null;
    remark: string | null;
    /** Relative URL path + query. Frontend prepends window.location.origin. */
    path: string;
  };
  status?: "streaming" | "complete" | "error";
};

export type ChatAttachmentKind = "image" | "pdf" | "text";

export type ChatAttachment = {
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};
