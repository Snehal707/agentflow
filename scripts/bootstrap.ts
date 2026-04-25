import dotenv from 'dotenv';
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  parseAbiItem,
} from 'viem';

import { adminDb } from '../db/client';
import { ARC } from '../lib/arc-config';
import {
  executeTransaction,
  getCircleClient,
  getOrCreateAgentWallets,
  waitForTransaction,
  type PersistedWalletRow,
} from '../lib/dcw';

dotenv.config();

const AGENT_SLUGS = [
  'swap',
  'vault',
  'bridge',
  'portfolio',
  'invoice',
  'research',
  'analyst',
  'writer',
  'vision',
  'transcribe',
  'schedule',
  'split',
  'batch',
  'ascii',
] as const;

const registeredEvent = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
);

async function assertFirstRun(): Promise<void> {
  const walletSetEnv =
    process.env.WALLET_SET_ID?.trim() || process.env.CIRCLE_WALLET_SET_ID?.trim();
  const treasuryEnv = process.env.TREASURY_WALLET_ADDRESS?.trim();

  if (walletSetEnv && treasuryEnv) {
    throw new Error(
      '[bootstrap] WALLET_SET_ID and TREASURY_WALLET_ADDRESS are already set. Refusing to re-bootstrap.',
    );
  }

  const { data: treasuryData, error: treasuryError } = await adminDb
    .from('wallets')
    .select('id')
    .eq('purpose', 'treasury')
    .maybeSingle();

  if (treasuryError) {
    throw new Error(`[bootstrap] Failed to check existing treasury: ${treasuryError.message}`);
  }
  if (treasuryData) {
    throw new Error('[bootstrap] Treasury wallet row already exists in Supabase. Refusing to re-bootstrap.');
  }

  const { count, error: countError } = await adminDb
    .from('wallets')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    throw new Error(`[bootstrap] Failed to check wallets table count: ${countError.message}`);
  }
  if ((count ?? 0) > 0) {
    throw new Error(
      '[bootstrap] Wallet records already exist in Supabase. Refusing to recreate bootstrap wallets.',
    );
  }
}

async function ensureWalletSetId(): Promise<string> {
  const existing =
    process.env.WALLET_SET_ID?.trim() || process.env.CIRCLE_WALLET_SET_ID?.trim();
  if (existing) {
    return existing;
  }

  const dcw = getCircleClient();
  const res = await dcw.createWalletSet({ name: 'AgentFlow V3' });
  const id = res.data?.walletSet?.id as string | undefined;
  if (!id) {
    throw new Error('[bootstrap] createWalletSet failed');
  }
  return id;
}

async function createTreasuryWallet(walletSetId: string): Promise<PersistedWalletRow> {
  const dcw = getCircleClient();
  const response = await dcw.createWallets({
    walletSetId,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'EOA',
    metadata: [{ name: 'agentflow-treasury', refId: 'treasury' }],
  });

  const w = response.data?.wallets?.[0];
  if (!w?.id || !w?.address) {
    throw new Error('[bootstrap] Failed to create treasury wallet');
  }

  const row: Omit<PersistedWalletRow, 'id'> = {
    wallet_id: w.id,
    address: w.address,
    wallet_set_id: walletSetId,
    purpose: 'treasury',
    agent_slug: null,
    user_wallet: null,
    blockchain: 'ARC-TESTNET',
    erc8004_token_id: null,
  };

  const inserted = await adminDb.from('wallets').insert(row).select('*').single();
  if (inserted.error) {
    throw new Error(`[bootstrap] Failed to persist treasury wallet: ${inserted.error.message}`);
  }

  return inserted.data as PersistedWalletRow;
}

async function registerAgentIdentity(input: {
  ownerWalletId: string;
  agentSlug: string;
}): Promise<string> {
  const agentURI = `https://agentflow.one/agents/${input.agentSlug}/card.json`;

  const exec = (await executeTransaction({
    walletId: input.ownerWalletId,
    contractAddress: ARC.identityRegistry,
    abiFunctionSignature: 'register(string)',
    abiParameters: [agentURI],
    feeLevel: 'HIGH',
  })) as any;

  const tx = exec.data?.transaction ?? exec.data;
  const txId = tx?.id as string | undefined;
  if (!txId) {
    throw new Error('[bootstrap] register() did not return a transaction id');
  }

  const done = await waitForTransaction(txId, `erc8004-register:${input.agentSlug}`);
  if (done.state !== 'COMPLETE' || !done.txHash) {
    throw new Error(
      `[bootstrap] register failed for ${input.agentSlug}: state=${done.state} err=${done.errorReason ?? ''}`,
    );
  }

  const chain = defineChain({
    id: ARC.chainId,
    name: ARC.blockchain,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC.rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const receipt = await client.getTransactionReceipt({ hash: done.txHash as `0x${string}` });

  const owner = await client.getTransaction({ hash: done.txHash as `0x${string}` });
  const from = owner.from ? getAddress(owner.from) : null;

  const logs = await client.getLogs({
    address: ARC.identityRegistry as `0x${string}`,
    event: registeredEvent,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  const match = logs.find(
    (l) =>
      l.args.agentURI === agentURI && (from ? l.args.owner === from : true),
  );
  const agentId = match?.args.agentId;
  if (agentId === undefined) {
    throw new Error(`[bootstrap] Could not parse Registered event for ${input.agentSlug}`);
  }
  return agentId.toString();
}

async function main(): Promise<void> {
  await assertFirstRun();

  const walletSetId = await ensureWalletSetId();
  process.env.WALLET_SET_ID = walletSetId;
  console.log(`[bootstrap] walletSetId=${walletSetId}`);

  const treasury = await createTreasuryWallet(walletSetId);
  console.log(`[bootstrap] treasury walletId=${treasury.wallet_id} address=${treasury.address}`);

  const createdAgents: Array<{ slug: string; agentId: string }> = [];

  for (const slug of AGENT_SLUGS) {
    const { owner } = await getOrCreateAgentWallets(slug);
    const agentId = await registerAgentIdentity({ ownerWalletId: owner.wallet_id, agentSlug: slug });

    const updated = await adminDb
      .from('wallets')
      .update({ erc8004_token_id: agentId })
      .eq('wallet_id', owner.wallet_id)
      .select('*')
      .single();

    if (updated.error) {
      throw new Error(`[bootstrap] Failed to update erc8004_token_id for ${slug}: ${updated.error.message}`);
    }

    createdAgents.push({ slug, agentId });
    console.log(`[bootstrap] registered ${slug} agentId=${agentId} owner=${owner.address}`);
  }

  console.log('\n[bootstrap] DONE');
  console.log('Add these to your environment (Railway / .env):');
  console.log(`WALLET_SET_ID=${walletSetId}`);
  console.log(`TREASURY_WALLET_ADDRESS=${treasury.address}`);
  console.log('\nAgents:');
  for (const a of createdAgents) {
    console.log(`- ${a.slug}: erc8004_token_id=${a.agentId}`);
  }
  console.log('\nImportant: do not run this script again.');
}

main().catch((err) => {
  console.error('[bootstrap] Failed:', err);
  process.exit(1);
});
