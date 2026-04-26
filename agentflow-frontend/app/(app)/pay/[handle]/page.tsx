"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getAddress, isAddress, parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_USDC_ADDRESS } from "@/lib/arcChain";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

type LivePaymentProfile = {
  handle: string;
  walletAddress: string;
  business: {
    business_name?: string | null;
    invoice_email?: string | null;
  } | null;
};

type PayStatus =
  | "idle"
  | "resolving"
  | "submitting"
  | "confirming"
  | "recording"
  | "success"
  | "error";

type PayMode = "agentflow" | "external";

const USDC_TRANSFER_ABI = [
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

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function stripArcSuffix(name: string): string {
  return String(name ?? "").trim().replace(/\.arc$/i, "");
}

export default function PayHandlePage({ params }: { params: { handle: string } }) {
  const searchParams = useSearchParams();
  const bareHandle = useMemo(() => stripArcSuffix(params.handle).toLowerCase(), [params.handle]);
  const displayHandle = bareHandle ? `${bareHandle}.arc` : params.handle;

  const initialAmount = searchParams.get("amount")?.trim() ?? "";
  const initialPurpose =
    searchParams.get("remark")?.trim() ?? searchParams.get("note")?.trim() ?? "";

  const [recipient, setRecipient] = useState<string>("");
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [amount, setAmount] = useState(initialAmount);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [status, setStatus] = useState<PayStatus>("resolving");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");

  const [mode, setMode] = useState<PayMode>("external");
  const [modeManuallySet, setModeManuallySet] = useState(false);
  const [signInError, setSignInError] = useState<string>("");

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated: hasAgentFlowSession,
    loading: signingIn,
    signIn,
    getAuthHeaders,
  } = useAgentJwt();

  // Auto-pick mode once on connect: prefer AgentFlow if already authed,
  // otherwise default to External. User can still switch manually.
  useEffect(() => {
    if (!isConnected || !address) {
      if (!modeManuallySet) setMode("external");
      return;
    }
    if (!modeManuallySet) {
      setMode(hasAgentFlowSession ? "agentflow" : "external");
    }
  }, [address, isConnected, modeManuallySet, hasAgentFlowSession]);

  useEffect(() => {
    let active = true;
    setStatus("resolving");
    setProfileNotFound(false);
    setProfileError(null);

    void fetch(`/api/pay/${encodeURIComponent(bareHandle)}`, { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as
          | (LivePaymentProfile & { error?: string })
          | { error?: string };
        if (response.status === 404) {
          if (!active) return null;
          setProfileNotFound(true);
          setStatus("idle");
          return null;
        }
        if (!response.ok) {
          throw new Error(("error" in json && json.error) || "Payment profile load failed");
        }
        return json as LivePaymentProfile;
      })
      .then((liveProfile) => {
        if (!active || !liveProfile) return;
        const addr = String(liveProfile.walletAddress ?? "").trim();
        if (addr && isAddress(addr)) {
          setRecipient(getAddress(addr));
          setStatus("idle");
        } else {
          setProfileNotFound(true);
          setStatus("idle");
        }
      })
      .catch((error) => {
        if (!active) return;
        setProfileError(error instanceof Error ? error.message : "Payment profile load failed");
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [bareHandle]);

  const amountNumber = Number(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const onArc = chainId === ARC_CHAIN_ID;

  const busy = status === "submitting" || status === "confirming" || status === "recording";
  const canSend = isConnected && amountValid && !!recipient && !busy;

  const pickMode = (next: PayMode) => {
    setMode(next);
    setModeManuallySet(true);
    setErrorMessage("");
    if (status === "error") setStatus("idle");
  };

  const handlePayExternal = async () => {
    if (!walletClient || !publicClient || !address) {
      throw new Error("Wallet client not ready. Try reconnecting your wallet.");
    }
    if (!onArc) {
      try {
        await switchChain({ chainId: ARC_CHAIN_ID });
      } catch {
        throw new Error("Please switch your wallet to Arc Testnet to continue.");
      }
      return;
    }

    setStatus("submitting");
    const hash = await walletClient.writeContract({
      account: getAddress(address),
      address: ARC_USDC_ADDRESS,
      abi: USDC_TRANSFER_ABI,
      functionName: "transfer",
      args: [getAddress(recipient), parseUnits(amountNumber.toFixed(6), 6)],
    });

    setTxHash(hash);
    setStatus("confirming");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("Transaction reverted on Arc.");
    }

    // Record the external transfer in the recipient's AgentPay history.
    // Ledger insert is best-effort — the on-chain transfer has already
    // succeeded, so we surface any failure as a non-blocking notice.
    setStatus("recording");
    try {
      const recordRes = await fetch("/api/pay/record-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: hash,
          fromAddress: getAddress(address),
          toAddress: getAddress(recipient),
          amountUsdc: amountNumber,
          remark: purpose.trim() || null,
          handle: displayHandle,
        }),
      });
      if (!recordRes.ok) {
        const body = (await recordRes.json().catch(() => ({}))) as { error?: string };
        console.warn("[pay/external] record-external failed:", body.error || recordRes.statusText);
      }
    } catch (err) {
      console.warn("[pay/external] record-external threw:", err);
    }

    setStatus("success");
  };

  const handlePayAgentFlow = async () => {
    if (!address) throw new Error("Connect a wallet first.");
    const headers = getAuthHeaders();
    if (!headers) {
      throw new Error(
        "You need to sign in to AgentFlow with this wallet first. Click 'Sign in to AgentFlow' above.",
      );
    }

    setStatus("submitting");
    const response = await fetch("/api/pay/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        toAddress: recipient,
        amount: amountNumber,
        remark: purpose.trim() ? purpose.trim().slice(0, 100) : undefined,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      txHash?: string;
      explorerLink?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || "Payment failed");
    }
    if (result.txHash) setTxHash(result.txHash);
    setStatus("success");
  };

  const handlePay = async () => {
    setErrorMessage("");
    setTxHash("");

    try {
      if (!isConnected || !address) {
        openConnectModal?.();
        return;
      }
      if (!recipient || !isAddress(recipient)) {
        throw new Error("Recipient wallet not resolved.");
      }
      if (!amountValid) {
        throw new Error("Enter a valid USDC amount.");
      }
      if (mode === "agentflow") {
        await handlePayAgentFlow();
      } else {
        await handlePayExternal();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Payment failed";
      setErrorMessage(
        msg.includes("User rejected") || msg.includes("user rejected")
          ? "Transaction rejected in your wallet."
          : msg,
      );
      setStatus("error");
    }
  };

  // Not-found state
  if (profileNotFound) {
    return (
      <div className="app-shell">
        <div className="dashboard-frame">
          <main className="mx-auto max-w-xl pt-16 text-center">
            <div className="surface-card rounded-[36px] p-10">
              <div className="text-5xl">🔍</div>
              <h1 className="section-title mt-4">{displayHandle} not found</h1>
              <p className="mt-3 text-sm text-white/60">
                This .arc name is not registered on the AgentPay registry on Arc Testnet.
              </p>
              <a
                href="/pay"
                className="mt-6 inline-block text-sm text-cyan-300 hover:underline"
              >
                Get your own .arc name →
              </a>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const payButtonLabel = (() => {
    if (status === "submitting") return "Confirm in wallet...";
    if (status === "confirming") return "Waiting for Arc confirmation...";
    if (status === "recording") return "Updating history...";
    if (status === "success") return "Pay again";
    if (!onArc && mode === "external" && isConnected) return "Switch to Arc Testnet";
    const amt = amountValid ? amountNumber.toFixed(2) : "0.00";
    return `Send ${amt} USDC`;
  })();

  return (
    <div className="app-shell">
      <div className="dashboard-frame">
        <main className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="surface-card rounded-[36px] p-7 sm:p-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/8 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[#f2ca50]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#f2ca50]" />
                  Public payment page
                </div>
                <h1 className="section-title mt-3">
                  Pay <span className="gold-gradient-text">{displayHandle}</span>
                </h1>
              </div>
              <ConnectButton
                chainStatus="icon"
                accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
                showBalance={false}
              />
            </div>

            <p className="mt-3 max-w-xl text-base leading-7 text-white/62">
              Send USDC to {displayHandle} on Arc Testnet. Signed into AgentFlow? We route
              through your agent wallet. Otherwise, any wallet works — no account needed.
            </p>

            {profileError ? (
              <div className="mt-4 rounded-2xl border border-[#ff716c]/20 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                {profileError}
              </div>
            ) : null}

            <div className="mt-8 rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="text-[11px] uppercase tracking-[0.26em] text-white/42">
                Paying to
              </div>
              <div className="mt-3 font-display text-4xl gold-gradient-text">{displayHandle}</div>
              <div className="mt-3 font-mono text-xs text-white/50 break-all">
                {status === "resolving"
                  ? "Resolving on-chain..."
                  : recipient || "Not resolved"}
              </div>
            </div>

            {/* --- Mode picker ------------------------------------------- */}
            <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.26em] text-white/42">
                  Pay from
                </div>
                {hasAgentFlowSession ? (
                  <span className="rounded-full border border-[#f2ca50]/30 bg-[#f2ca50]/10 px-3 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[#f2ca50]">
                    AgentFlow detected
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => pickMode("agentflow")}
                  disabled={busy}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition disabled:opacity-60 ${
                    mode === "agentflow"
                      ? "border-[#f2ca50]/55 bg-[#f2ca50]/10 text-white shadow-[0_0_0_1px_rgba(242,202,80,0.25)_inset]"
                      : "border-white/10 bg-transparent text-white/70 hover:border-white/30"
                  }`}
                >
                  <div className="font-semibold">AgentFlow wallet</div>
                  <div className="mt-1 text-[11px] leading-5 text-white/55">
                    Pay from your AgentFlow agent wallet. Shows up in both histories.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => pickMode("external")}
                  disabled={busy}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition disabled:opacity-60 ${
                    mode === "external"
                      ? "border-[#f2ca50]/55 bg-[#f2ca50]/10 text-white shadow-[0_0_0_1px_rgba(242,202,80,0.25)_inset]"
                      : "border-white/10 bg-transparent text-white/70 hover:border-white/30"
                  }`}
                >
                  <div className="font-semibold">External wallet</div>
                  <div className="mt-1 text-[11px] leading-5 text-white/55">
                    Pay directly from any connected wallet. No AgentFlow account needed.
                  </div>
                </button>
              </div>

              {mode === "agentflow" && isConnected && !hasAgentFlowSession ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-[#f2ca50]/22 bg-[#f2ca50]/5 p-4">
                  <div className="text-xs leading-6 text-[#f2e9c5]/90">
                    Sign a one-time message to link this wallet to your AgentFlow session.
                    This routes the payment through your agent wallet and logs it in both
                    histories. No gas, no transaction.
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setSignInError("");
                      try {
                        await signIn();
                      } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        setSignInError(
                          msg.includes("User rejected") || msg.includes("user rejected")
                            ? "Signature cancelled in your wallet."
                            : msg,
                        );
                      }
                    }}
                    disabled={signingIn}
                    className="burnished-gold btn-hover-effect w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-[#1a1200] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {signingIn ? "Waiting for signature..." : "Sign in to AgentFlow"}
                  </button>
                  {signInError ? (
                    <div className="text-xs text-[#ffa8a3]">{signInError}</div>
                  ) : null}
                  <div className="text-[11px] leading-5 text-white/45">
                    Or{" "}
                    <button
                      type="button"
                      onClick={() => pickMode("external")}
                      className="underline"
                    >
                      pay from your external wallet
                    </button>{" "}
                    instead — no AgentFlow sign-in needed.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5">
              <label className="text-[11px] uppercase tracking-[0.26em] text-white/42">
                Amount (USDC)
              </label>
              <div className="mt-3 flex items-center rounded-[24px] border border-white/10 bg-slate-950/70 px-4">
                <span className="text-lg text-white/42">$</span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full bg-transparent px-3 py-4 text-2xl text-white outline-none"
                />
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5">
              <label className="text-[11px] uppercase tracking-[0.26em] text-white/42">
                Note / reference (optional)
              </label>
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                rows={2}
                placeholder="Invoice 1048, coffee, donation, retainer..."
                maxLength={140}
                className="mt-3 w-full resize-none rounded-[24px] border border-white/10 bg-slate-950/70 px-4 py-4 text-base text-white outline-none transition focus:border-[#f2ca50]/45"
              />
              <p className="mt-2 text-xs text-white/45">
                Saved with the transfer so both sides can identify it later.
              </p>
            </div>

            {status === "success" && txHash ? (
              <div className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5 text-sm text-emerald-100">
                <div className="font-semibold">Payment sent.</div>
                <div className="mt-1 text-xs text-emerald-100/80">
                  {amount} USDC sent to {displayHandle}
                  {purpose ? ` — "${purpose}"` : ""}.
                </div>
                <a
                  href={`${ARC_EXPLORER_URL}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block break-all text-xs text-[#f2ca50] hover:underline"
                >
                  View on Arcscan ↗ ({shortAddr(txHash)})
                </a>
                <div className="mt-2 text-[11px] text-emerald-100/60">
                  {mode === "agentflow"
                    ? "Logged in your AgentFlow history and the recipient's."
                    : "Logged in the recipient's AgentFlow history."}
                </div>
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mt-6 rounded-2xl border border-[#ff716c]/30 bg-[#9f0519]/10 px-4 py-3 text-sm text-[#ffa8a3]">
                {errorMessage}
              </div>
            ) : null}

            <div className="mt-6">
              {!isConnected ? (
                <div className="flex flex-col items-stretch gap-3">
                  <ConnectButton.Custom>
                    {({ openConnectModal: openModal }) => (
                      <button
                        type="button"
                        onClick={openModal}
                        className="burnished-gold btn-hover-effect w-full rounded-2xl px-4 py-4 text-base font-semibold text-[#1a1200]"
                      >
                        Connect wallet to pay
                      </button>
                    )}
                  </ConnectButton.Custom>
                  <p className="text-center text-xs text-white/50">
                    MetaMask, Rainbow, Coinbase, WalletConnect — any wallet on Arc Testnet works.
                  </p>
                </div>
              ) : mode === "external" && !onArc ? (
                <button
                  type="button"
                  onClick={() => {
                    void switchChain({ chainId: ARC_CHAIN_ID });
                  }}
                  className="burnished-gold btn-hover-effect w-full rounded-2xl px-4 py-4 text-base font-semibold text-[#1a1200]"
                >
                  Switch to Arc Testnet
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handlePay()}
                  disabled={!canSend || (mode === "agentflow" && !hasAgentFlowSession)}
                  className="burnished-gold btn-hover-effect w-full rounded-2xl px-4 py-4 text-base font-semibold text-[#1a1200] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {payButtonLabel}
                </button>
              )}
              {isConnected && address ? (
                <p className="mt-3 text-center text-xs text-white/45">
                  {mode === "agentflow"
                    ? `Paying via AgentFlow (connected as ${shortAddr(address)})`
                    : `Paying from ${shortAddr(address)} on Arc Testnet`}
                </p>
              ) : null}
            </div>
          </section>

          {/* Right column — sticky on desktop so "How this works" is always in view */}
          <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
            <section className="surface-card rounded-[36px] p-7 sm:p-8">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[#f2ca50]" />
                <div className="eyebrow">How this works</div>
              </div>

              <ol className="mt-5 space-y-5 text-sm leading-6 text-white/70">
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#f2ca50]/40 bg-[#f2ca50]/10 text-[11px] font-semibold text-[#f2ca50]">
                    1
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-white">
                      AgentFlow wallet{" "}
                      <span className="ml-1 rounded-full bg-[#f2ca50]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#f2ca50]">
                        recommended
                      </span>
                    </div>
                    <div className="mt-1 text-white/58">
                      Signed into AgentFlow with this wallet? We route through your agent wallet
                      (DCW). Logged in <em>both</em> your and {displayHandle}&apos;s AgentPay
                      history, with a Telegram ping if enabled.
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[11px] font-semibold text-white/80">
                    2
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-white">External wallet</div>
                    <div className="mt-1 text-white/58">
                      No AgentFlow account? Connect any wallet (MetaMask, Rainbow, Coinbase,
                      WalletConnect) and pay with USDC on Arc Testnet. After confirmation we
                      record it in {displayHandle}&apos;s history automatically.
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[11px] font-semibold text-white/80">
                    3
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-white">Stay on Arc Testnet</div>
                    <div className="mt-1 text-white/58">
                      USDC here is the Arc Testnet ERC-20. If your wallet is on another chain
                      we&apos;ll prompt you to switch before sending.
                    </div>
                  </div>
                </li>
              </ol>
            </section>

            {/* Trust / brand panel — uses the dApp's signature gold accent */}
            <section className="cinematic-card rounded-[36px] p-7 sm:p-8">
              <div>
                <div className="eyebrow">Powered by</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  <span className="gold-gradient-text">Agent</span>
                  <span className="text-white">Flow</span>
                </div>
              </div>
              <ul className="mt-5 list-disc space-y-3 pl-5 text-[13px] leading-6 text-white/62 marker:text-[#f2ca50]">
                <li>
                  Settlement on Arc Testnet in under 2 seconds, directly to{" "}
                  {displayHandle}&apos;s wallet.
                </li>
                <li>
                  No intermediary custody. You sign, the chain confirms, both sides see it.
                </li>
                <li>
                  Receipt stored in both histories — open{" "}
                  <a
                    href="/pay"
                    className="text-[#f2ca50] underline-offset-2 hover:underline"
                  >
                    AgentPay
                  </a>{" "}
                  any time.
                </li>
              </ul>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
