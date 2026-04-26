"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveChatMessage } from "@/components/chat/types";

type ChatPaymentPanelProps = {
  message: LiveChatMessage | null;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
};

type AttemptRecord = {
  requestId: string;
  stage?: string;
  payer?: string;
  transaction?: string;
  updatedAt?: string;
  error?: string;
  mode?: "eoa" | "dcw" | "a2a";
  slug?: string;
};

type AttemptRecordApiResponse =
  | AttemptRecord
  | {
      ok?: boolean;
      record?: AttemptRecord;
      error?: string;
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
  if (stage === "failed" || stage === "preflight_failed") return 100;
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
    case "preflight_failed":
      return "Preflight failed";
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

function agentName(slug?: string | null): string {
  if (!slug) return "Agent";
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)} Agent`;
}

function paymentSubtitle(
  entry: NonNullable<LiveChatMessage["paymentMeta"]>["entries"][number],
): string {
  if (entry.sponsored || entry.mode === "sponsored") {
    return "Sponsored by AgentFlow";
  }
  if (entry.mode === "a2a") {
    return entry.buyerAgent
      ? `${agentName(entry.buyerAgent)} paid via A2A/Gateway`
      : "Agent-paid via A2A/Gateway";
  }
  return "User-paid via Gateway/DCW";
}

export function ChatPaymentPanel({
  message,
  isOpen,
  onClose,
  onOpen,
}: ChatPaymentPanelProps) {
  const entries = useMemo(() => message?.paymentMeta?.entries ?? [], [message]);
  const [attempts, setAttempts] = useState<Record<string, AttemptRecord>>({});

  const requestIds = useMemo(
    () => entries.map((entry) => entry.requestId).filter(Boolean),
    [entries],
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
            const payload = (await response.json()) as AttemptRecordApiResponse;
            const record = "record" in payload && payload.record ? payload.record : payload;
            return [requestId, record as AttemptRecord] as const;
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
      void load();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [requestIds]);

  if (!entries.length) {
    return null;
  }

  if (!isOpen) {
    return (
      <div className="flex w-14 flex-shrink-0 items-start justify-center pt-6">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-2xl border border-[#f2ca50]/25 bg-[#111111] px-3 py-4 text-[10px] font-bold uppercase tracking-[0.24em] text-[#f2ca50] [writing-mode:vertical-rl]"
        >
          x402
        </button>
      </div>
    );
  }

  return (
    <aside className="scrollbar-hide flex w-80 flex-shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-black/50 px-4 py-6 backdrop-blur-2xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
            Nanopayment
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white/90">Execution Progress</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#f2ca50]"
        >
          Hide
        </button>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => {
          const attempt = attempts[entry.requestId];
          const stage = attempt?.stage;
          const progress = stageProgress(stage);
          return (
            <div
              key={entry.requestId}
              className="rounded-2xl border border-white/10 bg-[#151515] p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">
                    {agentName(entry.agent)}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {paymentSubtitle(entry)}
                  </div>
                </div>
                <div className="rounded-full border border-[#f2ca50]/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]">
                  {stageLabel(stage)}
                </div>
              </div>

              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black">
                <div
                  className={`h-full rounded-full ${
                    stage === "failed" || stage === "preflight_failed"
                      ? "bg-red-400"
                      : "bg-[#f2ca50]"
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
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                    {attempt.error}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
