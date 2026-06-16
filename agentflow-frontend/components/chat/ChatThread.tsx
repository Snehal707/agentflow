import { useEffect, useRef } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatAttachment, LiveChatMessage } from "@/components/chat/types";
import { PaymentLinkCard } from "@/components/chat/PaymentLinkCard";
import { messageSupportsReportPanel } from "@/lib/chatInspector";

type ChatThreadProps = {
  messages: LiveChatMessage[];
  selectedAssistantId?: string | null;
  onSelectAssistant?: (id: string) => void;
  onSendMessage?: (message: string) => void;
  onFeedback?: (messageId: string, feedback: "positive" | "negative") => void;
  onRateAgent?: (
    messageId: string,
    stars: number,
    ratingMeta: NonNullable<LiveChatMessage["ratingMeta"]>,
  ) => void;
  onConfirmAction?: (input: {
    messageId: string;
    action: "schedule" | "split" | "invoice" | "batch";
    confirmId: string;
    label: string;
  }) => void;
};

type QuickActionGroup = NonNullable<LiveChatMessage["quickActionGroups"]>[number];
type QuickAction = QuickActionGroup["actions"][number];
type PredmarketRenderableBlock =
  | { type: "markdown"; content: string }
  | { type: "group"; title?: string; content?: string; actions: QuickAction[] };

function cleanQuickActionContextTitle(value?: string): string {
  return (value || "").replace(/\.\.\.$/, "").trim();
}

function extractPredmarketResearchTitleFromPrompt(prompt?: string): string {
  const raw = (prompt || "").trim();
  if (!raw) return "";

  const match = raw.match(
    /research\s+the\s+prediction\s+market\s+topic:\s*([\s\S]*?)(?=\s*Listed outcomes in AgentFlow:|$)/i,
  );
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function quickActionDisplayLabel(action: QuickAction, contextTitle?: string): string {
  const promptDerivedTitle =
    action.label === "Research"
      ? extractPredmarketResearchTitleFromPrompt(action.prompt)
      : "";
  const cleanedTitle = cleanQuickActionContextTitle(
    promptDerivedTitle || contextTitle,
  );
  if (action.label === "Research" && cleanedTitle) {
    return `Research: ${cleanedTitle}`;
  }
  return action.label;
}

function encodeQuickActionMessage(action: QuickAction, contextTitle?: string): string {
  return `[[AF_ACTION:${encodeURIComponent(JSON.stringify({
    prompt: action.prompt,
    ...(action.actionId ? { actionId: action.actionId } : {}),
    ...(action.routeIntent ? { routeIntent: action.routeIntent } : {}),
  }))}]]${quickActionDisplayLabel(action, contextTitle)}`;
}

/** Swap / vault completion messages are plain markdown in a default bubble - elevate visually. */
function isArcTxReceiptMessage(message: LiveChatMessage): boolean {
  if (message.role !== "assistant" || message.status !== "complete") {
    return false;
  }
  const c = message.content;
  return (
    /^Executed swap:/m.test(c) ||
    /^Executed (?:deposit|withdraw):/m.test(c) ||
    /^Swap complete on Arc\./m.test(c) ||
    /^Vault (?:deposit|withdraw) complete on Arc\./m.test(c) ||
    /^Bridge complete on Arc\./m.test(c) ||
    /^- \*\*Amount:\*\* .+\n- \*\*Route:\*\* .+ -> Arc/m.test(c) ||
    /^Bridge:\s.+-> Arc/m.test(c) ||
    /^Bridged .* USDC to Arc/m.test(c) ||
    /\bcomplete on Arc\.\s*\n\nTx:/m.test(c) ||
    /^Sent payment successfully on Arc\./m.test(c) ||
    /^Batch payment complete!/m.test(c)
  );
}

/** Count how many Arc-explorer links a tx-receipt message contains. */
function countArcExplorerLinks(content: string): number {
  const matches = content.match(/testnet\.arcscan\.app\/tx\//g);
  return matches ? matches.length : 0;
}

function stripDisplayMetadata(content: string): string {
  return content
    .replace(/\[\[AFMETA:[^\]]*\]\]/g, "")
    .replace(/^(⚡\s*)/, "");
}

function stripConfirmationCta(content: string): string {
  return content
    .replace(/\n*Reply\s+[*_]*YES[*_]*\s+to\s+\w[\w\s]*?(?:\s+or\s+[*_]*NO[*_]*\s+to\s+cancel)?\.?\s*$/i, "")
    .replace(/\n*Reply\s+YES\s+to\s+cancel\s+or\s+NO\s+to\s+keep\s+it\.?\s*$/i, "")
    .replace(
      /\n+(?:\*\*)?Reply\s+YES\s+to\s+confirm[\s\S]*?(?:NO\s+to\s+cancel)?\.?\s*$/i,
      "",
    )
    .replace(/\n*Confirm\s+to\s+send\s+all\s+transfers[^.]*\.?\s*$/i, "")
    .trimEnd();
}

function isRefundConfirmationPrompt(content: string): boolean {
  return (
    /\brefund this market\?/i.test(content) &&
    /reply\s+[*_]*yes[*_]*\s+to\s+execute\s+or\s+[*_]*no[*_]*\s+to\s+cancel\.?/i.test(content)
  );
}

function stripPortfolioPaymentFooter(content: string): string {
  return content
    .replace(/\n*_Paid Portfolio Agent \([^)]+ via x402\)\._\s*$/i, "")
    .trimEnd();
}

