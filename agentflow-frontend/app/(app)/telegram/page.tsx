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

        <main className="flex-1 overflow-y-auto px-8 pb-24 pt-12 xl:px-12">
          <div className="mx-auto max-w-[1120px]">
            <header className="mb-14 border-b border-white/5 pb-14">
              <nav className="mb-4 flex items-center gap-3 text-[9px] font-black uppercase tracking-[0.4em] text-white/30">
                <Link href="/chat" className="transition-colors hover:text-[#f2ca50]">
                  Chat
                </Link>
                <span className="text-white/15">/</span>
                <span className="tracking-[0.5em] text-[#f2ca50]">Telegram</span>
              </nav>

              <h1 className="mb-5 text-[clamp(4rem,8vw,6.5rem)] font-headline font-black uppercase italic leading-[0.92] tracking-[-0.04em] text-white">
                TELE<span className="text-[#f2ca50]">GRAM</span>
              </h1>

              <div className="mb-7 h-[3px] w-20 bg-[#f2ca50] shadow-[0_0_12px_rgba(242,202,80,0.4)]" />

              <p className="max-w-2xl text-[15px] font-medium leading-relaxed text-white/40">
                Link Telegram for bot access and wallet-backed actions. The web app stays the source of truth; this screen only manages the real Telegram connection flow.
              </p>
            </header>

            <section className="border border-white/6 bg-[#0d0d0d] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] xl:p-12">
              <div className="mb-10 flex items-start justify-between">
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

                <Link
                  href="/chat"
                  className="rounded-full border border-white/10 bg-[#101010] px-4 py-2 text-[9px] font-black uppercase tracking-[0.22em] text-white/45 transition hover:border-[#f2ca50]/25 hover:text-[#f2ca50]"
                >
                  Open chat
                </Link>
              </div>

              <TelegramConnectCard />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
