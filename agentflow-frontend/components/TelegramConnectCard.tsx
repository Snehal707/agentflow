"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

const POLL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;
const TELEGRAM_STATUS_PATHS = ["/api/telegram/status", "/api/settings/telegram/status"] as const;
const TELEGRAM_GENERATE_CODE_PATHS = ["/api/telegram/generate-code", "/api/settings/telegram/generate-code"] as const;
const TELEGRAM_UNLINK_PATHS = ["/api/telegram/unlink", "/api/settings/telegram/unlink"] as const;

type TelegramStatus = {
  linked: boolean;
  telegramId?: string;
  telegramUsername?: string;
  telegramDisplayName?: string;
  botUsername?: string;
};

async function fetchTelegramJson<T>(
  paths: readonly string[],
  init?: RequestInit,
): Promise<T> {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      const res = await fetch(`${BACKEND}${path}`, init);
      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();
      const isJson = contentType.includes("application/json");

      if (!isJson) {
        if (res.status === 404) {
          lastError = new Error(`Route not found for ${path}`);
          continue;
        }
        throw new Error("Telegram API returned HTML instead of JSON.");
      }

      const json = JSON.parse(raw) as T & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || `Telegram API request failed (${res.status})`);
      }
      return json;
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
  }

  throw lastError ?? new Error("Telegram API request failed.");
}

