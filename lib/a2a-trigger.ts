import { insertAgentToAgentLedger, type AgentToAgentLedgerInput } from './a2a-ledger';

export function shouldTriggerResearch(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.split(/\s+/).length < 10) return false;

  const researchSignals = [
    /what is|how does|why does|explain|tell me about/i,
    /protocol|blockchain|defi|crypto|token|nft|dao|yield|apy|tvl/i,
    /bitcoin|ethereum|arc|circle|usdc|solana|polygon/i,
    /research|analyze|analysis|report|summary|overview/i,
    /price|market|trading|investment|portfolio/i,
    /algorithm|architecture|implementation|infrastructure/i,
    /company|startup|founder|funding|revenue/i,
  ];

  return researchSignals.some((p) => p.test(trimmed));
}

/** Map executeTool name or agent slug to portfolio follow-up buyer slug. */
export function portfolioBuyerSlugFromTool(tool: string): 'swap' | 'vault' | 'bridge' | 'batch' | 'split' | null {
  if (tool === 'swap_tokens') return 'swap';
  if (tool === 'vault_action') return 'vault';
  if (tool === 'bridge_usdc') return 'bridge';
  if (tool === 'batch' || tool === 'batch_pay') return 'batch';
  if (tool === 'split' || tool === 'split_pay') return 'split';
  return null;
}

export function extractResearchQuery(
  content: string,
  sourceType: 'vision' | 'transcribe' | 'invoice',
): string {
  const prefixes: Record<typeof sourceType, string> = {
    vision: 'Research and analyze the following from an image: ',
    transcribe: 'Research the key topics mentioned: ',
    invoice: 'Verify vendor reputation and background: ',
  };
  const slice = content.slice(0, 500);
  return `${prefixes[sourceType]}${slice}`;
}

export async function logA2APayment(
  input: Omit<AgentToAgentLedgerInput, 'context'> & { context?: string },
): Promise<void> {
  const ledger = await insertAgentToAgentLedger({
    ...input,
    context: input.context ?? 'a2a ledger',
  });
  if (!ledger.ok) {
    console.warn('[a2a] logA2APayment ledger insert failed:', ledger.error);
  }
}