function shortPaymentRef(value?: string | null): string {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function deriveRatingMeta(message: LiveChatMessage): LiveChatMessage["ratingMeta"] | undefined {
  if (message.ratingMeta) {
    return message.ratingMeta;
  }
  const entries = message.paymentMeta?.entries ?? [];
  const entry = entries.find(
    (candidate) =>
      candidate.mode !== "a2a" &&
      !candidate.sponsored &&
      candidate.requestId &&
      Boolean(candidate.transactionRef || candidate.settlementTxHash),
  );
  if (!entry) {
    return undefined;
  }
  const agentSlug = entry.sellerAgent || entry.agent;
  if (!agentSlug || agentSlug === "analyst" || agentSlug === "writer") {
    return undefined;
  }
  return {
    taskId: entry.requestId,
    requestId: entry.requestId,
    agentSlug,
    settlementRef: entry.transactionRef || entry.settlementTxHash || "",
  };
}

/** Only for assistant bubbles; preserves inner fenced code blocks. */
function stripOuterCodeFenceForAssistantText(content: string): string {
  const raw = typeof content === "string" ? content : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return raw;
  }

  const openMatch = trimmed.match(/^```[^\r\n]*(?:\r\n|[\r\n])/);
  if (!openMatch) {
    return raw;
  }

  let afterOpen = trimmed.slice(openMatch[0].length);

  let searchEnd = afterOpen.length;
  while (searchEnd >= 0) {
    const closeLineStart = afterOpen.lastIndexOf("\n```", searchEnd);
    if (closeLineStart === -1) {
      break;
    }
    const afterFenceLine = afterOpen.slice(closeLineStart + 1).trim();
    if (afterFenceLine === "```") {
      return afterOpen.slice(0, closeLineStart).trimEnd();
    }
    searchEnd = closeLineStart - 1;
  }

  if (!/\n```/.test(afterOpen) && afterOpen.endsWith("```")) {
    return afterOpen.slice(0, -3).trimEnd();
  }

  return raw;
}

type AssistantReportParts = {
  progress: string;
  report: string;
  hasReport: boolean;
};

function splitAssistantReport(content: string): AssistantReportParts {
  const normalized = content.replace(/\r\n/g, "\n");
  const dividerPattern = /\n\s*---\s*\n/g;
  const firstDivider = dividerPattern.exec(normalized);

  if (firstDivider) {
    const reportStart = (firstDivider.index ?? 0) + firstDivider[0].length;
    const progress = normalized.slice(0, firstDivider.index).trim();
    const report = normalized.slice(reportStart).trim();
    if (report) {
      return { progress, report, hasReport: true };
    }
  }

  return { progress: "", report: content, hasReport: false };
}

function getProgressPanelLabel(message: LiveChatMessage, txReceipt: boolean): string {
  if (txReceipt) {
    return "Execution Receipt";
  }
  if (message.reportMeta?.kind === "portfolio") {
    return "Portfolio Workflow";
  }
  if (message.reportMeta?.kind === "execution") {
    return "Execution Flow";
  }
  return "Research Pipeline";
}

function looksLikeReportContent(content: string): boolean {
  return (
    /^#\s.+/m.test(content) ||
    /^##\s.+/m.test(content) ||
    /^\*\*(?:Current Situation|Executive Summary|Summary|Key Findings|Key Insights|Portfolio Implications|Sources|Takeaway)[^*]*\*\*/im.test(
      content,
    ) ||
    /##\s+(Executive Summary|Current Status|Current Situation|Analysis|Conclusion|Key\s+Findings|Key\s+Insights|Sources\s+Checked|Recommendations?|Implications?|Portfolio\s+Implications|Takeaway)/i.test(
      content,
    ) ||
    /AgentFlow research pipeline \(Wikipedia/i.test(content) ||
    /^â–¸\s+(?:research|analyst|writer)\s+step/m.test(content)
  );
}

function formatProgressLines(progress: string): string[] {
  return progress
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-\s]*$/.test(line));
}

function normalizeReportMarkdown(content: string): string {
  const trimmed = content.trim();
  const outerFence = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  const unwrapped = outerFence?.[1]?.trim() || content;

  return unwrapped.replace(
    /^\*\*((?:Current Situation|Executive Summary|Summary|Key Findings|Key Insights|Portfolio Implications|Your Portfolio Impact|Sources|Takeaway)[^*]*)\*\*\s*$/gim,
    "## $1",
  );
}

function getConfirmationPrimaryLabel(
  action?: "swap" | "vault" | "bridge" | "execute" | "schedule" | "split" | "invoice" | "batch",
  content?: string,
): string {
  const normalized = stripDisplayMetadata(content || "");
  if (action === "invoice") return "Create Invoice";
  if (action === "batch") return "Send batch";
  if (action === "split") {
    return "Confirm & send";
  }
  if (action === "schedule") {
    if (/\bcancel\b/i.test(normalized)) {
      return "Cancel now";
    }
    return "Schedule now";
  }
  if (action === "bridge") {
    return "Yes, bridge";
  }
  if (action === "vault") {
    return "Yes, continue";
  }
  if (action === "swap") {
    return "Yes, swap";
  }
  if (/\bbridge\b/i.test(normalized)) {
    return "Yes, bridge";
  }
  if (/\b(vault|deposit|withdraw|stake)\b/i.test(normalized)) {
    return "Yes, continue";
  }
  if (/\bswap\b/i.test(normalized)) {
    return "Yes, swap";
  }
  return "Yes, execute";
}

function getConfirmationSecondaryLabel(
  action?: "swap" | "vault" | "bridge" | "execute" | "schedule" | "split" | "invoice" | "batch",
  content?: string,
): string {
  const normalized = stripDisplayMetadata(content || "");
  if (action === "invoice") return "Cancel";
  if (action === "batch") return "No, cancel";
  if (action === "split") {
    return "No, cancel";
  }
  if (action === "schedule" && /\bcancel\b/i.test(normalized)) {
    return "No";
  }
  if (/reply\s+yes\s+to\s+cancel\s+or\s+no\s+to\s+keep\s+it/i.test(normalized)) {
    return "No";
  }
  if (action === "schedule") {
    return "No";
  }
  return "No, cancel";
}

function isPlainAssistantBubble(
  isAssistant: boolean,
  isReportMessage: boolean,
  txReceipt: boolean,
): boolean {
  return isAssistant && !isReportMessage && !txReceipt;
}

function isMarkdownLikeAssistantMessage(content: string): boolean {
  return (
    /^#{1,3}\s+\S/m.test(content) ||
    /\*\*[^*\n][\s\S]*?\*\*/.test(content) ||
    /^\s*(?:[-*]|\d+\.)\s+\S/m.test(content) ||
    /\[[^\]]+\]\([^)]+\)/.test(content)
  );
}

function containsFencedCodeBlock(content: string): boolean {
  return /```[\s\S]*```/.test(content);
}

function looksLikeAlignedTextBlock(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "    "))
    .filter((line) => line.trim().length > 0);

  if (lines.length < 3) {
    return false;
  }

  const alignedLines = lines.filter((line) => line.length >= 8 && / {2,}/.test(line));
  return alignedLines.length >= 3;
}

