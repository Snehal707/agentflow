"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocSection } from "@/lib/docsContent";

function matchesQuery(
  section: DocSection,
  query: string,
): DocSection | null {
  if (!query.trim()) return section;
  const q = query.toLowerCase();
  const topics = section.topics.filter((topic) => {
    const haystack = [
      topic.title,
      topic.summary,
      ...topic.facts,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
  if (!topics.length) return null;
  return { ...section, topics };
}

export function DocsBrowser({ sections }: { sections: DocSection[] }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => matchesQuery(section, query))
        .filter((section): section is DocSection => section !== null),
    [sections, query],
  );

  // Scroll-spy: highlight the section currently in view in the TOC.
  const sectionIds = useMemo(
    () => visibleSections.map((s) => s.id),
    [visibleSections],
  );
  const spyRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    spyRef.current?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -65% 0px", threshold: 0 },
    );
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    spyRef.current = observer;
    return () => observer.disconnect();
  }, [sectionIds]);

  const handleCopy = async (topicId: string) => {
    try {
      const url = `${window.location.origin}${window.location.pathname}#${topicId}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(topicId);
      window.setTimeout(() => setCopiedId((id) => (id === topicId ? null : id)), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="mt-16 grid gap-12 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-20">
      {/* Sidebar: search + sticky TOC */}
      <aside className="hidden lg:block">
        <div className="sticky top-28">
          <SearchBox query={query} onChange={setQuery} />
          <nav className="mt-7">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-white/40">
              On this page
            </div>
            <ul className="mt-4 space-y-0.5 border-l border-white/[0.08]">
              {visibleSections.map((section) => {
                const active = section.id === activeId;
                return (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className={`-ml-px block border-l py-1.5 pl-4 text-[13px] transition-colors ${
                        active
                          ? "border-[#f2ca50] text-white"
                          : "border-transparent text-white/50 hover:border-[#f2ca50]/50 hover:text-white"
                      }`}
                    >
                      {section.label}
                    </a>
                  </li>
                );
              })}
              {visibleSections.length === 0 ? (
                <li className="py-1.5 pl-4 text-[13px] text-white/30">No matches</li>
              ) : null}
            </ul>
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0">
        {/* Mobile search (sidebar is hidden on small screens) */}
        <div className="mb-10 lg:hidden">
          <SearchBox query={query} onChange={setQuery} />
        </div>

        {visibleSections.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center text-sm text-white/45">
            No topics match “{query}”. Try a different word.
          </div>
        ) : (
          <div className="space-y-20">
            {visibleSections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-28">
                <h2 className="border-b border-white/[0.08] pb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-[#f2ca50]">
                  {section.label}
                </h2>

                <div className="mt-7 space-y-6">
                  {section.topics.map((topic) => (
                    <article
                      key={topic.id}
                      id={topic.id}
                      className="group scroll-mt-28 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7 transition-colors duration-300 hover:border-[#f2ca50]/20 hover:bg-white/[0.03]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="group/anchor flex items-center gap-2 text-lg font-bold tracking-tight text-white">
                          <a href={`#${topic.id}`} className="hover:text-[#f2ca50]">
                            {topic.title}
                          </a>
                          <a
                            href={`#${topic.id}`}
                            aria-label="Link to this topic"
                            className="text-white/0 transition-colors group-hover/anchor:text-white/30 hover:!text-[#f2ca50]"
                          >
                            <HashIcon />
                          </a>
                        </h3>

                        <button
                          type="button"
                          onClick={() => handleCopy(topic.id)}
                          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/0 transition-all duration-200 group-hover:text-white/55 hover:!border-[#f2ca50]/40 hover:!text-[#f2ca50]"
                        >
                          {copiedId === topic.id ? "Copied" : "Copy link"}
                        </button>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-white/60">
                        {topic.summary}
                      </p>
                      <ul className="mt-4 space-y-2.5">
                        {topic.facts.map((fact, index) => (
                          <li
                            key={index}
                            className="flex gap-3 text-sm leading-relaxed text-white/75"
                          >
                            <span
                              aria-hidden
                              className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#f2ca50]/70"
                            />
                            <span>{fact}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ))}

            <p className="border-t border-white/[0.06] pt-8 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              Still stuck? Ask the assistant in-app — it answers from this same knowledge.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchBox({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30">
        <SearchIcon />
      </span>
      <input
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search docs"
        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] py-2.5 pl-10 pr-9 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#f2ca50]/40"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/35 transition-colors hover:text-white"
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}
