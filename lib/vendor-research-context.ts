import { assessCounterpartyRisk } from './counterparty-risk';

export async function buildVendorResearchContext(input: {
  vendor: string;
  amount: number;
  issuerWalletAddress?: string;
}): Promise<string> {
  const assessment = await assessCounterpartyRisk({
    counterparty: input.vendor,
    amountUsdc: input.amount,
    ownerWalletAddress: input.issuerWalletAddress,
    purpose: 'invoice',
  });

  return JSON.stringify(
    {
      ...assessment,
      research_guidance: [
        'Use this internal AgentFlow risk assessment as the primary result.',
        'Do not run public web search for private .arc handles, contacts, or wallet-only counterparties unless the user explicitly asks for public background research.',
        'Separate deterministic internal risk score from any optional public evidence.',
      ],
    },
    null,
    2,
  );
}
