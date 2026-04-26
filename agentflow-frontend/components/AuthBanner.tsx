"use client";

import { useAccount } from "wagmi";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

export function AuthBanner() {
  const { isConnected } = useAccount();
  const { isAuthenticated, signIn, loading, error } = useAgentJwt();

  if (!isConnected || isAuthenticated) {
    return null;
  }

  return (
    <div className="rounded-[24px] bg-amber-400/10 px-4 py-4 text-sm text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Sign the message once to unlock portfolio, swap, vault, bridge, and business tools.</span>
        <button
          type="button"
          onClick={() => {
            signIn().catch(() => {});
          }}
          disabled={loading}
          className="rounded-full border border-amber-300/35 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-amber-100 transition hover:bg-amber-200/10 disabled:opacity-60"
        >
          {loading ? "Signing..." : "Sign In"}
        </button>
      </div>
      {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
    </div>
  );
}
