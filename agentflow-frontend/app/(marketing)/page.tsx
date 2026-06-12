import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AgentPipeline, type AgentStep } from "@/components/AgentPipeline";
import { AgentPayQrMock } from "@/components/marketing/AgentPayQrMock";
import { AnimatedExecutionStates } from "@/components/marketing/AnimatedExecutionStates";
import { HeroChatMock } from "@/components/marketing/HeroChatMock";
import { HermesFlowMock } from "@/components/marketing/HermesFlowMock";
import { LandingStatsStrip } from "@/components/marketing/LandingStatsStrip";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { PredictionMarketMock } from "@/components/marketing/PredictionMarketMock";
import { RotatingHeroTagline } from "@/components/marketing/RotatingHeroTagline";
import { RotatingPrompts } from "@/components/marketing/RotatingPrompts";
import { ScrollRevealSection } from "@/components/marketing/ScrollRevealSection";
import { TelegramAgentPayMock } from "@/components/marketing/TelegramAgentPayMock";
import { SpotlightCard } from "@/components/marketing/SpotlightCard";
import { BorderBeam } from "@/components/marketing/BorderBeam";

const displayFontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Research": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  "DeFi": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
  "Analytics": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  "Business": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  "Perception": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  "Payments": (
    <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
};

const STACK_ITEMS = [
  {
    step: "01. Classification Layer",
    title: "Understands the ask",
    body: "Classifies requests across research, prediction markets, swaps, payments, vaults, bridges, invoices, portfolio, voice, and file analysis before execution begins.",
  },
  {
    step: "02. Intent Router",
    title: "Dispatches the workflow",
    body: "Routes the structured request into the right agent or product flow so specialized services handle the actual work.",
  },
  {
    step: "03. Validation Layer",
    title: "Checks before action",
    body: "Runs execution checks, previews, and transaction guardrails before money movement, swaps, vault actions, or settlement steps proceed.",
  },
  {
    step: "04. Memory Layer",
    title: "Maintains context",
    body: "Keeps semantic memory, saved contacts, user preferences, and recent workflow context available across sessions.",
  },
] as const;

const EXECUTION_STATES = [
  "Started",
  "Preflight passed",
  "Payment required",
  "Payload created",
  "Paid request sent",
  "Settled",
] as const;

const RESEARCH_STEPS: AgentStep[] = [
  { key: "research", label: "Research", price: "0.005", status: "complete", tx: "batch_research" },
  { key: "analyst", label: "Analyst", price: "0.003", status: "complete", tx: "batch_analyst" },
  { key: "writer", label: "Writer", price: "0.008", status: "complete", tx: "batch_writer" },
];

const RESEARCH_USE_CASES = [
  {
    icon: "globe",
    title: "Any topic",
    body: "Generate a structured report on any market, company, protocol, macro event, or theme.",
  },
  {
    icon: "pulse",
    title: "Portfolio impact",
    body: "Ask how inflation, rates, war, regulation, or sector rotation could affect your holdings.",
  },
  {
    icon: "chart",
    title: "Prediction markets",
    body: "Research a live market before you act, so you decide from the report instead of waiting for someone else's call.",
  },
] as const;

const RESEARCH_TEMPLATE_SECTIONS = [
  "Overview",
  "Key evidence",
  "What changed",
  "Portfolio / market impact",
  "Risks and tradeoffs",
  "Sources",
  "Takeaway",
] as const;

const RESEARCH_PIPELINE_TOTAL = RESEARCH_STEPS.reduce((sum, step) => {
  const price = Number(step.price ?? 0);
  return sum + (Number.isFinite(price) ? price : 0);
}, 0).toFixed(3);

const AGENT_ROSTER = [
  { name: "Research", category: "Research", price: "$0.005", body: "Three-stage pipeline — gathers live evidence, interprets it, and writes a decision-ready report." },
  { name: "Swap", category: "DeFi", price: "$0.010", body: "Live Arc USDC swap quotes and execution with slippage guardrails and verification." },
  { name: "Vault", category: "DeFi", price: "$0.012", body: "Deposit into multi-protocol yield vaults (Lunex on testnet). More providers coming." },
  { name: "Prediction Markets", category: "DeFi", price: "$0.012", body: "Buy, sell, redeem, and refund on LMSR markets (AchMarket on testnet) with public proof." },
  { name: "Bridge", category: "DeFi", price: "$0.009", body: "Bridge USDC into Arc and stream CCTP progress in real time." },
  { name: "Portfolio", category: "Analytics", price: "$0.015", body: "Analyze Arc wallet balances, positions, transfers, and PnL." },
  { name: "Invoice", category: "Business", price: "$0.025", body: "Automate invoice review, approvals, and business settlement flows." },
  { name: "Vision", category: "Perception", price: "$0.004", body: "Read screenshots, images, text files, and single-page PDFs with Hermes-first reasoning." },
  { name: "Voice Input", category: "Perception", price: "Free", body: "Turn short voice notes into chat-ready text." },
  { name: "Schedule", category: "Payments", price: "$0.005", body: "Create recurring USDC payments — daily, weekly, or monthly — on Arc." },
  { name: "Split", category: "Payments", price: "$0.005", body: "Split USDC equally between 2–10 recipients in one command." },
  { name: "Batch", category: "Payments", price: "$0.010", body: "Bulk USDC payouts from CSV — payroll and distributions up to 500 recipients." },
] as const;

