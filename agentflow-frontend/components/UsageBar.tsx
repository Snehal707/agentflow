"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

type UsagePayload = {
  accessModel: string;
  dailyLimit: number;
  worstUsed: number;
  remainingApprox: number;
};

export function UsageBar() {
  const { address } = useAccount();
  const { getAuthHeaders, isAuthenticated } = useAgentJwt();
  const [data, setData] = useState<UsagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !isAuthenticated) {
      setData(null);
      return;
    }

    const headers = getAuthHeaders();
    if (!headers) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${BACKEND}/api/wallet/usage`, { headers });
        const json = (await response.json()) as UsagePayload & { error?: string };
        if (!response.ok) {
          throw new Error(json.error || "usage failed");
        }
        if (!cancelled) {
          setData(json);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, getAuthHeaders, isAuthenticated]);

  if (!isAuthenticated || !data) {
    return null;
  }

  const used = data.worstUsed ?? 0;
  const limit = data.dailyLimit || 10;
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone =
    ratio < 0.5
      ? "from-emerald-400 to-lime-300"
      : ratio < 0.85
        ? "from-amber-400 to-amber-200"
        : "from-rose-400 to-rose-300";

  return (
    <div className="rounded-[24px] bg-black/20 p-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm text-white/70">
        <span>Daily agent usage</span>
        <span className="font-mono text-cyan-200">
          {used}/{limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-white/45">
        {error || `Approximately ${data.remainingApprox} runs left at the busiest agent today.`}
      </div>
    </div>
  );
}
