import { getBackendUrl } from "./config";

function authHeaders(jwt: string): HeadersInit {
  return {
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };
}

export async function getWalletBalance(jwt: string): Promise<unknown> {
  const res = await fetch(`${getBackendUrl()}/api/wallet/balance`, {
    headers: authHeaders(jwt),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

/** Row shape from `GET /api/funds/plans` (see api/funds.ts listFundPlans). */
export type FundPlanRow = {
  id: string;
  status?: string;
  amount?: number;
  fundId?: string;
  userWallet?: string;
  fund?: { name?: string } | null;
};

export async function listFundPlans(jwt: string): Promise<FundPlanRow[]> {
  const res = await fetch(`${getBackendUrl()}/api/funds/plans`, {
    headers: authHeaders(jwt),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("GET /api/funds/plans: expected JSON array");
  }
  return data as FundPlanRow[];
}

/**
 * POST /api/extension/analyze — SSE (`data: { "delta": "..." }` lines, then `data: [DONE]`).
 */
export async function streamExtensionAnalyze(
  jwt: string,
  url: string,
  question: string,
  handlers: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/api/extension/analyze`, {
    method: "POST",
    headers: authHeaders(jwt),
    body: JSON.stringify({ url, question }),
  });

  const ct = res.headers.get("content-type") || "";

  if (res.status === 401 || res.status === 403) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    handlers.onError(j.error || "Unauthorized or access denied");
    return;
  }

  if (res.status === 429) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      dailyUsed?: number;
      dailyLimit?: number;
    };
    const detail = `${j.dailyUsed ?? "?"}/${j.dailyLimit ?? "?"}`;
    handlers.onError(
      j.error ? `${j.error} (${detail})` : `Rate limited (${detail})`,
    );
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    handlers.onError(text || `HTTP ${res.status}`);
    return;
  }

  if (!res.body || !ct.includes("text/event-stream")) {
    const text = await res.text();
    handlers.onError(text || "Unexpected response (not SSE)");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (processSseLine(line, handlers)) {
          sawDone = true;
        }
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (processSseLine(line, handlers)) {
          sawDone = true;
        }
      }
    }
    if (!sawDone) {
      handlers.onDone();
    }
  } catch (e) {
    handlers.onError(e instanceof Error ? e.message : String(e));
  }
}

/** @returns true if [DONE] was seen */
function processSseLine(
  line: string,
  handlers: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return false;
  const payload = trimmed.slice(5).trim();
  if (!payload) return false;
  if (payload === "[DONE]") {
    handlers.onDone();
    return true;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const err = (parsed as { error?: string }).error;
      if (err) {
        handlers.onError(err);
      }
      return false;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "delta" in parsed &&
      typeof (parsed as { delta?: unknown }).delta === "string"
    ) {
      handlers.onDelta((parsed as { delta: string }).delta);
    }
  } catch {
    // ignore malformed lines
  }
  return false;
}
