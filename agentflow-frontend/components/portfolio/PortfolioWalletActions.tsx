"use client";

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  ARC_CHAIN_ID,
  ARC_EURC_ADDRESS,
  ARC_EXPLORER_URL,
  ARC_USDC_ADDRESS,
  GATEWAY_WALLET_ADDRESS,
} from "@/lib/arcChain";
import {
  withdrawExecutionWalletUsdc,
  withdrawGatewayUsdc,
  type ExecutionWalletSummary,
} from "@/lib/liveAgentClient";

/** Circle Gateway Wallet - `deposit(token, value)` on Arc (EOA sends tx). */
const gatewayWalletDepositAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type PortfolioWalletActionsProps = {
  eoaAddress: string;
  authHeaders: Record<string, string> | null;
  executionSummary: ExecutionWalletSummary | null;
  /** When true, show loading placeholders instead of zeros for execution summary fields. */
  executionSummaryLoading?: boolean;
  /** Set when `GET /api/wallet/execution` failed (avoid showing 0 as if wallets were empty). */
  executionSummaryError?: string | null;
  onAfterAction: () => void;
};

type RecentArcTx = {
  hash: `0x${string}`;
  label: string;
  explorerUrl?: string;
};

type GatewayTxHighlight = {
  hash: `0x${string}`;
  heading: string;
  footnote: string;
};

type AlchemyHoldingRow = {
  contractAddress?: string;
  symbol?: string | null;
  balance?: number;
  decimals?: number;
};

function executionWalletBalanceLine(
  tokenKey: string,
  summary: ExecutionWalletSummary | null,
  summaryLoading?: boolean,
  summaryError?: string | null,
): { symbol: string; amount: string } {
  if (summaryLoading) return { symbol: tokenKey === "EURC" ? "EURC" : "USDC", amount: "..." };
  if (summaryError) return { symbol: tokenKey === "EURC" ? "EURC" : "USDC", amount: "—" };
  if (!summary) return { symbol: "-", amount: "-" };
  if (tokenKey === "USDC") return { symbol: "USDC", amount: summary.balances.usdc.formatted };
  if (tokenKey === "EURC") return { symbol: "EURC", amount: summary.balances.eurc.formatted };
  if (!isAddress(tokenKey)) return { symbol: "-", amount: "0" };
  const addr = tokenKey.toLowerCase();
  const h = (summary.holdings as AlchemyHoldingRow[]).find(
    (x) => (x.contractAddress ?? "").toLowerCase() === addr,
  );
  if (h?.balance != null && Number.isFinite(h.balance)) {
    return { symbol: (h.symbol ?? "TOKEN").replace(/\s+/g, "").slice(0, 10), amount: String(h.balance) };
  }
  return { symbol: "TOKEN", amount: "0" };
}

function isAuthSummaryError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /401|unauthorized|token|jwt|signature|expired|bearer/i.test(message);
}

function resolveDepositToken(
  tokenKey: string,
  summary: ExecutionWalletSummary | null,
): { address: `0x${string}`; decimals: number; symbol: string } | null {
  if (tokenKey === "USDC") {
    return { address: ARC_USDC_ADDRESS, decimals: 6, symbol: "USDC" };
  }
  if (tokenKey === "EURC") {
    return { address: ARC_EURC_ADDRESS, decimals: 6, symbol: "EURC" };
  }
  if (!isAddress(tokenKey) || !summary) return null;
  const address = getAddress(tokenKey);
  const h = (summary.holdings as AlchemyHoldingRow[]).find(
    (x) => (x.contractAddress ?? "").toLowerCase() === address.toLowerCase(),
  );
  const decimals = Number(h?.decimals ?? 18);
  return {
    address,
    decimals: Number.isFinite(decimals) && decimals >= 0 ? decimals : 18,
    symbol: (h?.symbol ?? "TOKEN").replace(/\s+/g, "").slice(0, 12) || "TOKEN",
  };
}

