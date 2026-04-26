"use client";

import { useCallback, useEffect, useState } from "react";
import { ARC_EXPLORER_URL } from "@/lib/arcChain";
import {
  fetchGatewayBalance,
  fetchGatewayDepositInfo,
  moveGatewayToExecution,
  withdrawGatewayUsdc,
} from "@/lib/liveAgentClient";

type GatewayWalletPanelProps = {
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

export function GatewayWalletPanel({
  walletAddress,
  isConnected,
  isAuthenticated,
  authHeaders,
  onRequireSession,
  signInLoading,
}: GatewayWalletPanelProps) {
  const authBearer = authHeaders?.Authorization ?? null;

  const [balanceUsdc, setBalanceUsdc] = useState<string | null>(null);
  const [gatewayWalletAddress, setGatewayWalletAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [depositInfo, setDepositInfo] = useState<{
    depositAddress: string;
    network: string;
    instructions: string;
  } | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);

  const [withdrawAmount, setWithdrawAmount] = useState("10");
  const [moveAmount, setMoveAmount] = useState("10");

  const [actionState, setActionState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [lastExplorerLink, setLastExplorerLink] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!authBearer) {
      setBalanceUsdc(null);
      setGatewayWalletAddress(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchGatewayBalance({
        Authorization: authBearer,
      });
      setBalanceUsdc(data.balance);
      setGatewayWalletAddress(data.walletAddress);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load Gateway balance.",
      );
      setBalanceUsdc(null);
      setGatewayWalletAddress(null);
    } finally {
      setIsLoading(false);
    }
  }, [authBearer]);

  useEffect(() => {
    if (!isConnected || !walletAddress || !isAuthenticated || !authBearer) {
      setBalanceUsdc(null);
      setGatewayWalletAddress(null);
      return;
    }

    void refreshBalance();
  }, [isConnected, walletAddress, isAuthenticated, authBearer, refreshBalance]);

  const showInitialLoading = isLoading && balanceUsdc === null && !loadError;

  const handleLoadDeposit = async () => {
    if (!authHeaders) {
      return;
    }
    setDepositLoading(true);
    setActionState("idle");
    setActionMessage(null);
    try {
      const info = await fetchGatewayDepositInfo(authHeaders);
      setDepositInfo(info);
      setActionState("success");
      setActionMessage("Send USDC on Arc to the deposit address below.");
    } catch (error) {
      setActionState("error");
      setActionMessage(
        error instanceof Error ? error.message : "Could not load deposit address.",
      );
    } finally {
      setDepositLoading(false);
    }
  };

  const copyDepositAddress = async () => {
    if (!depositInfo?.depositAddress) {
      return;
    }
    try {
      await navigator.clipboard.writeText(depositInfo.depositAddress);
      setActionState("success");
      setActionMessage("Deposit address copied.");
    } catch {
      setActionState("error");
      setActionMessage("Could not copy address.");
    }
  };

  const handleWithdraw = async () => {
    if (!authHeaders) {
      return;
    }
    setActionState("pending");
    setActionMessage("Withdrawing from Gateway...");
    setLastExplorerLink(null);
    try {
      const result = await withdrawGatewayUsdc({
        authHeaders,
        amount: withdrawAmount.trim() || "0",
      });
      setLastExplorerLink(result.explorerLink);
      setActionState("success");
      setActionMessage(`Withdrew ${result.amount} USDC from Gateway.`);
      await refreshBalance();
    } catch (error) {
      setActionState("error");
      setActionMessage(error instanceof Error ? error.message : "Withdraw failed.");
    }
  };

  const handleMoveToExecution = async () => {
    if (!authHeaders) {
      return;
    }
    setActionState("pending");
    setActionMessage("Moving USDC to execution wallet...");
    setLastExplorerLink(null);
    try {
      const result = await moveGatewayToExecution({
        authHeaders,
        amount: moveAmount.trim() || "0",
      });
      setActionState("success");
      setActionMessage(
        `Moved ${result.amount} USDC to execution wallet. New on-chain USDC: ${result.newBalance}.`,
      );
      await refreshBalance();
    } catch (error) {
      setActionState("error");
      setActionMessage(
        error instanceof Error ? error.message : "Move to execution wallet failed.",
      );
    }
  };

  return (
    <div className="space-y-4 rounded-[22px] bg-[#0c0e12] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/34">
            Gateway Wallet
          </div>
        </div>
        {gatewayWalletAddress ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(gatewayWalletAddress);
                setActionState("success");
                setActionMessage("Gateway funding address copied.");
              } catch {
                setActionState("error");
                setActionMessage("Could not copy address.");
              }
            }}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
          >
            Copy
          </button>
        ) : null}
      </div>

      {!isConnected || !walletAddress ? (
        <div className="rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/54">
          Connect wallet to manage Gateway USDC.
        </div>
      ) : !isAuthenticated || !authHeaders ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              void onRequireSession().then(() => {
                void refreshBalance();
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
          Loading Gateway balance...
        </div>
      ) : loadError ? (
        <div className="rounded-2xl bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-100">
          {loadError}
        </div>
      ) : (
        <div className="space-y-4">
          {gatewayWalletAddress ? (
            <div className="rounded-2xl bg-black/20 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                Gateway funding address
              </div>
              <div className="mt-3 break-all font-mono text-sm text-white/84">
                {gatewayWalletAddress}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`${ARC_EXPLORER_URL}/address/${gatewayWalletAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
                >
                  View on Arcscan
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void refreshBalance();
                  }}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl bg-black/20 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Gateway USDC
            </div>
            <div className="mt-2 text-lg text-white/88">
              {balanceUsdc !== null ? `${formatAmount(balanceUsdc)} USDC` : "—"}
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Deposit
            </div>
            <p className="mt-2 text-sm text-white/54">
              Load USDC into Circle Gateway by sending Arc USDC to your funding address.
            </p>
            <button
              type="button"
              onClick={() => {
                void handleLoadDeposit();
              }}
              disabled={depositLoading}
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white transition hover:bg-white/[0.08] disabled:opacity-60"
            >
              {depositLoading ? "Loading…" : "Deposit"}
            </button>
            {depositInfo ? (
              <div className="mt-4 space-y-2 rounded-xl border border-white/8 bg-black/20 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                  {depositInfo.network}
                </div>
                <div className="break-all font-mono text-xs text-white/78">
                  {depositInfo.depositAddress}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void copyDepositAddress();
                  }}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/62 transition hover:border-white/18 hover:text-white"
                >
                  Copy address
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl bg-black/20 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Withdraw
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/32"
                placeholder="Amount (USDC)"
              />
              <button
                type="button"
                onClick={() => {
                  void handleWithdraw();
                }}
                disabled={actionState === "pending"}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                Withdraw
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
              Move to execution wallet
            </div>
            <p className="mt-2 text-sm text-white/54">
              Burns Gateway balance and mints USDC to your DCW for swaps and vault.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={moveAmount}
                onChange={(event) => setMoveAmount(event.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-cyan-300/32"
                placeholder="Amount (USDC)"
              />
              <button
                type="button"
                onClick={() => {
                  void handleMoveToExecution();
                }}
                disabled={actionState === "pending"}
                className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] px-4 py-3 text-sm text-cyan-100 transition hover:bg-cyan-400/14 disabled:opacity-60"
              >
                Move to execution wallet
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
              {lastExplorerLink ? (
                <div className="mt-2">
                  <a
                    href={lastExplorerLink}
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
      )}
    </div>
  );
}
