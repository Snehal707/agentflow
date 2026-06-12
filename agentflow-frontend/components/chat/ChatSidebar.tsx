"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/BrandLockup";
import { SidebarToggleButton } from "@/components/app/SidebarToggleButton";
import { formatChatHistoryTime } from "@/lib/chatHistory";
import { navItems, type ChatHistoryItem } from "@/lib/appData";
import { sidebarWidthClass } from "@/lib/useSidebarPreference";

const navIconMap: Record<string, string> = {
  "/chat": "forum",
  "/pay": "payments",
  "/funding": "account_balance_wallet",
  "/portfolio": "pie_chart",
  "/agents": "storefront",
  "/telegram": "send",
};

const socialLinks = [
  { label: "X", href: "https://x.com/AgentFlowone" },
  { label: "Discord", href: "https://discord.gg/MskKAf6VRz" },
  { label: "Docs", href: "/docs" },
] as const;

function SidebarSocialIcon({ label }: { label: (typeof socialLinks)[number]["label"] }) {
  if (label === "X") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[0.85rem] w-[0.85rem]">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  if (label === "Discord") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[0.85rem] w-[0.85rem]">
        <path d="M20.317 4.37A19.8 19.8 0 0 0 15.886 3c-.192.34-.414.797-.567 1.154a18.3 18.3 0 0 0-6.638 0A12.7 12.7 0 0 0 8.114 3a19.74 19.74 0 0 0-4.432 1.37C.883 8.58-.033 12.64.321 16.64A19.9 19.9 0 0 0 6.39 19.69c.486-.66.92-1.36 1.296-2.1a12.9 12.9 0 0 1-2.036-.98c.171-.13.338-.26.5-.39a14.18 14.18 0 0 0 12.13 0c.16.13.328.26.499.39-.647.38-1.329.71-2.036.98.376.74.81 1.44 1.296 2.1a19.86 19.86 0 0 0 6.07-3.05c.41-4.63-.69-8.67-3.8-12.27zM8.02 14.18c-1.18 0-2.15-1.08-2.15-2.41 0-1.34.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.34.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-[0.85rem] w-[0.85rem]"
    >
      <path d="M8 3.5h6l4 4V20.5H8a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 8 3.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 11h6" />
      <path d="M9 14.5h6" />
      <path d="M9 18h4" />
    </svg>
  );
}

type ChatSidebarProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  history: ChatHistoryItem[];
  onNewChat: () => void;
  onHistorySelect: (title: string) => void;
};

