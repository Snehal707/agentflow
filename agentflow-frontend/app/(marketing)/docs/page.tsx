import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { DocsBrowser } from "@/components/marketing/DocsBrowser";
import { getBackendUrl } from "@/lib/backendProxy";
import { DOC_INTRO, DOC_SECTIONS, type DocTopic } from "@/lib/docsContent";

export const metadata: Metadata = {
  title: "Docs — AgentFlow",
  description:
    "How to use AgentFlow: payments, bridge, swaps, vaults, prediction markets, research, and onchain actions on Arc.",
};

// Re-fetch the live knowledge at most every 5 minutes (ISR).
export const revalidate = 300;

type LiveTopic = { id: string; title: string; summary: string; facts: string[] };

// Pull the same product knowledge the in-chat assistant uses so the docs stay
// in sync automatically. Falls back to the bundled static content if the
// backend is unreachable, so the page never breaks.
async function fetchLiveTopics(): Promise<Map<string, LiveTopic>> {
  try {
    const res = await fetch(getBackendUrl("/api/docs"), {
      next: { revalidate },
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as { topics?: LiveTopic[] };
    const map = new Map<string, LiveTopic>();
    for (const t of data.topics ?? []) {
      if (t && typeof t.id === "string" && Array.isArray(t.facts)) {
        map.set(t.id, t);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function mergeTopic(staticTopic: DocTopic, live: Map<string, LiveTopic>): DocTopic {
  const hit = live.get(staticTopic.id);
  if (!hit) return staticTopic;
  return {
    id: staticTopic.id,
    title: hit.title || staticTopic.title,
    summary: hit.summary || staticTopic.summary,
    facts: hit.facts.length ? hit.facts : staticTopic.facts,
  };
}

export default async function DocsPage() {
  const liveTopics = await fetchLiveTopics();

  // Merge live content over the static structure, keeping the curated grouping.
  const mergedSections = DOC_SECTIONS.map((section) => ({
    ...section,
    topics: section.topics.map((topic) => mergeTopic(topic, liveTopics)),
  }));

  return (
    <main className="min-h-screen bg-[#070708] text-white dotted-canvas-bg font-display-sans">
      <MarketingNav />

      <div className="mx-auto max-w-7xl px-6 pb-28 pt-32 lg:px-8">
        {/* Hero */}
        <header className="mx-auto max-w-3xl text-center">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#f2ca50]">
            {DOC_INTRO.eyebrow}
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">
            {DOC_INTRO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-white/55">
            {DOC_INTRO.summary}
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <Link
              href="/chat"
              className="rounded-xl bg-gradient-to-r from-amber-400 to-[#f2ca50] px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-black shadow-[0_4px_18px_rgba(242,202,80,0.2)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              Launch App
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70 transition-colors hover:border-[#f2ca50]/40 hover:text-white"
            >
              Back home
            </Link>
          </div>
        </header>

        {/* Body: search + sticky TOC + sections (interactive) */}
        <DocsBrowser sections={mergedSections} />
      </div>
    </main>
  );
}
