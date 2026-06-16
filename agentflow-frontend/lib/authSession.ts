const STORAGE_KEY = "agentflow_frontend_session";
const SESSION_EVENT = "agentflow-auth-session-changed";

export interface AgentAuthSession {
  token: string;
  walletAddress: string;
}

export function saveAuthSession(session: AgentAuthSession): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    // Ignore browser storage failures.
  }
}

export function loadAuthSession(): AgentAuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AgentAuthSession;
    if (!parsed.token || !parsed.walletAddress) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    // Ignore browser storage failures.
  }
}

export function authSessionEventName(): string {
  return SESSION_EVENT;
}

export function authHeadersForWallet(expectedAddress: string): Record<string, string> | null {
  const session = loadAuthSession();
  if (!session || session.walletAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    return null;
  }
  return {
    Authorization: `Bearer ${session.token}`,
  };
}
