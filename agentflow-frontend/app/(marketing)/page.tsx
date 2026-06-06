import Link from "next/link";
import { AgentPipeline, type AgentStep } from "@/components/AgentPipeline";
import { BrandLockup } from "@/components/BrandLockup";
import { AgentPayQrMock } from "@/components/marketing/AgentPayQrMock";
import { AnimatedExecutionStates } from "@/components/marketing/AnimatedExecutionStates";
import { HermesFlowMock } from "@/components/marketing/HermesFlowMock";
import { RotatingHeroTagline } from "@/components/marketing/RotatingHeroTagline";
import { ScrollRevealSection } from "@/components/marketing/ScrollRevealSection";
import { TelegramAgentPayMock } from "@/components/marketing/TelegramAgentPayMock";
import { TelegramContinuityShowcase } from "@/components/marketing/TelegramContinuityShowcase";

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

const MARQUEE_ITEMS = [
  "Arc settlement: available",
  "Core agents: 12",
  "Circle x402 flows: active",
  "Telegram link flow: available",
  "Agent wallet + gateway: tracked",
] as const;

const SURFACE_ITEMS = [
  {
    title: "Chat workspace",
    body: "Hermes-powered chat for research, planning, approvals, and command-driven workflow execution.",
  },
  {
    title: "Agent store",
    body: "Browse core agents, task pricing, and specialized flows from one product surface instead of scattered tools.",
  },
  {
    title: "AgentPay",
    body: "Send and receive payments, manage requests, history, schedules, invoices, contacts, exports, batch payroll, and optional .arc identities in one place.",
  },
  {
    title: "Portfolio + funds",
    body: "Track balances, positions, wallet activity, and treasury movement without leaving AgentFlow.",
  },
  {
    title: "Execution wallet + gateway",
    body: "The DCW execution wallet is AgentFlow's primary wallet, while gateway balance supports x402 paid execution liquidity.",
  },
  {
    title: "Telegram continuity",
    body: "Continue approved workflows from Telegram when you are away from the web app.",
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
    title: "Any topic",
    body: "Generate a structured report on any market, company, protocol, macro event, or theme.",
  },
  {
    title: "Portfolio impact",
    body: "Ask how inflation, rates, war, regulation, or sector rotation could affect your holdings.",
  },
  {
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

export default function LandingPage() {
  return (
    <div className="bg-[#0a0a0a] text-[#f5f5f5] selection:bg-[#f2ca50]/30">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[rgba(10,10,10,0.82)] backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
          <BrandLockup href="/" variant="nav" />

          <div className="hidden items-center gap-8 text-sm font-medium text-[#a3a3a3] md:flex">
            <a href="#research-usp" className="transition-colors hover:text-white">
              Product
            </a>
            <a href="#intelligence" className="transition-colors hover:text-white">
              How It Works
            </a>
            <a href="#hermes-engine" className="transition-colors hover:text-white">
              Capabilities
            </a>
            <a href="#business" className="transition-colors hover:text-white">
              AgentPay
            </a>
            <a href="#trust" className="transition-colors hover:text-white">
              Trust
            </a>
          </div>

          <Link
            href="/chat"
            className="rounded-lg bg-[#f2ca50] px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_18px_rgba(242,202,80,0.18)] transition-colors hover:bg-[#f6d46a]"
          >
            Launch AgentFlow
          </Link>
        </div>
      </nav>

      <ScrollRevealSection
        as="main"
        className="relative px-6 pb-12 pt-32 text-center lg:px-8 lg:pb-20 lg:pt-48"
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f2ca50]/10 blur-[100px]" />

        <div className="relative z-10 mx-auto max-w-5xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#f2ca50]/20 bg-[#f2ca50]/10 px-4 py-2">
            <span className="font-mono text-xs font-medium uppercase tracking-widest text-[#f2ca50]">
              An AI Agent Operating System
            </span>
          </div>

          <h1 className="mx-auto mb-8 max-w-[11ch] text-4xl font-bold leading-[1.16] tracking-tight sm:max-w-[12ch] sm:text-5xl md:max-w-none md:text-7xl md:leading-[1.12]">
            AI agents that research, decide, and{" "}
            <span className="block">
              <RotatingHeroTagline />
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-3xl text-lg leading-relaxed text-[#a3a3a3] md:text-xl">
            AgentFlow turns natural language into research, DeFi execution,
            payments, and portfolio workflows in one operating layer.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/chat"
              className="w-full rounded-xl bg-[#f2ca50] px-8 py-4 text-sm font-bold uppercase tracking-wider text-black transition-colors hover:bg-yellow-400 sm:w-auto"
            >
              Launch AgentFlow
            </Link>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="surfaces" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="mb-14 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50]">
            Product Surfaces
          </div>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">
            More than chat. This is the operating layer.
          </h2>
          <p className="mx-auto max-w-3xl text-lg text-[#a3a3a3]">
            AgentFlow already ships distinct product surfaces for chat, agent discovery,
            payments, portfolio visibility, funding flows, and Telegram continuity.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {SURFACE_ITEMS.map((item) => (
            <div
              key={item.title}
              className="group rounded-3xl border border-white/10 bg-[#111111] p-7 transition-colors hover:border-[#f2ca50]/35"
            >
              <h3 className="mb-3 text-2xl font-bold text-white transition-colors group-hover:text-[#f2ca50]">
                {item.title}
              </h3>
              <p className="leading-relaxed text-[#a3a3a3]">{item.body}</p>
            </div>
          ))}
        </div>
      </ScrollRevealSection>

      <div className="relative z-10 overflow-hidden border-y border-white/5 bg-[#050505] py-3">
        <div className="animate-[marquee_28s_linear_infinite] whitespace-nowrap text-xs font-mono uppercase tracking-widest text-[#a3a3a3] [@media(prefers-reduced-motion:reduce)]:animate-none">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, index) => (
            <span key={`${item}-${index}`} className="mx-8 inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {item}
            </span>
          ))}
        </div>
      </div>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 pt-16 lg:px-8 lg:pt-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[2rem] border border-white/10 bg-[#101010] p-8 md:p-10">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50]">
              Wallet Flow
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">
              AgentFlow runs on its execution wallet by default.
            </h2>
            <p className="mb-8 max-w-2xl text-lg leading-relaxed text-[#a3a3a3]">
              The DCW execution wallet is the primary AgentFlow wallet for agent actions.
              Gateway balance supports x402 paid execution liquidity, while the connected
              wallet is used for authentication and any step that requires the user&apos;s
              direct signature.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50]">
                  01
                </div>
                <h3 className="mb-2 text-lg font-bold">Execution wallet (DCW)</h3>
                <p className="text-sm leading-relaxed text-[#a3a3a3]">
                  Primary AgentFlow wallet used for execution, balances, and approved agent actions.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50]">
                  02
                </div>
                <h3 className="mb-2 text-lg font-bold">Gateway balance</h3>
                <p className="text-sm leading-relaxed text-[#a3a3a3]">
                  Tracks funded USDC for x402-style paid agent calls and supports gateway liquidity needs.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[#f2ca50]">
                  03
                </div>
                <h3 className="mb-2 text-lg font-bold">Connected wallet (EOA)</h3>
                <p className="text-sm leading-relaxed text-[#a3a3a3]">
                  Used for wallet authentication and direct user-signed steps like bridging or funding the execution wallet.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#141414] p-8 md:p-10">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50]">
              Execution States
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">
              The product shows real transaction progress.
            </h2>
            <p className="mb-8 text-lg leading-relaxed text-[#a3a3a3]">
              AgentFlow does not hide payment and execution state behind a spinner. It
              exposes each stage of the action flow so users can tell what is pending,
              confirmed, or blocked.
            </p>
            <AnimatedExecutionStates states={EXECUTION_STATES} />
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="research-usp" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-[#f2ca50]">
              Research
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-5xl">
              Get the report before you make the decision.
            </h2>
            <p className="mb-6 max-w-2xl text-lg leading-relaxed text-[#a3a3a3]">
              AgentFlow generates research reports on any topic, personalized
              reports against your holdings and portfolio, and prediction-market
              research you can use before you take the trade.
            </p>
            <p className="mb-8 max-w-2xl text-lg leading-relaxed text-[#a3a3a3]">
              Instead of sitting in front of the news, waiting for a call, or
              copying a KOL thesis, you can ask how a macro event affects your
              portfolio and get a decision-ready report back.
            </p>

            <div className="space-y-3">
              {RESEARCH_USE_CASES.map((item, index) => (
                <div
                  key={item.title}
                  className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 font-mono text-[10px] font-bold text-[#f2ca50]">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{item.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#a3a3a3]">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#101010] p-6 shadow-2xl md:p-8">
            <div className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-headline text-2xl font-bold text-white">Three-agent report pipeline</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                    Research -&gt; analyst -&gt; writer
                  </div>
                </div>
                <div className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f2ca50]">
                  Fast or deep
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-[#a3a3a3]">
                Fast mode usually returns in 1-2 minutes. Deep mode runs longer
                retrieval, claim checks, and source verification for heavier reports.
              </p>
            </div>

            <AgentPipeline steps={RESEARCH_STEPS} />

            <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-headline text-lg font-bold text-white">Report template</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                    Reusable decision format
                  </div>
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#f2ca50]">
                  Portfolio-aware
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {RESEARCH_TEMPLATE_SECTIONS.map((section, index) => (
                  <div
                    key={section}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]/80">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">{section}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs text-[#a3a3a3]">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                  Macro impact
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                  Holdings context
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                  Prediction market thesis
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                  Source-backed
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection
        id="business"
        className="mx-auto max-w-7xl border-t border-white/5 px-6 py-24 lg:px-8"
      >
        <div className="flex flex-col items-center gap-12 md:flex-row">
          <div className="flex-1">
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#f2ca50]">
              AgentPay B2B
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-5xl">Programmable money for teams.</h2>
            <p className="mb-6 max-w-2xl text-balance text-lg leading-relaxed text-[#a3a3a3]">
              AgentFlow is not just for individuals. Teams can use natural-language
              payment workflows for requests, approvals, invoices, contacts, exports,
              batch payroll, and recurring payouts.
            </p>
            <div className="flex flex-wrap gap-3 font-mono text-sm">
              {["/requests", "/history", "/contacts", "/exports", "/batch", "/invoice"].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative w-full max-w-md rounded-2xl border border-white/20 border-dashed bg-[#050505] p-6 font-mono shadow-2xl">
            <div className="mb-4 mt-2 border-b border-dashed border-white/20 pb-4 text-center">
              <div className="text-lg font-bold tracking-widest text-white">AGENTPAY RECEIPT</div>
              <div className="mt-1 text-xs text-[#a3a3a3]">STATUS: APPROVED &amp; SETTLED</div>
            </div>

            <div className="mb-6 space-y-2 text-sm text-[#a3a3a3]">
              <div className="flex justify-between">
                <span>OP_TYPE:</span>
                <span className="text-white">BATCH_PAYROLL</span>
              </div>
              <div className="flex justify-between">
                <span>NETWORK:</span>
                <span className="text-white">ARC TESTNET</span>
              </div>
              <div className="flex justify-between">
                <span>TOKEN:</span>
                <span className="text-white">USDC</span>
              </div>
              <div className="flex justify-between">
                <span>CSV_PARSED:</span>
                <span className="text-green-400">SUCCESS [12 rows]</span>
              </div>
            </div>

            <div className="mb-4 space-y-3 border-y border-dashed border-white/20 py-4 text-xs">
              <div className="flex justify-between">
                <span>0x4A...21B (Design)</span>
                <span>$1,200.00</span>
              </div>
              <div className="flex justify-between">
                <span>0x9C...88F (Engineering)</span>
                <span>$4,500.00</span>
              </div>
              <div className="flex justify-between">
                <span>0x11D...3E2 (Marketing)</span>
                <span>$800.00</span>
              </div>
              <div className="pt-2 italic text-[#a3a3a3]">... 9 more recipients</div>
            </div>

            <div className="flex justify-between text-lg font-bold text-white">
              <span>TOTAL:</span>
              <span>$12,500.00</span>
            </div>

            <div className="mt-6 break-all text-center text-[10px] text-[#a3a3a3]/50">
              TX: 0x8f2a9c3e1b7d5f4a6c8e0b2d4f6a8c0e2b4d6f8a
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Don&apos;t switch tabs.</h2>
          <p className="mx-auto max-w-2xl text-lg text-[#a3a3a3]">
            Execute from where you already are. Link your wallet to the AgentFlow Telegram
            bot and continue approved onchain workflows from mobile or desktop.
          </p>
        </div>

        <TelegramContinuityShowcase />
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="order-2 lg:order-1">
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#f2ca50]">
              AgentPay C2B / C2C
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-5xl">
              Payments for people, shops, and creators.
            </h2>
            <p className="mb-6 max-w-2xl text-lg leading-relaxed text-[#a3a3a3]">
              AgentFlow also supports direct receive flows for personal payments,
              merchant checkouts, and creator payments. Generate your own
              customized payment link or wallet QR, use a wallet address or
              optional .arc identity, and prefill amount and remark so anyone,
              including non-AgentFlow users, can pay directly without an
              AgentFlow account.
            </p>
            <div className="flex flex-wrap gap-3 font-mono text-sm">
              {["QR receive", "Payment link", "Optional .arc", "Remarks", "Anyone can pay"].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="rounded-[2rem] border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="font-headline text-2xl font-bold text-white">Receive with AgentPay</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                    QR + Payment Link
                  </div>
                </div>
                <div className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f2ca50]">
                  Arc Testnet
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                <AgentPayQrMock />
              </div>

              <p className="mt-5 text-sm leading-relaxed text-[#a3a3a3]">
                Use a wallet address or an optional .arc identity. Share the QR
                or payment link, attach a remark, and let any customer, shop
                visitor, or non-AgentFlow payer send USDC directly.
              </p>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#f2ca50]">
              AgentPay + Telegram
            </div>
            <h2 className="mb-4 text-3xl font-bold md:text-5xl">
              Pay from Telegram with a QR image.
            </h2>
            <p className="mb-6 max-w-2xl text-lg leading-relaxed text-[#a3a3a3]">
              AgentFlow users can send an AgentPay QR image to the Telegram bot,
              include the amount and remark in the same message, confirm in chat,
              and complete the payment on Arc without opening the web app.
            </p>
            <div className="flex flex-wrap gap-3 font-mono text-sm">
              {[
                "Send QR image",
                "Add amount",
                "Add remark",
                "Confirm in Telegram",
                "Settle on Arc",
              ].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="font-headline text-2xl font-bold text-white">
                  Telegram payment flow
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                  QR image + amount + remark
                </div>
              </div>
              <div className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f2ca50]">
                Live flow
              </div>
            </div>

            <TelegramAgentPayMock />

            <p className="mt-5 text-sm leading-relaxed text-[#a3a3a3]">
              The bot resolves the QR target, keeps the remark, asks for
              confirmation, and completes the payment directly from Telegram.
            </p>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="intelligence" className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">Built with an intelligence stack.</h2>
          <p className="mx-auto max-w-2xl text-lg text-[#a3a3a3]">
            Not a simple prompt wrapper. AgentFlow routes each request through four
            critical layers before any paid agent executes.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {STACK_ITEMS.map((item) => (
            <div
              key={item.step}
              className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(30,30,30,0.5)_0%,rgba(15,15,15,0.9)_100%)] p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[#f2ca50]/40 hover:shadow-[0_10px_40px_-10px_rgba(242,202,80,0.1)]"
            >
              <div className="mb-4 bg-gradient-to-br from-[#f2ca50]/15 to-[rgba(200,100,80,0.05)] p-0 text-left">
                <div className="font-mono text-sm uppercase tracking-widest text-[#f2ca50]">
                  {item.step}
                </div>
              </div>
              <h3 className="mb-3 text-2xl font-bold">{item.title}</h3>
              <p className="leading-relaxed text-[#a3a3a3]">{item.body}</p>
            </div>
          ))}
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="hermes-engine" className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="mb-16 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f2ca50]/20 bg-[#f2ca50]/10 px-3 py-1">
            <span className="font-mono text-xs font-medium uppercase tracking-widest text-[#f2ca50]">
              Powered by Hermes
            </span>
          </div>
          <h2 className="mb-4 text-3xl font-bold md:text-5xl">No menus. Just ask.</h2>
          <p className="mx-auto max-w-2xl text-lg text-[#a3a3a3]">
            Hermes handles the natural-language reasoning layer. AgentFlow then routes the
            request into the right service or paid agent flow for execution.
          </p>
        </div>

          <div className="relative mx-auto max-w-3xl">
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[#f2ca50]/10 blur-[80px]" />

          <HermesFlowMock />
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-[#0f0f0f] p-8 md:p-16">
          <div className="flex flex-col items-center gap-12 md:flex-row">
            <div className="z-10 flex-1">
              <div className="mb-4 font-mono text-xs uppercase tracking-widest text-[#f2ca50]">
                Semantic Memory
              </div>
              <h2 className="mb-4 text-3xl font-bold md:text-4xl">An OS that actually remembers.</h2>
              <p className="text-lg leading-relaxed text-[#a3a3a3]">
                AgentFlow keeps semantic memory for workflow context. It can retain saved
                contacts, user preferences, and portfolio history so repeated tasks do not
                start from scratch each time.
              </p>
            </div>

            <div className="relative flex h-64 w-full flex-1 items-center justify-center">
              <div className="absolute h-48 w-48 rounded-full bg-[#f2ca50]/20 blur-[60px]" />
              <div className="absolute h-24 w-24 rounded-full bg-yellow-500/30 blur-[40px]" />

              <div className="relative z-10 flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/5 bg-[rgba(20,20,20,0.4)] p-5 backdrop-blur-xl">
                <div className="flex gap-3">
                  <div className="h-8 w-8 flex-shrink-0 rounded-full bg-white/10" />
                  <div className="rounded-xl rounded-tl-none border border-white/5 bg-white/5 p-3 text-sm text-white">
                    Send 500 USDC to my designer for the new logo assets.
                  </div>
                </div>
                <div className="flex flex-row-reverse gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#f2ca50]/30 bg-[#f2ca50]/20">
                    <span className="text-[10px] font-black text-[#f2ca50]">AF</span>
                  </div>
                  <div className="flex w-full flex-col gap-2 rounded-xl rounded-tr-none border border-[#f2ca50]/20 bg-[#f2ca50]/10 p-3 font-mono text-sm">
                    <span className="text-xs text-[#a3a3a3]">{"> accessing memory..."}</span>
                    <span className="text-white">{"> Resolved 'designer' to saved contact record"}</span>
                    <span className="text-green-400">{"> Preparing 500 USDC transaction."}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection id="trust" className="border-y border-white/5 bg-[#111111] py-24">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-16 px-6 lg:flex-row lg:px-8">
          <div className="flex-1">
            <h2 className="mb-6 text-3xl font-bold md:text-4xl">Real onchain execution.</h2>
            <ul className="space-y-6">
              <li>
                <h4 className="text-lg font-bold text-white">Session auth + execution wallet</h4>
                <p className="mt-1 text-sm text-[#a3a3a3]">
                  AgentFlow uses wallet-based session auth and keeps execution balances visible
                  in the app before privileged flows can run.
                </p>
              </li>
              <li>
                <h4 className="text-lg font-bold text-white">Execution guard</h4>
                <p className="mt-1 text-sm text-[#a3a3a3]">
                  Simulation, slippage checks, previews, and strict validation guard real
                  money-movement actions before they are sent.
                </p>
              </li>
              <li>
                <h4 className="text-lg font-bold text-white">Circle x402 on Arc</h4>
                <p className="mt-1 text-sm text-[#a3a3a3]">
                  Paid agent steps use USDC-denominated Arc settlement and Circle x402
                  flows so usage-based pricing stays practical.
                </p>
              </li>
            </ul>
          </div>

          <div className="relative w-full flex-1 overflow-hidden rounded-3xl border border-white/10 bg-[#1a1a1a] p-8 font-mono text-sm text-[#a3a3a3] shadow-2xl">
            <div className="absolute right-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-[#f2ca50] to-transparent opacity-50" />
            <div className="mb-2 text-green-400">{"> AgentFlow Intent Router initialized..."}</div>
            <div className="mb-2">{'> Request: "Swap 100 USDC to EURC and send to Alice"'}</div>
            <div className="mb-2 text-yellow-400">{"> Classification: [SWAP], [PAYMENT]"}</div>
            <div className="mb-2">{"> Validation Layer: Checking slippage... OK"}</div>
            <div className="mb-2">{"> Memory Layer: Resolved saved contact for Alice"}</div>
            <div className="mt-4 font-bold text-white">
              {"> Execution Guard: PASSED. Ready for confirmed transaction."}
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      <ScrollRevealSection as="footer" className="bg-[#0a0a0a] py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row lg:px-8">
          <div className="flex items-center gap-2 opacity-70">
            <span className="font-black">
              <span className="text-[#f2ca50]">A</span>F
            </span>
          </div>
          <div className="font-mono text-xs uppercase tracking-widest text-[#a3a3a3]/50">
            Your AI agent economy for Web3 workflows.
          </div>
          <div className="font-mono text-xs uppercase tracking-widest text-[#a3a3a3]/50">
            © 2026 AgentFlow. All rights reserved.
          </div>
        </div>
      </ScrollRevealSection>

      <style>{`
        html {
          scroll-behavior: smooth;
        }

        @media (min-width: 1024px) {
          html {
            scroll-snap-type: y proximity;
          }

          [data-snap="true"] {
            scroll-snap-align: start;
          }
        }

        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
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
