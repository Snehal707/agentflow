import Image from "next/image";
import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";
import { AgentFlowWaveHero } from "@/components/marketing/AgentFlowWaveHero";
import { LandingStatsStrip } from "@/components/marketing/LandingStatsStrip";

const footerLinks = [
  { label: "Docs", href: "#" },
  { label: "Security", href: "#" },
  { label: "Developers", href: "#" },
  { label: "Terms", href: "#" },
] as const;

export default function LandingPage() {
  return (
    <div className="bg-[#111111] text-[#e5e2e1] selection:bg-[#f2ca50]/30">
      {/* Top Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-[#4d4635]/10 bg-[#111111]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5 md:px-12">
          <BrandLockup href="/" variant="nav" />
          <div className="hidden items-center gap-10 md:flex">
            <a
              href="#features"
              className="font-headline text-lg font-medium tracking-tight text-[#f2ca50] border-b border-[#f2ca50]/40 pb-0.5 transition-opacity hover:opacity-80"
            >
              Features
            </a>
            <a
              href="#solutions"
              className="font-headline text-lg font-medium tracking-tight text-[#e5e2e1]/60 hover:text-[#e5e2e1] transition-colors"
            >
              Solutions
            </a>
            <a
              href="#workspace"
              className="font-headline text-lg font-medium tracking-tight text-[#e5e2e1]/60 hover:text-[#e5e2e1] transition-colors"
            >
              Workspace
            </a>
            <a
              href="#protocol"
              className="font-headline text-lg font-medium tracking-tight text-[#e5e2e1]/60 hover:text-[#e5e2e1] transition-colors"
            >
              Protocol
            </a>
          </div>
          <Link
            href="/chat"
            className="gold-gradient-bg text-[#241a00] px-7 py-2.5 rounded-lg font-label font-bold text-sm tracking-wide btn-hover-effect"
          >
            Launch App
          </Link>
        </div>
      </nav>

      <main>
        <AgentFlowWaveHero />

        <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24 pt-8 md:px-12 md:pt-10">
          <LandingStatsStrip />

          <div className="mb-6 mt-10 flex flex-col gap-3 border-b border-[#4d4635]/18 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-label text-[10px] uppercase tracking-[0.24em] text-[#d0c5af]/48">
                Agent brain preview
              </p>
              <h2 className="mt-2 font-headline text-2xl font-bold tracking-tight text-white md:text-3xl">
                The answer, the payment, and the wallet action live together.
              </h2>
            </div>
            <p className="text-sm text-[#d0c5af]/66 md:max-w-sm md:text-right">
              Ask from web chat or Telegram about a macro event, holdings, invoice, payment,
              swap, vault, or bridge. AgentFlow routes the right agent and keeps proof close.
            </p>
          </div>

          <div className="glass-card relative aspect-video w-full overflow-hidden rounded-lg border-[#4d4635]/20 shadow-2xl">
            <Image
              alt="Unified AgentFlow workspace sections"
              className="w-full h-full object-cover"
              src="/agentflow-unified-preview.png"
              width={1680}
              height={945}
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111111]/40 via-transparent to-transparent" />
          </div>
        </section>

        {/* Trust Strip */}
        <section className="w-full border-y border-[#4d4635]/5 bg-[#0e0e0e]/50 py-16">
          <div className="mx-auto max-w-7xl px-8 md:px-12">
            <p className="font-label mb-12 text-center text-[9px] uppercase tracking-[0.5em] text-[#d0c5af]/40">
              Built for Circle Nanopayments, Arc, AgentPay, Telegram, and ERC-8004 agent identity
            </p>
            <div className="flex flex-wrap items-center justify-center gap-12 opacity-30 grayscale hover:opacity-60 transition-opacity duration-700 md:gap-24">
              <span className="font-headline text-xl font-bold tracking-[0.2em]">CIRCLE</span>
              <span className="font-headline text-xl font-bold italic tracking-[0.2em]">ARC</span>
              <span className="font-headline text-xl font-bold tracking-[0.2em]">HERMES</span>
              <span className="font-headline text-xl font-bold italic tracking-[0.2em]">X402</span>
              <span className="font-headline text-xl font-bold tracking-[0.2em]">USDC</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="mb-8 text-center font-headline text-2xl font-bold text-white">
            Why AgentFlow Needs Arc Nanopayments
          </h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-red-400/20 bg-[#111318] p-6">
              <div className="mb-3 font-medium text-red-400">Traditional Gas Model</div>
              <div className="space-y-2 text-sm text-[#aaabb0]">
                <div>Gas per tx: ~$2.50</div>
                <div>Per-agent task price: $0.02</div>
                <div>Revenue after gas: -$2.48</div>
                <div className="font-medium text-red-400">No room for pay-per-task agents</div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-400/20 bg-[#111318] p-6">
              <div className="mb-3 font-medium text-emerald-400">Arc + Circle Nanopayments</div>
              <div className="space-y-2 text-sm text-[#aaabb0]">
                <div>Gas per tx: ~$0.00001</div>
                <div>Per-agent task price: $0.02</div>
                <div>Revenue after gas: $0.01999</div>
                <div className="font-medium text-emerald-400">Usage pricing becomes viable</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Bento Grid */}
        <section className="mx-auto max-w-7xl px-8 py-32 md:px-12" id="solutions">
          <div className="mb-20">
            <h2 className="font-headline editorial-headline mb-6 text-5xl font-bold md:text-6xl">
              Built for the full <span className="italic text-[#f2ca50]">agent economy loop.</span>
            </h2>
            <div className="h-0.5 w-20 gold-gradient-bg opacity-60" />
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
            {/* Card 1 - large */}
            <div className="glass-card relative overflow-hidden rounded-2xl p-10 group md:col-span-8 md:p-14">
              <div className="relative z-10">
                <div className="mb-8 flex h-12 w-12 items-center justify-center">
                  <span className="material-symbols-outlined text-[#f2ca50] text-[28px]">shield</span>
                </div>
                <h3 className="font-headline mb-5 text-3xl font-bold tracking-tight">Personalized Reports</h3>
                <p className="max-w-md text-lg leading-relaxed text-[#d0c5af]/90 opacity-90">
                  Ask any topic, market move, policy shift, or macro event. Research,
                  Analyst, and Writer agents produce sourced reports and can explain the
                  impact through your live portfolio exposure.
                </p>
              </div>
            </div>

            {/* Card 2 - small */}
            <div className="glass-card flex flex-col justify-between rounded-2xl p-10 md:col-span-4 md:p-14">
              <div className="flex h-12 w-12 items-center justify-center">
                <span className="material-symbols-outlined text-[#f2ca50] text-[28px]">bolt</span>
              </div>
              <div>
                <h3 className="font-headline mb-4 text-3xl font-bold tracking-tight">AgentPay Commerce</h3>
                <p className="leading-relaxed text-[#d0c5af]/90 opacity-90">
                  Send USDC, create requests, payment links, QR codes, .arc receiving flows, invoices,
                  recurring payments, saved contacts, split payments, and CSV batch payouts.
                </p>
              </div>
            </div>

            {/* Card 3 - small */}
            <div className="glass-card flex flex-col justify-between rounded-2xl p-10 md:col-span-4 md:p-14">
              <div className="flex h-12 w-12 items-center justify-center">
                <span className="material-symbols-outlined text-[#f2ca50] text-[28px]">hub</span>
              </div>
              <div>
                <h3 className="font-headline mb-4 text-3xl font-bold tracking-tight">Web + Telegram Brain</h3>
                <p className="leading-relaxed text-[#d0c5af]/90 opacity-90">
                  Use AgentFlow in the app or through Telegram for linked-wallet balance,
                  portfolio, swap, vault, bridge, and natural-language replies with memory.
                </p>
              </div>
            </div>

            {/* Card 4 - large */}
            <div className="glass-card relative overflow-hidden rounded-2xl p-10 group md:col-span-8 md:p-14">
              <div className="relative z-10 flex h-full flex-col justify-between">
                <div>
                  <div className="mb-8 flex h-12 w-12 items-center justify-center">
                    <span className="material-symbols-outlined text-[#f2ca50] text-[28px]">monitoring</span>
                  </div>
                  <h3 className="font-headline mb-5 text-3xl font-bold tracking-tight">14 Core Agent Roles</h3>
                </div>
                <p className="max-w-md text-lg leading-relaxed text-[#d0c5af]/90 opacity-90">
                  Research, Analyst, Writer, Swap, Vault, Bridge, Portfolio, Invoice, Vision,
                  Transcribe, Schedule, Split, Batch, and ASCII agents power pay-per-task flows
                  with x402 pricing, A2A follow-ups, and Arc ERC-8004 registry support.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonial / Social Proof */}
        <section className="border-y border-[#4d4635]/5 bg-[#0e0e0e] py-32" id="workspace">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-20 px-8 md:grid-cols-2 md:px-12">
            <div className="relative">
              <div className="pointer-events-none absolute -left-12 -top-16 select-none text-[#f2ca50]/5">
                <span className="material-symbols-outlined text-[180px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  format_quote
                </span>
              </div>
              <blockquote className="font-headline relative z-10 text-4xl font-medium italic leading-[1.15] tracking-tight md:text-5xl">
                &ldquo;AgentFlow turns research into action: know what a market event means for your
                holdings, then send, invoice, schedule, batch pay, rebalance, or bridge without
                buying a subscription.&rdquo;
              </blockquote>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="glass-card rounded-2xl border-[#4d4635]/20 p-8">
                  <p className="font-headline text-3xl font-bold text-[#f2ca50] mb-1">99.9%</p>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/60">Margin preserved</p>
                </div>
                <div className="glass-card rounded-2xl border-[#4d4635]/20 p-8">
                  <p className="font-headline text-3xl font-bold text-[#f2ca50] mb-1">x402</p>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/60">Nanopayment gate</p>
                </div>
              </div>
              <div className="space-y-4 pt-10">
                <div className="glass-card rounded-2xl border-[#4d4635]/20 p-8">
                  <p className="font-headline text-3xl font-bold text-[#f2ca50] mb-1">Arc</p>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/60">USDC-native gas</p>
                </div>
                <div className="glass-card rounded-2xl border-[#4d4635]/20 p-8">
                  <p className="font-headline text-3xl font-bold text-[#f2ca50] mb-1">5+</p>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/60">Core workflows</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section
          className="relative mx-auto overflow-hidden px-8 py-40 text-center md:px-12 md:py-52"
          id="protocol"
        >
          <h2 className="font-headline editorial-headline mb-12 text-6xl font-extrabold md:text-8xl">
            Stop watching. <span className="italic gold-gradient-text">Ask the agents.</span>
          </h2>
          <p className="mx-auto mb-16 max-w-xl text-lg text-[#d0c5af] font-body opacity-90 md:text-xl">
            Connect a wallet and pay only when work runs. AgentFlow makes per-query, per-action,
            and agent-to-agent commerce practical for reports, payments, swaps, vaults, bridges,
            invoices, schedules, splits, batch payouts, and Telegram-assisted execution.
          </p>
          <div className="flex flex-col items-center justify-center gap-6 md:flex-row">
            <Link
              href="/chat"
              className="gold-gradient-bg text-[#241a00] rounded-lg px-16 py-6 font-label font-bold text-xl btn-hover-effect"
            >
              Open AgentFlow
            </Link>
          </div>
          <div className="mt-16 inline-flex items-center gap-3 font-label text-xs tracking-widest text-[#d0c5af]/50">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f2ca50]" />
            Arc Testnet - Circle Nanopayments - ERC-8004 agent registry support
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[#4d4635]/10 bg-[#0c0c0c] py-16">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-10 px-8 md:px-12">
          <BrandLockup href="/" variant="footer" />
          <div className="flex flex-wrap justify-center gap-10 md:gap-14">
            {footerLinks.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="font-body text-[10px] uppercase tracking-[0.25em] text-[#e5e2e1]/40 transition-colors hover:text-[#f2ca50]"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="w-full border-t border-[#4d4635]/5 pt-10 text-center font-label text-[9px] tracking-[0.15em] text-[#e5e2e1]/20">
            (c) 2024 AgentFlow. Pay-per-task research, payments, and execution on Arc.
          </div>
        </div>
      </footer>
    </div>
  );
}