const LANDING_AGENT_ROSTER = AGENT_ROSTER.map((agent) =>
  agent.name === "Research"
    ? {
        ...agent,
        price: `$${RESEARCH_PIPELINE_TOTAL}`,
        body: "Three-stage pipeline total for Research, Analyst, and Writer â€” gathers live evidence, interprets it, and writes a decision-ready report.",
      }
    : agent,
);

const DEFI_PILLARS = [
  { tag: "Swap", body: "Quote and execute USDC swaps on Arc with slippage protection and a real preview before you confirm." },
  { tag: "Vault", body: "Move USDC into yield vaults and track shares and value from the same chat." },
  { tag: "Prediction Markets", body: "Trade outcomes on LMSR markets — buy, sell, redeem winnings, or claim refunds, all priced live." },
  { tag: "Bridge", body: "Bring USDC onto Arc with live CCTP progress, then put it to work immediately." },
] as const;

const REPUTATION_POINTS = [
  { title: "Agents pay agents", body: "A research run pays its analyst and writer; a chat run pays the agent it calls. Every hop is a real x402/Gateway nanopayment settled in USDC on Arc." },
  { title: "On-chain reputation (ERC-8004)", body: "Each agent is an ERC-8004 identity. Performance and user feedback are written to the on-chain Reputation Registry — not a private database." },
  { title: "Rate what you pay for", body: "After a paid run you can rate the agent. The score is submitted on-chain by a validator, so the rating you see is verifiable, not marketing." },
] as const;

const WHY_POINTS = [
  {
    eyebrow: "What it does",
    title: "One chat, many agents.",
    body: "Ask in natural language and AgentFlow runs the right specialized agent — research, swaps, vaults, prediction markets, payments — previewing every step before it executes.",
  },
  {
    eyebrow: "What it solves",
    title: "No more tool-juggling.",
    body: "Stop stitching together a research tab, a DEX, a yield app, a payments tool, and a spreadsheet. One place runs the whole workflow, with a real preview before any money moves.",
  },
  {
    eyebrow: "Why it's different",
    title: "An economy you can verify.",
    body: "Agents pay each other per task and earn reputation on-chain via ERC-8004. Most “AI agents” are a black box — here every paid run, payment, and rating is a real on-chain trace.",
  },
] as const;

const HOW_STEPS = [
  { step: "01", title: "Ask", body: "Type or speak a request. Hermes reads the intent — no menus, no commands to memorize." },
  { step: "02", title: "Route & preview", body: "AgentFlow dispatches the right paid agent and shows a real quote or preview with guardrails before anything runs." },
  { step: "03", title: "Confirm & settle", body: "You confirm, and the action settles in USDC on Arc with a visible transaction and on-chain reputation." },
] as const;

const HOW_STEP_ICONS = ["spark", "route", "shield"] as const;

const TRUST_BADGES = ["Circle", "Arc L1", "USDC", "x402", "Gateway", "ERC-8004"] as const;

const SOCIAL_LINKS = [
  { label: "X", href: "https://x.com/AgentFlowone" },
  { label: "Discord", href: "https://discord.gg/MskKAf6VRz" },
  { label: "Docs", href: "/docs" },
] as const;

function SocialIcon({ label }: { label: string }) {
  if (label === "X") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[1rem] w-[1rem]">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (label === "Discord") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[1rem] w-[1rem]">
        <path d="M20.317 4.37A19.8 19.8 0 0 0 15.886 3c-.192.34-.414.797-.567 1.154a18.3 18.3 0 0 0-6.638 0A12.7 12.7 0 0 0 8.114 3a19.74 19.74 0 0 0-4.432 1.37C.883 8.58-.033 12.64.321 16.64A19.9 19.9 0 0 0 6.39 19.69c.486-.66.92-1.36 1.296-2.1a12.9 12.9 0 0 1-2.036-.98c.171-.13.338-.26.5-.39a14.18 14.18 0 0 0 12.13 0c.16.13.328.26.499.39-.647.38-1.329.71-2.036.98.376.74.81 1.44 1.296 2.1a19.86 19.86 0 0 0 6.07-3.05c.41-4.63-.69-8.67-3.8-12.27zM8.02 14.18c-1.18 0-2.15-1.08-2.15-2.41 0-1.34.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.34.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-[1rem] w-[1rem]">
      <path d="M8 3.5h6l4 4V20.5H8a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 8 3.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 11h6" />
      <path d="M9 14.5h6" />
      <path d="M9 18h4" />
      </svg>
  );
}

// Representational marks for the "Built on" row. Swap for official brand SVGs
// (drop them in /public/logos and replace this switch) when you have the assets.
function TrustMark({ name }: { name: string }) {
  const cls = "h-3.5 w-3.5";
  switch (name) {
    case "Circle":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cls}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>
      );
    case "Arc L1":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cls}>
          <path d="M3 17a9 9 0 0 1 18 0" />
          <circle cx="3" cy="17" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="21" cy="17" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "USDC":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cls}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v9" strokeWidth={1.6} />
          <path d="M14.2 9.6a2.4 1.9 0 0 0-4.4 1c0 2.3 4.4.9 4.4 3.2a2.4 1.9 0 0 1-4.4 1" strokeWidth={1.6} />
        </svg>
      );
    case "x402":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cls}>
          <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
        </svg>
      );
    case "Gateway":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cls}>
          <circle cx="12" cy="12" r="2.5" />
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cls}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
          <path d="M9 12l2 2 4-4" strokeWidth={1.8} />
        </svg>
      );
  }
}

