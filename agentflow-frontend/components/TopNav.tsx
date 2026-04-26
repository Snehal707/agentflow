"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BrandLockup } from "@/components/BrandLockup";

const links = [
  { href: "/chat", label: "Chat" },
  { href: "/pay", label: "AgentPay" },
  { href: "/funds", label: "Funding" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/economy", label: "Benchmark" },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--af-outline-soft)] bg-[color:rgba(19,19,19,0.92)] px-5 backdrop-blur-xl lg:px-8">
      <div className="flex items-center gap-6">
        <BrandLockup href="/" variant="nav" />

        <nav className="hidden items-center gap-1 rounded-full bg-[var(--af-surface-low)] p-1 sm:flex">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-[rgba(242,202,80,0.14)] text-[var(--af-gold)]"
                    : "text-[var(--af-text-secondary)] hover:text-[var(--af-text-primary)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus={{
          smallScreen: "avatar",
          largeScreen: "full",
        }}
      />
    </header>
  );
}
