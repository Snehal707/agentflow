"use client";

import { shortenAddress } from "@/lib/appData";

type SessionStatusChipProps = {
  address?: string | null;
  isAuthenticated: boolean;
  isLoading?: boolean;
  error?: string | null;
  onAction: () => void;
  compact?: boolean;
};

export function SessionStatusChip({
  address,
  isAuthenticated,
  isLoading = false,
  error = null,
  onAction,
  compact = false,
}: SessionStatusChipProps) {
  const detailLabel = address ? shortenAddress(address) : "Wallet required";

  if (!address) {
    return (
      <button
        type="button"
        onClick={onAction}
        className="rounded-full border border-white/10 bg-[#131313] px-4 py-2 text-sm text-white/90 transition hover:bg-white/5"
        title="Connect wallet"
      >
        Connect wallet
      </button>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAction}
            disabled={isLoading}
            className="af-btn-primary af-transition rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
            title="Sign session"
          >
            {isLoading ? "Signing..." : "Sign session"}
          </button>
          <button
            type="button"
            onClick={onAction}
            className="rounded-full border border-white/10 bg-[#131313] px-4 py-2 text-sm text-white/90 transition hover:bg-white/5"
            title={detailLabel}
          >
            {detailLabel}
          </button>
        </div>
        {error ? (
          <div className="max-w-[320px] text-right text-xs text-rose-300">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAction}
      className={`rounded-full border border-white/10 bg-[#131313] px-4 py-2 text-sm text-white/90 transition hover:bg-white/5 ${
        compact ? "text-sm" : "text-sm"
      }`}
      title={detailLabel}
    >
      {detailLabel}
    </button>
  );
}
