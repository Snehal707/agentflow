export type WalletRefreshEvent = {
  source: string;
  walletAddress?: string | null;
};

const WALLET_REFRESH_EVENT = "agentflow:wallet-refresh";

export function emitWalletRefresh(detail: WalletRefreshEvent): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<WalletRefreshEvent>(WALLET_REFRESH_EVENT, { detail }));
}

export function subscribeWalletRefresh(callback: (event: WalletRefreshEvent) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event: Event) => {
    callback((event as CustomEvent<WalletRefreshEvent>).detail);
  };

  window.addEventListener(WALLET_REFRESH_EVENT, listener);
  return () => window.removeEventListener(WALLET_REFRESH_EVENT, listener);
}
