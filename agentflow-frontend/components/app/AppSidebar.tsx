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
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-[1rem] w-[1rem]"
    >
      <path d="M8 3.5h6l4 4V20.5H8a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 8 3.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 11h6" />
      <path d="M9 14.5h6" />
      <path d="M9 18h4" />
    </svg>
  );
}

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
          <div className={collapsed ? "flex flex-col items-center gap-3 pb-2" : "pb-2"}>
            {!collapsed ? (
              <p className="mb-3 px-2 text-[9px] font-black uppercase tracking-[0.24em] text-white/24">
                Community
              </p>
            ) : null}
            <div className={`flex ${collapsed ? "flex-col gap-3" : "items-center gap-3 px-2"}`}>
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noreferrer noopener" : undefined}
                  title={link.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/34 transition-all duration-300 hover:border-[#f2ca50]/35 hover:bg-[#f2ca50]/8 hover:text-[#f2ca50]"
                >
                  <SidebarSocialIcon label={link.label} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
