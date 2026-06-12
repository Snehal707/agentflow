"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";

const NAV_LINKS = [
  { label: "Agents", href: "#agents" },
  { label: "DeFi", href: "#defi" },
  { label: "AgentPay", href: "#agentpay" },
  { label: "How it works", href: "#how" },
  { label: "Docs", href: "/docs" },
] as const;

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed inset-x-0 top-5 z-50 flex justify-center px-4 md:px-6 xl:px-7">
      <nav className="w-full max-w-[84rem] rounded-[1.25rem] border border-white/[0.08] bg-[#0d0d0d]/60 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-white/15">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-7">
          <BrandLockup href="/" variant="nav" />

          <div className="hidden items-center gap-7 text-[10px] font-bold uppercase tracking-[0.18em] font-display-sans text-[#a3a3a3] md:flex">
            {NAV_LINKS.map((link) => (
              <a 
                key={link.label} 
                href={link.href} 
                className="relative py-1.5 transition-colors hover:text-white group"
              >
                {link.label}
                <span className="absolute bottom-0 left-1/2 h-[1.5px] w-0 -translate-x-1/2 bg-[#f2ca50] transition-all duration-300 group-hover:w-3/5" />
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="hidden rounded-xl bg-gradient-to-r from-amber-400 to-[#f2ca50] px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-black shadow-[0_4px_18px_rgba(242,202,80,0.2)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_4px_22px_rgba(242,202,80,0.35)] active:scale-[0.98] sm:inline-block font-display-sans"
            >
              Launch App
            </Link>

            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/80 transition-colors hover:border-[#f2ca50]/40 hover:text-white md:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4.5 w-4.5">
                {open ? (
                  <path d="M6 6l12 12M18 6 6 18" />
                ) : (
                  <>
                    <path d="M4 7h16" />
                    <path d="M4 12h16" />
                    <path d="M4 17h16" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-white/5 bg-[#0a0a0a]/95 rounded-b-[1.25rem] md:hidden overflow-hidden">
            <div className="flex flex-col gap-1 px-4 py-3">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/chat"
                onClick={() => setOpen(false)}
                className="mt-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-[#f2ca50] px-4 py-3 text-center text-[11px] font-extrabold uppercase tracking-[0.14em] text-black font-display-sans shadow-[0_4px_18px_rgba(242,202,80,0.2)]"
              >
                Launch App
              </Link>
            </div>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
