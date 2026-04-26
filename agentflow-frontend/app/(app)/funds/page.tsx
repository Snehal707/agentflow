"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import { PortfolioWalletActions } from "@/components/portfolio/PortfolioWalletActions";
import { shortenAddress } from "@/lib/appData";
import {
  runDcwVaultAction,
  type DcwVaultAction,
  type ExecutionWalletSummary,
  fetchExecutionWalletSummary,
} from "@/lib/liveAgentClient";
import { loadVaultHoldingCards, type VaultHoldingCard } from "@/lib/vaultPositionCards";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

type Fund = {
  id: string;
  name: string;
  description: string;
  strategyType: string;
  minDeposit: number;
  estimatedApy: number;
  riskLevel: string;
  planCount: number;
  totalValueLocked: number;
};

type FundPlan = {
  id: string;
  fundId: string;
  amount: number;
  status: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  fund?: Fund | null;
};

function strategyMeta(strategyType: string): { icon: string; accent: string } {
  switch (strategyType) {
    case "dca_vault":
      return { icon: "sync_alt", accent: "text-[#f2ca50]" };
    case "auto_compound":
      return { icon: "auto_awesome", accent: "text-[#f2ca50]" };
    case "research_monitor":
      return { icon: "travel_explore", accent: "text-white/90" };
    default:
      return { icon: "savings", accent: "text-[#f2ca50]" };
  }
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatApy(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(value === 0 ? 0 : 1)}%` : "N/A";
}

function isYieldBearingFund(fund: Fund): boolean {
  return fund.strategyType === "dca_vault" || fund.strategyType === "auto_compound";
}

function displayFundApy(fund: Fund): string {
  if (!isYieldBearingFund(fund)) {
    return "N/A";
  }
  return formatApy(fund.estimatedApy);
}

function fundApyExplanation(fund: Fund): string {
  switch (fund.strategyType) {
    case "dca_vault":
      return "Uses the current vault APY when the contract exposes it, otherwise falls back to the configured vault target.";
    case "auto_compound":
      return "Derived from the vault APY plus a 1.5 point automation uplift for compounding behavior.";
    case "research_monitor":
      return "This strategy sends research alerts and does not produce yield, so APY is not applicable.";
    default:
      return "Shown as an estimated strategy yield and may change with live conditions.";
  }
}

function defaultFundSummary(fund: Fund): string {
  if (fund.description) {
    return fund.description;
  }
  if (!isYieldBearingFund(fund)) {
    return `${formatRisk(fund.strategyType)} workflow. No yield component is attached to this strategy.`;
  }
  return `${formatRisk(fund.strategyType)} strategy with ${displayFundApy(fund)} estimated yield.`;
}

function formatRisk(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function strategyRuntimeState(fund: Fund): {
  label: string;
  detail: string;
  tone: string;
} {
  switch (fund.strategyType) {
    case "research_monitor":
      return {
        label: "Live cron",
        detail: "Daily reports are generated and sent to opted-in Telegram users by the cron worker.",
        tone: "text-emerald-300",
      };
    case "dca_vault":
      return {
        label: "Tracked only",
        detail: "Direct vault deposit and withdraw work in chat, but this weekly recurring plan is not automated yet.",
        tone: "text-amber-200",
      };
    case "auto_compound":
      return {
        label: "Tracked only",
        detail: "Vault APY is monitored for display, but auto-compound execution is not wired to this plan yet.",
        tone: "text-amber-200",
      };
    default:
      return {
        label: "Unknown",
        detail: "This strategy does not have a verified runtime status yet.",
        tone: "text-white/60",
      };
  }
}

function formatVaultShares(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: numeric >= 100 ? 2 : 4,
  }).format(numeric);
}

function formatTokenAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: numeric >= 100 ? 2 : 4,
  }).format(numeric);
}

function buildVaultActionGuardMessage(input: {
  action: DcwVaultAction;
  executionWalletAddress: string;
  needsGasFunding: boolean;
  needsUsdcFunding: boolean;
  needsVaultShares: boolean;
}): string | null {
  const walletLabel = `Agent wallet ${shortenAddress(input.executionWalletAddress)}`;

  if (input.action === "deposit") {
    if (input.needsGasFunding && input.needsUsdcFunding) {
      return `${walletLabel} needs USDC on Arc before it can deposit into the vault.`;
    }
    if (input.needsGasFunding) {
      return `${walletLabel} needs a little more USDC on Arc for fees before it can deposit.`;
    }
    if (input.needsUsdcFunding) {
      return `${walletLabel} does not have USDC available to deposit yet.`;
    }
  }

  if (input.needsGasFunding && input.needsVaultShares) {
    return `${walletLabel} needs a little more USDC for fees and does not hold vault shares yet.`;
  }
  if (input.needsGasFunding) {
    return `${walletLabel} needs a little more USDC on Arc for fees before it can withdraw.`;
  }
  if (input.needsVaultShares) {
    return `${walletLabel} does not hold vault shares yet. Deposit first, then withdraw from the same Agent wallet.`;
  }

  return null;
}

function isAuthBalanceError(message: string | null): boolean {
  if (!message) return false;
  return /401|unauthorized|token|jwt|signature|expired|bearer/i.test(message);
}

export default function FundsPage() {
  const pathname = usePathname();
  const isVaultRoute = pathname === "/vault";
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundPlans, setFundPlans] = useState<FundPlan[]>([]);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "low" | "high">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  const [amount, setAmount] = useState("");
  const [vaultHoldings, setVaultHoldings] = useState<VaultHoldingCard[]>([]);
  const [actionState, setActionState] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [executionSummary, setExecutionSummary] = useState<ExecutionWalletSummary | null>(null);
  const [executionSummaryLoading, setExecutionSummaryLoading] = useState(false);
  const [executionSummaryError, setExecutionSummaryError] = useState<string | null>(null);
  const [vaultActionAmount, setVaultActionAmount] = useState("10");
  const [vaultActionState, setVaultActionState] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [vaultActionMessage, setVaultActionMessage] = useState<string | null>(null);
  const [vaultActionExplorer, setVaultActionExplorer] = useState<string | null>(null);
  const [vaultActionKind, setVaultActionKind] = useState<DcwVaultAction | null>(null);

  const filteredFunds = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return funds.filter((fund) => {
      const risk = fund.riskLevel.toLowerCase();
      const passesRisk =
        riskFilter === "all" ||
        (riskFilter === "low" ? risk.includes("low") || risk.includes("medium") : risk.includes("high"));
      if (!passesRisk) return false;
      if (!normalized) return true;
      return (
        fund.name.toLowerCase().includes(normalized) ||
        fund.description.toLowerCase().includes(normalized) ||
        fund.strategyType.toLowerCase().includes(normalized)
      );
    });
  }, [funds, search, riskFilter]);

  const activeFundPlanIds = useMemo(
    () => new Set(fundPlans.filter((item) => item.status === "active").map((item) => item.fundId)),
    [fundPlans],
  );

  const fundPlansByFundId = useMemo(
    () =>
      new Map(
        fundPlans
          .filter((item) => item.status === "active")
          .map((item) => [item.fundId, item]),
      ),
    [fundPlans],
  );

  const vaultApy = useMemo(() => {
    const fund = funds.find((item) => item.strategyType === "dca_vault");
    return fund?.estimatedApy ?? null;
  }, [funds]);

  const totalVaultUsd = useMemo(
    () =>
      vaultHoldings.reduce(
        (sum, holding) => sum + (Number.isFinite(holding.usdValue ?? NaN) ? (holding.usdValue ?? 0) : 0),
        0,
      ),
    [vaultHoldings],
  );

  const loadFunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND}/api/funds`, { cache: "no-store" });
      const json = (await response.json().catch(() => [])) as Fund[] | { error?: string };
      if (!response.ok || !Array.isArray(json)) {
        throw new Error(!Array.isArray(json) ? json.error || "Could not load funds" : "Could not load funds");
      }
      setFunds(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load funds");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFundPlans = useCallback(async () => {
    const authHeaders = getAuthHeaders();
    if (!address || !isAuthenticated || !authHeaders) {
      setFundPlans([]);
      return;
    }

    try {
      const response = await fetch(`${BACKEND}/api/funds/plans`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const json = (await response.json().catch(() => [])) as
        | FundPlan[]
        | { error?: string };
      if (!response.ok || !Array.isArray(json)) {
        throw new Error(!Array.isArray(json) ? json.error || "Could not load fund plans" : "Could not load fund plans");
      }
      setFundPlans(json);
    } catch {
      setFundPlans([]);
    }
  }, [address, getAuthHeaders, isAuthenticated]);

  const loadExecutionSummary = useCallback(async () => {
    const authHeaders = getAuthHeaders();
    if (!address || !isAuthenticated || !authHeaders) {
      setExecutionSummary(null);
      setExecutionSummaryError(null);
      setExecutionSummaryLoading(false);
      return;
    }

    setExecutionSummaryLoading(true);
    setExecutionSummaryError(null);
    try {
      const summary = await fetchExecutionWalletSummary(authHeaders);
      setExecutionSummary(summary);
    } catch (cause) {
      setExecutionSummary(null);
      setExecutionSummaryError(
        cause instanceof Error ? cause.message : "Could not load Agent wallet balances.",
      );
    } finally {
      setExecutionSummaryLoading(false);
    }
  }, [address, getAuthHeaders, isAuthenticated]);

  const resignAndLoadExecutionSummary = useCallback(async () => {
    if (!address) {
      openConnectModal?.();
      return;
    }

    setExecutionSummaryLoading(true);
    setExecutionSummaryError(null);
    try {
      const session = await signIn();
      const summary = await fetchExecutionWalletSummary({
        Authorization: `Bearer ${session.token}`,
      });
      setExecutionSummary(summary);
    } catch (cause) {
      setExecutionSummary(null);
      setExecutionSummaryError(
        cause instanceof Error ? cause.message : "Could not load Agent wallet balances.",
      );
    } finally {
      setExecutionSummaryLoading(false);
    }
  }, [address, openConnectModal, signIn]);

  const loadVaultHoldings = useCallback(async () => {
    const { cards } = await loadVaultHoldingCards(address, getAuthHeaders, isAuthenticated);
    setVaultHoldings(cards);
  }, [address, getAuthHeaders, isAuthenticated]);

  const refreshAfterAgentWalletAction = useCallback(async () => {
    await Promise.all([loadExecutionSummary(), loadVaultHoldings(), loadFunds(), loadFundPlans()]);
  }, [loadExecutionSummary, loadVaultHoldings, loadFunds, loadFundPlans]);

  useEffect(() => {
    void loadFunds();
  }, [loadFunds]);

  useEffect(() => {
    void loadFundPlans();
  }, [loadFundPlans]);

  useEffect(() => {
    void loadExecutionSummary();
  }, [loadExecutionSummary]);

  useEffect(() => {
    void loadVaultHoldings();
  }, [loadVaultHoldings]);

  const openPlanModal = (fund: Fund) => {
    setSelectedFund(fund);
    setAmount(String(fund.minDeposit || 1));
    setActionState("idle");
    setActionMessage(null);
  };

  const handleFundAction = async (fund: Fund) => {
    if (activeFundPlanIds.has(fund.id)) {
      setSelectedFund(fund);
      setActionState("idle");
      setActionMessage(null);
      return;
    }
    if (!address) {
      openConnectModal?.();
      return;
    }
    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
      return;
    }
    openPlanModal(fund);
  };

  const handleDirectVaultAction = async (nextAction: DcwVaultAction) => {
    if (!address) {
      openConnectModal?.();
      return;
    }

    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
    }

    const authHeaders = getAuthHeaders();
    if (!authHeaders) {
      setVaultActionState("error");
      setVaultActionMessage("Sign your AgentFlow session first.");
      setVaultActionExplorer(null);
      return;
    }

    const amountNumber = Number(vaultActionAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setVaultActionState("error");
      setVaultActionMessage("Enter a valid USDC amount.");
      setVaultActionExplorer(null);
      return;
    }

    setVaultActionKind(nextAction);
    setVaultActionState("submitting");
    setVaultActionMessage(null);
    setVaultActionExplorer(null);

    try {
      const summary = await fetchExecutionWalletSummary(authHeaders);
      setExecutionSummary(summary);
      setExecutionSummaryError(null);

      const guardMessage = buildVaultActionGuardMessage({
        action: nextAction,
        executionWalletAddress: summary.userAgentWalletAddress,
        needsGasFunding: summary.fundingStatus.needsGasFunding,
        needsUsdcFunding: summary.fundingStatus.needsUsdcFunding,
        needsVaultShares: summary.fundingStatus.needsVaultShares,
      });

      if (guardMessage) {
        setVaultActionState("error");
        setVaultActionMessage(guardMessage);
        return;
      }

      const result = await runDcwVaultAction({
        authHeaders,
        walletAddress: address,
        action: nextAction,
        amount: amountNumber,
      });

      if (!result.success) {
        throw new Error(result.error || `Vault ${nextAction} failed`);
      }

      setVaultActionState("success");
      setVaultActionMessage(
        nextAction === "deposit"
          ? "Vault deposit complete on Arc."
          : "Vault withdraw complete on Arc.",
      );
      setVaultActionExplorer(result.explorerLink ?? null);
      await Promise.all([loadExecutionSummary(), loadVaultHoldings(), loadFunds()]);
    } catch (cause) {
      setVaultActionState("error");
      setVaultActionMessage(cause instanceof Error ? cause.message : `Vault ${nextAction} failed.`);
      setVaultActionExplorer(null);
    }
  };

  const startFundPlan = async () => {
    if (!selectedFund) return;
    const authHeaders = getAuthHeaders();
    if (!authHeaders) {
      setActionState("error");
      setActionMessage("Sign your session first.");
      return;
    }
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber < selectedFund.minDeposit) {
      setActionState("error");
      setActionMessage(`Enter at least ${selectedFund.minDeposit} USDC.`);
      return;
    }

    setActionState("submitting");
    setActionMessage(null);
    try {
      const response = await fetch(`${BACKEND}/api/funds/plans/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          fundId: selectedFund.id,
          amount,
        }),
      });

      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Plan start failed");
      }

      setActionState("success");
      setActionMessage("Plan activated.");
      await Promise.all([loadFunds(), loadFundPlans()]);
      window.setTimeout(() => {
        setSelectedFund(null);
        setActionState("idle");
        setActionMessage(null);
      }, 900);
    } catch (cause) {
      setActionState("error");
      setActionMessage(cause instanceof Error ? cause.message : "Plan start failed");
    }
  };

  const stopFundPlan = async (fund: Fund) => {
    const authHeaders = getAuthHeaders();
    const fundPlan = fundPlansByFundId.get(fund.id);
    if (!authHeaders || !fundPlan) {
      return;
    }
    if (!window.confirm(`Stop the active plan for ${fund.name}?`)) {
      return;
    }

    setActionState("submitting");
    setActionMessage(null);
    try {
      const response = await fetch(`${BACKEND}/api/funds/plans/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          planId: fundPlan.id,
        }),
      });

      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Stop plan failed");
      }

      setActionState("success");
      setActionMessage(`${fund.name} plan stopped.`);
      await Promise.all([loadFunds(), loadFundPlans()]);
      window.setTimeout(() => {
        setActionState("idle");
        setActionMessage(null);
      }, 1200);
    } catch (cause) {
      setActionState("error");
      setActionMessage(cause instanceof Error ? cause.message : "Stop plan failed");
    }
  };

  const activePlanCount = activeFundPlanIds.size;
  const selectedFundRuntime = selectedFund ? strategyRuntimeState(selectedFund) : null;
  const selectedPlan = selectedFund ? fundPlansByFundId.get(selectedFund.id) ?? null : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#131313] font-body text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left main */}
        <main className="scrollbar-hide flex-1 overflow-y-auto">
          <ChatTopNavbar
            actions={(
              <SessionStatusChip
                address={address}
                isAuthenticated={isAuthenticated}
                isLoading={authLoading}
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
            )}
          />

          <div className="px-10 py-12">
            {/* Hero */}
            <section className="mb-12 space-y-2">
              <h1 className="font-headline text-6xl tracking-tight text-[#e5e2e1]">
                {isVaultRoute ? "Vault" : "Funding"}
              </h1>
              <p className="text-lg font-light tracking-wide text-white/40">
                {isVaultRoute
                  ? "Deposit or withdraw from the AgentFlow vault."
                  : "Fund Gateway and top up the Agent wallet for paid execution."}
              </p>
              {!isVaultRoute ? (
                <div className="pt-3">
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded border border-[#f2ca50]/20 bg-[#f2ca50]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#f2ca50] transition hover:bg-[#f2ca50]/15"
                  >
                    Open Circle Faucet
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </a>
                </div>
              ) : null}
            </section>

            {/* Balance cards */}
            {isVaultRoute ? (
            <section className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="relative overflow-hidden rounded-xl border-l-2 border-[#f2ca50] bg-[#2a2a2a] p-6">
                <div className="absolute right-4 top-4 opacity-10">
                  <span className="material-symbols-outlined text-4xl text-[#f2ca50]">percent</span>
                </div>
                <p className="mb-1 font-label text-[10px] uppercase tracking-widest text-[#f2ca50]">Vault</p>
                <h3 className="font-headline mb-4 text-xl text-[#e5e2e1]">Vault APY</h3>
                <div className="font-headline text-3xl text-[#e5e2e1]">
                  {vaultApy == null ? "N/A" : formatApy(vaultApy)}
                </div>
              </div>
              <div className="rounded-xl border border-transparent bg-[#1c1b1b] p-6 transition-all hover:border-white/10">
                <p className="mb-1 font-label text-[10px] uppercase tracking-widest text-white/40">Vault</p>
                <h3 className="font-headline mb-4 text-xl text-[#e5e2e1]">Your Vault Balance</h3>
                <div className="font-headline text-3xl text-[#e5e2e1]">{formatUsd(totalVaultUsd)}</div>
              </div>
              <div className="rounded-xl border border-transparent bg-[#1c1b1b] p-6 transition-all hover:border-white/10">
                <p className="mb-1 font-label text-[10px] uppercase tracking-widest text-white/40">Vault</p>
                <h3 className="font-headline mb-4 text-xl text-[#e5e2e1]">Tracked Positions</h3>
                <div className="font-headline text-3xl text-[#e5e2e1]">{vaultHoldings.length}</div>
              </div>
            </section>
            ) : null}

            {/* Auth banners */}
            {!address ? (
              <div className="mb-10 rounded-xl border border-white/5 bg-[#1c1b1b] px-8 py-6 text-sm text-white/50">
                Connect your wallet to {isVaultRoute ? "use the vault." : "manage funding reserves."}
              </div>
            ) : !isAuthenticated ? (
              <div className="mb-10 rounded-xl border border-[#f2ca50]/20 bg-[#1c1b1b] px-8 py-6">
                <p className="text-sm text-[#e5e2e1]">
                  Sign your AgentFlow session to continue.
                </p>
                <button
                  type="button"
                  onClick={() => { void signIn().catch(() => {}); }}
                  disabled={authLoading}
                  className="mt-4 rounded bg-[#f2ca50] px-6 py-2.5 font-label text-xs font-bold uppercase tracking-[0.16em] text-[#3c2f00] transition hover:brightness-110 disabled:opacity-60"
                >
                  {authLoading ? "Signing..." : "Sign session"}
                </button>
                {authError ? <p className="mt-3 text-sm text-rose-300">{authError}</p> : null}
              </div>
            ) : null}

            {isVaultRoute ? (
            <section className="mb-12 rounded-xl border border-white/5 bg-[#1c1b1b] p-8">
              <div className="mb-6">
                <p className="font-label text-[10px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
                  Vault
                </p>
                <h2 className="font-headline mt-2 text-2xl text-[#e5e2e1]">Deposit &amp; withdraw</h2>
              </div>

              {!address ? (
                <div className="mt-8 rounded-xl border border-white/5 bg-black/20 p-6">
                  <p className="font-label text-[10px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
                    Direct vault actions
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-white/55">
                    Connect your wallet to deposit into or withdraw from the AgentFlow vault.
                  </p>
                  <button
                    type="button"
                    onClick={() => openConnectModal?.()}
                    className="mt-5 rounded bg-[#f2ca50] px-5 py-2.5 font-label text-xs font-bold uppercase tracking-[0.16em] text-[#3c2f00] transition hover:brightness-110"
                  >
                    Connect wallet
                  </button>
                </div>
              ) : !isAuthenticated ? (
                <div className="mt-8 rounded-xl border border-[#f2ca50]/20 bg-black/20 p-6">
                  <p className="font-label text-[10px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
                    Direct vault actions
                  </p>
                  <button
                    type="button"
                    onClick={() => { void signIn().catch(() => {}); }}
                    disabled={authLoading}
                    className="mt-5 rounded bg-[#f2ca50] px-5 py-2.5 font-label text-xs font-bold uppercase tracking-[0.16em] text-[#3c2f00] transition hover:brightness-110 disabled:opacity-60"
                  >
                    {authLoading ? "Signing..." : "Sign session"}
                  </button>
                </div>
              ) : (
                <div className="mt-8 rounded-xl border border-white/5 bg-black/20 p-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-2xl">
                      <p className="font-label text-[10px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
                        Direct vault actions
                      </p>
                      {executionSummaryLoading ? (
                        <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/35">
                          Loading Agent wallet balances...
                        </p>
                      ) : executionSummary ? (
                        <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/45">
                          <span className="rounded border border-white/5 bg-[#141414] px-3 py-2">
                            Agent wallet {shortenAddress(executionSummary.userAgentWalletAddress)}
                          </span>
                          <span className="rounded border border-white/5 bg-[#141414] px-3 py-2">
                            USDC {formatTokenAmount(executionSummary.balances.usdc.formatted)}
                          </span>
                          <span className="rounded border border-white/5 bg-[#141414] px-3 py-2">
                            Vault shares {formatVaultShares(executionSummary.balances.vaultShares.formatted)}
                          </span>
                        </div>
                      ) : executionSummaryError ? (
                        <p className="mt-4 text-sm text-rose-300">{executionSummaryError}</p>
                      ) : null}
                    </div>

                    <div className="w-full max-w-2xl">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                        <label className="block">
                          <span className="font-label text-[10px] uppercase tracking-[0.18em] text-white/40">
                            Amount (USDC)
                          </span>
                          <input
                            value={vaultActionAmount}
                            onChange={(event) => setVaultActionAmount(event.target.value)}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="mt-2 h-11 w-full rounded border border-white/5 bg-[#141414] px-4 text-sm text-[#e5e2e1] outline-none transition focus:border-[#f2ca50]/40"
                            placeholder="10"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => { void handleDirectVaultAction("deposit"); }}
                          disabled={vaultActionState === "submitting"}
                          className="h-11 rounded bg-[#f2ca50] px-5 font-label text-xs font-bold uppercase tracking-[0.16em] text-[#3c2f00] transition hover:brightness-110 disabled:opacity-60"
                        >
                          {vaultActionState === "submitting" && vaultActionKind === "deposit"
                            ? "Depositing..."
                            : "Deposit"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDirectVaultAction("withdraw"); }}
                          disabled={vaultActionState === "submitting"}
                          className="h-11 rounded border border-white/10 bg-[#141414] px-5 font-label text-xs font-bold uppercase tracking-[0.16em] text-[#e5e2e1] transition hover:border-[#f2ca50]/40 hover:text-[#f2ca50] disabled:opacity-60"
                        >
                          {vaultActionState === "submitting" && vaultActionKind === "withdraw"
                            ? "Withdrawing..."
                            : "Withdraw"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {vaultActionMessage ? (
                    <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                      vaultActionState === "error"
                        ? "border border-rose-500/20 bg-rose-500/10 text-rose-300"
                        : "border border-[#f2ca50]/20 bg-[#f2ca50]/10 text-[#e5e2e1]"
                    }`}>
                      <p>{vaultActionMessage}</p>
                      {vaultActionExplorer ? (
                        <a
                          href={vaultActionExplorer}
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
                </div>
              )}
            </section>
            ) : null}

            {/* Agent wallet — fund execution balances */}
            {!isVaultRoute ? (
            <section className="mb-12 overflow-hidden rounded-xl border border-white/5 bg-[#1c1b1b] px-8 py-8">
              <h2 className="font-headline text-2xl font-bold text-[#e5e2e1]">Operational reserves</h2>
              <div className="mt-6 space-y-4">
                {executionSummaryError && isAuthenticated && address ? (
                  <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    <p className="font-medium">
                      {isAuthBalanceError(executionSummaryError)
                        ? "Session expired"
                        : "Balances unavailable"}
                    </p>
                    <p className="mt-1 font-mono text-xs text-rose-200/90">{executionSummaryError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (isAuthBalanceError(executionSummaryError)) {
                          void resignAndLoadExecutionSummary();
                        } else {
                          void loadExecutionSummary();
                        }
                      }}
                      className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-rose-100 transition hover:bg-rose-500/30"
                    >
                      {isAuthBalanceError(executionSummaryError) ? "Re-sign session" : "Retry"}
                    </button>
                  </div>
                ) : null}
                <PortfolioWalletActions
                  eoaAddress={address ?? ""}
                  authHeaders={address ? getAuthHeaders() : null}
                  executionSummary={executionSummary}
                  executionSummaryLoading={executionSummaryLoading}
                  executionSummaryError={executionSummaryError}
                  onAfterAction={() => {
                    void refreshAfterAgentWalletAction();
                  }}
                />
              </div>
            </section>
            ) : null}

          </div>
        </main>

      </div>
    </div>
  );
}
