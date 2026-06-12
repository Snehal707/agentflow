"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import {
  exportSemanticMemoryReviewDataset,
  fetchSemanticMemoryMetrics,
  fetchSemanticMemoryReviewCases,
  patchSemanticMemoryReviewCase,
  type SemanticMemoryMetricsReport,
  type SemanticMemoryReviewCase,
  type SemanticMemoryReviewLabel,
} from "@/lib/liveProductClient";
import { useSidebarPreference } from "@/lib/useSidebarPreference";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

const REVIEW_LABELS: Array<{
  value: SemanticMemoryReviewLabel;
  label: string;
}> = [
  { value: "correct", label: "Correct" },
  { value: "needs_profile", label: "Needs profile" },
  { value: "needs_episodic", label: "Needs episodic" },
  { value: "needs_routing", label: "Needs routing" },
  { value: "needs_clarification", label: "Needs clarification" },
  { value: "ignore", label: "Ignore" },
];

function formatNumber(value: number | null | undefined, digits = 0): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric);
}

function formatPercent(value: number | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0%";
  }
  return `${(numeric * 100).toFixed(1)}%`;
}

function metricTone(value: string): string {
  if (value === "healthy") return "text-emerald-300";
  if (value === "watch") return "text-[#f2ca50]";
  return "text-rose-300";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function MetricCard({
  eyebrow,
  value,
  detail,
  accent = false,
  toneClassName,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  accent?: boolean;
  toneClassName?: string;
}) {
  return (
    <div className={`internal-admin-kpi rounded-[28px] p-5 ${accent ? "internal-admin-kpi-gold" : ""}`}>
      <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">{eyebrow}</p>
      <p className={`mt-4 text-4xl font-semibold tracking-[-0.05em] text-white ${toneClassName ?? ""}`}>
        {value}
      </p>
      <p className="mt-2 text-sm text-white/52">{detail}</p>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  toneClassName,
}: {
  label: string;
  value: string;
  toneClassName?: string;
}) {
  return (
    <div className="internal-admin-kpi rounded-[24px] p-4">
      <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">{label}</p>
      <p className={`mt-3 text-2xl font-semibold tracking-[-0.04em] text-white ${toneClassName ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

export function MemoryAdminPanel({ routeLabel }: { routeLabel: string }) {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [metrics, setMetrics] = useState<SemanticMemoryMetricsReport | null>(null);
  const [cases, setCases] = useState<SemanticMemoryReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessWallet, setAccessWallet] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, SemanticMemoryReviewLabel>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingCaseId, setSavingCaseId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const authBearer = getAuthHeaders()?.Authorization ?? null;

  async function runAuthAction() {
    if (!address) {
      openConnectModal?.();
      return;
    }
    if (!isAuthenticated) {
      await signIn();
    }
  }

  async function loadPanel() {
    const authHeaders: Record<string, string> = authBearer ? { Authorization: authBearer } : {};
    setLoading(true);
    setError(null);

    try {
      const accessResponse = await fetch("/api/internal/access/memory", {
        headers: authHeaders,
        cache: "no-store",
      });
      const accessJson = (await accessResponse.json().catch(() => ({}))) as {
        error?: string;
        walletAddress?: string | null;
      };

      if (!accessResponse.ok) {
        throw new Error(accessJson.error || "Admin access required");
      }

      setAccessWallet(accessJson.walletAddress ?? address ?? null);

      const [nextMetrics, nextCases] = await Promise.all([
        fetchSemanticMemoryMetrics(authHeaders),
        fetchSemanticMemoryReviewCases(authHeaders, { limit: 24 }),
      ]);

      setMetrics(nextMetrics);
      setCases(nextCases);
      setDraftLabels(
        Object.fromEntries(
          nextCases.map((item) => [
            item.id,
            item.reviewLabel ?? item.recommendedLabel,
          ]),
        ) as Record<string, SemanticMemoryReviewLabel>,
      );
      setDraftNotes(
        Object.fromEntries(nextCases.map((item) => [item.id, item.reviewNote ?? ""])),
      );
    } catch (cause) {
      setMetrics(null);
      setCases([]);
      setError(cause instanceof Error ? cause.message : "Could not load memory admin panel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPanel();
  }, [authBearer, address]);

  async function saveReviewCase(caseId: string) {
    const authHeaders: Record<string, string> = authBearer ? { Authorization: authBearer } : {};
    const label = draftLabels[caseId];
    if (!label) {
      return;
    }

    setSavingCaseId(caseId);
    setError(null);
    try {
      await patchSemanticMemoryReviewCase(authHeaders, caseId, {
        label,
        note: draftNotes[caseId] || null,
      });
      await loadPanel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save review label.");
    } finally {
      setSavingCaseId(null);
    }
  }

  async function exportDataset() {
    const authHeaders: Record<string, string> = authBearer ? { Authorization: authBearer } : {};
    setExporting(true);
    setError(null);
    try {
      const blob = await exportSemanticMemoryReviewDataset(authHeaders, {
        labeledOnly: false,
        limit: 500,
      });
      downloadBlob(blob, "semantic-memory-review-dataset.json");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export review dataset.");
    } finally {
      setExporting(false);
    }
  }

  const topMemoryType = metrics?.retrievals.topReturnedTypes?.[0];
  const topMemoryCategory = metrics?.retrievals.topReturnedCategories?.[0];

  return (
    <div className="internal-admin-shell flex min-h-screen text-white">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <ChatTopNavbar
          actions={
            <>
              <Link
                href="/chat"
                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
              >
                Back to app
              </Link>
              <Link
                href="/internal/feedback"
                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
              >
                Feedback panel
              </Link>
              <SessionStatusChip
                address={address}
                isAuthenticated={isAuthenticated}
                isLoading={authLoading}
                error={authError}
                onAction={() => {
                  void runAuthAction();
                }}
                compact
              />
            </>
          }
        />

        <main className="flex-1 overflow-y-auto px-6 py-8 xl:px-10">
          <div className="mx-auto flex max-w-7xl flex-col gap-6">
            <section className="internal-admin-hero rounded-[32px] px-8 py-8 xl:px-10">
              <div className="relative z-[1] flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-4xl">
                  <p className="text-[11px] font-black uppercase tracking-[0.34em] text-[#f2ca50]">
                    Internal Admin
                  </p>
                  <h1 className="mt-4 max-w-3xl text-[clamp(2.8rem,4.8vw,4.6rem)] font-semibold tracking-[-0.06em] text-white">
                    Semantic Memory Monitor
                  </h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/62">
                    Watch the quality of retrieval, review memory misses, and export
                    corrective datasets from <code className="rounded bg-white/5 px-2 py-1 text-white/78">{routeLabel}</code>.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void loadPanel();
                    }}
                    className="internal-admin-button-secondary rounded-full px-5 py-3 text-sm font-medium transition"
                  >
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void exportDataset();
                    }}
                    disabled={exporting}
                    className="internal-admin-button-primary rounded-full px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                  >
                    {exporting ? "Exporting..." : "Export dataset"}
                  </button>
                </div>
              </div>
              <div className="relative z-[1] mt-8 flex flex-wrap gap-3 text-xs text-white/62">
                <span className="internal-admin-chip internal-admin-chip-gold rounded-full px-4 py-2">
                  Access wallet: {accessWallet ?? "local bypass or not signed"}
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Backend API: /api/internal/memory/*
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Review queue: {cases.length} cases
                </span>
              </div>
            </section>

            {error ? (
              <section className="rounded-[28px] border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-100">
                {error}
              </section>
            ) : null}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                eyebrow="Total events"
                value={formatNumber(metrics?.totalEvents)}
                detail="All recorded semantic-memory events"
                accent
              />
              <MetricCard
                eyebrow="Writes 24h"
                value={formatNumber(metrics?.history.windows.last24h.writesCount)}
                detail="New semantic writes captured in the last day"
              />
              <MetricCard
                eyebrow="Retrieval miss rate"
                value={formatPercent(metrics?.health.currentRecallMissRate)}
                detail="Zero-result recall-like events over recent retrievals"
              />
              <MetricCard
                eyebrow="Overall health"
                value={metrics?.health.overall ?? "loading"}
                detail="Current semantic-memory system status"
                toneClassName={`capitalize ${metricTone(metrics?.health.overall ?? "degraded")}`}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Health matrix</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                      Retrieval quality breakdown
                    </h2>
                  </div>
                  {loading ? <span className="text-xs text-white/45">Syncing now...</span> : null}
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {[
                    ["Snapshot freshness", metrics?.health.snapshotFreshness],
                    ["Storage reliability", metrics?.health.storageReliability],
                    ["Current retrieval", metrics?.health.currentRetrievalQuality],
                    ["Historical drift", metrics?.health.historicalRetrievalDrift],
                  ].map(([label, value]) => (
                    <div key={label} className="internal-admin-kpi rounded-[24px] p-4">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">{label}</p>
                      <p className={`mt-3 text-xl font-semibold capitalize ${metricTone(String(value ?? "degraded"))}`}>
                        {String(value ?? "loading")}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <MiniMetric
                    label="Avg returned"
                    value={formatNumber(metrics?.retrievals.averageReturnedCount, 2)}
                  />
                  <MiniMetric
                    label="Profile mismatches"
                    value={formatNumber(metrics?.retrievals.profileIntentMismatchCount)}
                  />
                  <MiniMetric
                    label="Recall-like zeroes"
                    value={formatNumber(metrics?.retrievals.zeroResultRecallLikeCount)}
                  />
                </div>

                <div className="mt-6 space-y-2">
                  {(metrics?.health.notes ?? []).length ? (
                    metrics?.health.notes.map((note) => (
                      <div
                        key={note}
                        className="rounded-[22px] border border-white/8 bg-white/[0.025] px-4 py-3 text-sm leading-6 text-white/72"
                      >
                        {note}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[22px] border border-white/8 bg-white/[0.025] px-4 py-3 text-sm text-white/45">
                      No health notes available yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
                <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Signal summary</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                  What retrievals are surfacing
                </h2>

                <div className="mt-6 space-y-3">
                  <div className="internal-admin-kpi internal-admin-kpi-gold rounded-[24px] p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Top memory type</p>
                    <p className="mt-3 text-2xl font-semibold text-white">
                      {topMemoryType?.key ?? "None yet"}
                    </p>
                    <p className="mt-2 text-sm text-white/52">
                      {topMemoryType ? `${formatNumber(topMemoryType.count)} surfaced results` : "Waiting for retrieval volume"}
                    </p>
                  </div>

                  <div className="internal-admin-kpi rounded-[24px] p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Top category</p>
                    <p className="mt-3 text-2xl font-semibold text-white">
                      {topMemoryCategory?.key ?? "None yet"}
                    </p>
                    <p className="mt-2 text-sm text-white/52">
                      {topMemoryCategory ? `${formatNumber(topMemoryCategory.count)} category hits recorded` : "No category data yet"}
                    </p>
                  </div>

                  <div className="internal-admin-kpi rounded-[24px] p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Write destinations</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(metrics?.writes.destinationBreakdown ?? {}).slice(0, 4).map(([key, count]) => (
                        <span key={key} className="internal-admin-chip rounded-full px-3 py-1.5 text-xs text-white/72">
                          {key}: {formatNumber(count)}
                        </span>
                      ))}
                      {!Object.keys(metrics?.writes.destinationBreakdown ?? {}).length ? (
                        <span className="text-sm text-white/45">No destination breakdown yet.</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Review queue</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                    Semantic memory misses
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    Label the highest-signal retrieval misses and keep your correction loop export-ready.
                  </p>
                </div>
                <span className="internal-admin-chip internal-admin-chip-gold rounded-full px-4 py-2 text-xs text-white/74">
                  {cases.length} review cases
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {!loading && cases.length === 0 ? (
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.025] px-4 py-4 text-sm text-white/45">
                    No review cases available.
                  </div>
                ) : null}

                {cases.map((item) => (
                  <article key={item.id} className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-3xl">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-[#f2ca50]">
                          {item.kind.replaceAll("_", " ")}
                        </p>
                        <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">
                          {item.query}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/68">
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          Expected {item.expectedMemoryType}
                        </span>
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          Returned {item.returnedCount}
                        </span>
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          Seen {item.occurrenceCount}x
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-[1fr,320px]">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="internal-admin-kpi rounded-[22px] p-4">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Recommended</p>
                          <p className="mt-3 text-lg font-semibold text-white">{item.recommendedLabel}</p>
                          <p className="mt-2 text-sm leading-6 text-white/60">{item.recommendationReason}</p>
                        </div>
                        <div className="internal-admin-kpi rounded-[22px] p-4">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Wallet + recall context</p>
                          <p className="mt-3 text-sm leading-6 text-white/72">
                            <span className="text-white/45">Wallet:</span> {item.walletAddress}
                            <br />
                            <span className="text-white/45">Top types:</span> {item.topTypes.join(", ") || "none"}
                            <br />
                            <span className="text-white/45">Top categories:</span> {item.topCategories.join(", ") || "none"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="block text-[10px] uppercase tracking-[0.24em] text-white/42">
                          Review label
                        </label>
                        <select
                          value={draftLabels[item.id] ?? item.recommendedLabel}
                          onChange={(event) =>
                            setDraftLabels((current) => ({
                              ...current,
                              [item.id]: event.target.value as SemanticMemoryReviewLabel,
                            }))
                          }
                          className="w-full rounded-[22px] border border-white/10 bg-[#0d0d0d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#f2ca50]/40"
                        >
                          {REVIEW_LABELS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={draftNotes[item.id] ?? ""}
                          onChange={(event) =>
                            setDraftNotes((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                          rows={4}
                          placeholder="Optional reviewer note"
                          className="w-full rounded-[22px] border border-white/10 bg-[#0d0d0d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#f2ca50]/40"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void saveReviewCase(item.id);
                          }}
                          disabled={savingCaseId === item.id}
                          className="internal-admin-button-primary w-full rounded-[22px] px-4 py-3 text-sm font-semibold transition disabled:opacity-60"
                        >
                          {savingCaseId === item.id ? "Saving..." : "Save label"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