export function TelegramConnectCard() {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { getAuthHeaders, isAuthenticated, signIn } = useAgentJwt();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState(false);
  const pollDeadlineRef = useRef<number>(0);

  const fetchStatus = useCallback(async () => {
    const headers = getAuthHeaders();
    if (!headers) return null;
    const json = await fetchTelegramJson<TelegramStatus & { error?: string }>(TELEGRAM_STATUS_PATHS, {
      headers,
      cache: "no-store",
    });
    setStatus(json);
    setError(null);
    if (json.botUsername) {
      setBotUsername(json.botUsername.replace(/^@/, ""));
    }
    return json;
  }, [getAuthHeaders]);

  useEffect(() => {
    const pub = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim();
    if (pub) {
      setBotUsername((current) => current || pub);
    }
  }, []);

  useEffect(() => {
    if (!address || !isAuthenticated) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await fetchStatus();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, isAuthenticated, fetchStatus]);

  useEffect(() => {
    if (!modalOpen || !code) {
      return;
    }
    pollDeadlineRef.current = Date.now() + POLL_MAX_MS;
    let id: ReturnType<typeof setInterval> | undefined;

    const onLinked = () => {
      if (id != null) {
        clearInterval(id);
        id = undefined;
      }
      setModalSuccess(true);
      setTimeout(() => {
        setModalOpen(false);
        setCode(null);
        setModalSuccess(false);
      }, 1600);
    };

    const tick = async () => {
      if (Date.now() > pollDeadlineRef.current) {
        if (id != null) {
          clearInterval(id);
          id = undefined;
        }
        setError("Connection timed out after 5 minutes. Close and generate a new code.");
        return;
      }
      try {
        const next = await fetchStatus();
        if (next?.linked) {
          onLinked();
        }
      } catch {
        // ignore poll errors
      }
    };

    void tick();
    id = setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      if (id != null) {
        clearInterval(id);
      }
    };
  }, [modalOpen, code, fetchStatus]);

  const generateCode = async () => {
    setError(null);
    const headers = getAuthHeaders();
    if (!headers) {
      setError("Sign in with your wallet first.");
      return;
    }
    setLoading(true);
    try {
      const json = await fetchTelegramJson<{
        code?: string;
        botUsername?: string;
        error?: string;
      }>(TELEGRAM_GENERATE_CODE_PATHS, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      if (!json.code) {
        throw new Error(json.error || "Could not generate code");
      }
      setCode(json.code);
      setModalSuccess(false);
      if (json.botUsername) {
        setBotUsername(json.botUsername.replace(/^@/, ""));
      }
      setModalOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const unlink = async () => {
    setError(null);
    const headers = getAuthHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const json = await fetchTelegramJson<{ success?: boolean; error?: string }>(TELEGRAM_UNLINK_PATHS, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      if (!json.success) {
        throw new Error(json.error || "Unlink failed");
      }
      await fetchStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (!code || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // ignore
    }
  };

  const telegramHandle = botUsername?.replace(/^@/, "").trim() || "";
  const tMeUrl = telegramHandle ? `https://t.me/${telegramHandle}` : "";
  const telegramStartPayload = code ? encodeURIComponent(code) : "";
  const telegramAppUrl =
    telegramHandle && telegramStartPayload
      ? `tg://resolve?domain=${telegramHandle}&start=${telegramStartPayload}`
      : "";
  const telegramWebUrl =
    telegramHandle && telegramStartPayload
      ? `https://t.me/${telegramHandle}?start=${telegramStartPayload}`
      : "";

  const openTelegramApp = () => {
    if (!telegramAppUrl || typeof window === "undefined") {
      return;
    }
    window.location.href = telegramAppUrl;
  };

  const openTelegramWeb = () => {
    if (!telegramWebUrl || typeof window === "undefined") {
      return;
    }
    window.open(telegramWebUrl, "_blank", "noopener,noreferrer");
  };

  const linkedUsername = status?.telegramUsername?.replace(/^@/, "").trim() || "";
  const linkedDisplayName = status?.telegramDisplayName?.trim() || "";
  const linkedPrimaryLabel = linkedUsername
    ? `@${linkedUsername}`
    : linkedDisplayName || "Telegram linked";
  const linkedSecondaryLabel =
    linkedUsername && linkedDisplayName
      ? linkedDisplayName
      : linkedUsername
        ? "Wallet-linked Telegram account"
        : status?.telegramId
          ? "Wallet-linked Telegram chat"
          : "Wallet-linked Telegram account";

  const cardEyebrow = status?.linked ? "Linked account" : "Telegram access";

  if (!address) {
    return (
      <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="text-[10px] uppercase tracking-[0.24em] text-[#f2ca50]/70">{cardEyebrow}</div>
        <p className="mt-2 text-sm text-white/55">
          Connect your wallet first, then sign your AgentFlow session to link Telegram.
        </p>
        <button
          type="button"
          onClick={() => openConnectModal?.()}
          className="mt-3 w-full rounded-xl border border-[#2f7f67] bg-[#163228] px-4 py-3 text-sm text-white transition hover:bg-[#1b3d30]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="text-[10px] uppercase tracking-[0.24em] text-[#f2ca50]/70">{cardEyebrow}</div>
        <p className="mt-2 text-sm text-white/55">Sign a message to link Telegram.</p>
        <button
          type="button"
          onClick={() => void signIn()}
          className="mt-3 w-full rounded-xl border border-[#2f7f67] bg-[#163228] px-4 py-3 text-sm text-white transition hover:bg-[#1b3d30]"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-[10px] uppercase tracking-[0.24em] text-[#f2ca50]/70">{cardEyebrow}</div>
      {error ? <p className="mt-2 text-xs text-rose-300/90">{error}</p> : null}

      {status?.linked ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-[24px] border border-[#f2ca50]/22 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.1),transparent_38%),linear-gradient(180deg,rgba(242,202,80,0.1),rgba(242,202,80,0.04))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[#f2ca50]/24 bg-[#f2ca50]/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f2ca50]">
                    Linked
                  </span>
                </div>
                <div className="mt-4 text-[1.65rem] font-headline font-bold leading-none tracking-[-0.03em] text-white">{linkedPrimaryLabel}</div>
                <div className="mt-2 text-sm text-white/52">{linkedSecondaryLabel}</div>
              </div>
              <span className="material-symbols-outlined rounded-full border border-[#f2ca50]/18 bg-[#f2ca50]/10 p-2 text-[18px] text-[#f2ca50]">
                verified
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void unlink()}
            className="w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm font-semibold text-white/78 transition hover:border-[#f2ca50]/22 hover:text-[#f2ca50]"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-white/55">
            Link your Telegram to use swap, vault, bridge, portfolio, and chat in the bot. Until you link,
            only onboarding commands like <span className="text-white/70">/start</span> work fully, and{" "}
            <span className="text-white/70">/link</span> remains a fallback manual option.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void generateCode()}
            className="w-full rounded-xl border border-[#2f7f67] bg-[#163228] px-4 py-3 text-sm text-white transition hover:bg-[#1b3d30]"
          >
            {loading ? "Working..." : "Link Telegram Wallet"}
          </button>
        </div>
      )}

      {modalOpen && code ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#111214] p-6 shadow-xl">
            {modalSuccess ? (
              <div className="text-center">
                <div className="text-lg font-semibold text-emerald-300">Telegram connected!</div>
                <p className="mt-2 text-sm text-white/55">Your wallet is linked to this Telegram chat.</p>
              </div>
            ) : (
              <>
                <div className="text-lg font-semibold text-white">Link Telegram wallet</div>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  Open @{telegramHandle || "your_bot"} in the Telegram app or on the web to finish
                  linking this wallet. This link stays valid for about 10 minutes.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={openTelegramApp}
                    disabled={!telegramAppUrl}
                    className="min-w-[140px] rounded-xl border border-[#2f7f67] bg-[#163228] px-4 py-3 text-sm text-white transition hover:bg-[#1b3d30] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Open app
                  </button>
                  <button
                    type="button"
                    onClick={openTelegramWeb}
                    disabled={!telegramWebUrl}
                    className="min-w-[140px] rounded-xl border border-white/12 px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Open web
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      setCode(null);
                      setModalSuccess(false);
                      setError(null);
                    }}
                    className="rounded-xl border border-white/12 px-4 py-3 text-sm text-white/70 transition hover:bg-white/[0.06]"
                  >
                    Close
                  </button>
                </div>

                <p className="mt-4 text-xs leading-5 text-white/45">
                  Once Telegram confirms the link, this window will close automatically.
                </p>

                <details className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
                  <summary className="cursor-pointer list-none text-white/70">
                    Trouble opening Telegram?
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      If Telegram opens without linking, you can still paste this one-time code in
                      the bot chat.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all rounded-lg border border-white/12 bg-black/40 px-3 py-2 font-mono text-sm text-white">
                        {code}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyCode()}
                        className="rounded-xl border border-[#2f7f67] bg-[#163228] px-3 py-2 text-sm text-white transition hover:bg-[#1b3d30]"
                      >
                        Copy code
                      </button>
                    </div>
                    <p className="text-white/45">
                      Fallback only: send{" "}
                      <code className="rounded bg-white/10 px-1 text-white/80">/link {code}</code>{" "}
                      in the bot chat.
                    </p>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
