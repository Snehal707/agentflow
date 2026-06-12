"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import {
  exportConversationReviewDataset,
  fetchConversationReviewCases,
  patchConversationReviewCase,
  type ConversationReviewCase,
  type ConversationReviewLabel,
} from "@/lib/liveProductClient";
import { useSidebarPreference } from "@/lib/useSidebarPreference";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

const REVIEW_LABELS: Array<{ value: ConversationReviewLabel; label: string }> = [
  { value: "correct", label: "Correct" },
  { value: "wrong_intent", label: "Wrong intent" },
  { value: "needs_clarification", label: "Needs clarification" },
  { value: "should_use_tool", label: "Should use tool" },
  { value: "bad_fallback", label: "Bad fallback" },
  { value: "infra_failure", label: "Infra failure" },
  { value: "ignore", label: "Ignore" },
];

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

function countBy<T extends string>(items: T[]): Array<[T, number]> {
  const tally = new Map<T, number>();
  for (const item of items) {
    tally.set(item, (tally.get(item) ?? 0) + 1);
  }
  return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
}

function SummaryCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`internal-admin-kpi rounded-[28px] p-5 ${accent ? "internal-admin-kpi-gold" : ""}`}>
      <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">{label}</p>
      <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white">{value}</p>
      <p className="mt-2 text-sm text-white/52">{detail}</p>
    </div>
  );
}