function HowStepIcon({ icon }: { icon: (typeof HOW_STEP_ICONS)[number] }) {
  const common = "h-5 w-5";

  if (icon === "spark") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
        <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
      </svg>
    );
  }

  if (icon === "route") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
        <circle cx="6" cy="6" r="1.7" />
        <circle cx="18" cy="6" r="1.7" />
        <circle cx="12" cy="18" r="1.7" />
        <path d="M7.9 6H11c2.8 0 4.1.8 5.1 2.6" />
        <path d="M16.1 6H13c-2.8 0-4.1.8-5.1 2.6" />
        <path d="M12 10.2V16" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
      <path d="M12 3l7 3.2v5.6c0 4.2-2.8 7.9-7 9.9-4.2-2-7-5.7-7-9.9V6.2L12 3z" />
      <path d="M8.7 12.3l2.1 2.1 4.5-4.8" />
    </svg>
  );
}

function ResearchUseCaseIcon({ icon }: { icon: (typeof RESEARCH_USE_CASES)[number]["icon"] }) {
  const common = "h-4.5 w-4.5";

  if (icon === "globe") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.8 12h16.4" />
        <path d="M12 3.5c2.7 2.4 4.1 5.2 4.1 8.5 0 3.3-1.4 6.1-4.1 8.5-2.7-2.4-4.1-5.2-4.1-8.5 0-3.3 1.4-6.1 4.1-8.5z" />
      </svg>
    );
  }

  if (icon === "pulse") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
        <path d="M3.5 12h4l2.1-4.2 4.1 8.4 2.2-4.2h4.6" />
        <path d="M4 6.5h16" opacity="0.4" />
        <path d="M4 17.5h16" opacity="0.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={common}>
      <path d="M4 16l4.5-4.5 3.2 3.2L20 6.5" />
      <path d="M15 6.5H20V11.5" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className={`overflow-x-hidden bg-[#070708] text-[#f5f5f5] selection:bg-amber-400/20 ${displayFontSans.className}`}>
      <MarketingNav />

      <ScrollRevealSection
        as="main"
        className="relative px-6 pb-16 pt-32 lg:px-8 lg:pb-24 lg:pt-48 overflow-hidden dotted-canvas-bg"
      >
        {/* Modern ambient radial glows */}
        <div className="pointer-events-none absolute left-[10%] top-[10%] h-[350px] w-[350px] rounded-full bg-amber-400/10 blur-[100px] animate-pulse" />
        <div className="pointer-events-none absolute right-[15%] top-[25%] h-[450px] w-[450px] rounded-full bg-indigo-500/10 blur-[120px] opacity-75" />

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="text-center lg:text-left">
            <h1 className="mb-7 text-4xl font-extrabold leading-[1.08] tracking-tighter sm:text-5xl md:text-6xl xl:text-7xl">
              <span className="text-[0.94em] bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent">
                AI agents that research, decide, and{" "}
              </span>
              <span className="block text-[1.03em] bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-200 bg-clip-text text-transparent">
                <RotatingHeroTagline />
              </span>
            </h1>

            <p className="mx-auto mb-9 max-w-xl text-base leading-relaxed text-white/60 lg:mx-0 md:text-lg">
              One chat runs an economy of paid agents — research, DeFi, prediction
              markets, and payments — each step previewed, then settled in USDC with
              reputation you can verify on-chain.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row lg:items-start justify-center lg:justify-start">
              <Link
                href="/chat"
                className="group relative overflow-hidden w-full text-center rounded-xl bg-gradient-to-r from-amber-400 to-[#f2ca50] px-8 py-4 text-xs font-bold uppercase tracking-wider text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_24px_rgba(242,202,80,0.25)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_4px_30px_rgba(242,202,80,0.45)] sm:w-auto"
              >
                {/* Diagonal glass reflection sweep */}
                <div className="absolute inset-y-0 left-0 w-1/2 -skew-x-12 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent group-hover:animate-[btn-shine_0.75s_ease-out-in_both]" />
                <span className="relative z-10">Launch AgentFlow</span>
              </Link>
              <a
                href="#how"
                className="relative overflow-hidden w-full text-center rounded-xl border border-white/[0.08] bg-black/40 px-8 py-4 text-xs font-bold uppercase tracking-wider text-white/90 transition-all duration-300 hover:border-amber-400/30 hover:bg-white/[0.03] hover:scale-[1.02] sm:w-auto"
              >
                <BorderBeam size={40} duration={6} />
                <span className="relative z-10">See how it works</span>
              </a>
            </div>

            <RotatingPrompts />
          </div>

          <HeroChatMock />
        </div>

        <div className="relative z-10 mx-auto mt-16 max-w-7xl border-t border-white/[0.06] pt-8">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200/55">
              Built on
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {TRUST_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1.5 text-white/60 transition-all duration-300 hover:border-amber-400/20 hover:bg-amber-400/[0.04] hover:text-white/90"
                >
                  <span className="text-amber-400/80">
                    <TrustMark name={badge} />
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                    {badge}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="why" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {WHY_POINTS.map((point) => (
            <SpotlightCard
              key={point.eyebrow}
              className="p-8 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(242,202,80,0.04)]"
            >
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.22em] text-amber-400/90 font-bold">
                {point.eyebrow}
              </div>
              <h3 className="mb-3 text-2xl font-extrabold tracking-tight text-amber-50">{point.title}</h3>
              <p className="leading-relaxed text-white/60 text-sm">{point.body}</p>
            </SpotlightCard>
          ))}
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="how" className="mx-auto max-w-7xl px-6 pb-20 lg:px-8">
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
            How It Works
          </div>
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">From a sentence to a settled action.</h2>
          <p className="mx-auto max-w-3xl text-base text-white/60">
            No dashboards to learn. Three steps from what you type to what settles on-chain.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {HOW_STEPS.map((item, index) => (
            <div key={item.step} className="relative group">
              {index < HOW_STEPS.length - 1 ? (
                <svg className="pointer-events-none absolute left-16 top-7 hidden h-1.5 w-[calc(100%-3.5rem)] md:block" fill="none">
                  <line x1="0" y1="2" x2="100%" y2="2" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1.5" />
                  <line
                    x1="0"
                    y1="2"
                    x2="100%"
                    y2="2"
                    stroke="#f2ca50"
                    strokeWidth="2"
                    className="animate-path-flow"
                  />
                </svg>
              ) : null}
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[1.1rem] border border-amber-400/20 bg-[linear-gradient(180deg,rgba(242,202,80,0.16)_0%,rgba(242,202,80,0.06)_100%)] text-[#f2ca50] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_18px_rgba(242,202,80,0.12)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_24px_rgba(242,202,80,0.24)]">
                <HowStepIcon icon={HOW_STEP_ICONS[index]} />
              </div>
              <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200/55">
                Step {index + 1}
              </div>
              <h3 className="mb-2 text-xl font-bold tracking-tight text-amber-50">{item.title}</h3>
              <p className="text-sm leading-relaxed text-white/60">{item.body}</p>
            </div>
          ))}
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="agents" className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 dotted-canvas-bg">
        <div className="pointer-events-none absolute right-[10%] top-[20%] h-[350px] w-[350px] rounded-full bg-indigo-500/5 blur-[100px]" />
        
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
            The Agents
          </div>
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">Twelve agents. One chat.</h2>
          <p className="mx-auto max-w-3xl text-base text-white/60">
            Ask in natural language — AgentFlow routes the work to the right paid agent and
            previews each run before it executes. No menus, no tab-switching.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {LANDING_AGENT_ROSTER.slice(0, 4).map((agent) => (
            <SpotlightCard
              key={agent.name}
              className="p-6 flex flex-col hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(242,202,80,0.03)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
                  {agent.category}
                </span>
                <span className="opacity-60 transition-transform duration-300 group-hover:scale-110">
                  {CATEGORY_ICONS[agent.category]}
                </span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-3 font-display-sans">
                <h3 className="text-lg font-bold text-amber-50 transition-colors group-hover:text-amber-300">
                  {agent.name}
                </h3>
                <span className="shrink-0 font-mono text-xs font-semibold text-amber-400">
                  {agent.price}
                </span>
              </div>
              <p className="flex-1 text-xs leading-relaxed text-white/50">{agent.body}</p>
            </SpotlightCard>
          ))}
        </div>

        <div className="mt-12">
          <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-amber-200/55">
            And eight more
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {LANDING_AGENT_ROSTER.slice(4).map((agent) => (
              <div
                key={agent.name}
                className="flex items-baseline justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 transition-all duration-300 hover:border-amber-400/20 hover:bg-white/[0.04]"
              >
                <span className="text-xs font-semibold text-amber-50">{agent.name}</span>
                <span className="font-mono text-[10px] text-amber-200/55">{agent.price}</span>
              </div>
            ))}
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="research-usp" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
              Research
            </div>
            <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter leading-tight text-transparent md:text-5xl">
              Get the report before you make the decision.
            </h2>
            <p className="mb-6 max-w-2xl text-base text-white/60">
              AgentFlow generates research reports on any topic, personalized
              reports against your holdings and portfolio, and prediction-market
              research you can use before you take the trade.
            </p>
            <p className="mb-8 max-w-2xl text-base text-white/60">
              Instead of sitting in front of the news, waiting for a call, or
              copying a KOL thesis, you can ask how a macro event affects your
              portfolio and get a decision-ready report back.
            </p>

            <div className="space-y-3.5">
              {RESEARCH_USE_CASES.map((item, index) => (
                <div
                  key={item.title}
                  className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-[#0d0d0d]/40 backdrop-blur-sm px-5 py-5 hover:border-amber-400/20 transition-all duration-300"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.95rem] border border-amber-400/20 bg-[linear-gradient(180deg,rgba(242,202,80,0.16)_0%,rgba(242,202,80,0.06)_100%)] text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_18px_rgba(242,202,80,0.08)]">
                    <ResearchUseCaseIcon icon={item.icon} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-amber-50 tracking-tight">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-6 shadow-2xl md:p-8 backdrop-blur-md transition-all duration-300 hover:border-amber-400/15">
            <div className="mb-6 flex flex-col gap-3 border-b border-white/[0.06] pb-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xl font-bold tracking-tight text-amber-50">Three-agent report pipeline</div>
                  <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200/45">
                    Research -&gt; analyst -&gt; writer
                  </div>
                </div>
                <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
                  Fast or deep
                </div>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-amber-100/58">
                Fast mode usually returns in 1-2 minutes. Deep mode runs longer
                retrieval, claim checks, and source verification for heavier reports.
              </p>
            </div>

            <AgentPipeline steps={RESEARCH_STEPS} />

            <div className="mt-8 rounded-3xl border border-white/[0.06] bg-black/40 p-6">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-base font-bold tracking-tight text-amber-50">Report template</div>
                  <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200/45">
                    Reusable decision format
                  </div>
                </div>
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
                  Portfolio-aware
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {RESEARCH_TEMPLATE_SECTIONS.map((section, index) => (
                  <div
                    key={section}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 hover:border-amber-400/20 transition-colors duration-300"
                  >
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]/80">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-amber-50">{section}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2.5 font-mono text-xs text-amber-100/65">
                <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 text-amber-100/72">
                  Macro impact
                </span>
                <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 text-amber-100/72">
                  Holdings context
                </span>
                <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 text-amber-100/72">
                  Prediction market thesis
                </span>
                <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 text-amber-100/72">
                  Source-backed
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="defi" className="relative mx-auto max-w-7xl px-6 pb-24 lg:px-8 dotted-canvas-bg">
        <div className="pointer-events-none absolute left-[15%] top-[30%] h-[350px] w-[350px] rounded-full bg-cyan-500/5 blur-[100px]" />
        
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
            DeFi + Prediction Markets
          </div>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tighter text-white md:text-5xl">Trade, earn, and bridge — by asking.</h2>
          <p className="mx-auto max-w-3xl text-base text-white/60">
            Swaps, vaults, bridges, and prediction markets run as confirmed, previewed
            actions on Arc. You see the quote, the slippage, and the outcome before anything
            moves.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {DEFI_PILLARS.map((pillar) => (
            <SpotlightCard
              key={pillar.tag}
              className="p-7 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(242,202,80,0.03)]"
            >
              <div className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-amber-400 font-bold">
                {pillar.tag}
              </div>
              <p className="text-xs leading-relaxed text-white/50">{pillar.body}</p>
            </SpotlightCard>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5 font-mono text-xs text-white/50">
          {[
            "Real preview before confirm",
            "Slippage protection",
            "LMSR pricing",
            "Admin-resolved with public proof",
            "USDC settlement",
          ].map((chip) => (
            <span key={chip} className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 hover:border-amber-400/20 hover:text-white/80 transition-colors">
              {chip}
            </span>
          ))}
        </div>

        <div className="mt-20 grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
              Prediction Markets
            </div>
            <h3 className="mb-4 text-2xl font-extrabold tracking-tighter text-white md:text-4xl">
              Take a position from the same chat.
            </h3>
            <p className="mb-6 max-w-xl text-base leading-relaxed text-white/60">
              Browse live markets, see implied odds, and trade outcomes priced by an LMSR
              curve. Buy a side, sell out early, redeem winnings when a market resolves, or
              claim a refund if it&apos;s cancelled — and every step previews before it runs.
            </p>
            <div className="flex flex-wrap gap-2.5 font-mono text-xs text-white/70">
              {["Live odds", "Buy / sell", "Redeem winnings", "Expiry refunds", "Public proof"].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1 hover:border-white/20 transition-colors duration-300 cursor-default"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <PredictionMarketMock />
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection
        id="agentpay"
        className="mx-auto max-w-7xl border-t border-white/[0.06] px-6 py-24 lg:px-8"
      >
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
            AgentPay
          </div>
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">
            Programmable money for teams, shops, and people.
          </h2>
          <p className="mx-auto max-w-3xl text-base text-white/60">
            Pay in natural language. Run batch payroll, approvals, and invoices for a team,
            or share a QR or payment link so anyone — even non-AgentFlow users — can pay you
            directly. Settled in USDC, in seconds.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
          <div className="relative w-full rounded-[2rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-7 font-mono shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-amber-400/15">
            <div className="mb-4 mt-2 border-b border-dashed border-white/[0.08] pb-4 text-center">
              <div className="text-lg font-bold tracking-widest text-amber-50">AGENTPAY RECEIPT</div>
              <div className="mt-1 text-xs text-white/40">STATUS: APPROVED &amp; SETTLED</div>
            </div>

            <div className="mb-6 space-y-2 text-xs text-white/50">
              <div className="flex justify-between">
                <span>OP_TYPE:</span>
                <span className="text-amber-50 font-bold">BATCH_PAYROLL</span>
              </div>
              <div className="flex justify-between">
                <span>NETWORK:</span>
                <span className="text-amber-50 font-bold">ARC TESTNET</span>
              </div>
              <div className="flex justify-between">
                <span>TOKEN:</span>
                <span className="text-amber-50 font-bold">USDC</span>
              </div>
              <div className="flex justify-between">
                <span>CSV_PARSED:</span>
                <span className="text-emerald-400 font-bold">SUCCESS [12 rows]</span>
              </div>
            </div>

            <div className="mb-4 space-y-3 border-y border-dashed border-white/[0.08] py-4 text-xs text-white/50">
              <div className="flex justify-between">
                <span>0x4A...21B (Design)</span>
                <span className="text-amber-50 font-semibold">$1,200.00</span>
              </div>
              <div className="flex justify-between">
                <span>0x9C...88F (Engineering)</span>
                <span className="text-amber-50 font-semibold">$4,500.00</span>
              </div>
              <div className="flex justify-between">
                <span>0x11D...3E2 (Marketing)</span>
                <span className="text-amber-50 font-semibold">$800.00</span>
              </div>
              <div className="pt-2 italic text-white/40">... 9 more recipients</div>
            </div>

            <div className="flex justify-between text-base font-bold text-amber-50 tracking-tight">
              <span>TOTAL:</span>
              <span className="text-amber-400 font-extrabold">$12,500.00</span>
            </div>

            <div className="mt-6 break-all text-center text-[9px] font-mono text-white/30">
              TX: 0x8f2a9c3e1b7d5f4a6c8e0b2d4f6a8c0e2b4d6f8a
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-7 shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-amber-400/15 flex flex-col justify-between">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold tracking-tight text-amber-50">Receive with AgentPay</div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
                  QR + Payment Link
                </div>
              </div>
              <div className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
                Arc Testnet
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-[200px_1fr] items-center">
              <AgentPayQrMock />
            </div>

            <p className="mt-5 text-xs leading-relaxed text-white/50">
              Use a wallet address or an optional .arc identity. Share the QR or payment link,
              attach a remark, and let any customer, shop visitor, or non-AgentFlow payer send
              USDC directly.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5 font-mono text-xs text-white/50">
          {[
            "Requests",
            "Approvals",
            "Invoices",
            "Batch payroll",
            "Split",
            "Schedule",
            "QR receive",
            "Payment link",
            "Optional .arc",
            "Anyone can pay",
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1 text-xs text-white/60 hover:border-amber-400/20 hover:text-white/80 transition-colors"
            >
              {item}
            </span>
          ))}
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#f2ca50] font-bold">
              AgentPay on Telegram
            </div>
            <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter leading-tight text-transparent md:text-5xl">
              Don&apos;t switch tabs. Pay from Telegram.
            </h2>
            <p className="mb-6 max-w-2xl text-base leading-relaxed text-white/60">
              Link your wallet to the AgentFlow Telegram bot and continue approved onchain
              workflows from mobile or desktop. Send an AgentPay QR image with the amount and
              remark, confirm in chat, and the payment completes on Arc — without opening the
              web app.
            </p>
            <div className="flex flex-wrap gap-2.5 font-mono text-xs text-white/70">
              {[
                "Continue workflows",
                "Send QR image",
                "Add amount + remark",
                "Confirm in chat",
                "Settle on Arc",
              ].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1 hover:border-white/20 transition-all cursor-default"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-6 md:p-8 backdrop-blur-md transition-all duration-300 hover:border-amber-400/15">
            <div className="mb-5 flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <div className="text-xl font-bold tracking-tight text-amber-50">
                  Telegram payment flow
                </div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
                  QR image + amount + remark
                </div>
              </div>
              <div className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400">
                Live flow
              </div>
            </div>

            <TelegramAgentPayMock />

            <p className="mt-5 text-xs leading-relaxed text-white/50">
              The bot resolves the QR target, keeps the remark, asks for confirmation, and
              completes the payment directly from Telegram.
            </p>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="reputation" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="rounded-[2.5rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-8 md:p-12 backdrop-blur-md">
          <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
                Agent Economy + Reputation
              </div>
              <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter leading-tight text-transparent md:text-5xl">
                An economy of agents you can verify.
              </h2>
              <p className="mb-8 max-w-2xl text-base leading-relaxed text-white/60">
                AgentFlow is not one model pretending to do everything. It is a market of
                specialized agents that pay each other per task and earn a reputation that
                lives on-chain.
              </p>
              <div className="space-y-3.5">
                {REPUTATION_POINTS.map((point, index) => (
                  <div
                    key={point.title}
                    className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-[#0d0d0d]/30 px-5 py-5 hover:border-amber-400/20 transition-colors duration-300"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-400/25 bg-amber-400/10 font-mono text-[10px] font-bold text-amber-400">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-amber-50 tracking-tight">{point.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/50">{point.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/[0.08] bg-black/40 p-6 md:p-7">
              <div className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-amber-400 font-bold">
                Live on Arc
              </div>
              <LandingStatsStrip />
              <p className="mt-5 text-xs leading-relaxed text-white/50">
                Reputation is recorded through the ERC-8004 Reputation Registry on Arc. Every
                paid run, agent-to-agent payment, and user rating is a real on-chain trace —
                buyer and seller, settled in USDC.
              </p>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="intelligence" className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">Built with an intelligence stack.</h2>
          <p className="mx-auto max-w-2xl text-base text-white/60">
            Not a simple prompt wrapper. AgentFlow routes each request through four
            critical layers before any paid agent executes.
          </p>
        </div>

        <div className="mx-auto max-w-3xl">
          {STACK_ITEMS.map((item, index) => (
            <div key={item.step} className="relative flex gap-6 pb-10 last:pb-0">
              <div className="flex flex-col items-center pt-1">
                <span className="h-3 w-3 shrink-0 rounded-full border-2 border-amber-400 bg-[#070708] shadow-[0_0_8px_rgba(242,202,80,0.4)]" />
                {index < STACK_ITEMS.length - 1 ? (
                  <span className="mt-1 w-px flex-1 bg-gradient-to-b from-amber-400/40 to-white/5" />
                ) : null}
              </div>
              <div className="-mt-1 pb-1">
                <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50] font-bold">
                  {item.step}
                </div>
                <h3 className="mb-1.5 text-xl font-bold tracking-tight text-amber-50">{item.title}</h3>
                <p className="text-xs leading-relaxed text-white/50">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="hermes-engine" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="mb-16 text-center">
          <div className="mb-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5">
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#f2ca50]">
                Powered by Hermes
              </span>
            </div>
          </div>
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">No menus. Just ask.</h2>
          <p className="mx-auto max-w-2xl text-base text-white/60">
            Hermes handles the natural-language reasoning layer. AgentFlow then routes the
            request into the right service or paid agent flow for execution.
          </p>
        </div>

        <div className="relative mx-auto max-w-3xl">
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[#f2ca50]/5 blur-[80px]" />
          <HermesFlowMock />
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl border-t border-white/[0.06] px-6 py-24 lg:px-8">
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
            Under the Hood
          </div>
          <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">Real wallets. Real transaction states.</h2>
          <p className="mx-auto max-w-3xl text-base text-white/60">
            AgentFlow runs on its own execution wallet and never hides what&apos;s happening —
            you see each stage of every paid action.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[2.5rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-8 md:p-10 backdrop-blur-md">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
              Wallet Flow
            </div>
            <h3 className="mb-4 text-2xl font-extrabold tracking-tight text-amber-50">
              AgentFlow runs on its execution wallet by default.
            </h3>
            <p className="mb-8 text-sm leading-relaxed text-white/50">
              The DCW execution wallet is the primary AgentFlow wallet for agent actions.
              Gateway balance supports x402 paid execution liquidity, while the connected
              wallet is used for authentication and any step that requires the user&apos;s
              direct signature.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-5 hover:border-amber-400/20 transition-all duration-300">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50] font-bold">
                  01
                </div>
                <h4 className="mb-2 text-sm font-bold text-amber-50">Execution wallet (DCW)</h4>
                <p className="text-[11px] leading-relaxed text-white/50">
                  Primary AgentFlow wallet used for execution, balances, and approved agent actions.
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-5 hover:border-amber-400/20 transition-all duration-300">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50] font-bold">
                  02
                </div>
                <h4 className="mb-2 text-sm font-bold text-amber-50">Gateway balance</h4>
                <p className="text-[11px] leading-relaxed text-white/50">
                  Tracks funded USDC for x402-style paid agent calls and supports gateway liquidity needs.
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-5 hover:border-amber-400/20 transition-all duration-300">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50] font-bold">
                  03
                </div>
                <h4 className="mb-2 text-sm font-bold text-amber-50">Connected wallet (EOA)</h4>
                <p className="text-[11px] leading-relaxed text-white/50">
                  Used for wallet authentication and direct user-signed steps like bridging or funding the execution wallet.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-white/[0.08] bg-[#0d0d0d]/40 p-8 md:p-10 backdrop-blur-md">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50] font-bold">
              Execution States
            </div>
            <h3 className="mb-4 text-2xl font-extrabold tracking-tight text-amber-50 md:text-3xl">
              The product shows real transaction progress.
            </h3>
            <p className="mb-8 text-sm leading-relaxed text-white/50">
              AgentFlow does not hide payment and execution state behind a spinner. It
              exposes each stage of the action flow so users can tell what is pending,
              confirmed, or blocked.
            </p>
            <AnimatedExecutionStates states={EXECUTION_STATES} />
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="trust" className="border-y border-white/[0.06] bg-[#070708]/60 py-24 relative overflow-hidden">
        <div className="pointer-events-none absolute right-[10%] top-[10%] h-[300px] w-[300px] rounded-full bg-amber-400/5 blur-[95px]" />
        
        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center gap-16 px-6 lg:flex-row lg:px-8">
          <div className="flex-1">
            <h2 className="marketing-gradient-heading mb-6 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-4xl">Real onchain execution.</h2>
            <ul className="space-y-6">
              <li>
                <h4 className="text-lg font-bold text-amber-50 tracking-tight">Session auth + execution wallet</h4>
                <p className="mt-1 text-sm text-white/50">
                  AgentFlow uses wallet-based session auth and keeps execution balances visible
                  in the app before privileged flows can run.
                </p>
              </li>
              <li>
                <h4 className="text-lg font-bold text-amber-50 tracking-tight">Execution guard</h4>
                <p className="mt-1 text-sm text-white/50">
                  Simulation, slippage checks, previews, and strict validation guard real
                  money-movement actions before they are sent.
                </p>
              </li>
              <li>
                <h4 className="text-lg font-bold text-amber-50 tracking-tight">Circle x402 on Arc</h4>
                <p className="mt-1 text-sm text-white/50">
                  Paid agent steps use USDC-denominated Arc settlement and Circle x402
                  flows so usage-based pricing stays practical.
                </p>
              </li>
            </ul>
          </div>

          <div className="relative w-full flex-1 overflow-hidden rounded-3xl border border-white/[0.08] bg-neutral-950/70 p-8 font-mono text-xs text-white/50 shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-amber-400/20">
            <div className="absolute right-0 top-0 h-[2px] w-full bg-gradient-to-r from-transparent via-[#f2ca50] to-transparent opacity-50" />
            <div className="mb-2.5 text-emerald-400 font-semibold">{"> AgentFlow Intent Router initialized..."}</div>
            <div className="mb-2.5">{'\u003e Request: "Swap 100 USDC to EURC and send to Alice"'}</div>
            <div className="mb-2.5 text-yellow-400 font-semibold">{"> Classification: [SWAP], [PAYMENT]"}</div>
            <div className="mb-2.5">{"> Validation Layer: Checking slippage... OK"}</div>
            <div className="mb-2.5">{"> Memory Layer: Resolved saved contact for Alice"}</div>
            <div className="mt-5 font-bold text-amber-50">
              {"> Execution Guard: PASSED. Ready for confirmed transaction."}
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection as="footer" className="border-t border-white/[0.06] bg-[#070708] dotted-canvas-bg">
        <div className="relative mx-auto max-w-7xl px-6 py-20 text-center lg:px-8 overflow-hidden">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[350px] w-[350px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/5 blur-[95px] opacity-75 animate-pulse" />
          
          <div className="relative z-10">
            <h2 className="marketing-gradient-heading mb-4 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tighter text-transparent md:text-5xl">Put your agents to work.</h2>
            <p className="mx-auto mb-8 max-w-xl text-base text-white/60">
              One chat. Twelve agents. Every run settled in USDC on Arc.
            </p>
            <Link
              href="/chat"
              className="relative overflow-hidden inline-block rounded-xl bg-gradient-to-r from-amber-400 to-[#f2ca50] px-8 py-4 text-xs font-bold uppercase tracking-wider text-black shadow-[0_4px_24px_rgba(242,202,80,0.25)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_4px_30px_rgba(242,202,80,0.45)] font-display-sans"
            >
              <BorderBeam size={40} duration={4} />
              <span className="relative z-10">Launch AgentFlow</span>
            </Link>
          </div>
        </div>

        {/* Directory Grid */}
        <div className="border-t border-white/[0.06] py-12 md:py-16">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 grid grid-cols-2 md:grid-cols-5 gap-8 relative z-10">
            <div className="col-span-2 space-y-4">
              <div className="flex items-center gap-2">
                <span className="font-black text-xl">
                  <span className="text-[#f2ca50]">A</span>F
                </span>
                <span className="font-mono text-xs uppercase tracking-widest text-amber-200/55">
                  AgentFlow
                </span>
              </div>
              <p className="text-xs text-white/50 max-w-xs leading-relaxed">
                An economy of paid agents settled in USDC on Arc with ERC-8004 on-chain reputation.
              </p>
              <div className="flex items-center gap-2.5 pt-2">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    aria-label={social.label}
                    title={social.label}
                    {...(social.href.startsWith("http")
                      ? { target: "_blank", rel: "noreferrer noopener" }
                      : {})}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] text-white/60 transition-all duration-300 hover:border-[#f2ca50]/50 hover:text-[#f2ca50] hover:bg-[#f2ca50]/[0.03]"
                  >
                    <SocialIcon label={social.label} />
                  </a>
                ))}
              </div>
            </div>
            
            {[
              {
                title: "Product",
                links: [
                  { label: "Agents Catalog", href: "#agents" },
                  { label: "DeFi Modules", href: "#defi" },
                  { label: "AgentPay Flows", href: "#agentpay" },
                  { label: "System Health", href: "/api/health" },
                ],
              },
              {
                title: "Developers",
                links: [
                  { label: "Documentation", href: "/docs" },
                  { label: "API Explorer", href: "/docs" },
                  { label: "Reputation Spec", href: "#reputation" },
                  {
                    label: "On-Chain Registry",
                    href: "https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e",
                  },
                ],
              },
              {
                title: "Ecosystem",
                links: [
                  { label: "Arc L1 Chain", href: "https://testnet.arcscan.app" },
                  { label: "Circle USDC", href: "https://www.circle.com/usdc" },
                  { label: "x402 protocol", href: "https://x402.org" },
                  {
                    label: "Reputation registry",
                    href: "https://testnet.arcscan.app/address/0x8004B663056A597Dffe9eCcC1965A193B7388713",
                  },
                ],
              },
            ].map((col) => (
              <div key={col.title} className="space-y-3.5">
                <h4 className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#f2ca50]">
                  {col.title}
                </h4>
                <ul className="space-y-2.5 text-xs text-white/50 font-display-sans">
                  {col.links.map((link) => {
                    const isExternal = link.href.startsWith("http");
                    return (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                          className="transition-colors duration-200 hover:text-amber-300"
                        >
                          {link.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Legal & Copyright */}
        <div className="border-t border-white/[0.06] py-8 bg-black/30 relative z-10">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-widest text-white/30">
            <div>© 2026 AgentFlow. All rights reserved.</div>
            <div className="flex gap-6">
              <a href="#" className="hover:text-white/50 transition-colors">Testnet v1.2</a>
              <span className="text-white/10">|</span>
              <a href="#" className="hover:text-white/50 transition-colors">USDC Settled</a>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <style>{`
        html {
          scroll-behavior: smooth;
        }

        @keyframes heroTaglineIn {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
