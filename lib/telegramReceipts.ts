export function formatSwapReceipt(input: {
  amountIn: string;
  tokenIn: string;
  amountOut: string;
  tokenOut: string;
  fee: string;
  priceImpact: string;
  txHash: string;
  walletAddress: string;
}): string {
  const explorerLink = `https://testnet.arcscan.app/tx/${input.txHash}`;
  return [
    '✅ Swap complete!',
    '',
    `Sold:     ${input.amountIn} ${input.tokenIn}`,
    `Received: ${input.amountOut} ${input.tokenOut}`,
    '',
    `Fee:          ${input.fee} USDC`,
    `Price impact: ${input.priceImpact}`,
    '',
    `🔗 Tx: ${input.txHash.slice(0, 10)}...`,
    explorerLink,
  ].join('\n');
}

export async function formatVaultReceiptWithHermes(input: {
  walletAddress: string;
  action: 'deposit' | 'withdraw';
  amount: number;
  extraLines?: string[];
  txHash?: string;
  explorerBase: string;
}): Promise<string> {
  const lines = [
    `✅ ${input.action === 'deposit' ? 'Vault deposit' : 'Vault withdrawal'} complete on Arc Testnet.`,
    `Amount: ${input.amount} USDC`,
    ...(input.extraLines ?? []),
  ];

  if (input.txHash) {
    lines.push(`Tx: ${input.txHash.slice(0, 10)}…`);
    lines.push(`View: ${input.explorerBase}${input.txHash}`);
  }

  return lines.join('\n');
}

export function formatBridgeReceipt(input: {
  amount: string;
  sourceChain: string;
  destinationChain: string;
  txHash: string;
  recipientAddress: string;
}): string {
  const explorerLink = `https://testnet.arcscan.app/tx/${input.txHash}`;

  return [
    '✅ Bridge complete!',
    '',
    `From: ${formatChainName(input.sourceChain)}`,
    'To:   Arc Testnet',
    '',
    `Amount: ${input.amount} USDC`,
    `Recipient: ${input.recipientAddress}`,
    '',
    `🔗 Tx: ${input.txHash.slice(0, 10)}...`,
    explorerLink,
  ]
    .join('\n');
}

function formatChainName(chain: string): string {
  const names: Record<string, string> = {
    'ethereum-sepolia': 'Ethereum Sepolia',
    'base-sepolia': 'Base Sepolia',
    'avalanche-fuji': 'Avalanche Fuji',
  };
  const key = chain.trim().toLowerCase();
  if (names[key]) {
    return names[key];
  }
  return chain;
}
