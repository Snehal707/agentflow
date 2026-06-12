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
  exportChatFeedbackEntries,
  fetchChatFeedbackEntries,
  type ChatFeedbackEntry,
} from "@/lib/liveProductClient";
import { useSidebarPreference } from "@/lib/useSidebarPreference";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

function countBy<T extends string>(items: T[]): Array<[T, number]> {
  const tally = new Map<T, number>();
  for (const item of items) {
    tally.set(item, (tally.get(item) ?? 0) + 1);
  }
  return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
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

export function FeedbackAdminPanel() {
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

  const [entries, setEntries] = useState<ChatFeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<"all" | "positive" | "negative">("all");
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const authBearer = getAuthHeaders()?.Authorization ?? null;
  const sessionFilter = searchParams.get("session")?.trim() ?? "";
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredEntries = useMemo(() => {
    return entries.filter((item) => {
      if (sessionFilter && item.sessionId !== sessionFilter) {
        return false;
      }
      if (feedbackFilter !== "all" && item.feedback !== feedbackFilter) {
        return false;
      }
      if (onlyWithNotes && !item.note) {
        return false;
      }
      if (onlyFailures && item.outcome === "success" && !item.failureReason) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        item.query,
        item.responseSummary,
        item.note,
        item.intentLabel,
        item.finalIntent,
        item.layerUsed,
        item.failureReason,
        item.outcome,
        item.walletAddress,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [entries, feedbackFilter, onlyFailures, onlyWithNotes, normalizedSearch, sessionFilter]);

  const feedbackCounts = useMemo(
    () => countBy(filteredEntries.map((item) => item.feedback)),
    [filteredEntries],
  );
  const intentCounts = useMemo(
    () => countBy(filteredEntries.map((item) => item.finalIntent || item.intentLabel || "unknown")),
    [filteredEntries],
  );
  const layerCounts = useMemo(
    () => countBy(filteredEntries.map((item) => item.layerUsed || "unknown")),
    [filteredEntries],
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
      const nextEntries = await fetchChatFeedbackEntries(authHeaders, { limit: 80 });
      setEntries(nextEntries);
    } catch (cause) {
      setEntries([]);
      setError(cause instanceof Error ? cause.message : "Could not load feedback admin panel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPanel();
  }, [authBearer, address]);

  async function exportDataset() {
    const authHeaders: Record<string, string> = authBearer ? { Authorization: authBearer } : {};
    setExporting(true);
    setError(null);
    try {
      const blob = await exportChatFeedbackEntries(authHeaders, { limit: 400 });
      downloadBlob(blob, "chat-feedback-events.json");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export chat feedback.");
    } finally {
      setExporting(false);
    }
  }

  const positiveCount = feedbackCounts.find(([key]) => key === "positive")?.[1] ?? 0;
  const negativeCount = feedbackCounts.find(([key]) => key === "negative")?.[1] ?? 0;
  const entriesWithNotes = filteredEntries.filter((item) => Boolean(item.note)).length;
  const failureCount = filteredEntries.filter(
    (item) => item.outcome !== "success" || Boolean(item.failureReason),
  ).length;

  return (
    <div className="internal-admin-shell flex min-h-screen text-white">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <ChatTopNavbar
          actions={
            <>
              <Link
                href="/internal/review"
                className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
              >
                Review panel
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
                    Chat Feedback Monitor
                  </h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/62">
                    This panel is only for normal chat thumbs up/down feedback on responses. It is not the paid
                    output rating system and does not touch ERC-8004 reputation.
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
                  Source table: brain_events.user_feedback
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Separate from agent_ratings / ERC-8004
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Loaded rows: {entries.length}
                </span>
                <span className="internal-admin-chip rounded-full px-4 py-2">
                  Filtered rows: {filteredEntries.length}
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
                  <span>Showing thumbs feedback for one session so you can compare it against the review queue.</span>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/internal/feedback"
                      className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                    >
                      Clear session filter
                    </Link>
                    <Link
                      href={`/internal/review?session=${encodeURIComponent(sessionFilter)}`}
                      className="internal-admin-button-primary rounded-full px-4 py-2 text-sm transition"
                    >
                      Open matching review context
                    </Link>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Feedback rows"
                value={String(filteredEntries.length)}
                detail="Current review slice after filters"
                accent
              />
              <SummaryCard
                label="Thumbs up"
                value={String(positiveCount)}
                detail="Positive response votes"
              />
              <SummaryCard
                label="Thumbs down"
                value={String(negativeCount)}
                detail="Negative response votes"
              />
              <SummaryCard
                label="Needs review"
                value={String(failureCount)}
                detail={entriesWithNotes ? `${entriesWithNotes} rows include reviewer notes` : "No notes in current slice"}
              />
            </section>

            <section className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Distribution</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                    Feedback composition
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    Split by thumbs direction, routed intent, and handling layer for future model tuning.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-3">
                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Feedback mix</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {feedbackCounts.map(([feedback, count]) => (
                      <span
                        key={feedback}
                        className={`rounded-full px-3 py-1.5 text-xs ${
                          feedback === "positive"
                            ? "internal-admin-chip internal-admin-chip-gold text-white/78"
                            : "internal-admin-chip text-white/72"
                        }`}
                      >
                        {feedback}: {count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Top intents</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {intentCounts.slice(0, 6).map(([intent, count]) => (
                      <span key={intent} className="internal-admin-chip rounded-full px-3 py-1.5 text-xs text-white/72">
                        {intent}: {count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="internal-admin-kpi rounded-[24px] p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Handling layers</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {layerCounts.slice(0, 6).map(([layer, count]) => (
                      <span key={layer} className="internal-admin-chip rounded-full px-3 py-1.5 text-xs text-white/72">
                        {layer}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="internal-admin-panel rounded-[32px] p-6 xl:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-[#f2ca50]">Feedback inbox</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                    User-marked good and bad responses
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    These are plain chat-response quality signals to improve intent routing and future model tuning.
                  </p>
                </div>
                <span className="internal-admin-chip internal-admin-chip-gold rounded-full px-4 py-2 text-xs text-white/74">
                  {filteredEntries.length} visible feedback events
                </span>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_auto]">
                <label className="internal-admin-filter-field rounded-[24px] px-4 py-3">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/42">Search feedback</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Query, response, note, intent, wallet..."
                    className="internal-admin-input mt-3 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  />
                </label>

                <div className="flex flex-wrap gap-3">
                  {([
                    ["all", "All"],
                    ["negative", "Thumbs down"],
                    ["positive", "Thumbs up"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFeedbackFilter(value)}
                      className={`rounded-full px-4 py-2 text-sm transition ${
                        feedbackFilter === value
                          ? "internal-admin-button-primary"
                          : "internal-admin-button-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOnlyWithNotes((current) => !current)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      onlyWithNotes ? "internal-admin-button-primary" : "internal-admin-button-secondary"
                    }`}
                  >
                    Notes only
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyFailures((current) => !current)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      onlyFailures ? "internal-admin-button-primary" : "internal-admin-button-secondary"
                    }`}
                  >
                    Failed only
                  </button>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {!loading && filteredEntries.length === 0 ? (
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.025] px-4 py-4 text-sm text-white/45">
                    No feedback rows match the current filters.
                  </div>
                ) : null}

                {filteredEntries.map((item) => (
                  <article key={item.id} className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-3xl">
                        <p className={`text-[11px] uppercase tracking-[0.28em] ${item.feedback === "positive" ? "text-[#f2ca50]" : "text-rose-300"}`}>
                          {item.feedback === "positive" ? "Thumbs Up" : "Thumbs Down"}
                        </p>
                        <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">
                          {item.query}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-white/68">
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          {item.finalIntent || item.intentLabel || "unknown_intent"}
                        </span>
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          {item.layerUsed || "unknown_layer"}
                        </span>
                        <span className="internal-admin-chip rounded-full px-3 py-1.5">
                          {item.outcome || "no_outcome"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                      <div className="internal-admin-kpi rounded-[22px] p-4">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Assistant response summary</p>
                        <p className="mt-3 text-sm leading-7 text-white/72">
                          {item.responseSummary || "No final response summary recorded."}
                        </p>
                      </div>
                      <div className="grid gap-3">
                        <div className="internal-admin-kpi rounded-[22px] p-4">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Diagnostics</p>
                          <p className="mt-3 text-sm leading-6 text-white/72">
                            <span className="text-white/45">Failure:</span> {item.failureReason || "none"}
                            <br />
                            <span className="text-white/45">Wallet:</span> {item.walletAddress || "none"}
                            <br />
                            <span className="text-white/45">Session:</span> {item.sessionId || "none"}
                          </p>
                        </div>
                        {item.sessionId ? (
                          <div className="flex flex-wrap gap-3">
                            <Link
                              href={`/internal/review?session=${encodeURIComponent(item.sessionId)}`}
                              className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                            >
                              Open in review
                            </Link>
                            <Link
                              href={`/internal/feedback?session=${encodeURIComponent(item.sessionId)}`}
                              className="internal-admin-button-secondary rounded-full px-4 py-2 text-sm transition"
                            >
                              Focus this session
                            </Link>
                          </div>
                        ) : null}
                        {item.note ? (
                          <div className="internal-admin-kpi rounded-[22px] p-4">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-white/42">Feedback note</p>
                            <p className="mt-3 text-sm leading-6 text-white/72">{item.note}</p>
                          </div>
                        ) : null}
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