function buildDepositTokenOptions(summary: ExecutionWalletSummary | null): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [
    { value: "USDC", label: "USDC" },
    { value: "EURC", label: "EURC" },
  ];
  if (!summary?.holdings || !Array.isArray(summary.holdings)) return opts;
  const seen = new Set([ARC_USDC_ADDRESS.toLowerCase(), ARC_EURC_ADDRESS.toLowerCase()]);
  for (const h of summary.holdings as AlchemyHoldingRow[]) {
    const raw = h.contractAddress;
    if (!raw || !isAddress(raw)) continue;
    const a = getAddress(raw as `0x${string}`);
    const al = a.toLowerCase();
    if (seen.has(al)) continue;
    seen.add(al);
    const sym = (h.symbol ?? "Token").replace(/\s+/g, "").slice(0, 12) || "Token";
    opts.push({ value: a, label: sym });
  }
  return opts;
}

function TokenBalanceIcon({ symbol }: { symbol: string }) {
  const s = symbol.toUpperCase();
  let icon = "generating_tokens";
  if (s === "USDC" || s.includes("USD")) icon = "monetization_on";
  else if (s === "EURC" || s.includes("EUR")) icon = "euro_symbol";
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#46484d]/20 bg-[#000000]">
      <span className="material-symbols-outlined text-2xl text-[#f2ca50]">{icon}</span>
    </span>
  );
}

function userFacingFundingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  if (/429|Too Many Requests|eth_getBalance|eth_call|alchemy|HTTP request failed/i.test(message)) {
    return "Balance provider is rate-limited right now. Wait a moment, refresh balances, then retry.";
  }
  if (/INSUFFICIENT_NATIVE_TOKEN|needs direct Arc USDC/i.test(message)) {
    return message;
  }
  return message || fallback;
}

function AmountRow(props: {
  value: string;
  onChange: (v: string) => void;
  onMax: () => void;
  maxDisabled?: boolean;
  actionLabel: string;
  actionPending: boolean;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="Amount"
          inputMode="decimal"
          className="min-w-0 flex-1 rounded-xl border border-[#46484d]/20 bg-[#0c0e12] px-4 py-2.5 text-sm text-[#f6f6fc] outline-none placeholder:text-[#6a6c72] focus:border-[#f2ca50]/40"
        />
        <button
          type="button"
          disabled={props.maxDisabled}
          onClick={props.onMax}
          className="shrink-0 rounded-full border border-[#46484d]/40 bg-[#111318] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#aaabb0] transition hover:border-[#f2ca50]/30 hover:text-[#f2ca50] disabled:opacity-40"
        >
          Max
        </button>
      </div>
      <button
        type="button"
        disabled={props.actionPending || props.actionDisabled || !props.value.trim()}
        onClick={() => void props.onAction()}
        className="shrink-0 rounded-full border border-[#f2ca50]/30 bg-[#f2ca50]/10 px-5 py-2.5 text-sm font-bold text-[#f2ca50] transition-colors hover:bg-[#f2ca50]/15 disabled:opacity-50"
      >
        {props.actionPending ? "..." : props.actionLabel}
      </button>
    </div>
  );
}

