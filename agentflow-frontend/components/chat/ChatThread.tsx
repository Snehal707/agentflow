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
  onConfirmAction?: (input: {
    messageId: string;
    action: "schedule" | "split" | "invoice" | "batch";
    confirmId: string;
    label: string;
  }) => void;
};

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
    /^Vault \w+ complete on Arc\./m.test(c) ||
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
    .replace(/\n*Reply\s+YES\s+to\s+\w[\w\s]*?(?:\s+or\s+NO\s+to\s+cancel)?\.?\s*$/i, "")
    .replace(/\n*Reply\s+YES\s+to\s+cancel\s+or\s+NO\s+to\s+keep\s+it\.?\s*$/i, "")
    .replace(
      /\n+(?:\*\*)?Reply\s+YES\s+to\s+confirm[\s\S]*?(?:NO\s+to\s+cancel)?\.?\s*$/i,
      "",
    )
    .replace(/\n*Confirm\s+to\s+send\s+all\s+transfers[^.]*\.?\s*$/i, "")
    .trimEnd();
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

function looksLikeAsciiArt(content: string): boolean {
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
          const showConfirmationActions =
            isAssistant &&
            typeof onSendMessage === "function" &&
            message.confirmation?.required === true &&
            index === messages.length - 1;
          const renderedContent = isAssistant
            ? stripConfirmationCta(stripDisplayMetadata(message.content)).trimStart()
            : message.content;
          const reportParts = isAssistant
            ? splitAssistantReport(renderedContent)
            : { progress: "", report: renderedContent, hasReport: false };
          const markdownContent = reportParts.hasReport
            ? normalizeReportMarkdown(reportParts.report)
            : renderedContent;
          const progressLines = reportParts.hasReport
            ? formatProgressLines(reportParts.progress)
            : [];
          const isReportMessage =
            isAssistant &&
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
          const asciiArtBlock =
            isAssistant &&
            !isReportMessage &&
            !fencedCodeBlock &&
            looksLikeAsciiArt(renderedContent);
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
                    className={`min-w-0 max-w-full overflow-hidden leading-relaxed ${
                      isAssistant
                        ? message.status === "error"
                          ? "rounded-xl rounded-tl-none border border-[#ffb4ab]/20 border-l-2 border-l-[#ffb4ab] bg-[#241818]/80 p-4 text-[#ffe7e3]"
                        : txReceipt
                          ? selected
                            ? "rounded-xl rounded-tl-none border border-[#f2ca50]/25 border-l-[3px] border-l-[#f2ca50] bg-gradient-to-br from-[#f2ca50]/5 via-[#141a18] to-[#1d2025]/95 p-5 text-[#f6f6fc] shadow-[0_0_48px_-16px_rgba(242,202,80,0.20)]"
                            : "rounded-xl rounded-tl-none border border-[#f2ca50]/15 border-l-[3px] border-l-[#f2ca50]/80 bg-gradient-to-br from-[#f2ca50]/5 via-[#121816] to-[#1d2025]/90 p-5 text-[#f6f6fc] shadow-[0_0_40px_-18px_rgba(242,202,80,0.15)]"
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
                        {plainAssistantBubble && !fencedCodeBlock && !asciiArtBlock && !markdownLikeAssistantMessage ? (
                          <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-white/90">
                            {renderedContent}
                          </div>
                        ) : asciiArtBlock ? (
                          <div className="not-prose overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-3">
                            <pre className="m-0 w-max min-w-full whitespace-pre font-mono text-[12px] leading-[1.15] text-white/92">
                              {renderedContent}
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
              </div>
            </article>
          );
        })}
        <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full" />
      </div>
    </div>
  );
}
