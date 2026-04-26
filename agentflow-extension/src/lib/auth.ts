import { getWebOrigin } from "./config";

const KEY_JWT = "af_jwt";
const KEY_WALLET = "af_wallet";

export interface StoredAuth {
  jwt: string;
  walletAddress: string;
}

export function getStoredAuth(): Promise<StoredAuth | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY_JWT, KEY_WALLET], (data) => {
      const jwt = data[KEY_JWT] as string | undefined;
      if (!jwt?.trim()) {
        resolve(null);
        return;
      }
      resolve({
        jwt: jwt.trim(),
        walletAddress: String(data[KEY_WALLET] ?? "").trim(),
      });
    });
  });
}

export function saveAuth(jwt: string, walletAddress: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(
      {
        [KEY_JWT]: jwt.trim(),
        [KEY_WALLET]: walletAddress.trim(),
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      },
    );
  });
}

export function clearAuth(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([KEY_JWT, KEY_WALLET], () => resolve());
  });
}

/** Decode JWT payload (no signature verification — server is authoritative). */
export function decodeJwtPayload(token: string): {
  walletAddress?: string;
  accessModel?: string;
  exp?: number;
} | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as {
      walletAddress?: string;
      accessModel?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
}

export function openFundsPage(): void {
  chrome.tabs.create({ url: `${getWebOrigin()}/funds` });
}

export function openAccountOrSignIn(): void {
  chrome.tabs.create({ url: `${getWebOrigin()}/dashboard` });
}