export function PortfolioWalletActions({
  eoaAddress,
  authHeaders,
  executionSummary,
  executionSummaryLoading = false,
  executionSummaryError = null,
  onAfterAction,
}: PortfolioWalletActionsProps) {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();

  const eoa = eoaAddress ? (getAddress(eoaAddress) as `0x${string}`) : undefined;

  const { data: eoaUsdcRaw } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20TransferAbi,
    functionName: "balanceOf",
    args: eoa ? [eoa] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(eoa) },
  });

  const { data: eoaEurcRaw } = useReadContract({
    address: ARC_EURC_ADDRESS,
    abi: erc20TransferAbi,
    functionName: "balanceOf",
    args: eoa ? [eoa] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(eoa) },
  });

  const eoaUsdcStr = useMemo(
    () => (eoaUsdcRaw !== undefined ? formatUnits(eoaUsdcRaw, 6) : ""),
    [eoaUsdcRaw],
  );
  const eoaEurcStr = useMemo(
    () => (eoaEurcRaw !== undefined ? formatUnits(eoaEurcRaw, 6) : ""),
    [eoaEurcRaw],
  );

  const [gwAmount, setGwAmount] = useState("");
  const [gwDepositAmount, setGwDepositAmount] = useState("");
  const [exAmount, setExAmount] = useState("");
  const [exDepositAmount, setExDepositAmount] = useState("");
  const [exDepositToken, setExDepositToken] = useState<string>("USDC");
  const [gwPending, setGwPending] = useState(false);
  const [gwDepPending, setGwDepPending] = useState(false);
  const [exPending, setExPending] = useState(false);
  const [exDepPending, setExDepPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gatewayTxHighlight, setGatewayTxHighlight] = useState<GatewayTxHighlight | null>(null);
  const [recentTxs, setRecentTxs] = useState<RecentArcTx[]>([]);

  const depositTokenOpts = useMemo(() => buildDepositTokenOptions(executionSummary), [executionSummary]);

  useEffect(() => {
    if (!depositTokenOpts.some((o) => o.value === exDepositToken)) {
      setExDepositToken("USDC");
    }
  }, [depositTokenOpts, exDepositToken]);

  const resolvedExDeposit = useMemo(
    () => resolveDepositToken(exDepositToken, executionSummary),
    [exDepositToken, executionSummary],
  );

  const exDepositIsOther = exDepositToken !== "USDC" && exDepositToken !== "EURC" && isAddress(exDepositToken);

  const { data: eoaOtherRaw } = useReadContract({
    address: resolvedExDeposit?.address,
    abi: erc20TransferAbi,
    functionName: "balanceOf",
    args: eoa ? [eoa] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(eoa && exDepositIsOther && resolvedExDeposit) },
  });

  const exDepositBalanceLine = useMemo(
    () =>
      executionWalletBalanceLine(
        exDepositToken,
        executionSummary,
        executionSummaryLoading,
        executionSummaryError,
      ),
    [exDepositToken, executionSummary, executionSummaryLoading, executionSummaryError],
  );

  if (!authHeaders) {
    return (
      <div className="rounded-xl border border-[#46484d]/20 bg-[#111318] p-4 text-sm text-[#aaabb0]">
        Sign in to move funds from Gateway or your agent wallet back to your main wallet.
      </div>
    );
  }

  const ensureArcWallet = async (): Promise<boolean> => {
    if (walletClient?.chain?.id === ARC_CHAIN_ID) {
      return true;
    }
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
      return true;
    } catch (e) {
      setErr(userFacingFundingError(e, "Switch to Arc Testnet first."));
      return false;
    }
  };

  const handleGatewayDepositFromEoa = async () => {
    if (!eoaAddress || !authHeaders) return;
    const n = Number(gwDepositAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a valid amount.");
      return;
    }
    setErr(null);
    setMsg(null);
    setGatewayTxHighlight(null);
    setGwDepPending(true);
    try {
      if (!walletClient || !publicClient) {
        throw new Error("Connect your wallet.");
      }
      const ok = await ensureArcWallet();
      if (!ok) return;

      const account = getAddress(eoaAddress);
      const usdc = getAddress(ARC_USDC_ADDRESS);
      const gatewayWallet = getAddress(GATEWAY_WALLET_ADDRESS);
      const amountRaw = parseUnits(gwDepositAmount.trim(), 6);

      const eoaBal = (await publicClient.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      })) as bigint;
      if (eoaBal < amountRaw) {
        setErr("Your EOA does not have enough USDC on Arc for this amount (get test USDC on Arc first).");
        return;
      }

      const allowance = (await publicClient.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, gatewayWallet],
      })) as bigint;
      if (allowance < amountRaw) {
        const approveHash = await walletClient.writeContract({
          account,
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [gatewayWallet, amountRaw],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        setRecentTxs((prev: RecentArcTx[]) => {
          const next = [
            { hash: approveHash, label: "Gateway deposit - approve USDC" },
            ...prev.filter((x: RecentArcTx) => x.hash !== approveHash),
          ];
          return next.slice(0, 15);
        });
      }

      const depositHash = await walletClient.writeContract({
        account,
        address: gatewayWallet,
        abi: gatewayWalletDepositAbi,
        functionName: "deposit",
        args: [usdc, amountRaw],
      });
      setRecentTxs((prev: RecentArcTx[]) => {
        const next = [
          { hash: depositHash, label: "Gateway - deposit from EOA" },
          ...prev.filter((x: RecentArcTx) => x.hash !== depositHash),
        ];
        return next.slice(0, 15);
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });
      setGatewayTxHighlight({
        hash: depositHash,
        heading: "Gateway deposit - Arc transaction",
        footnote: "USDC is credited to your EOA as depositor. Balances may take a few seconds in Circle Gateway API.",
      });
      setMsg(
        `Deposited ${n} USDC into Circle Gateway from your EOA. If the number below lags, wait a few seconds and refresh.`,
      );
      setGwDepositAmount("");
      onAfterAction();
      [400, 900, 1800, 3500, 7000, 14000].forEach((ms) => {
        window.setTimeout(() => onAfterAction(), ms);
      });
    } catch (e) {
      setErr(userFacingFundingError(e, "Gateway deposit failed"));
    } finally {
      setGwDepPending(false);
    }
  };

  const handleExecutionDeposit = async () => {
    if (!eoaAddress || !executionSummary?.userAgentWalletAddress) return;
    const n = Number(exDepositAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a valid amount.");
      return;
    }
    setErr(null);
    setMsg(null);
    setGatewayTxHighlight(null);
    setExDepPending(true);
    try {
      if (!walletClient || !publicClient) {
        throw new Error("Connect your wallet.");
      }
      const ok = await ensureArcWallet();
      if (!ok) return;
      const to = getAddress(executionSummary.userAgentWalletAddress);
      const resolved = resolveDepositToken(exDepositToken, executionSummary);
      if (!resolved) {
        throw new Error("Select a valid token.");
      }
      const txHash = await walletClient.writeContract({
        account: getAddress(eoaAddress),
        address: resolved.address,
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [to, parseUnits(exDepositAmount.trim(), resolved.decimals)],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setRecentTxs((prev: RecentArcTx[]) => {
        const next = [
          { hash: txHash, label: `Execution wallet deposit (${resolved.symbol})` },
          ...prev.filter((x: RecentArcTx) => x.hash !== txHash),
        ];
        return next.slice(0, 15);
      });
      setMsg(`Sent ${n} ${resolved.symbol} to your execution wallet.`);
      setExDepositAmount("");
      onAfterAction();
    } catch (e) {
      setErr(userFacingFundingError(e, "Execution wallet deposit failed"));
    } finally {
      setExDepPending(false);
    }
  };

  const handleGatewayWithdraw = async () => {
    setErr(null);
    setMsg(null);
    setGatewayTxHighlight(null);
    setGwPending(true);
    try {
      const result = await withdrawGatewayUsdc({
        authHeaders,
        amount: gwAmount.trim(),
        toAddress: eoaAddress,
      });
      const h = result.txHash as `0x${string}`;
      setRecentTxs((prev: RecentArcTx[]) => {
        const next = [
          { hash: h, label: "Gateway withdraw (mint to EOA)" },
          ...prev.filter((x: RecentArcTx) => x.hash !== h),
        ];
        return next.slice(0, 15);
      });
      setGatewayTxHighlight({
        hash: h,
        heading: "Gateway withdraw - Arc transaction",
        footnote: "Server-completed burn + mint; verify USDC mint to your EOA on Arc explorer.",
      });
      setMsg(`Gateway: withdrew ${result.amount} USDC to your EOA.`);
      setGwAmount("");
      onAfterAction();
    } catch (e) {
      setErr(userFacingFundingError(e, "Gateway withdraw failed"));
    } finally {
      setGwPending(false);
    }
  };

  const handleExecutionWithdraw = async () => {
    setErr(null);
    setMsg(null);
    setGatewayTxHighlight(null);
    const n = Number(exAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a valid USDC amount.");
      return;
    }
    setExPending(true);
    try {
      const result = await withdrawExecutionWalletUsdc({
        authHeaders,
        amountUsdc: n,
        toAddress: eoaAddress,
      });
      if (result.txHash) {
        const h = result.txHash as `0x${string}`;
        setRecentTxs((prev: RecentArcTx[]) => {
          const next = [
            { hash: h, label: "Agent wallet to EOA (USDC)" },
            ...prev.filter((x: RecentArcTx) => x.hash !== h),
          ];
          return next.slice(0, 15);
        });
      }
      setMsg("Execution wallet USDC sent to your EOA.");
      setExAmount("");
      onAfterAction();
    } catch (e) {
      setErr(userFacingFundingError(e, "Execution withdraw failed"));
    } finally {
      setExPending(false);
    }
  };

  const gwBal = executionSummary?.balances.gatewayUsdc.formatted ?? "0";
  const exUsdc = executionSummary?.balances.usdc.formatted ?? "0";
  const exGas = executionSummary?.balances.nativeUsdcGas.formatted ?? "0";
  const summaryUnavailable = Boolean(executionSummaryError);
  const gwDisplay = executionSummaryLoading ? "..." : summaryUnavailable ? "—" : gwBal;
  const exUsdcDisplay = executionSummaryLoading ? "..." : summaryUnavailable ? "—" : exUsdc;
  const exGasDisplay = executionSummaryLoading ? "..." : summaryUnavailable ? "—" : exGas;
  const executionReserveLow =
    !executionSummaryLoading && !summaryUnavailable && Number(exUsdc) < 20;
  const gatewayReserveLow = !executionSummaryLoading && !summaryUnavailable && Number(gwBal) < 5;

  const maxGwDeposit = () => {
    if (eoaUsdcStr) setGwDepositAmount(eoaUsdcStr);
  };
  const maxGwWithdraw = () => {
    if (gwBal) setGwAmount(gwBal);
  };
  const maxExDeposit = () => {
    if (exDepositToken === "USDC" && eoaUsdcStr) setExDepositAmount(eoaUsdcStr);
    else if (exDepositToken === "EURC" && eoaEurcStr) setExDepositAmount(eoaEurcStr);
    else if (
      exDepositIsOther &&
      resolvedExDeposit &&
      eoaOtherRaw !== undefined
    ) {
      setExDepositAmount(formatUnits(eoaOtherRaw, resolvedExDeposit.decimals));
    }
  };
  const maxExWithdraw = () => {
    if (exUsdc) setExAmount(exUsdc);
  };

  const tokenSelectClass =
    "rounded-full border border-[#46484d]/30 bg-[#0c0e12] px-3 py-2 text-xs font-bold text-[#f6f6fc] outline-none focus:border-[#f2ca50]/40";

  return (
    <div className="space-y-6">
      {executionSummaryError ? (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <p className="font-semibold">
            {isAuthSummaryError(executionSummaryError)
              ? "Session expired. Re-sign from the banner above to reload balances."
              : "Wallet balances unavailable."}
          </p>
          <p className="mt-1 break-words font-mono text-xs text-rose-200/90">{executionSummaryError}</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-[#46484d]/10 bg-[#111318] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#aaabb0]">Gateway reserve</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <TokenBalanceIcon symbol="USDC" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#aaabb0]">USDC - Available balance</p>
              <p className="font-display text-3xl font-bold tabular-nums leading-tight text-[#f6f6fc]">{gwDisplay}</p>
            </div>
          </div>
        </div>
        {gatewayReserveLow ? (
          <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            Low for repeated A2A/x402 tests. Keep at least 5-20 USDC.
          </p>
        ) : null}

        <div className="mt-5 border-t border-[#46484d]/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#aaabb0]">Deposit</span>
          </div>
          <AmountRow
            value={gwDepositAmount}
            onChange={setGwDepositAmount}
            onMax={maxGwDeposit}
            maxDisabled={!eoaUsdcStr || Number(eoaUsdcStr) <= 0}
            actionLabel="Deposit from EOA"
            actionPending={gwDepPending}
            onAction={handleGatewayDepositFromEoa}
          />
        </div>

        <div className="mt-5 border-t border-[#46484d]/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#aaabb0]">Withdraw</span>
          </div>
          <AmountRow
            value={gwAmount}
            onChange={setGwAmount}
            onMax={maxGwWithdraw}
            maxDisabled={!gwBal || Number(gwBal) <= 0}
            actionLabel="Withdraw to EOA"
            actionPending={gwPending}
            onAction={handleGatewayWithdraw}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-[#46484d]/10 bg-[#111318] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#aaabb0]">Agent wallet reserve</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <TokenBalanceIcon symbol={exDepositBalanceLine.symbol} />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#aaabb0]">
                {exDepositBalanceLine.symbol} - Available balance
              </p>
              <p className="font-display text-3xl font-bold tabular-nums leading-tight text-[#f6f6fc]">
                {exDepositBalanceLine.amount}
              </p>
            </div>
          </div>
          <div className="shrink-0 lg:pt-1">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-[#7f8796]">Deposit token</p>
            <select
              value={exDepositToken}
              onChange={(e) => setExDepositToken(e.target.value)}
              className={tokenSelectClass}
              aria-label="Token to show and deposit"
            >
              {depositTokenOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-[#46484d]/10 bg-[#0c0e12] px-3 py-2">
            <span className="text-[#7f8796]">Execution USDC</span>
            <span className={executionReserveLow ? "ml-2 text-amber-200" : "ml-2 text-[#f6f6fc]"}>
              {exUsdcDisplay}
            </span>
          </div>
          <div className="rounded-lg border border-[#46484d]/10 bg-[#0c0e12] px-3 py-2">
            <span className="text-[#7f8796]">Arc gas USDC</span>
            <span className="ml-2 text-[#f6f6fc]">{exGasDisplay}</span>
          </div>
        </div>
        {executionReserveLow ? (
          <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            Low for execution tests. Keep at least 20 USDC.
          </p>
        ) : null}

        <div className="mt-5 border-t border-[#46484d]/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#aaabb0]">Deposit</span>
          </div>
          <AmountRow
            value={exDepositAmount}
            onChange={setExDepositAmount}
            onMax={maxExDeposit}
            maxDisabled={
              exDepositToken === "EURC"
                ? !eoaEurcStr
                : exDepositToken === "USDC"
                  ? !eoaUsdcStr
                  : exDepositIsOther
                    ? eoaOtherRaw === undefined
                    : true
            }
            actionLabel="Deposit from EOA"
            actionPending={exDepPending}
            onAction={handleExecutionDeposit}
            actionDisabled={!executionSummary}
          />
        </div>

        <div className="mt-5 border-t border-[#46484d]/10 pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#aaabb0]">Withdraw</span>
          </div>
          <AmountRow
            value={exAmount}
            onChange={setExAmount}
            onMax={maxExWithdraw}
            maxDisabled={!exUsdc || Number(exUsdc) <= 0}
            actionLabel="Withdraw to EOA"
            actionPending={exPending}
            onAction={handleExecutionWithdraw}
          />
        </div>
      </div>

      {msg ? (
        <div className="space-y-2 text-sm text-[#f2ca50]">
          <p>{msg}</p>
          {gatewayTxHighlight ? (
            <div className="rounded-lg border border-[#f2ca50]/20 bg-[#111318]/90 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#aaabb0]">
                {gatewayTxHighlight.heading}
              </p>
              <a
                href={`${ARC_EXPLORER_URL}/tx/${gatewayTxHighlight.hash}`}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-xs leading-relaxed text-[#f2ca50] underline decoration-[#f2ca50]/50 underline-offset-2 hover:text-[#f4d66f]"
              >
                {gatewayTxHighlight.hash}
              </a>
              <p className="mt-1 text-[10px] text-[#6a6c72]">{gatewayTxHighlight.footnote}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {err ? <div className="text-sm text-[#ff716c]">{err}</div> : null}
      {recentTxs.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-[#46484d]/20 bg-[#111318]/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#aaabb0]">Recent transactions</p>
          <ul className="max-h-40 space-y-2 overflow-y-auto text-xs">
            {recentTxs.map((t) => (
              <li key={t.hash}>
                <a
                  href={t.explorerUrl ?? `${ARC_EXPLORER_URL}/tx/${t.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[#f2ca50] underline decoration-[#f2ca50]/40 underline-offset-2 hover:text-[#f4d66f]"
                >
                  <span className="text-[#aaabb0]">{t.label}</span>
                  <span className="text-[#f6f6fc]"> - {t.hash.slice(0, 10)}...{t.hash.slice(-6)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
