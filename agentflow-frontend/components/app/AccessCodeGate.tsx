"use client";

import { FormEvent, useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { getBrowserBackendUrl } from "@/lib/browserApi";

type GateStage = "connect" | "sign" | "checking" | "code" | "ready";

function accessCacheKey(address: string): string {
  return `agentflow:beta-access:${address.toLowerCase()}`;
}

function loadCachedAccess(address: string | undefined): boolean {
  if (!address || typeof window === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(accessCacheKey(address)) === "ready";
  } catch {
    return false;
  }
}

function saveCachedAccess(address: string | undefined): void {
  if (!address || typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(accessCacheKey(address), "ready");
  } catch {
    // Ignore storage failures; backend status still governs access.
  }
}

function clearCachedAccess(address: string | undefined): void {
  if (!address || typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(accessCacheKey(address));
  } catch {
    // Ignore storage failures.
  }
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export function AccessCodeGate() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    getAuthHeaders,
    isAuthenticated,
    loading: authLoading,
    error: authError,
    signIn,
  } = useAgentJwt();

  const [stage, setStage] = useState<GateStage>("connect");
  const [code, setCode] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (!isConnected || !address) {
        setStage("connect");
        setGateError(null);
        return;
      }

      if (!isAuthenticated) {
        setStage("sign");
        return;
      }

      const authHeaders = getAuthHeaders();
      if (!authHeaders?.Authorization) {
        setStage("sign");
        return;
      }

      const hasCachedAccess = loadCachedAccess(address);
      setStage(hasCachedAccess ? "ready" : "checking");
      setGateError(null);

      try {
        const response = await fetch(getBrowserBackendUrl("/api/access/status"), {
          method: "GET",
          headers: authHeaders,
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          hasAccess?: boolean;
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          clearCachedAccess(address);
          setStage("code");
          setGateError(parseErrorMessage(payload, "Unable to verify access code status."));
          return;
        }

        if (payload.hasAccess) {
          saveCachedAccess(address);
          setStage("ready");
          return;
        }

        clearCachedAccess(address);
        setStage("code");
      } catch {
        if (cancelled) return;
        if (!hasCachedAccess) {
          setStage("code");
          setGateError("Unable to verify access right now. Try again in a moment.");
        }
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [address, getAuthHeaders, isAuthenticated, isConnected]);

  async function handleClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setGateError("Enter your access code to continue.");
      return;
    }

    const authHeaders = getAuthHeaders();
    if (!authHeaders?.Authorization) {
      setStage("sign");
      setGateError("Sign your session first.");
      return;
    }

    setIsSubmitting(true);
    setGateError(null);

    try {
      const response = await fetch(getBrowserBackendUrl("/api/access/claim"), {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: trimmedCode }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        hasAccess?: boolean;
        error?: string;
      };

      if (!response.ok) {
        setGateError(parseErrorMessage(payload, "Access code claim failed."));
        return;
      }

      if (payload.hasAccess) {
        saveCachedAccess(address);
        setCode(trimmedCode);
        setStage("ready");
        return;
      }

      setGateError("Access code claim did not unlock the app.");
    } catch {
      setGateError("Unable to claim code right now. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (stage === "ready") {
    return null;
  }

  const title =
    stage === "connect"
      ? "Connect To Continue"
      : stage === "sign"
        ? "Authorize Your Session"
        : stage === "checking"
          ? "Checking Access"
          : "Enter Access Code";

  const description =
    stage === "connect"
      ? "Connect your wallet to start the beta access flow and unlock the app."
      : stage === "sign"
        ? "Sign your AgentFlow session so we can verify your wallet before claiming beta access."
        : stage === "checking"
          ? "First we check whether this wallet already has access. If it does not, the manual code form appears next."
          : "This wallet does not have beta access yet. Enter your code manually to unlock AgentFlow.";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/84 px-6 py-10 backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(242,202,80,0.14),transparent_42%)]" />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-[34px] border border-[#f2ca50]/22 bg-[#0b0b0b]/96 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#f2ca50]/50 to-transparent" />

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#f2ca50]/24 bg-gradient-to-b from-[#f2ca50]/14 to-transparent text-[#f2ca50]">
          <span className="material-symbols-outlined text-[30px] leading-none">
            lock_open
          </span>
        </div>

        <div className="mt-6 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.34em] text-[#f2ca50]/78">
            Beta Access
          </p>
          <h2 className="mt-3 font-headline text-[2rem] font-black uppercase italic tracking-[0.04em] text-white">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-[420px] text-sm leading-7 text-white/58">
            {description}
          </p>
        </div>

        <div className="mt-8 grid gap-3 rounded-[24px] border border-white/8 bg-[#111111]/92 p-4 text-left text-xs text-white/54">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-[#f2ca50]" : "bg-white/15"}`} />
            <span>Connect wallet</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${isAuthenticated ? "bg-[#f2ca50]" : "bg-white/15"}`} />
            <span>Sign AgentFlow session</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${stage === "code" ? "bg-[#f2ca50]" : "bg-white/15"}`} />
            <span>Enter beta access code</span>
          </div>
        </div>

        {stage === "code" ? (
          <form onSubmit={handleClaim} className="mt-8">
            <label className="block text-left text-[11px] font-black uppercase tracking-[0.28em] text-white/42">
              Access Code
            </label>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCD1234"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              className="mt-3 w-full rounded-[22px] border border-[#f2ca50]/16 bg-[#090909] px-5 py-4 text-center font-mono text-[1.1rem] uppercase tracking-[0.38em] text-white outline-none transition focus:border-[#f2ca50]/48 focus:shadow-[0_0_0_3px_rgba(242,202,80,0.08)]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 w-full rounded-full border border-[#f2ca50]/32 bg-gradient-to-r from-[#f2ca50] to-[#e4ba40] py-3.5 text-sm font-black uppercase tracking-[0.28em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Claiming..." : "Unlock AgentFlow"}
            </button>
          </form>
        ) : null}

        {stage === "connect" ? (
          <button
            type="button"
            onClick={() => openConnectModal?.()}
            className="mt-8 w-full rounded-full border border-[#f2ca50]/32 bg-gradient-to-r from-[#f2ca50] to-[#e4ba40] py-3.5 text-sm font-black uppercase tracking-[0.28em] text-black transition hover:brightness-110"
          >
            Connect Wallet
          </button>
        ) : null}

        {stage === "sign" ? (
          <button
            type="button"
            onClick={() => {
              void signIn().catch(() => {});
            }}
            disabled={authLoading}
            className="mt-8 w-full rounded-full border border-[#f2ca50]/32 bg-gradient-to-r from-[#f2ca50] to-[#e4ba40] py-3.5 text-sm font-black uppercase tracking-[0.28em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {authLoading ? "Signing..." : "Sign Session"}
          </button>
        ) : null}

        {stage === "checking" ? (
          <>
            <div className="mt-6 rounded-[20px] border border-[#f2ca50]/14 bg-[#f2ca50]/[0.06] px-4 py-3 text-sm leading-6 text-white/72">
              Checking whether this wallet already claimed a code. If not, you will enter the code manually on the next step.
            </div>
            <div className="mt-4 flex items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-white/58">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#f2ca50]" />
              Checking wallet access...
            </div>
          </>
        ) : null}

        {gateError || authError ? (
          <div className="mt-5 rounded-[20px] border border-rose-400/18 bg-rose-400/8 px-4 py-3 text-sm leading-6 text-rose-100/88">
            {gateError || authError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
