import { useCallback, useEffect, useState } from "react";
import "./App.css";
import type { FundPlanRow } from "../lib/api";
import {
  clearAuth,
  decodeJwtPayload,
  getStoredAuth,
  openAccountOrSignIn,
  openFundsPage,
  saveAuth,
} from "../lib/auth";

type SummaryState = {
  wallet?: string;
  balanceSnippet?: string;
  totalPlans: number;
  activePlans: number;
};

export function App() {
  const [jwt, setJwt] = useState("");
  const [wallet, setWallet] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [question, setQuestion] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [usage, setUsage] = useState<string>("— / 10");
  const [lastSent, setLastSent] = useState<{
    url: string;
    question: string;
    wallet: string;
  } | null>(null);

  const loadAuth = useCallback(async () => {
    const s = await getStoredAuth();
    if (s) {
      setJwt(s.jwt);
      setWallet(s.walletAddress);
    }
  }, []);

  const refreshSummary = useCallback(() => {
    chrome.runtime.sendMessage({ type: "getSummary" }, (res) => {
      if (chrome.runtime.lastError) {
        setSummary(null);
        return;
      }
      const r = res as {
        ok?: boolean;
        balance?: unknown;
        plans?: FundPlanRow[] | null;
        error?: string;
      };
      if (!r?.ok) {
        setSummary(null);
        return;
      }
      const plans = Array.isArray(r.plans) ? r.plans : [];
      const activePlans = plans.filter(
        (p) => String(p.status ?? "").toLowerCase() === "active",
      ).length;
      const bal = r.balance as
        | {
            walletAddress?: string;
            userAgentWalletAddress?: string;
            holdings?: unknown;
          }
        | undefined;
      setSummary({
        totalPlans: plans.length,
        activePlans,
        wallet: bal?.walletAddress,
        balanceSnippet: bal?.holdings
          ? JSON.stringify(bal.holdings).slice(0, 120) + "…"
          : undefined,
      });
    });
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (!jwt) {
      setSummary(null);
      return;
    }
    const payload = decodeJwtPayload(jwt);
    if (payload?.accessModel) {
      setUsage((u) =>
        u.startsWith("—") ? `access: ${payload.accessModel}` : u,
      );
    }
    refreshSummary();
  }, [jwt, refreshSummary]);

  const handleSaveAuth = async () => {
    setSaveMsg(null);
    setErr(null);
    try {
      const payload = decodeJwtPayload(jwt.trim());
      const addr =
        wallet.trim() || (payload?.walletAddress ?? "");
      if (!jwt.trim()) {
        setSaveMsg("Paste JWT first.");
        return;
      }
      await saveAuth(jwt.trim(), addr);
      setSaveMsg("Saved.");
      refreshSummary();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSignOut = async () => {
    await clearAuth();
    setJwt("");
    setWallet("");
    setSummary(null);
    setSaveMsg("Cleared.");
  };

  const analyze = async () => {
    setErr(null);
    setOutput("");
    const q = question.trim();
    if (!q) {
      setErr("Enter a question.");
      return;
    }
    if (!jwt.trim()) {
      setErr("Save your JWT in Settings first.");
      return;
    }
    const payload = decodeJwtPayload(jwt.trim());

    try {
      await saveAuth(
        jwt.trim(),
        wallet.trim() || payload?.walletAddress || "",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabUrl = tab?.url ?? "";
    if (!tabUrl || !/^https?:\/\//i.test(tabUrl)) {
      setErr("Open a normal http(s) page, then try again.");
      return;
    }
    if (tabUrl.startsWith("chrome-extension://")) {
      setErr("This page URL cannot be used.");
      return;
    }

    const displayWallet =
      wallet.trim() || payload?.walletAddress || "—";
    setLastSent({
      url: tabUrl,
      question: q,
      wallet: displayWallet,
    });

    setRunning(true);
    const port = chrome.runtime.connect({ name: "af-analyze" });
    let buffer = "";

    port.onMessage.addListener(
      (msg: { type?: string; delta?: string; error?: string }) => {
        if (msg.type === "delta" && typeof msg.delta === "string") {
          buffer += msg.delta;
          setOutput(buffer);
        }
        if (msg.type === "done") {
          port.disconnect();
          setRunning(false);
        }
        if (msg.type === "error") {
          setErr(msg.error ?? "Error");
          const m = msg.error?.match(/\((\d+)\s*\/\s*(\d+)\)/);
          if (m) setUsage(`${m[1]} / ${m[2]}`);
          port.disconnect();
          setRunning(false);
        }
      },
    );

    port.onDisconnect.addListener(() => {
      setRunning(false);
    });

    port.postMessage({ type: "analyze", url: tabUrl, question: q });
  };

  const accessHint = jwt.trim()
    ? decodeJwtPayload(jwt.trim())?.accessModel
    : undefined;

  const plansLabel =
    summary != null
      ? `${summary.activePlans} active / ${summary.totalPlans} plans`
      : accessHint ?? "—";

  return (
    <>
      <h1>AgentFlow Research</h1>

      <div className="card">
        <div className="row">
          <span className="muted">Wallet / fund plans</span>
          <span>
            {plansLabel}
            {summary?.wallet ? (
              <span className="muted">
                {" "}
                · {summary.wallet.slice(0, 6)}…
              </span>
            ) : null}
          </span>
        </div>
        {summary?.balanceSnippet ? (
          <p className="muted" style={{ marginTop: 6 }}>
            Holdings: {summary.balanceSnippet}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            Connect JWT below to load balances.
          </p>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Extension usage (estimate)</span>
          <span>{usage}</span>
        </div>
      </div>

      <div className="card">
        <strong className="muted">Settings</strong>
        <label>
          JWT (Bearer from AgentFlow sign-in)
          <textarea
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJ..."
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Wallet address (display; optional if JWT contains it)
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x..."
          />
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="primary" onClick={handleSaveAuth}>
            Save
          </button>
          <button type="button" onClick={handleSignOut}>
            Clear
          </button>
          <button type="button" onClick={() => openAccountOrSignIn()}>
            Get JWT
          </button>
        </div>
        {saveMsg ? (
          <p className={saveMsg.includes("Saved") ? "success" : "error"}>
            {saveMsg}
          </p>
        ) : null}
      </div>

      <div className="card">
        <label>
          Question
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we analyze about this page?"
          />
        </label>
        <button
          type="button"
          className="primary"
          style={{ marginTop: 8, width: "100%" }}
          disabled={running}
          onClick={() => analyze().catch((e) => setErr(String(e)))}
        >
          {running ? "Analyzing…" : "Analyze current tab URL"}
        </button>
        {err ? <p className="error">{err}</p> : null}
        {output ? <pre className="out">{output}</pre> : null}
      </div>

      <div className="card">
        <strong className="muted">Transparency</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Sent to AgentFlow (this request):
        </p>
        <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 11 }}>
          <li>
            <span className="check">✓</span> URL{" "}
            {lastSent ? (
              <code>{lastSent.url.slice(0, 64)}…</code>
            ) : (
              <span className="muted">(after Analyze)</span>
            )}
          </li>
          <li>
            <span className="check">✓</span> Question{" "}
            {lastSent ? (
              <span>{lastSent.question.slice(0, 80)}…</span>
            ) : (
              <span className="muted">(after Analyze)</span>
            )}
          </li>
          <li>
            <span className="check">✓</span> Authorization header (JWT) — body is
            only <code>url</code> + <code>question</code>. Wallet shown here is
            for display; it matches your session from the JWT.
            {lastSent?.wallet ? (
              <> Display: {lastSent.wallet.slice(0, 12)}…</>
            ) : null}
          </li>
        </ul>
        <p className="muted">Never sent from this extension:</p>
        <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 11 }}>
          <li>
            <span className="cross">✗</span> Page HTML / DOM content
          </li>
          <li>
            <span className="cross">✗</span> Private keys
          </li>
          <li>
            <span className="cross">✗</span> Other tabs
          </li>
        </ul>
        <p className="muted" style={{ marginTop: 8 }}>
          The AgentFlow server may fetch public content from the URL server-side
          (e.g. Firecrawl) — not from your browser DOM.
        </p>
      </div>

      {jwt ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Analyze uses pay-per-task limits (server-enforced). Manage automated
          allocations on the web:{" "}
          <button type="button" onClick={() => openFundsPage()}>
            Open /funds
          </button>
        </p>
      ) : null}
    </>
  );
}