type PlainAssistantBlock =
  | { type: "paragraph"; content: string }
  | { type: "bullet_list"; items: string[] };

function normalizePseudoListParagraph(paragraph: string): string {
  return paragraph
    .replace(/\s+-\s+(?=[A-Z][^:\n]{1,40}:)/g, "\n- ")
    .replace(/(?<=\S)\s+(?=What do you want to do(?: first)?\?)/g, "\n\n");
}

function normalizeCollapsedAssistantFormatting(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    // Preserve decimal values like "0.999999" in receipts while still breaking
    // true numbered steps like "1. Confirm..." onto their own lines.
    .replace(/:\s*((?:\d{1,3})\.)\s+(?=[A-Z(])/g, ":\n\n$1 ")
    .replace(/([a-z)\]])((?:\d{1,3})\.)\s+(?=[A-Z(])/g, "$1\n\n$2 ")
    .replace(/\b(About|Around|In)\s*(\d+)\b/g, "$1 $2")
    .replace(/([a-z])(?=(Want to|Do you want|Would you like|If you want|You can also|Then open|Search for))/g, "$1\n\n")
    .replace(/([^.?!\n])\s*(?=(Reply YES|Reply NO|Want to pick up|Want me to|What do you want to do\??))/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatPlainAssistantBlocks(content: string): PlainAssistantBlock[] {
  const normalized = normalizeCollapsedAssistantFormatting(content);
  if (!normalized) {
    return [];
  }

  const preprocessed = normalizePseudoListParagraph(normalized);
  const paragraphs = preprocessed
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const blocks: PlainAssistantBlock[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const bulletLines = lines.filter((line) => /^-\s+/.test(line));
    if (bulletLines.length >= 2 && bulletLines.length === lines.length) {
      blocks.push({
        type: "bullet_list",
        items: bulletLines.map((line) => line.replace(/^-\s+/, "").trim()),
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      content: paragraph,
    });
  }

  return blocks;
}

function normalizeGroupTitle(value?: string): string {
  return (value || "").replace(/\.\.\.$/, "").trim().toLowerCase();
}

function extractMarketAddress(value?: string): string | null {
  const match = (value || "").match(/\b0x[a-fA-F0-9]{40}\b/);
  return match ? match[0].toLowerCase() : null;
}

function parsePredmarketInlineBlocks(
  content: string,
  groups?: LiveChatMessage["quickActionGroups"],
): PredmarketRenderableBlock[] | null {
  if (!groups?.length) {
    return null;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const isList =
    normalized.startsWith("## Prediction markets on AchMarket") ||
    normalized.startsWith("## Your prediction market positions");
  if (!isList) {
    return null;
  }

  const categoryGroup = groups.find((group) =>
    group.actions.some((action) =>
      /show (?:prediction markets|crypto markets|sports markets|politics markets|entertainment markets)/i.test(
        action.prompt,
      ),
    ),
  );
  const marketGroups = groups.filter((group) => group !== categoryGroup);
  if (!marketGroups.length) {
    return null;
  }

  const sectionMatches = Array.from(
    normalized.matchAll(/^(###\s+[^\n]+)\n([\s\S]*?)(?=^###\s+|^##\s+⚠️|\Z)/gm),
  );
  if (!sectionMatches.length) {
    return null;
  }

  const firstSectionIndex = sectionMatches[0]?.index ?? -1;
  const noteIndex = normalized.search(/^##\s+⚠️/m);
  const introEnd =
    firstSectionIndex >= 0 ? firstSectionIndex : noteIndex >= 0 ? noteIndex : normalized.length;
  const intro = normalized.slice(0, introEnd).trim();
  const notes = noteIndex >= 0 ? normalized.slice(noteIndex).trim() : "";

  const blocks: PredmarketRenderableBlock[] = [];
  if (intro) {
    blocks.push({ type: "markdown", content: intro });
  }
  if (categoryGroup) {
    blocks.push({
      type: "group",
      title: categoryGroup.title,
      actions: categoryGroup.actions,
    });
  }

  for (const match of sectionMatches) {
    const heading = match[1] || "";
    const body = (match[2] || "").trim();
    const title = heading.replace(/^###\s+[^\s]+\s*/, "").trim();
    const addressInSection = extractMarketAddress(body);
    const matchedGroup =
      marketGroups.find((group) => normalizeGroupTitle(group.title) === normalizeGroupTitle(title)) ||
      marketGroups.find((group) =>
        normalizeGroupTitle(title).includes(normalizeGroupTitle(group.title)) ||
        normalizeGroupTitle(group.title).includes(normalizeGroupTitle(title)),
      ) ||
      (addressInSection
        ? marketGroups.find((group) =>
            group.actions.some((action) => extractMarketAddress(action.prompt) === addressInSection),
          )
        : undefined);

    if (matchedGroup) {
      blocks.push({
        type: "group",
        title,
        content: `${heading}\n${body}`.trim(),
        actions: matchedGroup.actions,
      });
    } else {
      blocks.push({
        type: "markdown",
        content: `${heading}\n${body}`.trim(),
      });
    }
  }

  if (notes) {
    blocks.push({ type: "markdown", content: notes });
  }

  return blocks;
}

function looksLikePredmarketStructuredMessage(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return (
    normalized.startsWith("## Prediction markets on AchMarket") ||
    normalized.startsWith("## Your prediction market positions") ||
    normalized.startsWith("## ")
  ) &&
    /- \*\*Address:\*\* `0x[a-fA-F0-9]{40}`/m.test(normalized);
}

function StatusDots() {
  return (
    <span className="flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#f2ca50] [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#f2ca50] [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#f2ca50]" />
    </span>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function attachmentLabel(attachment: ChatAttachment): string {
  if (attachment.kind === "image") return "Image";
  if (attachment.kind === "pdf") return "PDF";
  return "File";
}

export function ChatThread({
  messages,
  selectedAssistantId,
  onSelectAssistant,
  onSendMessage,
  onFeedback,
  onRateAgent,
  onConfirmAction,
}: ChatThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const latestMessage = messages[messages.length - 1];

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateAutoScrollState = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < 120;
    };

    updateAutoScrollState();
    container.addEventListener("scroll", updateAutoScrollState, { passive: true });

    return () => {
      container.removeEventListener("scroll", updateAutoScrollState);
    };
  }, []);

  useEffect(() => {
    const bottomAnchor = bottomAnchorRef.current;
    if (!bottomAnchor || messages.length === 0) return;

    if (shouldAutoScrollRef.current || latestMessage?.role === "user") {
      bottomAnchor.scrollIntoView({
        behavior: latestMessage?.role === "user" ? "smooth" : "auto",
        block: "end",
      });
    }
  }, [
    messages.length,
    latestMessage?.id,
    latestMessage?.role,
    latestMessage?.content,
    latestMessage?.status,
  ]);

  return (
    <div
      ref={scrollContainerRef}
      className="scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-10 py-10 xl:px-14"
    >
      <div className="space-y-12">
        {messages.map((message, index) => {
          const isAssistant = message.role === "assistant";
          const ratingMeta =
            isAssistant && message.status === "complete"
              ? deriveRatingMeta(message)
              : undefined;
          const hasImplicitConfirmationPrompt =
            (/reply[\s*_]*YES\b/i.test(message.content) ||
              /\bconfirm(?:\s+with)?[\s*_]*YES\b/i.test(message.content)) &&
            /\bNO\b/i.test(message.content);
          const hasRefundConfirmationPrompt = isRefundConfirmationPrompt(message.content);
          const showConfirmationActions =
            isAssistant &&
            typeof onSendMessage === "function" &&
            (
              message.confirmation?.required === true ||
              hasRefundConfirmationPrompt ||
              (hasImplicitConfirmationPrompt && index === messages.length - 1)
            );
          const renderedContent = isAssistant
            ? normalizeCollapsedAssistantFormatting(
                stripOuterCodeFenceForAssistantText(
                  stripConfirmationCta(stripDisplayMetadata(message.content)).trimStart(),
                ),
              )
            : message.content;
          const portfolioCard = isAssistant && message.reportMeta?.kind === "portfolio";
          const portfolioPaid =
            portfolioCard && (message.paymentMeta?.entries?.length ?? 0) > 0;
          const visibleRenderedContent = portfolioCard
            ? stripPortfolioPaymentFooter(renderedContent)
            : renderedContent;
          const reportParts = isAssistant
            ? splitAssistantReport(visibleRenderedContent)
            : { progress: "", report: visibleRenderedContent, hasReport: false };
          const markdownContent = reportParts.hasReport
            ? normalizeReportMarkdown(reportParts.report)
            : visibleRenderedContent;
          const predmarketInlineBlocks =
            isAssistant
              ? parsePredmarketInlineBlocks(markdownContent, message.quickActionGroups)
              : null;
          const isPredictionMarketReportFooter = message.reportMeta?.contextKind === "prediction_market";
          const visibleQuickActionGroups =
            isPredictionMarketReportFooter && message.quickActionGroups?.length
              ? message.quickActionGroups
                  .map((group) => ({
                    ...group,
                    actions: group.actions.filter(
                      (action) =>
                        !/^(?:research|details|show\b|find this market to trade|trade)$/i.test(
                          action.label.trim(),
                        ),
                    ),
                  }))
                  .filter((group) => group.actions.length > 0)
              : message.quickActionGroups;
          const progressLines = reportParts.hasReport
            ? formatProgressLines(reportParts.progress)
            : [];
          const isReportMessage =
            isAssistant &&
            !predmarketInlineBlocks &&
            (Boolean(message.reportMeta) ||
              reportParts.hasReport ||
              looksLikeReportContent(markdownContent) ||
              /^#\s.+/m.test(renderedContent) ||
              /^##\s.+/m.test(renderedContent) ||
              /##\s+(Executive Summary|Current Status|Analysis|Conclusion|Key\s+Findings|Sources\s+Checked|Recommendations?|Implications?|Takeaway)/i.test(
                renderedContent,
              ) ||
              /AgentFlow research pipeline \(Wikipedia/i.test(renderedContent) ||
              /^▸\s+(?:research|analyst|writer)\s+step/m.test(renderedContent));
          const selected = selectedAssistantId === message.id;
          const txReceipt = isArcTxReceiptMessage(message);
          const userHasAttachment = !isAssistant && Boolean(message.attachment);
          const plainAssistantBubble = isPlainAssistantBubble(
            isAssistant,
            isReportMessage,
            txReceipt,
          );
          const fencedCodeBlock = isAssistant && containsFencedCodeBlock(renderedContent);
          const markdownLikeAssistantMessage =
            isAssistant && isMarkdownLikeAssistantMessage(markdownContent);
          const alignedTextBlock =
            isAssistant &&
            !isReportMessage &&
            !fencedCodeBlock &&
            looksLikeAlignedTextBlock(renderedContent);
          const selectableAssistantMessage =
            isAssistant &&
            Boolean(onSelectAssistant) &&
            messageSupportsReportPanel(message);

          return (
            <article
              key={message.id}
              onClick={selectableAssistantMessage ? () => onSelectAssistant?.(message.id) : undefined}
              className={`flex w-full min-w-0 gap-4 ${
                isAssistant
                  ? isReportMessage
                    ? "max-w-[min(100%,58rem)]"
                    : "max-w-3xl"
                  : "ml-auto max-w-3xl flex-row-reverse"
              } ${selectableAssistantMessage ? "cursor-pointer" : ""}`}
            >
              <div
                className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                  isAssistant
                    ? "border border-white/10 bg-[#201f1f]"
                    : "bg-[#f2ca50]"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-sm ${
                    isAssistant ? "text-[#f2ca50]" : "text-[#3c2f00]"
                  }`}
                  style={isAssistant ? { fontVariationSettings: '"FILL" 1' } : undefined}
                >
                  {isAssistant ? "smart_toy" : "person"}
                </span>
              </div>

              <div className={`min-w-0 flex-1 space-y-5 ${isAssistant ? "" : "text-right"}`}>
                <div className="text-sm font-medium text-white/40">
                  {isAssistant ? message.title || "AgentFlow" : "You"}
                  <span className={`text-[10px] opacity-40 ${isAssistant ? "ml-2" : "mr-2"}`}>
                    {message.status === "streaming" ? "Just now" : "Live"}
                  </span>
                </div>
                {isAssistant && message.status === "streaming" && !renderedContent ? (
                  <div className="flex items-center gap-3 rounded-xl rounded-tl-none bg-black p-4 text-sm italic text-[#f2ca50]">
                    <StatusDots />
                    Analyzing...
                  </div>
                ) : (
                  <div
                    className={`min-w-0 max-w-full ${isReportMessage ? "overflow-visible" : "overflow-hidden"} leading-relaxed ${
                      isAssistant
                        ? message.status === "error"
                          ? "rounded-xl rounded-tl-none border border-[#ffb4ab]/20 border-l-2 border-l-[#ffb4ab] bg-[#241818]/80 p-4 text-[#ffe7e3]"
                        : txReceipt
                          ? selected
                            ? "rounded-xl rounded-tl-none border border-[#f2ca50]/25 border-l-[3px] border-l-[#f2ca50] bg-gradient-to-br from-[#201b0f] via-[#171411] to-[#1d2025]/95 p-5 text-[#f6f6fc] shadow-[0_0_48px_-16px_rgba(242,202,80,0.20)]"
                            : "rounded-xl rounded-tl-none border border-[#f2ca50]/15 border-l-[3px] border-l-[#f2ca50]/80 bg-gradient-to-br from-[#1c180e] via-[#151210] to-[#1d2025]/90 p-5 text-[#f6f6fc] shadow-[0_0_40px_-18px_rgba(242,202,80,0.15)]"
                          : portfolioCard
                            ? "rounded-xl rounded-tl-none border border-[#f2ca50]/20 border-l-[3px] border-l-[#f2ca50] bg-[#171717] px-5 py-5 text-white/90 shadow-[0_18px_50px_-34px_rgba(242,202,80,0.55)]"
                          : selected
                            ? isReportMessage
                              ? "rounded-2xl rounded-tl-none border border-white/10 border-l-2 border-l-[#f2ca50] bg-[#201f1f]/70 px-6 py-5 text-white/90"
                              : "rounded-xl rounded-tl-none border-l-2 border-l-[#f2ca50] bg-[#201f1f]/70 p-4 text-white/90"
                            : isReportMessage
                              ? "rounded-2xl rounded-tl-none border border-white/10 border-l-2 border-l-[#f2ca50] bg-[#201f1f]/50 px-6 py-5 text-white/90"
                              : "rounded-xl rounded-tl-none border-l-2 border-l-[#f2ca50] bg-[#201f1f]/50 p-4 text-white/90"
                        : "ml-auto w-fit text-left rounded-xl rounded-tr-none border border-[rgba(242,202,80,0.25)] bg-[rgba(242,202,80,0.12)] p-4 text-white/90"
                    }`}
                  >
                    {isAssistant ? (
                      <div
                        className={`prose prose-invert max-w-none break-words [overflow-wrap:anywhere] prose-headings:break-words prose-headings:text-white prose-p:break-words prose-p:text-white/90 prose-strong:text-white prose-li:break-words prose-li:text-white/80 prose-a:break-all prose-code:break-words prose-pre:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:max-w-full prose-table:overflow-x-auto ${
                          message.status === "error"
                            ? "prose-p:first:mt-0 prose-p:last:mb-0 prose-p:text-[15px] prose-p:leading-7 prose-p:text-[#ffe7e3] prose-strong:text-[#ffe7e3] prose-li:text-[#ffe7e3]/85"
                            : txReceipt
                            ? "prose-p:first:mt-0 prose-p:last:mb-0 prose-p:first-of-type:mt-0 prose-a:text-[#f2ca50] prose-a:decoration-[rgba(242,202,80,0.4)] hover:prose-a:text-white/90"
                            : isReportMessage
                              ? "prose-h1:mb-3 prose-h1:text-[clamp(1.25rem,1.8vw,1.625rem)] prose-h1:leading-[1.22] prose-h1:tracking-[-0.02em] prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-[1.125rem] prose-h2:leading-snug prose-h3:mt-5 prose-h3:text-base prose-p:first:mt-0 prose-p:last:mb-0 prose-p:text-[0.938rem] prose-p:leading-relaxed prose-li:text-[0.938rem] prose-li:leading-relaxed"
                              : "prose-p:first:mt-0 prose-p:last:mb-0 prose-p:text-[15px] prose-p:leading-7"
                        }`}
                      >
                        {txReceipt ? (
                          <div className="not-prose mb-4 flex items-start gap-3 border-b border-[#f2ca50]/20 pb-4">
                            <span
                              className="material-symbols-outlined mt-0.5 shrink-0 text-[26px] text-[#f2ca50]"
                              style={{ fontVariationSettings: '"FILL" 1' }}
                            >
                              check_circle
                            </span>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f2ca50]">
                                Settled on Arc
                              </div>
                              <div className="mt-0.5 text-[13px] text-white/55">
                                {countArcExplorerLinks(renderedContent) > 1
                                  ? "Transaction hashes and explorer links below."
                                  : "Transaction hash and explorer link below."}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {portfolioCard ? (
                          <div className="not-prose mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[#f2ca50]/15 pb-4">
                            <div className="flex items-center gap-3">
                              <span
                                className="material-symbols-outlined text-[24px] text-[#f2ca50]"
                                style={{ fontVariationSettings: '"FILL" 1' }}
                              >
                                account_balance_wallet
                              </span>
                              <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#f2ca50]">
                                  Portfolio Agent
                                </div>
                                <div className="mt-0.5 text-[12px] text-white/48">
                                  Live DCW holdings and positions
                                </div>
                              </div>
                            </div>
                            {portfolioPaid ? (
                              <span className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f2ca50]">
                                x402 paid
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {reportParts.hasReport && progressLines.length > 0 ? (
                          <div className="not-prose mb-5 border-b border-[#f2ca50]/15 pb-4">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f2ca50]">
                              {getProgressPanelLabel(message, txReceipt)}
                            </div>
                            <div className="space-y-1.5 text-[12px] leading-5 text-white/55">
                              {progressLines.slice(0, 8).map((line, lineIndex) => (
                                <div key={`${message.id}-progress-${lineIndex}`} className="flex gap-2">
                                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f2ca50]/70" />
                                  {/\[[^\]]+\]\([^)]+\)/.test(line) ? (
                                    <div className="min-w-0 flex-1 break-all text-white/65 [&_p]:m-0 [&_a]:break-all [&_a]:text-[#f2ca50] [&_a]:underline [&_a]:decoration-[rgba(242,202,80,0.4)] [&_a]:underline-offset-2">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {line.replace(/^-+\s*/, "")}
                                      </ReactMarkdown>
                                    </div>
                                  ) : (
                                    <span>{line.replace(/^-+\s*/, "")}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {message.status === "error" ? (
                          <div className="not-prose mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffb4ab]">
                            <span className="material-symbols-outlined text-base leading-none">
                              error
                            </span>
                            Needs attention
                          </div>
                        ) : null}
                        {predmarketInlineBlocks ? (
                          <div className="space-y-4">
                            {predmarketInlineBlocks.map((block, blockIndex) =>
                              block.type === "markdown" ? (
                                <ReactMarkdown
                                  key={`${message.id}-predmarket-inline-markdown-${blockIndex}`}
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    h1: ({ children }) => (
                                      <h1 className="mb-4 mt-0 border-b border-[#f2ca50]/20 pb-3 text-[clamp(1.35rem,2vw,1.85rem)] font-semibold leading-tight text-white">
                                        {children}
                                      </h1>
                                    ),
                                    h2: ({ children }) => (
                                      <h2 className="mb-2 mt-7 flex items-center gap-2 text-[1.08rem] font-semibold leading-snug text-[#f2ca50]">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#f2ca50]" />
                                        {children}
                                      </h2>
                                    ),
                                    h3: ({ children }) => (
                                      <h3 className="mb-2 mt-5 text-base font-semibold text-white">
                                        {children}
                                      </h3>
                                    ),
                                    p: ({ children }) => (
                                      <p className="my-3 first:mt-0 last:mb-0 text-[15px] leading-7 text-white/88">
                                        {children}
                                      </p>
                                    ),
                                    ul: ({ children }) => (
                                      <ul className="my-3 space-y-2 pl-0">{children}</ul>
                                    ),
                                    li: ({ children }) => (
                                      <li className="flex gap-2 text-[15px] leading-7 text-white/82">
                                        <span className="mt-3 h-1 w-1 shrink-0 rounded-full bg-[#f2ca50]/80" />
                                        <div className="min-w-0 flex-1">{children}</div>
                                      </li>
                                    ),
                                    strong: ({ children }) => (
                                      <strong className="font-semibold text-[#f7d768]">{children}</strong>
                                    ),
                                    hr: () => <hr className="my-6 border-[#f2ca50]/15" />,
                                    a: ({ href, children }) => (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all text-[#f2ca50] underline decoration-[rgba(242,202,80,0.5)] underline-offset-2 hover:text-white/90"
                                      >
                                        {children}
                                      </a>
                                    ),
                                    code: ({ className, children, ...props }) => {
                                      const codeText = String(children).replace(/\n$/, "");
                                      const blockCode = !Boolean((props as { inline?: boolean }).inline);
                                      if (blockCode) {
                                        return (
                                          <code
                                            {...props}
                                            className={`${className} font-mono text-[12px] leading-[1.15] text-white/92`}
                                          >
                                            {codeText}
                                          </code>
                                        );
                                      }
                                      return (
                                        <code
                                          {...props}
                                          className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.92em] text-[#f2ca50]"
                                        >
                                          {codeText}
                                        </code>
                                      );
                                    },
                                  }}
                                >
                                  {block.content}
                                </ReactMarkdown>
                              ) : (
                                <div
                                  key={`${message.id}-predmarket-inline-group-${blockIndex}`}
                                  className={
                                    block.content
                                      ? "space-y-3 rounded-2xl border border-white/10 bg-[#171717] px-4 py-4"
                                      : "space-y-2"
                                  }
                                >
                                  {block.content ? (
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        h3: ({ children }) => (
                                          <h3 className="mb-2 mt-0 text-[13px] font-black uppercase tracking-[0.16em] text-white/72">
                                            {children}
                                          </h3>
                                        ),
                                        p: ({ children }) => (
                                          <p className="my-2 first:mt-0 last:mb-0 text-[15px] leading-7 text-white/88">
                                            {children}
                                          </p>
                                        ),
                                        ul: ({ children }) => (
                                          <ul className="my-2 space-y-2 pl-0">{children}</ul>
                                        ),
                                        li: ({ children }) => (
                                          <li className="flex gap-2 text-[15px] leading-7 text-white/82">
                                            <span className="mt-3 h-1 w-1 shrink-0 rounded-full bg-[#f2ca50]/80" />
                                            <div className="min-w-0 flex-1">{children}</div>
                                          </li>
                                        ),
                                        strong: ({ children }) => (
                                          <strong className="font-semibold text-[#f7d768]">{children}</strong>
                                        ),
                                        code: ({ children }) => (
                                          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.92em] text-[#f2ca50]">
                                            {children}
                                          </code>
                                        ),
                                      }}
                                    >
                                      {block.content}
                                    </ReactMarkdown>
                                  ) : block.title ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                                      {block.title}
                                    </div>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2">
                                    {block.actions.map((action, actionIndex) => (
                                      <button
                                        key={`${message.id}-inline-action-${blockIndex}-${actionIndex}`}
                                        type="button"
                                        onClick={() =>
                                          onSendMessage?.(
                                            encodeQuickActionMessage(action, block.title),
                                          )
                                        }
                                        className={
                                          action.tone === "secondary"
                                            ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-[#201f1f] px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/55 transition hover:border-[rgba(242,202,80,0.25)] hover:text-white/90"
                                            : "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.12)] px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.20)]"
                                        }
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        ) : plainAssistantBubble && !fencedCodeBlock && !alignedTextBlock && !markdownLikeAssistantMessage ? (
                          <div className="space-y-3 break-words text-[15px] leading-7 text-white/90">
                            {formatPlainAssistantBlocks(renderedContent).map((block, blockIndex) =>
                              block.type === "bullet_list" ? (
                                <ul
                                  key={`${message.id}-plain-bullets-${blockIndex}`}
                                  className="space-y-2"
                                >
                                  {block.items.map((item, itemIndex) => (
                                    <li
                                      key={`${message.id}-plain-bullets-${blockIndex}-${itemIndex}`}
                                      className="flex gap-2 text-[15px] leading-7 text-white/88"
                                    >
                                      <span className="mt-3 h-1 w-1 shrink-0 rounded-full bg-[#f2ca50]/80" />
                                      <div className="min-w-0 flex-1">{item}</div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p
                                  key={`${message.id}-plain-paragraph-${blockIndex}`}
                                  className="whitespace-pre-wrap"
                                >
                                  {block.content}
                                </p>
                              ),
                            )}
                          </div>
                        ) : alignedTextBlock ? (
                          <div className="not-prose overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-3">
                            <pre className="m-0 w-max min-w-full whitespace-pre font-mono text-[12px] leading-[1.15] text-white/92">
                              {visibleRenderedContent}
                            </pre>
                          </div>
                        ) : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              h1: ({ children }) => (
                                <h1 className="mb-4 mt-0 border-b border-[#f2ca50]/20 pb-3 text-[clamp(1.35rem,2vw,1.85rem)] font-semibold leading-tight text-white">
                                  {children}
                                </h1>
                              ),
                              h2: ({ children }) => (
                                <h2 className="mb-2 mt-7 flex items-center gap-2 text-[1.08rem] font-semibold leading-snug text-[#f2ca50]">
                                  <span className="h-1.5 w-1.5 rounded-full bg-[#f2ca50]" />
                                  {children}
                                </h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className="mb-2 mt-5 text-base font-semibold text-white">
                                  {children}
                                </h3>
                              ),
                              p: ({ children }) => (
                                <p className="my-3 first:mt-0 last:mb-0 text-[15px] leading-7 text-white/88">
                                  {children}
                                </p>
                              ),
                              ul: ({ children }) => (
                                <ul className="my-3 space-y-2 pl-0">{children}</ul>
                              ),
                              li: ({ children }) => (
                                <li className="flex gap-2 text-[15px] leading-7 text-white/82">
                                  <span className="mt-3 h-1 w-1 shrink-0 rounded-full bg-[#f2ca50]/80" />
                                  <div className="min-w-0 flex-1">{children}</div>
                                </li>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-[#f7d768]">{children}</strong>
                              ),
                              hr: () => <hr className="my-6 border-[#f2ca50]/15" />,
                              table: ({ children }) => (
                                <div className="not-prose my-4 overflow-x-auto rounded-lg border border-white/10">
                                  <table className="min-w-full border-collapse text-left text-sm">
                                    {children}
                                  </table>
                                </div>
                              ),
                              th: ({ children }) => (
                                <th className="border-b border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#f2ca50]">
                                  {children}
                                </th>
                              ),
                              td: ({ children }) => (
                                <td className="border-b border-white/5 px-3 py-2 text-white/82">
                                  {children}
                                </td>
                              ),
                              a: ({ href, children }) => (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={
                                    txReceipt
                                      ? "break-all text-[#f2ca50] underline decoration-[rgba(242,202,80,0.4)] underline-offset-2 hover:text-white/90"
                                      : "break-all text-[#f2ca50] underline decoration-[rgba(242,202,80,0.5)] underline-offset-2 hover:text-white/90"
                                  }
                                >
                                  {children}
                                </a>
                              ),
                              pre: ({ children }) => (
                                <pre className="not-prose my-4 overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-3">
                                  {children}
                                </pre>
                              ),
                              code: ({ className, children, ...props }) => {
                                const codeText = String(children).replace(/\n$/, "");
                                const blockCode = !Boolean(
                                  (props as { inline?: boolean }).inline,
                                );

                                if (blockCode) {
                                  return (
                                    <code
                                      {...props}
                                      className={`${className} font-mono text-[12px] leading-[1.15] text-white/92`}
                                    >
                                      {codeText}
                                    </code>
                                  );
                                }

                                return (
                                  <code
                                    {...props}
                                    className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.92em] text-[#f2ca50]"
                                  >
                                    {codeText}
                                  </code>
                                );
                              },
                            }}
                          >
                            {markdownContent}
                          </ReactMarkdown>
                        )}
                        {portfolioPaid ? (
                          <div className="not-prose mt-5 border-t border-[#f2ca50]/15 pt-4">
                            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/38">
                              Nanopayment
                            </div>
                            {(message.paymentMeta?.entries?.length ?? 0) > 0 ? (
                              <div className="space-y-2">
                                {message.paymentMeta?.entries.map((entry) => (
                                  <div
                                    key={entry.requestId}
                                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px]"
                                  >
                                    <span className="text-white/62">
                                      {entry.agent.charAt(0).toUpperCase()}
                                      {entry.agent.slice(1)} Agent via Gateway/DCW
                                    </span>
                                    <span className="font-mono text-[#f2ca50]">
                                      {entry.price || "x402"}
                                    </span>
                                    <span className="basis-full font-mono text-[11px] text-white/35">
                                      request {shortPaymentRef(entry.requestId)}
                                      {entry.transactionRef
                                        ? ` · ref ${shortPaymentRef(entry.transactionRef)}`
                                        : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[12px] text-white/45">
                                Paid Portfolio Agent via x402.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {message.attachment ? (
                          <div className="rounded-2xl border border-white/10 bg-[#201f1f] p-2.5">
                            {message.attachment.kind === "image" &&
                            message.attachment.previewUrl ? (
                              <Image
                                src={message.attachment.previewUrl}
                                alt={message.attachment.name}
                                className="max-h-72 w-full rounded-xl object-cover"
                                width={1200}
                                height={720}
                                unoptimized
                              />
                            ) : (
                              <div className="flex items-center gap-3 rounded-xl bg-[#2a2a2a] px-3 py-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#201f1f]">
                                  <span className="material-symbols-outlined text-[#f2ca50]">
                                    {message.attachment.kind === "pdf"
                                      ? "picture_as_pdf"
                                      : "description"}
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-white/90">
                                    {message.attachment.name}
                                  </div>
                                  <div className="text-xs text-white/40">
                                    {attachmentLabel(message.attachment)} ·{" "}
                                    {formatAttachmentSize(message.attachment.size)}
                                  </div>
                                </div>
                              </div>
                            )}

                            {message.attachment.kind === "image" ? (
                              <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
                                <span className="rounded-full bg-[#2a2a2a] px-2 py-1">
                                  {attachmentLabel(message.attachment)}
                                </span>
                                <span>{formatAttachmentSize(message.attachment.size)}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {renderedContent ? (
                          <p className="text-[15px] leading-7 text-white/90">{renderedContent}</p>
                        ) : userHasAttachment ? null : (
                          <p className="text-[15px] leading-7 text-white/90">{renderedContent}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isAssistant && message.paymentLink ? (
                  <PaymentLinkCard
                    handle={message.paymentLink.handle}
                    displayHandle={message.paymentLink.displayHandle}
                    amount={message.paymentLink.amount}
                    remark={message.paymentLink.remark}
                    path={message.paymentLink.path}
                  />
                ) : null}

                {showConfirmationActions ? (
                  <div className="flex flex-wrap gap-2">
                    {/* Schedule agent: disambiguate — show one button per choice */}
                    {message.confirmation?.choices?.length ? (
                      message.confirmation.choices.map((choice) => (
                        <button
                          key={choice.confirmId}
                          type="button"
                          onClick={() => {
                            onConfirmAction?.({
                              messageId: message.id,
                              action: "schedule",
                              confirmId: choice.confirmId,
                              label: choice.label,
                            });
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.12)] px-4 py-2 text-sm font-medium text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.20)]"
                        >
                          {choice.label}
                        </button>
                      ))
                    ) : message.confirmation?.confirmId ? (
                      /* Split or schedule agent: single confirm button with action-aware routing */
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const action = message.confirmation!.action;
                            const confirmId = message.confirmation!.confirmId!;
                            if (action !== "schedule" && action !== "split" && action !== "invoice" && action !== "batch") {
                              return;
                            }
                            onConfirmAction?.({
                              messageId: message.id,
                              action,
                              confirmId,
                              label:
                                message.confirmation?.confirmLabel ||
                                getConfirmationPrimaryLabel(
                                  message.confirmation?.action,
                                  renderedContent,
                                ),
                            });
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.12)] px-4 py-2 text-sm font-medium text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.20)]"
                        >
                          {message.confirmation.confirmLabel || getConfirmationPrimaryLabel(message.confirmation?.action, renderedContent)}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSendMessage?.("NO")}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#201f1f] px-4 py-2 text-sm font-medium text-white/40 transition hover:border-[rgba(242,202,80,0.25)] hover:text-white/90"
                        >
                          {getConfirmationSecondaryLabel(
                            message.confirmation?.action,
                            renderedContent,
                          )}
                        </button>
                      </>
                    ) : (
                      /* Legacy YES/NO flow for swap, vault, bridge, etc. */
                      <>
                        <button
                          type="button"
                          onClick={() => onSendMessage?.("YES")}
                          className="inline-flex items-center gap-2 rounded-full border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.12)] px-4 py-2 text-sm font-medium text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.20)]"
                        >
                          {getConfirmationPrimaryLabel(
                            message.confirmation?.action,
                            renderedContent,
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSendMessage?.("NO")}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#201f1f] px-4 py-2 text-sm font-medium text-white/40 transition hover:border-[rgba(242,202,80,0.25)] hover:text-white/90"
                        >
                          {getConfirmationSecondaryLabel(
                            message.confirmation?.action,
                            renderedContent,
                          )}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
                {isAssistant && visibleQuickActionGroups?.length && !predmarketInlineBlocks ? (
                  <div className="space-y-3">
                    {visibleQuickActionGroups.map((group, groupIndex) => (
                      <div key={`${message.id}-quick-actions-${groupIndex}`} className="space-y-2">
                        {group.title && !isPredictionMarketReportFooter ? (
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                            {group.title}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {group.actions.map((action, actionIndex) => (
                            <button
                              key={`${message.id}-quick-action-${groupIndex}-${actionIndex}`}
                              type="button"
                              onClick={() =>
                                onSendMessage?.(
                                  encodeQuickActionMessage(action, group.title),
                                )
                              }
                              className={
                                action.tone === "secondary"
                                  ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-[#201f1f] px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/55 transition hover:border-[rgba(242,202,80,0.25)] hover:text-white/90"
                                  : "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[rgba(242,202,80,0.35)] bg-[rgba(242,202,80,0.12)] px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.20)]"
                              }
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {ratingMeta ? (
                  <div className="flex items-center gap-1 rounded-full border border-[rgba(242,202,80,0.22)] bg-[#201f1f]/70 px-2 py-1">
                    <span className="mr-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                      Rate
                    </span>
                    {[1, 2, 3, 4, 5].map((stars) => {
                      const selected = Number(message.agentRating?.stars ?? 0) >= stars;
                      const disabled = message.agentRating?.status === "pending";
                      return (
                        <button
                          key={stars}
                          type="button"
                          disabled={disabled}
                          onClick={() => onRateAgent?.(message.id, stars, ratingMeta)}
                          title={`Rate ${stars} star${stars === 1 ? "" : "s"}`}
                          aria-label={`Rate this paid agent task ${stars} star${stars === 1 ? "" : "s"}`}
                          className={`text-lg leading-none transition ${
                            selected
                              ? "text-[#f2ca50]"
                              : "text-white/25 hover:text-[#f2ca50]"
                          } ${disabled ? "cursor-wait opacity-60" : ""}`}
                        >
                          ★
                        </button>
                      );
                    })}
                    {message.agentRating?.status === "failed" && message.agentRating.error ? (
                      <span
                        className="ml-2 max-w-[220px] truncate text-xs text-[#ffb4ab]"
                        title={message.agentRating.error}
                      >
                        Retry
                      </span>
                    ) : null}
                  </div>
                ) : isAssistant && message.status === "complete" && message.eventId ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onFeedback?.(message.id, "positive")}
                      title="Helpful"
                      aria-label="Mark response helpful"
                      className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                        message.feedback === "positive"
                          ? "border-[#f2ca50]/45 bg-[#f2ca50]/15 text-[#f2ca50]"
                          : "border-white/10 bg-[#201f1f]/70 text-white/35 hover:border-[#f2ca50]/30 hover:text-[#f2ca50]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[17px]">thumb_up</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onFeedback?.(message.id, "negative")}
                      title="Not helpful"
                      aria-label="Mark response not helpful"
                      className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                        message.feedback === "negative"
                          ? "border-[#ffb4ab]/45 bg-[#ffb4ab]/12 text-[#ffb4ab]"
                          : "border-white/10 bg-[#201f1f]/70 text-white/35 hover:border-[#ffb4ab]/30 hover:text-[#ffb4ab]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[17px]">thumb_down</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
        <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full" />
      </div>
    </div>
  );
}
