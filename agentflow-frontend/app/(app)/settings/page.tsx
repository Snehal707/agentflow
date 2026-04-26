"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { TelegramConnectCard } from "@/components/TelegramConnectCard";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { shortenAddress } from "@/lib/appData";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

export default function SettingsPage() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, signIn, loading: signInLoading } = useAgentJwt();
  const [autoSettlement, setAutoSettlement] = useState(true);
  const [biometricMfa, setBiometricMfa] = useState(false);
  const [dispatchBriefing, setDispatchBriefing] = useState(true);
  const [tacticalAlerts, setTacticalAlerts] = useState(true);
  const [internalReasoning, setInternalReasoning] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-[#f2f2f2]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatTopNavbar
          actions={(
            <SessionStatusChip
              address={address}
              isAuthenticated={isAuthenticated}
              isLoading={signInLoading}
              onAction={() => {
                if (!address) { openConnectModal?.(); return; }
                if (!isAuthenticated) { void signIn().catch(() => {}); }
              }}
              compact
            />
          )}
        />

        {/* Scrollable main */}
        <main className="flex-1 overflow-y-auto px-10 pb-24 pt-12">
          <div className="max-w-7xl mx-auto">
            {/* Page header */}
            <header className="mb-14">
              <nav className="flex items-center text-[9px] uppercase tracking-[0.4em] text-white/30 font-black mb-4 gap-3">
                <Link href="/chat" className="hover:text-[#f2ca50] transition-colors">Chat</Link>
                <span className="text-white/15">/</span>
                <span className="text-[#f2ca50] tracking-[0.5em]">Telegram</span>
              </nav>
              <h1 className="text-6xl font-headline font-black text-white mb-5 italic uppercase leading-tight" style={{ letterSpacing: "-0.02em" }}>
                Telegram
              </h1>
              <div className="h-[3px] w-20 bg-[#f2ca50] mb-7 shadow-[0_0_12px_rgba(242,202,80,0.4)]" />
              <p className="text-white/40 max-w-xl font-medium text-[15px] leading-relaxed">
                Link Telegram for chat access, payment alerts, scheduled transfers, and mobile AgentFlow updates.
              </p>
            </header>

            <div className="grid grid-cols-12 gap-10">
              {/* Left column */}
              <div className="col-span-12 lg:col-span-7 space-y-10">

                {/* Telegram Protocol */}
                <section
                  className="cinematic-card p-10 border-t-[3px] border-t-[#f2ca50]"
                  style={{ boxShadow: "inset 0 1px 0px rgba(255,255,255,0.03)" }}
                >
                  <div className="flex justify-between items-start mb-10">
                    <div>
                      <h3 className="text-[9px] uppercase text-[#f2ca50] font-black mb-2" style={{ letterSpacing: "0.25em" }}>
                        Telegram
                      </h3>
                      <h2 className="text-2xl font-headline font-bold text-white tracking-tight">Telegram connection</h2>
                    </div>
                    <span className="px-4 py-1.5 bg-[#f2ca50]/10 border border-[#f2ca50]/30 text-[#f2ca50] text-[9px] font-black uppercase tracking-[0.2em]">
                      LINKED
                    </span>
                  </div>
                  <TelegramConnectCard />
                </section>

                {/* Wallet and session */}
                <section
                  className="cinematic-card p-10 border-l-[3px] border-l-[#f2ca50]/40"
                  style={{ boxShadow: "inset 0 1px 0px rgba(255,255,255,0.03)" }}
                >
                  <h3 className="text-[9px] uppercase text-white/30 font-black mb-10" style={{ letterSpacing: "0.25em" }}>
                    Wallet &amp; Session
                  </h3>

                  {/* Info cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                    <div className="bg-white/[0.02] p-6 border border-white/5 hover:border-[#f2ca50]/20 transition-all group">
                      <div className="flex justify-between mb-5">
                        <span className="material-symbols-outlined icon-standard text-[#f2ca50]/70 text-xl">account_circle</span>
                        <span className="material-symbols-outlined icon-standard text-white/20 text-sm group-hover:text-[#f2ca50] transition-colors">edit_note</span>
                      </div>
                      <p className="text-[8px] text-white/30 uppercase tracking-widest font-black mb-1">Wallet status</p>
                      <p className="text-xl font-headline font-black text-white uppercase tracking-tight italic">Connected user</p>
                    </div>
                    <div className="bg-white/[0.02] p-6 border border-white/5">
                      <div className="flex justify-between mb-5">
                        <span className="material-symbols-outlined icon-standard text-[#f2ca50]/70 text-xl">account_balance_wallet</span>
                        <span className="material-symbols-outlined icon-standard text-[#f2ca50]/30 text-sm">verified_user</span>
                      </div>
                      <p className="text-[8px] text-white/30 uppercase tracking-widest font-black mb-1">Connected address</p>
                      <p className="text-white font-mono text-xs font-bold tracking-widest opacity-80 uppercase">
                        {address ? shortenAddress(address) : "0x000...0000"}
                      </p>
                    </div>
                  </div>

                  {/* Toggle rows */}
                  <div>
                    <div className="flex items-center justify-between py-6 border-t border-white/5 hover:bg-white/[0.02] px-4 -mx-4 transition-all">
                      <div className="pr-8">
                        <p className="text-white text-[11px] font-black uppercase tracking-widest mb-1 italic">Auto settlement</p>
                        <p className="text-[11px] text-white/30 font-medium leading-relaxed max-w-sm">
                          Let Telegram-triggered AgentFlow actions finish eligible flows after preview and confirmation.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoSettlement((v) => !v)}
                        aria-pressed={autoSettlement}
                        className={`relative w-11 h-5 rounded-full flex items-center transition-all duration-300 flex-shrink-0 ${
                          autoSettlement
                            ? "bg-[#f2ca50]/90 shadow-[0_0_12px_rgba(242,202,80,0.3)] justify-end pr-0.5"
                            : "bg-white/5 justify-start pl-0.5"
                        }`}
                      >
                        <span className={`block w-4 h-4 rounded-full ${autoSettlement ? "bg-black" : "bg-white/10"}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between py-6 border-t border-white/5 hover:bg-white/[0.02] px-4 -mx-4 transition-all">
                      <div className="pr-8">
                        <p className="text-white text-[11px] font-black uppercase tracking-widest mb-1 italic">Biometric approval</p>
                        <p className="text-[11px] text-white/30 font-medium leading-relaxed max-w-sm">
                          Require an extra approval step for higher-risk actions on this device.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBiometricMfa((v) => !v)}
                        aria-pressed={biometricMfa}
                        className={`relative w-11 h-5 rounded-full flex items-center transition-all duration-300 flex-shrink-0 ${
                          biometricMfa
                            ? "bg-[#f2ca50]/90 shadow-[0_0_12px_rgba(242,202,80,0.3)] justify-end pr-0.5"
                            : "bg-white/5 justify-start pl-0.5"
                        }`}
                      >
                        <span className={`block w-4 h-4 rounded-full ${biometricMfa ? "bg-black" : "bg-white/10"}`} />
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              {/* Right column */}
              <div className="col-span-12 lg:col-span-5 space-y-10">

                {/* Security Posture */}
                <section className="cinematic-card p-10 border-b-[3px] border-b-[#f2ca50]/20">
                  <h3 className="text-[9px] uppercase text-white/30 font-black mb-10" style={{ letterSpacing: "0.25em" }}>
                    Security
                  </h3>
                  <div className="space-y-8">
                    <div>
                      <div className="flex items-center gap-3 mb-5">
                        <div className="w-1 h-5 bg-[#f2ca50]" />
                        <h4 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Encryption</h4>
                      </div>
                      <div className="bg-black/60 p-5 border border-[#f2ca50]/10">
                        <div className="flex justify-between mb-4 border-b border-white/5 pb-2">
                          <span className="text-[8px] text-white/30 uppercase font-black tracking-widest">ENCRYPTION LEVEL</span>
                          <span className="text-[8px] text-[#f2ca50] font-black uppercase tracking-[0.2em]">AES-256 / L9</span>
                        </div>
                        <p className="text-[11px] text-white/30 leading-relaxed italic">
                          Session data stays scoped to this workspace. Private keys remain outside the frontend.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-[8px] font-black text-white/30 uppercase tracking-[0.3em]">Current session</h4>
                      <div className="flex items-center justify-between bg-white/[0.01] p-4 border border-white/5">
                        <div className="flex items-center gap-4">
                          <span className="material-symbols-outlined icon-standard text-[#f2ca50]/70">terminal</span>
                          <div>
                            <p className="text-[10px] text-white font-black uppercase tracking-widest">WEB APP</p>
                            <p className="text-[8px] text-[#f2ca50]/50 uppercase tracking-widest font-black mt-0.5">Session active</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="material-symbols-outlined icon-standard text-white/20 hover:text-red-500 transition-colors text-lg"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Notifications */}
                <section className="cinematic-card p-10">
                  <h3 className="text-[9px] uppercase text-white/30 font-black mb-8" style={{ letterSpacing: "0.25em" }}>
                    Notifications
                  </h3>
                  <div className="space-y-6">
                    {[
                      { icon: "history_edu", label: "Daily brief", sub: "Chat summary and wallet context", state: dispatchBriefing, set: setDispatchBriefing },
                      { icon: "rocket_launch", label: "Execution alerts", sub: "Live updates for swaps, vaults, bridges, and payments", state: tacticalAlerts, set: setTacticalAlerts },
                      { icon: "psychology", label: "Reasoning trace", sub: "Show more of the agent process in chat", state: internalReasoning, set: setInternalReasoning },
                    ].map(({ icon, label, sub, state, set }) => (
                      <div key={label} className="flex items-center justify-between group">
                        <div className="flex items-center gap-5">
                          <div className="w-10 h-10 border border-white/5 flex items-center justify-center bg-white/[0.02] group-hover:border-[#f2ca50]/30 transition-all">
                            <span className="material-symbols-outlined icon-standard text-white/30 group-hover:text-[#f2ca50] transition-colors text-lg">
                              {icon}
                            </span>
                          </div>
                          <div>
                            <p className="text-[10px] text-white font-black uppercase tracking-widest italic">{label}</p>
                            <p className="text-[8px] text-white/30 uppercase tracking-widest mt-0.5">{sub}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => set((v) => !v)}
                          aria-pressed={state}
                          className={`relative w-10 h-5 rounded-full flex items-center transition-all duration-300 flex-shrink-0 ${
                            state
                              ? "bg-[#f2ca50]/90 shadow-[0_0_12px_rgba(242,202,80,0.3)] justify-end pr-0.5"
                              : "bg-white/5 justify-start pl-0.5"
                          }`}
                        >
                          <span className={`block w-4 h-4 rounded-full ${state ? "bg-black" : "bg-white/10"}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Telegram health */}
                <div className="cinematic-card p-10 bg-gradient-to-br from-[#101010] to-black relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-40 h-40 bg-[#f2ca50]/5 rounded-full -mr-20 -mt-20 blur-[80px]" />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-0.5 h-3 bg-[#f2ca50] animate-pulse" />
                      <p className="text-[9px] text-[#f2ca50] font-black uppercase tracking-[0.4em]">Telegram health</p>
                    </div>
                    <div className="flex items-baseline gap-2 mb-8">
                      <span className="text-6xl font-headline font-black text-white leading-none italic">98.2</span>
                      <div className="mb-1">
                        <span className="block text-[#f2ca50] text-[9px] font-black uppercase tracking-[0.2em]">Healthy</span>
                        <span className="block text-white/20 text-[7px] font-bold uppercase tracking-widest">Service load</span>
                      </div>
                    </div>
                    <div className="w-full bg-white/5 h-1 overflow-hidden border border-white/5">
                      <div
                        className="bg-[#f2ca50] h-full shadow-[0_0_15px_rgba(242,202,80,0.5)] transition-all duration-1000"
                        style={{ width: "98.2%" }}
                      />
                    </div>
                    <p className="mt-8 text-[10px] text-white/30 italic font-headline leading-relaxed text-center opacity-70">
                      Wallet auth, Telegram alerts, and execution controls are all configured from here.
                    </p>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
