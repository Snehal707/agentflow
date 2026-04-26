export function buildAuthMessage(walletAddress: string): string {
  const timestamp = Date.now();
  return `AgentFlow V3\nSign in to AgentFlow\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;
}
