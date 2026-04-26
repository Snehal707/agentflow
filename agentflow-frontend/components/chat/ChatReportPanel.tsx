import { useEffect, useMemo, useState } from "react";
import type { ChatTraceEntry, LiveChatMessage } from "@/components/chat/types";
import { traceEntryText } from "@/lib/bridgeTrace";
import { messageSupportsReportPanel } from "@/lib/chatInspector";

type ChatReportPanelProps = {
  message: LiveChatMessage | null;
  isOpen: boolean;
  onClose: () => void;
};

type AttemptRecord = {
  requestId: string;
  stage?: string;
  payer?: string;
  transaction?: string;
  updatedAt?: string;
  error?: string;
  mode?: "eoa" | "dcw";
  slug?: string;
};

const stageOrder = [
  "started",
  "preflight_ok",
  "payment_required",
  "payload_created",
  "paid_request_sent",
  "succeeded",
] as const;

function stageProgress(stage?: string): number {
  if (!stage) return 8;
  if (stage === "failed") return 100;
  const idx = stageOrder.indexOf(stage as (typeof stageOrder)[number]);
  if (idx < 0) return 12;
  return Math.round(((idx + 1) / stageOrder.length) * 100);
}

function stageLabel(stage?: string): string {
  switch (stage) {
    case "started":
      return "Started";
    case "preflight_ok":
      return "Preflight passed";
    case "payment_required":
      return "Payment required";
    case "payload_created":
      return "Payload created";
    case "paid_request_sent":
      return "Paid request sent";
    case "succeeded":
      return "Settled";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

function shortHash(value?: string | null): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function TraceTimelineRow({ step }: { step: ChatTraceEntry }) {
  if (typeof step === "string") {
    return (
      <span className="block whitespace-pre-wrap break-all leading-6">
        {step}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="whitespace-pre-wrap break-all leading-6">
        {step.label}
      </span>
      {step.txHash && step.explorerUrl ? (
        <a
          href={step.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-[11px] text-[#f2ca50] underline-offset-2 hover:underline"
          title="View on block explorer"
        >
          {step.txHash}
        </a>
      ) : null}
    </div>
  );
}

function buildProgress(message: LiveChatMessage | null): number {
  if (!message) return 0;
  if (message.status === "complete") return 100;
  if (message.status === "error") return 100;
  return Math.min(88, 18 + (message.trace?.length ?? 0) * 16);
}

function buildClusterNames(message: LiveChatMessage | null): string[] {
  if (!message) return [];

  if (message.activityMeta?.clusters?.length) {
    return message.activityMeta.clusters.slice(0, 4);
  }

  const values = new Set<string>();
  if (message.title) {
    values.add(message.title);
  }

  for (const step of message.trace ?? []) {
    const normalized = traceEntryText(step).toLowerCase();
    if (normalized.includes("research")) values.add("Research Agent");
    if (normalized.includes("analyst")) values.add("Analyst Agent");
    if (normalized.includes("writer")) values.add("Writer Agent");
    if (normalized.includes("swap")) values.add("Swap Agent");
    if (normalized.includes("vault")) values.add("Vault Agent");
    if (normalized.includes("bridge")) values.add("Bridge Agent");
    if (normalized.includes("portfolio")) values.add("Portfolio Agent");
  }

  for (const entry of message.paymentMeta?.entries ?? []) {
    if (entry.agent) {
      values.add(`${entry.agent.charAt(0).toUpperCase()}${entry.agent.slice(1)} Agent`);
    }
  }

  return Array.from(values).slice(0, 4);
}

export function ChatReportPanel({
  message,
  isOpen,
  onClose,
}: ChatReportPanelProps) {
  const paymentEntries = useMemo(() => message?.paymentMeta?.entries ?? [], [message]);
  const [attempts, setAttempts] = useState<Record<string, AttemptRecord>>({});
  const requestIds = useMemo(
    () => paymentEntries.map((entry) => entry.requestId).filter(Boolean),
    [paymentEntries],
  );

  useEffect(() => {
    if (!requestIds.length) {
      setAttempts({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const updates = await Promise.all(
        requestIds.map(async (requestId) => {
          try {
            const response = await fetch(`/api/x402/attempts/${encodeURIComponent(requestId)}`, {
              cache: "no-store",
            });
            if (!response.ok) {
              return null;
            }
            const payload = (await response.json()) as
              | AttemptRecord
              | { ok?: boolean; record?: AttemptRecord };
            const record =
              payload && typeof payload === "object" && "record" in payload
                ? payload.record ?? null
                : (payload as AttemptRecord);
            if (!record) {
              return null;
            }
            return [requestId, record] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;
      setAttempts((previous) => {
        const next = { ...previous };
        for (const update of updates) {
          if (!update) continue;
          next[update[0]] = update[1];
        }
        return next;
      });
    };

    void load();
    const interval = window.setInterval(() => {
      if (
        requestIds.some((requestId) => {
          const stage = attempts[requestId]?.stage;
          return stage !== "succeeded" && stage !== "failed";
        })
      ) {
        void load();
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [attempts, requestIds]);

  if (!isOpen || (!messageSupportsReportPanel(message) && paymentEntries.length === 0)) {
    return null;
  }

  const progress = buildProgress(message);
  const clusters = buildClusterNames(message);
  const evidence = message?.reportMeta?.evidence;
  const sourceCount = message?.reportMeta?.sources?.length ?? 0;
  const diagnosticCount = message?.reportMeta?.diagnostics?.length ?? 0;
  const traceCount = message?.trace?.length ?? 0;
  const freshness = message?.reportMeta?.freshness;
  const highlights = message?.reportMeta?.highlights ?? [];
  const diagnostics = message?.reportMeta?.diagnostics ?? [];
  const metricBars = message?.activityMeta?.stageBars?.length
    ? message.activityMeta.stageBars
    : [
        Math.max(12, Math.min(96, sourceCount * 16)),
        Math.max(16, Math.min(110, traceCount * 14)),
        Math.max(14, Math.min(100, (evidence?.confirmed ?? 0) * 18)),
        Math.max(22, Math.min(126, progress * 1.1)),
        Math.max(18, Math.min(92, diagnosticCount * 18)),
        Math.max(20, Math.min(108, (message?.reportMeta?.highlights?.length ?? 0) * 18)),
      ];
  const stateLabel = !message
    ? "IDLE"
    : message.status === "streaming"
      ? "LIVE SYNC"
      : message.status === "error"
        ? "ISSUE"
        : "READY";
  const metricsLabel = message?.activityMeta?.mode === "brain" ? "Execution Stages" : "Throughput History";

  return (
    <aside className="scrollbar-hide flex w-80 flex-shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-black/60 backdrop-blur-3xl">
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-medium italic tracking-wide text-white/90">
            Executive Summary
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#f2ca50] transition hover:bg-[rgba(242,202,80,0.12)]"
          >
            {stateLabel}
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#201f1f] p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
                Agent Status
              </p>
              <h4 className="font-display text-xl font-black text-white/90">
                {message?.title || "Standby"}
              </h4>
            </div>
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-[rgba(242,202,80,0.35)]">
              <div
                className={`absolute inset-0 rounded-full border-t-2 border-[#f2ca50] ${
                  message?.status === "streaming" ? "animate-spin" : ""
                }`}
              />
              <span className="material-symbols-outlined text-lg text-[#f2ca50]">
                data_usage
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Task completion</span>
              <span className="font-bold text-[#f2ca50]">{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black">
              <div
                className="h-full rounded-full bg-[#f2ca50] shadow-[0_0_8px_rgba(242,202,80,0.35)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 rounded-xl border border-white/10 bg-black p-4">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              {metricsLabel}
            </p>
            <div className="flex h-32 items-end justify-between gap-1 px-1">
              {metricBars.map((height, index) => (
                <div
                  key={`${height}-${index}`}
                  className={`w-full rounded-t-sm ${
                    index === 3 ? "bg-[#f2ca50]" : "bg-[rgba(242,202,80,0.2)]"
                  }`}
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Sources
            </p>
            <p className="font-display text-2xl font-black text-[#f2ca50]">
              {sourceCount}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Trace
            </p>
            <p className="font-display text-2xl font-black text-[#f2ca50]">
              {traceCount}
            </p>
          </div>
        </div>

        <div className="space-y-4">
            <h5 className="px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Strategic Actions
          </h5>
          {clusters.length > 0 ? (
            clusters.map((cluster) => (
              <div
                key={cluster}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-[#201f1f] p-3 transition-all hover:border-[rgba(242,202,80,0.25)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black">
                  <span className="material-symbols-outlined text-[#f2ca50]">hub</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-white/90">{cluster}</div>
                  <div className="text-[10px] text-white/40">Active reasoning chain</div>
                </div>
                <span className="material-symbols-outlined text-sm text-[#f2ca50]">
                  check_circle
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-xl bg-[#201f1f] p-3 text-sm text-white/40">
              No active clusters yet.
            </div>
          )}
        </div>

        {traceCount > 0 ? (
          <div className="space-y-4">
            <h5 className="px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Settlement Timeline
            </h5>
            <div className="space-y-2">
              {message?.trace?.map((step, index) => (
                <div
                  key={`${message.id}-trace-${index}`}
                  className="min-w-0 rounded-xl border border-white/10 bg-black px-4 py-3 text-sm text-white/90"
                >
                  <TraceTimelineRow step={step} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {paymentEntries.length > 0 ? (
          <div className="space-y-4">
            <h5 className="px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Nanopayment
            </h5>
            <div className="space-y-3">
              {paymentEntries.map((entry) => {
                const attempt = attempts[entry.requestId];
                const stage = attempt?.stage;
                const progress = stageProgress(stage);
                return (
                  <div
                    key={entry.requestId}
                    className="rounded-xl border border-white/10 bg-[#201f1f] p-4"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white/90">
                          {entry.agent.charAt(0).toUpperCase()}
                          {entry.agent.slice(1)} Agent
                        </div>
                        <div className="mt-1 text-[11px] text-white/45">
                          {entry.sponsored ? "Sponsored by AgentFlow" : "User-paid via Gateway/DCW"}
                        </div>
                      </div>
                      <div className="rounded-full border border-[#f2ca50]/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]">
                        {stageLabel(stage)}
                      </div>
                    </div>

                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black">
                      <div
                        className={`h-full rounded-full ${
                          stage === "failed" ? "bg-red-400" : "bg-[#f2ca50]"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/45">Batch / Request ID</span>
                        <span className="font-mono text-white/85">{shortHash(entry.requestId)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/45">Price</span>
                        <span className="text-white/85">{entry.price || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/45">Payer</span>
                        <span className="font-mono text-white/85">{shortHash(entry.payer)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/45">Payment ref</span>
                        <span className="font-mono text-white/85">
                          {shortHash(entry.transactionRef || attempt?.transaction)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/45">Settlement tx</span>
                        <span className="font-mono text-white/85">
                          {shortHash(entry.settlementTxHash)}
                        </span>
                      </div>
                      {attempt?.updatedAt ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/45">Last update</span>
                          <span className="text-white/70">
                            {new Date(attempt.updatedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      ) : null}
                      {attempt?.error ? (
                        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                          {attempt.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {message && (freshness || evidence || message.reportMeta?.premiseNote || diagnostics.length > 0 || highlights.length > 0) ? (
          <div className="space-y-4">
            <h5 className="px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Report Signals
            </h5>

            {freshness ? (
              <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                  {freshness.label}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/90">{freshness.detail}</div>
              </div>
            ) : null}

            {evidence ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-[#201f1f] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                    Confirmed
                  </div>
                  <div className="mt-2 font-display text-2xl font-black text-white/90">
                    {evidence.confirmed}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#201f1f] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                    Reported
                  </div>
                  <div className="mt-2 font-display text-2xl font-black text-white/90">
                    {evidence.reported}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#201f1f] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                    Analysis
                  </div>
                  <div className="mt-2 font-display text-2xl font-black text-white/90">
                    {evidence.analysis}
                  </div>
                </div>
              </div>
            ) : null}

            {message.reportMeta?.premiseNote ? (
              <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4 text-sm leading-6 text-white/90">
                {message.reportMeta.premiseNote}
              </div>
            ) : null}

            {highlights.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                  Highlights
                </div>
                <div className="space-y-2">
                  {highlights.slice(0, 3).map((highlight) => (
                    <div
                      key={highlight}
                      className="rounded-lg bg-black/70 px-3 py-2 text-sm text-white/90"
                    >
                      {highlight}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {diagnostics.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#201f1f] p-4">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[#f2ca50]">
                  Diagnostics
                </div>
                <div className="space-y-2">
                  {diagnostics.slice(0, 4).map((diagnostic) => (
                    <div
                      key={diagnostic}
                      className="rounded-lg bg-black/70 px-3 py-2 text-sm text-white/90"
                    >
                      {diagnostic}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {message?.reportMeta?.sources?.length ? (
          <div className="space-y-4">
            <h5 className="px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Sources
            </h5>
            <div className="space-y-2">
              {message.reportMeta.sources.slice(0, 4).map((source) => (
                <a
                  key={`${source.name}-${source.url}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl bg-[#201f1f] p-3 text-sm text-white/90 transition hover:bg-[#2a2a2a]"
                >
                  <div>{source.name}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
                    {source.usedFor || "Source"}
                  </div>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none select-none pt-8 opacity-20">
          <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <p className="text-center font-display text-4xl font-black tracking-tighter">
            AGENTFLOW
          </p>
        </div>
      </div>
    </aside>
  );
}
