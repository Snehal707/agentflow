import '../lib/loadEnv';
import { getAddress, isAddress } from 'viem';
import { adminDb } from '../db/client';
import { executeUsdcTransfer } from '../lib/agentpay-transfer';

const FUND_SPECS = [
  { slug: 'research', amountUsdc: 10 },
  { slug: 'analyst', amountUsdc: 10 },
  { slug: 'writer', amountUsdc: 5 },
  { slug: 'swap', amountUsdc: 5 },
  { slug: 'vault', amountUsdc: 5 },
  { slug: 'bridge', amountUsdc: 5 },
  { slug: 'portfolio', amountUsdc: 5 },
  { slug: 'vision', amountUsdc: 3 },
  { slug: 'transcribe', amountUsdc: 3 },
  { slug: 'invoice', amountUsdc: 5 },
  { slug: 'batch', amountUsdc: 3 },
  { slug: 'split', amountUsdc: 3 },
] as const;

async function main(): Promise<void> {
  const fundingEoa = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!fundingEoa || !isAddress(fundingEoa)) {
    console.error('[fund-agent-wallets] Set TEST_WALLET_ADDRESS to a valid funding EOA.');
    process.exit(1);
  }
  const payerEoa = getAddress(fundingEoa);

  const { data: userAgentRow, error: uaErr } = await adminDb
    .from('wallets')
    .select('wallet_id, address')
    .eq('purpose', 'user_agent')
    .eq('user_wallet', payerEoa)
    .maybeSingle();

  if (uaErr || !userAgentRow?.wallet_id) {
    console.error(
      '[fund-agent-wallets] No user_agent DCW row for TEST_WALLET_ADDRESS. Complete wallet setup first.',
      uaErr?.message ?? '',
    );
    process.exit(1);
  }

  for (const spec of FUND_SPECS) {
    const { data: ownerRow, error: ownerErr } = await adminDb
      .from('wallets')
      .select('address')
      .eq('purpose', 'owner')
      .eq('agent_slug', spec.slug)
      .maybeSingle();

    if (ownerErr || !ownerRow?.address) {
      console.warn(`[fund-agent-wallets] No owner wallet for ${spec.slug}, skipping.`, ownerErr?.message ?? '');
      continue;
    }

    try {
      const { txHash } = await executeUsdcTransfer({
        payerEoa,
        toAddress: getAddress(ownerRow.address as `0x${string}`),
        amountUsdc: spec.amountUsdc,
        remark: `Fund ${spec.slug} agent owner wallet`,
        actionType: 'agent_wallet_fund',
      });
      console.log(`✓ Funded ${spec.slug} with ${spec.amountUsdc} USDC — tx ${txHash}`);
    } catch (e) {
      console.error(`✗ Failed to fund ${spec.slug}:`, e instanceof Error ? e.message : e);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('[fund-agent-wallets] Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
