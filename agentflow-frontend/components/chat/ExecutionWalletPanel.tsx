"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, parseUnits } from "viem";
import {
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_USDC_ADDRESS,
  CIRCLE_FAUCET_URL,
} from "@/lib/arcChain";
import {
  fetchExecutionWalletSummary,
  type ExecutionWalletSummary,
} from "@/lib/liveAgentClient";

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type ExecutionWalletPanelProps = {
  walletAddress?: string;
  isConnected: boolean;
  isAuthenticated: boolean;
  authHeaders: Record<string, string> | null;
  onRequireSession: () => Promise<unknown>;
  signInLoading: boolean;
};

function formatAmount(value: string, digits = 4): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function ExecutionWalletPanel({
  walletAddress,
  isConnected,
  isAuthenticated,
  authHeaders,
  onRequireSession,
  signInLoading,
}: ExecutionWalletPanelProps) {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { switchChainAsync, isPending: isSwitchPending } = useSwitchChain();

  const [summary, setSummary] = useState<ExecutionWalletSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Parent passes a new object every render; only the bearer string is stable. */
  const authBearer = authHeaders?.Authorization ?? null;
  const [usdcAmount, setUsdcAmount] = useState("5");
  const [actionState, setActionState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    if (!authBearer) {
      setSummary(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await fetchExecutionWalletSummary({
        Authorization: authBearer,
      });
      setSummary(next);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load the agent wallet.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [authBearer]);

  useEffect(() => {
    if (!isConnected || !walletAddress || !isAuthenticated || !authBearer) {
      setSummary(null);
      return;
    }

    void refreshSummary();
  }, [isConnected, walletAddress, isAuthenticated, authBearer, refreshSummary]);

  /** Avoid flashing “Loading…” on every re-fetch when we already have data (stale-while-revalidate). */
  const showInitialLoading = isLoading && !summary;

  const copyAddress = async () => {
    if (!summary?.userAgentWalletAddress) {
      return;
    }
    try {
      await navigator.clipboard.writeText(summary.userAgentWalletAddress);
      setActionState("success");
      setActionMessage("Agent wallet address copied.");
    } catch {
      setActionState("error");
      setActionMessage("Could not copy the agent wallet address.");
    }
  };

  const ensureArcWallet = async () => {
    if (walletClient?.chain?.id === ARC_CHAIN_ID) {
      return true;
    }
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
      return true;
    } catch (error) {
      setActionState("error");
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Switch to Arc Testnet before funding the agent wallet.",
      );
      return false;
    }
  };

  const handleFundUsdc = async () => {
    if (!walletAddress || !summary?.userAgentWalletAddress) {
      return;
    }
    if (!walletClient || !publicClient) {
      setActionState("error");
      setActionMessage("Reconnect your wallet before sending USDC.");
      return;
    }
    const ok = await ensureArcWallet();
    if (!ok) {
      return;
    }

    setActionState("pending");
    setActionMessage("Sending USDC through the ERC-20 interface...");
    setLastTxHash(null);
    try {
      const txHash = await walletClient.writeContract({
        account: getAddress(walletAddress),
        address: ARC_USDC_ADDRESS,
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [getAddress(summary.userAgentWalletAddress), parseUnits(usdcAmount || "0", 6)],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setLastTxHash(txHash);
      setActionState("success");
      setActionMessage("USDC sent to the agent wallet.");
      await refreshSummary();
    } catch (error) {
      setActionState("error");
      setActionMessage(
        error instanceof Error ? error.message : "USDC funding failed.",
      );
    }
  };

  const statusMessage = summary
    ? summary.fundingStatus.needsUsdcFunding && summary.fundingStatus.needsGasFunding
      ? Number(summary.balances.gatewayUsdc.formatted) > 0
        ? "Gateway holds USDC, but this agent wallet has no direct spendable balance for swap yet."
        : "Add USDC before swap or vault actions."
      : summary.fundingStatus.needsGasFunding
        ? "Add a little more USDC for fees."
        : summary.fundingStatus.needsVaultShares
          ? "Withdraw needs vault shares in this wallet."
          : "Ready for swap and vault."
    : null;

  return (
    <div className="space-y-4 rounded-[22px] bg-[#0c0e12] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/34">
            Agent Wallet
          </div>
        </div>
        {summary?.userAgentWalletAddress ? (
          <button
            type="button"
            onClick={copyAddress}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
          >
            Copy
          </button>
        ) : null}
      </div>

      {!isConnected || !walletAddress ? (
        <div className="rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/54">
          Connect wallet to view execution details.
        </div>
      ) : !isAuthenticated || !authHeaders ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              void onRequireSession().then(() => {
                void refreshSummary();
              });
            }}
            disabled={signInLoading}
            className="rounded-full border border-cyan-400/24 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/16 disabled:opacity-60"
          >
            {signInLoading ? "Signing..." : "Sign session"}
          </button>
        </div>
      ) : showInitialLoading ? (
        <div className="rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/60">
          Loading agent wallet...
        </div>
      ) : loadError ? (
        <div className="rounded-2xl bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-100">
          {loadError}
        </div>
      ) : summary ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-black/20 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Agent Wallet Address
            </div>
            <div className="mt-3 break-all font-mono text-sm text-white/84">
              {summary.userAgentWalletAddress}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={summary.explorerUrl || `${ARC_EXPLORER_URL}/address/${summary.userAgentWalletAddress}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
              >
                View on Arcscan
              </a>
              <button
                type="button"
                onClick={() => {
                  void refreshSummary();
                }}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                Wallet USDC
              </div>
              <div className="mt-2 text-lg text-white/88">
                {formatAmount(summary.balances.usdc.formatted)} USDC
              </div>
            </div>
            <div className="rounded-2xl bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                Gateway USDC
              </div>
              <div className="mt-2 text-lg text-white/88">
                {formatAmount(summary.balances.gatewayUsdc.formatted)} USDC
              </div>
            </div>
            <div className="rounded-2xl bg-black/20 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                Vault Shares
              </div>
              <div className="mt-2 text-lg text-white/88">
                {formatAmount(summary.balances.vaultShares?.formatted ?? "0")} afvUSDC
              </div>
            </div>
          </div>

          {statusMessage ? (
            <div className="rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/58">
              {statusMessage}
            </div>
          ) : null}

          {Number(summary.balances.gatewayUsdc.formatted) > 0 &&
          Number(summary.balances.usdc.formatted) === 0 ? (
            <div className="rounded-2xl border border-cyan-400/16 bg-cyan-400/[0.06] px-4 py-3 text-sm text-cyan-100">
              Your Gateway deposit is being counted in portfolio, but swaps check the agent wallet&apos;s
              direct onchain USDC balance. Deposit more USDC to this wallet or withdraw or move funds back out
              of Gateway before swapping.
            </div>
          ) : null}

          <div className="rounded-2xl bg-black/20 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Fund From Main Wallet
            </div>
            <div className="mt-3 grid gap-3">
              <div className="flex flex-col gap-2">
                <input
                  value={usdcAmount}
                  onChange={(event) => setUsdcAmount(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/32"
                  placeholder="5"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleFundUsdc();
                  }}
                  disabled={actionState === "pending" || isSwitchPending}
                  className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white transition hover:bg-white/[0.08] disabled:opacity-60"
                >
                  Send USDC
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={CIRCLE_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
              >
                Faucet
              </a>
              <button
                type="button"
                onClick={() => {
                  void refreshSummary();
                }}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
              >
                Refresh
              </button>
            </div>
          </div>

          {actionMessage ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                actionState === "error"
                  ? "border-rose-400/16 bg-rose-400/[0.06] text-rose-100"
                  : actionState === "success"
                    ? "border-emerald-400/16 bg-emerald-400/[0.06] text-emerald-100"
                : "border-white/8 bg-black/20 text-white/62"
              }`}
            >
              {actionMessage}
              {lastTxHash ? (
                <div className="mt-2">
                  <a
                    href={`${ARC_EXPLORER_URL}/tx/${lastTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-100/78"
                  >
                    View transaction
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
