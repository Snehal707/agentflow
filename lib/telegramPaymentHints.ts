export function isLikelyGatewayOrBalanceError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('gateway') ||
    m.includes('insufficient') ||
    m.includes('balance') ||
    m.includes('too low') ||
    m.includes('funding') ||
    m.includes('settle') ||
    m.includes('402')
  );
}

export function buildGatewayLowMessage(currentBalance: number, required: number): string {
  return [
    '⚠️ Gateway balance too low for nanopayment.',
    `Required: ${required.toFixed(4)} USDC`,
    `Current: ${currentBalance.toFixed(4)} USDC`,
    '',
    'Fund your Gateway at:',
    'https://agentflow.one/funds → Gateway tab',
    '',
    'Execution will continue via your Agent Wallet instead.',
  ].join('\n');
}