export function ReviewAdminPanel() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const searchParams = useSearchParams();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [cases, setCases] = useState<ConversationReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, ConversationReviewLabel>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingCaseId, setSavingCaseId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const authBearer = getAuthHeaders()?.Authorization ?? null;
  const sessionFilter = searchParams.get("session")?.trim() ?? "";

  const filteredCases = useMemo(
    () => (sessionFilter ? cases.filter((item) => item.sessionId === sessionFilter) : cases),
    [cases, sessionFilter],
  );

  const kindCounts = useMemo(
    () => countBy(filteredCases.map((item) => item.kind)),
    [filteredCases],
  );
  const channelCounts = useMemo(
    () => countBy(filteredCases.map((item) => item.channel)),
    [filteredCases],
  );
  const sourceCounts = useMemo(
    () => countBy(filteredCases.map((item) => item.source)),
    [filteredCases],
  );

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
      const nextCases = await fetchConversationReviewCases(authHeaders, { limit: 24 });
      setCases(nextCases);
      setDraftLabels(
        Object.fromEntries(
          nextCases.map((item) => [item.id, item.reviewLabel ?? item.recommendedLabel]),
        ) as Record<string, ConversationReviewLabel>,
      );
      setDraftNotes(
        Object.fromEntries(nextCases.map((item) => [item.id, item.reviewNote ?? ""])),
      );
    } catch (cause) {
      setCases([]);
      setError(cause instanceof Error ? cause.message : "Could not load review admin panel.");
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
      await patchConversationReviewCase(authHeaders, caseId, {
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
      const blob = await exportConversationReviewDataset(authHeaders, {
        labeledOnly: false,
        limit: 500,
      });
      downloadBlob(blob, "conversation-review-dataset.json");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export review dataset.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="internal-admin-shell flex min-h-screen text-white">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <ChatTopNavbar
          actions={
            <>
              <Link
                href="/internal/feedback"
                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
              >
                Feedback panel
              </Link>
              <Link
                href="/internal/memory"
                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
              >
                Memory panel
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
                    Conversation Review Monitor
                  </h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/62">
                    Audit routing misses, clarification gaps, bad fallbacks, and infrastructure failures
                    in one gold-and-white review surface.
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
                  Review queue: {filteredCases.length} cases
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Sources tracked: {sourceCounts.length || 0}
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Channels tracked: {channelCounts.length || 0}
                </span>
                {sessionFilter ? (
                  <span className="internal-admin-chip rounded-full px-4 py-2">
                    Session scope: {sessionFilter}
                  </span>
                ) : null}
              </div>
            </section>

            {error ? (
              <section className="rounded-[28px] border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-100">
                {error}
              </section>
            ) : null}

            {sessionFilter ? (
              <section className="internal-admin-panel rounded-[28px] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/72">
                  <span>Showing incident context for one session so you can compare it with explicit user thumbs feedback.</span>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/internal/review"
                      className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                    >
                      Clear session filter
                    </Link>
                    <Link
                      href={`/internal/feedback?session=${encodeURIComponent(sessionFilter)}`}
                      className="internal-admin-button-primary rounded-full px-4 py-2 text-sm transition"
                    >
                      Open matching feedback
                    </Link>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Queued reviews"
                value={String(filteredCases.length)}
                detail="Cases currently visible in the audit queue"
                accent
              />
              <SummaryCard
                label="Top issue"
                value={kindCounts[0]?.[0]?.replaceAll("_", " ") ?? "None"}
                detail={kindCounts[0] ? `${kindCounts[0][1]} occurrences` : "No issue distribution yet"}
              />
              <SummaryCard
                label="Top channel"
                value={channelCounts[0]?.[0] ?? "None"}
                detail={channelCounts[0] ? `${channelCounts[0][1]} queued reviews` : "No channel data yet"}
              />
              <SummaryCard
                label="Top source"
                value={sourceCounts[0]?.[0] ?? "None"}
                detail={sourceCounts[0] ? `${sourceCounts[0][1]} surfaced events` : "No source data yet"}
              />
            </section>

            <section className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Distribution</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                    Queue composition
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    A compact view of where incidents are coming from, without stealing width from the review queue.
                  </p>
                </div>
                <span className="internal-admin-chip rounded-full px-4 py-2 text-xs text-white/72">
                  {filteredCases.length} queued reviews
                </span>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-3">
                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Kinds</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {kindCounts.slice(0, 5).map(([kind, count]) => (
                      <span key={kind} className="internal-admin-chip internal-admin-chip-gold rounded-full px-3 py-1.5 text-xs text-white/78">
                        {kind.replaceAll("_", " ")}: {count}
                      </span>
                    ))}
                    {!kindCounts.length ? <span className="text-sm text-white/45">No queue distribution yet.</span> : null}
                  </div>
                </div>

                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Channels</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {channelCounts.map(([channel, count]) => (
                      <span key={channel} className="internal-admin-chip rounded-full px-3 py-1.5 text-xs text-white/72">
                        {channel}: {count}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Sources</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sourceCounts.map(([source, count]) => (
                      <span key={source} className="internal-admin-chip rounded-full px-3 py-1.5 text-xs text-white/72">
                        {source}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Review queue</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                      Conversation incidents
                    </h2>
                    <p className="mt-2 text-sm text-white/55">
                      Label the highest-signal failures for routing quality, tool coverage, and reliability.
                    </p>
                  </div>
                  <span className="internal-admin-chip internal-admin-chip-gold rounded-full px-4 py-2 text-xs text-white/74">
                    {filteredCases.length} active cases
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  {!loading && filteredCases.length === 0 ? (
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.025] px-4 py-4 text-sm text-white/45">
                      No review cases match the current session scope.
                    </div>
                  ) : null}

                  {filteredCases.map((item) => (
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
                          <span className="internal-admin-chip rounded-full px-3 py-1.5">{item.channel}</span>
                          <span className="internal-admin-chip rounded-full px-3 py-1.5">{item.source}</span>
                          <span className="internal-admin-chip rounded-full px-3 py-1.5">Seen {item.occurrenceCount}x</span>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_320px]">
                        <div className="grid gap-3">
                          <div className="internal-admin-kpi rounded-[22px] p-4">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Recommendation</p>
                            <p className="mt-3 text-lg font-semibold text-white">{item.recommendedLabel}</p>
                            <p className="mt-2 text-sm leading-6 text-white/60">{item.recommendationReason}</p>
                          </div>
                          <div className="internal-admin-kpi rounded-[22px] p-4">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Observed system state</p>
                            <p className="mt-3 text-sm leading-6 text-white/72">
                              <span className="text-white/45">Intent:</span> {item.observedIntent ?? "none"}
                              <br />
                              <span className="text-white/45">Layer:</span> {item.observedLayer ?? "none"}
                              <br />
                              <span className="text-white/45">Policy:</span> {item.observedPolicy ?? "none"}
                              <br />
                              <span className="text-white/45">Summary:</span> {item.responseSummary ?? "none"}
                            </p>
                          </div>
                          {item.sessionId ? (
                            <div className="flex flex-wrap gap-3">
                              <Link
                                href={`/internal/feedback?session=${encodeURIComponent(item.sessionId)}`}
                                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                              >
                                Open related feedback
                              </Link>
                              <Link
                                href={`/internal/review?session=${encodeURIComponent(item.sessionId)}`}
                                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                              >
                                Focus this session
                              </Link>
                            </div>
                          ) : null}
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
                                [item.id]: event.target.value as ConversationReviewLabel,
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
