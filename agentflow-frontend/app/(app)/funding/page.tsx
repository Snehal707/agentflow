"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { erc20Abi, formatUnits, getAddress, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_USDC_ADDRESS,
  CIRCLE_FAUCET_URL,
} from "@/lib/arcChain";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import {
  fetchExecutionWalletSummary,
  type ExecutionWalletSummary,
  withdrawExecutionWalletUsdc,
} from "@/lib/liveAgentClient";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

type ReactNode = import("react").ReactNode;

type ActionState = "idle" | "depositing" | "withdrawing";

function formatAmount(value: string | number | null | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: numeric >= 100 ? 2 : 4,
  }).format(numeric);
}

function FundingCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(242,202,80,0.08),transparent_28%),linear-gradient(180deg,#121212_0%,#0d0d0d_100%)] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] xl:p-10">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/15 to-white/0" />
      <p className="mb-3 text-[9px] font-black uppercase tracking-[0.28em] text-[#f2ca50]">{eyebrow}</p>
      <h2 className="text-[clamp(2rem,2.2vw,2.35rem)] font-headline font-bold tracking-tight text-white">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function FundsBrandIcon() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/32 bg-[radial-gradient(circle_at_30%_25%,rgba(242,202,80,0.12),transparent_58%),linear-gradient(180deg,rgba(82,65,23,0.36)_0%,rgba(39,31,12,0.66)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      <span className="material-symbols-outlined text-[1.3rem] leading-none text-[#f2ca50]">
        account_balance_wallet
      </span>
    </div>
  );
}

export default function FundsPage() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [executionSummary, setExecutionSummary] = useState<ExecutionWalletSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const authHeaders = getAuthHeaders();
  const executionWalletAddress = executionSummary?.userAgentWalletAddress ?? null;
  const dcwUsdcBalance = executionSummary?.balances.usdc.formatted ?? "0";

  const { data: eoaUsdcRaw } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [getAddress(address)] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const eoaUsdcBalance = useMemo(
    () => (eoaUsdcRaw !== undefined ? formatUnits(eoaUsdcRaw, 6) : "0"),
    [eoaUsdcRaw],
  );

  const loadExecutionSummary = useCallback(async () => {
    if (!address || !isAuthenticated || !authHeaders) {
      setExecutionSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const summary = await fetchExecutionWalletSummary(authHeaders);
      setExecutionSummary(summary);
    } catch (cause) {
      setExecutionSummary(null);
      setSummaryError(
        cause instanceof Error ? cause.message : "Could not load DCW balances.",
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [address, authHeaders, isAuthenticated]);

  useEffect(() => {
    void loadExecutionSummary();
  }, [loadExecutionSummary]);

  const ensureArcWallet = useCallback(async (): Promise<boolean> => {
    if (walletClient?.chain?.id === ARC_CHAIN_ID) {
      return true;
    }
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Switch to Arc Testnet first.");
      return false;
    }
  }, [switchChainAsync, walletClient?.chain?.id]);

  const resetFeedback = () => {
    setMessage(null);
    setError(null);
    setTxHash(null);
  };

  const requireSignedSession = async (): Promise<boolean> => {
    if (!address) {
      openConnectModal?.();
      return false;
    }
    if (isAuthenticated) {
      return true;
    }
    try {
      await signIn();
      return true;
    } catch {
      return false;
    }
  };

  const handleDepositToDcw = async () => {
    resetFeedback();
    const ready = await requireSignedSession();
    if (!ready || !address || !executionWalletAddress) {
      return;
    }

    const amountNumber = Number(depositAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Enter a valid USDC amount.");
      return;
    }

    setActionState("depositing");
    try {
      if (!walletClient || !publicClient) {
        throw new Error("Connect your wallet first.");
      }
      const onArc = await ensureArcWallet();
      if (!onArc) {
        return;
      }

      const hash = await walletClient.writeContract({
        account: getAddress(address),
        address: ARC_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(executionWalletAddress), parseUnits(depositAmount.trim(), 6)],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setMessage(`Sent ${amountNumber} USDC from your EOA to the DCW.`);
      setDepositAmount("");
      await loadExecutionSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deposit to DCW failed.");
    } finally {
      setActionState("idle");
    }
  };

  const handleWithdrawToEoa = async () => {
    resetFeedback();
    const ready = await requireSignedSession();
    if (!ready || !address || !authHeaders) {
      return;
    }

    const amountNumber = Number(withdrawAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Enter a valid USDC amount.");
      return;
    }

    setActionState("withdrawing");
    try {
      const result = await withdrawExecutionWalletUsdc({
        authHeaders,
        amountUsdc: amountNumber,
        toAddress: address,
      });

      if (result.txHash) {
        setTxHash(result.txHash as `0x${string}`);
      }
      setMessage(`Sent ${amountNumber} USDC from the DCW to your EOA.`);
      setWithdrawAmount("");
      await loadExecutionSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Withdraw to EOA failed.");
    } finally {
      setActionState("idle");
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <ChatTopNavbar
          actions={
            <SessionStatusChip
              address={address}
              isAuthenticated={isAuthenticated}
              isLoading={authLoading}
              error={authError}
              onAction={() => {
                if (!address) {
                  openConnectModal?.();
                  return;
                }
                if (!isAuthenticated) {
                  void signIn().catch(() => {});
                }
              }}
              compact
            />
          }
        />

        <main className="flex-1 overflow-y-auto px-8 pb-24 pt-12 xl:px-12">
          <div className="mx-auto max-w-[1320px]">
            <header className="mb-12 border-b border-white/5 pb-12">
              <p className="mb-3 text-[9px] font-black uppercase tracking-[0.4em] text-white/30">
                Wallet / Funding
              </p>
              <h1 className="text-[clamp(3rem,6vw,5rem)] font-headline font-black uppercase italic leading-[0.92] tracking-[-0.04em] text-white">
                FUND<span className="text-[#f2ca50]">ING</span>
              </h1>
              <div className="mt-5 h-[3px] w-20 bg-[#f2ca50] shadow-[0_0_12px_rgba(242,202,80,0.4)]" />
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/45">
                This page is now only for moving USDC between your EOA and DCW, plus grabbing test funds from the faucet.
              </p>
            </header>

            <section className="mb-8 overflow-hidden rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(242,202,80,0.1),transparent_24%),linear-gradient(180deg,#131313_0%,#0d0d0d_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <FundsBrandIcon />
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f2ca50]/90">DCW USDC</p>
                      <p className="mt-1 text-sm text-white/45">Execution wallet balance ready for funding flows</p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-end gap-3">
                    <p className="text-[clamp(2.5rem,4vw,4rem)] font-semibold leading-none tracking-[-0.05em] tabular-nums text-white">
                      {summaryLoading ? "..." : formatAmount(dcwUsdcBalance)}
                    </p>
                    <span className="mb-1 rounded-full border border-[#f2ca50]/18 bg-[#f2ca50]/8 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#f2ca50]/85">
                      USDC
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f2ca50]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">DCW live balance</p>
                </div>
              </div>
            </section>

            {summaryError ? (
              <div className="mb-8 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {summaryError}
              </div>
            ) : null}

            {(message || error || txHash) ? (
              <div className={`mb-8 rounded-xl border px-4 py-4 text-sm ${
                error
                  ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
                  : "border-[#f2ca50]/20 bg-[#f2ca50]/10 text-[#e5e2e1]"
              }`}>
                {message ? <p>{message}</p> : null}
                {error ? <p>{error}</p> : null}
                {txHash ? (
                  <a
                    href={`${ARC_EXPLORER_URL}/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#f2ca50] hover:underline"
                  >
                    View transaction
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 xl:col-span-6">
                <FundingCard eyebrow="Deposit" title="Deposit to DCW">
                  <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">EOA USDC available</p>
                      <p className="mt-1 text-xs text-white/40">Source wallet for deposit</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums text-white">{formatAmount(eoaUsdcBalance)} USDC</p>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row">
                    <input
                      value={depositAmount}
                      onChange={(event) => setDepositAmount(event.target.value)}
                      placeholder="Amount in USDC"
                      inputMode="decimal"
                      className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#121212] px-5 py-4 text-base text-white outline-none placeholder:text-white/25 focus:border-[#f2ca50]/35"
                    />
                    <button
                      type="button"
                      onClick={() => setDepositAmount(eoaUsdcBalance)}
                      className="rounded-full border border-white/10 bg-[#121212] px-5 py-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition hover:border-[#f2ca50]/30 hover:text-[#f2ca50]"
                    >
                      Max
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDepositToDcw()}
                      disabled={actionState !== "idle"}
                      className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-7 py-4 text-base font-bold text-[#f2ca50] transition hover:bg-[#f2ca50]/15 disabled:opacity-50"
                    >
                      {actionState === "depositing" ? "Depositing..." : "Deposit"}
                    </button>
                  </div>
                </FundingCard>
              </div>

              <div className="col-span-12 xl:col-span-6">
                <FundingCard eyebrow="Withdraw" title="Withdraw to EOA">
                  <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">DCW USDC available</p>
                      <p className="mt-1 text-xs text-white/40">Execution wallet for withdrawal</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums text-white">
                      {summaryLoading ? "..." : `${formatAmount(dcwUsdcBalance)} USDC`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row">
                    <input
                      value={withdrawAmount}
                      onChange={(event) => setWithdrawAmount(event.target.value)}
                      placeholder="Amount in USDC"
                      inputMode="decimal"
                      className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#121212] px-5 py-4 text-base text-white outline-none placeholder:text-white/25 focus:border-[#f2ca50]/35"
                    />
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(dcwUsdcBalance)}
                      className="rounded-full border border-white/10 bg-[#121212] px-5 py-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition hover:border-[#f2ca50]/30 hover:text-[#f2ca50]"
                    >
                      Max
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleWithdrawToEoa()}
                      disabled={actionState !== "idle"}
                      className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-7 py-4 text-base font-bold text-[#f2ca50] transition hover:bg-[#f2ca50]/15 disabled:opacity-50"
                    >
                      {actionState === "withdrawing" ? "Withdrawing..." : "Withdraw"}
                    </button>
                  </div>
                </FundingCard>
              </div>

              <div className="col-span-12">
                <FundingCard eyebrow="Faucet" title="Testnet faucet">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-sm leading-relaxed text-white/45">
                        Use the Circle faucet to get Arc test USDC into your EOA, then come back here and deposit it to the DCW.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        href={CIRCLE_FAUCET_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-6 py-3 text-sm font-bold text-[#f2ca50] transition hover:bg-[#f2ca50]/15"
                      >
                        Open Circle faucet
                      </Link>
                      <button
                        type="button"
                        onClick={() => void loadExecutionSummary()}
                        className="rounded-full border border-white/10 bg-[#121212] px-6 py-3 text-sm font-bold text-white/65 transition hover:border-[#f2ca50]/25 hover:text-[#f2ca50]"
                      >
                        Refresh balances
                      </button>
                    </div>
                  </div>
                </FundingCard>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
