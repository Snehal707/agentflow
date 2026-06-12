"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { TelegramConnectCard } from "@/components/TelegramConnectCard";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

export default function TelegramPage() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, signIn, loading: signInLoading, error: signInError } = useAgentJwt();
  const telegramBotHandle =
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim() || "Agentflowone_bot";
  const telegramBotUrl = `https://t.me/${telegramBotHandle}`;

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-[#f2f2f2]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <ChatTopNavbar
          actions={
            <SessionStatusChip
              address={address}
              isAuthenticated={isAuthenticated}
              isLoading={signInLoading}
              error={signInError}
              onAction={() => {
                if (!address) {
                  openConnectModal?.();
                  return;
                }
                if (!isAuthenticated) {
                  void signIn().catch(() => {});
                }
              }}
              compact
            />
          }
        />

        <main className="flex-1 overflow-y-auto px-5 pb-24 pt-12 sm:px-8 xl:px-12">
          <div className="mx-auto max-w-[1120px]">
            <header className="mb-8 border-b border-white/5 pb-8">
              <h1 className="mb-5 text-[clamp(4rem,8vw,6.5rem)] font-headline font-black leading-none tracking-[-0.05em] text-white">
                Tele<span className="text-[#f2ca50]">gram</span>
              </h1>

              <div className="mb-7 h-[3px] w-20 bg-[#f2ca50] shadow-[0_0_12px_rgba(242,202,80,0.4)]" />

              <p className="max-w-2xl text-[15px] font-medium leading-relaxed text-white/40">
                Connect your Telegram to unlock bot chat, wallet alerts, and mobile AgentFlow actions.
              </p>
            </header>

            <section className="w-full overflow-hidden rounded-[28px] border border-white/5 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.05),transparent_28%),linear-gradient(180deg,#101010,#090909)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:rounded-[32px] sm:p-8 xl:p-12">
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <h3
                    className="mb-2 text-[9px] font-black uppercase text-[#f2ca50]"
                    style={{ letterSpacing: "0.25em" }}
                  >
                    Telegram
                  </h3>
                  <h2 className="text-2xl font-headline font-bold tracking-tight text-white">
                    Telegram connection
                  </h2>
                </div>
              </div>

              <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.85fr)_340px] lg:items-start">
                <TelegramConnectCard />

                <aside className="rounded-[28px] border border-[#f2ca50]/16 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.08),transparent_34%),linear-gradient(180deg,rgba(242,202,80,0.06),rgba(12,12,12,0.96))] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.24em] text-[#f2ca50]">
                        Telegram Bot
                      </p>
                      <h3 className="mt-2 text-[2rem] font-headline font-bold leading-[0.95] tracking-[-0.03em] text-white">
                        Open bot chat
                      </h3>
                    </div>
                    <span className="rounded-full border border-[#f2ca50]/24 bg-[#f2ca50]/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
                      Live
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-white/58">
                    Open the Telegram bot directly for chat continuity and wallet-backed actions.
                  </p>

                  <div className="mt-6 rounded-[22px] border border-white/8 bg-black/28 p-5">
                    <p className="text-[8px] font-black uppercase tracking-[0.28em] text-white/35">
                      Bot handle
                    </p>
                    <p className="mt-2 font-mono text-base font-bold text-white">
                      @{telegramBotHandle}
                    </p>
                  </div>

                  <a
                    href={telegramBotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[18px] border border-[#f2ca50]/28 bg-[#f2ca50]/14 px-4 py-3 text-sm font-semibold text-[#f2ca50] transition hover:bg-[#f2ca50]/20"
                  >
                    <span className="material-symbols-outlined text-base">send</span>
                    Open Telegram chat
                  </a>

                  <Link
                    href="/chat"
                    className="mt-3 inline-flex w-full items-center justify-center rounded-[18px] border border-white/10 bg-black/28 px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-white/60 transition hover:border-[#f2ca50]/25 hover:text-[#f2ca50]"
                  >
                    Open AgentFlow chat
                  </Link>
                </aside>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
