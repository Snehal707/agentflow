"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/BrandLockup";
import { SidebarToggleButton } from "@/components/app/SidebarToggleButton";
import { formatChatHistoryTime } from "@/lib/chatHistory";
import { navItems, type ChatHistoryItem } from "@/lib/appData";
import { sidebarWidthClass } from "@/lib/useSidebarPreference";

const navIconMap: Record<string, string> = {
  "/chat": "space_dashboard",
  "/pay": "payments",
  "/funds": "account_balance_wallet",
  "/portfolio": "pie_chart",
  "/vault": "savings",
  "/agents": "storefront",
  "/economy": "monitoring",
  "/settings": "send",
};

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
                <span className="font-label tracking-[0.18em] uppercase text-[10px] font-extrabold">
                  {item.label}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1" />

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
            <span className="min-w-0 flex-1 text-left text-[10px] font-extrabold uppercase tracking-[0.18em]">
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
