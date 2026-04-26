"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/BrandLockup";
import { SidebarToggleButton } from "@/components/app/SidebarToggleButton";
import { navItems } from "@/lib/appData";
import { sidebarWidthClass } from "@/lib/useSidebarPreference";

type AppSidebarProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  footer?: ReactNode;
  chatHistory?: Array<{ id: string; title: string; at: number }>;
};

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

export function AppSidebar({
  collapsed = false,
  onToggleCollapse,
  footer,
  chatHistory,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`sticky top-0 hidden h-screen max-h-dvh min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-white/5 bg-black/40 backdrop-blur-3xl py-8 text-xs font-medium transition-[width,padding] duration-300 md:flex ${
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
          <a
            href="/chat"
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2.5 bg-surface-container-high/60 border border-white/5 text-on-surface text-[11px] font-bold uppercase tracking-widest hover:border-[#f2ca50]/40 hover:bg-surface-container-high transition-all duration-300 group"
          >
            <span className="material-symbols-outlined icon-standard group-hover:text-[#f2ca50] text-base">add</span>
            New Session
          </a>
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

      {/* Chat history */}
      {!collapsed && chatHistory && chatHistory.length > 0 && (
        <div className="px-8 py-6 border-t border-white/5">
          <h2 className="text-[9px] tracking-[0.3em] uppercase text-white/30 mb-5 font-black">History</h2>
          <div className="space-y-4">
            {chatHistory.slice(0, 4).map((item) => (
              <div key={item.id} className="group cursor-pointer">
                <p className="text-[11px] text-white/50 group-hover:text-[#f2ca50] transition-colors line-clamp-1 font-medium tracking-wide">
                  {item.title}
                </p>
                <span className="text-[8px] text-white/20 uppercase tracking-[0.2em] mt-1.5 block">
                  {Math.round((Date.now() - item.at) / 60000)}m ago
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1" />

      {/* Footer slot */}
      <div className={`border-t border-white/5 pt-4 ${collapsed ? "px-3" : "px-6"}`}>
        {footer ?? (
          <a
            className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-white/30 hover:text-[#f2ca50] transition-colors text-[10px] font-bold uppercase tracking-widest ${
              collapsed ? "justify-center px-0" : ""
            }`}
            href="https://developers.circle.com/"
            target="_blank"
            rel="noreferrer"
            title={collapsed ? "Circle Docs" : undefined}
          >
            <span className="material-symbols-outlined icon-standard text-base">menu_book</span>
            {collapsed ? null : <span>Circle Docs</span>}
          </a>
        )}
      </div>
    </aside>
  );
}
