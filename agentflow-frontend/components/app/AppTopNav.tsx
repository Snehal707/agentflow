"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";
import { navItems } from "@/lib/appData";
import { SidebarToggleButton } from "@/components/app/SidebarToggleButton";
import { topNavSidebarPaddingClass } from "@/lib/useSidebarPreference";

type AppTopNavProps = {
  activeHref: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  rightSlot?: ReactNode;
};

export function AppTopNav({
  activeHref,
  sidebarCollapsed,
  onToggleSidebar,
  rightSlot,
}: AppTopNavProps) {
  return (
    <nav
      className={`fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b border-[var(--af-outline-soft)] bg-[color:rgba(19,19,19,0.92)] px-6 backdrop-blur-xl transition-[padding] duration-300 ${
        sidebarCollapsed
          ? topNavSidebarPaddingClass.collapsed
          : topNavSidebarPaddingClass.expanded
      }`}
    >
      <div className="flex items-center gap-3 font-display text-xl font-black tracking-[-0.04em] text-[var(--af-gold)] md:hidden">
        <SidebarToggleButton
          collapsed={sidebarCollapsed}
          onClick={onToggleSidebar}
          className="md:hidden"
        />
        <BrandLockup href="/chat" variant="nav" />
      </div>
      <div className="hidden items-center space-x-6 md:flex">
        <SidebarToggleButton
          collapsed={sidebarCollapsed}
          onClick={onToggleSidebar}
          className="hidden md:inline-flex"
        />
        {navItems.map((item) => (
          <Link
            key={item.href}
            className={
              item.href === activeHref
                ? "border-b-2 border-[var(--af-gold)] pb-1 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--af-gold)]"
                : "text-[11px] font-black uppercase tracking-[0.16em] text-[var(--af-text-secondary)] transition-colors hover:text-[var(--af-text-primary)]"
            }
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4">{rightSlot}</div>
    </nav>
  );
}
