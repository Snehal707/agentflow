"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { buildAuthMessage } from "@/lib/authMessage";
import {
  authHeadersForWallet,
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
  type AgentAuthSession,
} from "@/lib/authSession";

async function refreshSavedSession(existing: AgentAuthSession): Promise<AgentAuthSession> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${existing.token}`,
    },
    body: JSON.stringify({ token: existing.token }),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as {
    token?: string;
    walletAddress?: string;
    error?: string;
  };

  if (!response.ok || !json.token || !json.walletAddress) {
    throw new Error(json.error || "Session expired. Please sign again.");
  }

  return {
    token: json.token,
    walletAddress: json.walletAddress,
  };
}

export function useAgentJwt() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<AgentAuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setSession(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const existing = loadAuthSession();
    if (!existing || existing.walletAddress.toLowerCase() !== address.toLowerCase()) {
      clearAuthSession();
      setSession(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setSession(existing);
    setLoading(true);
    setError(null);
    refreshSavedSession(existing)
      .then((validated) => {
        if (cancelled) return;
        saveAuthSession(validated);
        setSession(validated);
      })
      .catch((cause) => {
        if (cancelled) return;
        clearAuthSession();
        setSession(null);
        setError(cause instanceof Error ? cause.message : "Session expired. Please sign again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  const signIn = useCallback(async () => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    setLoading(true);
    setError(null);
    try {
      const message = buildAuthMessage(address);
      const signature = await signMessageAsync({ message });
      const response = await fetch("/api/auth/verify-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          message,
          signature,
        }),
        cache: "no-store",
      });

      const json = (await response.json()) as {
        token?: string;
        walletAddress?: string;
        error?: string;
      };

      if (!response.ok || !json.token) {
        throw new Error(json.error || "Auth failed");
      }

      const nextSession: AgentAuthSession = {
        token: json.token,
        walletAddress: json.walletAddress ?? address,
      };
      saveAuthSession(nextSession);
      setSession(nextSession);
      return nextSession;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      clearAuthSession();
      setSession(null);
      setError(message);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    clearAuthSession();
    setSession(null);
    setError(null);
  }, []);

  const getAuthHeaders = useCallback(() => {
    if (!address || !session || session.walletAddress.toLowerCase() !== address.toLowerCase()) {
      return null;
    }
    return authHeadersForWallet(address);
  }, [address, session]);

  return {
    session,
    loading,
    error,
    signIn,
    signOut,
    getAuthHeaders,
    isAuthenticated: Boolean(
      session && address && session.walletAddress.toLowerCase() === address.toLowerCase(),
    ),
  };
}