export function ChatSidebar({
  collapsed = false,
  onToggleCollapse,
  history,
  onNewChat,
  onHistorySelect,
}: ChatSidebarProps) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) {
      return;
    }
    setHistoryOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!historyOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        // Do not close synchronously on primary nav links: setState on pointerdown can
        // re-render before the link's click fires and break same-tab Next.js navigation
        // (new tab / context-menu still works). History clears on route change unmount.
        if (target.closest("nav a[href]")) {
          return;
        }
      }
      const el = historyWrapRef.current;
      if (el && !el.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  return (
    <aside
      className={`relative z-20 sticky top-0 hidden h-screen max-h-dvh min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-white/5 bg-black/40 backdrop-blur-3xl py-8 text-xs font-medium transition-[width,padding] duration-300 md:flex ${
        collapsed
          ? `${sidebarWidthClass.collapsed} px-3`
          : `${sidebarWidthClass.expanded} px-0`
      }`}
    >
      {/* Toggle button */}
      {onToggleCollapse ? (
        <div className={`mb-4 flex px-6 ${collapsed ? "justify-center" : "justify-end"}`}>
          <SidebarToggleButton
            collapsed={collapsed}
            onClick={onToggleCollapse}
            className="hidden md:inline-flex opacity-40 hover:opacity-100 transition-opacity"
          />
        </div>
      ) : null}

      {/* Brand */}
      <div className={`mb-10 ${collapsed ? "flex justify-center px-3" : "px-8"}`}>
        <BrandLockup href="/chat" collapsed={collapsed} variant="sidebar" />
      </div>

      {/* New Session button */}
      {!collapsed && (
        <div className="px-6 mb-6">
          <button
            type="button"
            onClick={onNewChat}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2.5 bg-surface-container-high/60 border border-white/5 text-on-surface text-[11px] font-bold uppercase tracking-widest hover:border-[#f2ca50]/40 hover:bg-surface-container-high transition-all duration-300 group"
          >
            <span className="material-symbols-outlined icon-standard group-hover:text-[#f2ca50] text-base">add</span>
            New Session
          </button>
        </div>
      )}

      {collapsed && (
        <div className="px-2 mb-6">
          <button
            type="button"
            onClick={onNewChat}
            title="New Session"
            className="w-full py-3 flex items-center justify-center hover:text-[#f2ca50] text-white/40 transition-colors"
          >
            <span className="material-symbols-outlined icon-standard text-base">add</span>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className={`flex-1 space-y-0.5 ${collapsed ? "px-2" : "px-4"}`}>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const icon = navIconMap[item.href] ?? item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-4 px-4 py-3 rounded-r-lg transition-all duration-300 ${
                active
                  ? "active-nav-glow text-[#f2ca50]"
                  : "text-white/40 hover:text-white/80 hover:bg-white/5 rounded-lg"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 ${active ? "icon-filled" : "icon-standard"}`}
              >
                {icon}
              </span>
              {collapsed ? null : (
                <span className="min-w-0 flex-1 font-label text-left text-[11px] font-bold uppercase tracking-[0.12em] subpixel-antialiased">
                  {item.label}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1" />

      <div className={`border-t border-white/5 pt-4 ${collapsed ? "px-2 pb-3" : "px-4 pb-4"}`}>
        <div
          className={`flex ${
            collapsed
              ? "items-center justify-center gap-2 border-y border-white/5 py-3"
              : "items-center gap-2 px-3"
          }`}
        >
          {socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel={link.href.startsWith("http") ? "noreferrer noopener" : undefined}
              title={link.label}
              className="flex h-9 w-9 items-center justify-center text-white/34 transition-all duration-300 hover:text-[#f2ca50]"
            >
              <SidebarSocialIcon label={link.label} />
            </a>
          ))}
        </div>
      </div>

      {/* History */}
      <div ref={historyWrapRef} className={`relative mt-1 w-full flex-shrink-0 border-t border-white/5 pt-4 ${collapsed ? "px-2" : "px-4"}`}>
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-expanded={historyOpen}
          aria-haspopup="dialog"
          title={collapsed ? "Recent chats" : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-300 ${
            historyOpen
              ? "bg-white/5 text-white/90"
              : "text-white/40 hover:bg-white/5 hover:text-white/80"
          } ${collapsed ? "justify-center px-0" : ""}`}
        >
          <span
            className={`material-symbols-outlined text-[20px] shrink-0 ${historyOpen ? "icon-filled" : "icon-standard"}`}
          >
            history
          </span>
          {collapsed ? null : (
            <span className="min-w-0 flex-1 text-left text-[11px] font-bold uppercase tracking-[0.12em] subpixel-antialiased">
              Recent chats
            </span>
          )}
        </button>

        {historyOpen ? (
          <div
            className="scrollbar-hide absolute bottom-full left-0 right-0 z-50 mb-2 max-h-[min(50vh,320px)] overflow-y-auto rounded-xl border border-white/5 bg-[#131313] py-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
            role="dialog"
            aria-label="Recent chats"
          >
            <div className="px-3 pb-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-white/30">
              Recent
            </div>
            {history.length === 0 ? (
              <div className="px-3 pb-2 text-[11px] text-white/30">No chats yet.</div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onHistorySelect(item.title);
                    setHistoryOpen(false);
                  }}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                >
                  <div className="truncate text-sm text-white/80">{item.title}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/30">
                    {formatChatHistoryTime(item.at)}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

    </aside>
  );
}
