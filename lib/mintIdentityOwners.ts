/**
 * ERC-8004 IdentityRegistry.register for owner wallets missing erc8004_token_id.
 * Shared by scripts/mint-identity.ts and scripts/create-missing-wallets.ts.
 */

import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  parseAbiItem,
} from 'viem';

import { adminDb } from '../db/client';
import { ARC } from './arc-config';
import {
  executeTransaction,
  waitForTransaction,
  type PersistedWalletRow,
} from './dcw';

const registeredEvent = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
);

function needsMint(row: Pick<PersistedWalletRow, 'erc8004_token_id'>): boolean {
  const v = row.erc8004_token_id;
  if (v === null || v === undefined) return true;
  return String(v).trim() === '';
}

function metadataUriForSlug(agentSlug: string): string {
  const encoded = encodeURIComponent(agentSlug);
  return `https://agentflow.one/agents/${encoded}/metadata.json`;
}

async function registerAndParseAgentId(
  input: {
    ownerWalletId: string;
    agentSlug: string;
    metadataURI: string;
  },
  logPrefix: string,
): Promise<string> {
  const exec = (await executeTransaction({
    walletId: input.ownerWalletId,
    contractAddress: ARC.identityRegistry,
    abiFunctionSignature: 'register(string)',
    abiParameters: [input.metadataURI],
    feeLevel: 'HIGH',
  })) as { data?: { transaction?: { id?: string }; id?: string } };

  const tx = exec.data?.transaction ?? exec.data;
  const txId = tx?.id as string | undefined;
  if (!txId) {
    throw new Error(`${logPrefix} register() did not return a transaction id`);
  }

  const done = await waitForTransaction(
    txId,
    `erc8004-register:${input.agentSlug}`,
  );
  if (done.state !== 'COMPLETE' || !done.txHash) {
    throw new Error(
      `${logPrefix} register failed for ${input.agentSlug}: state=${done.state} err=${done.errorReason ?? ''}`,
    );
  }

  const chain = defineChain({
    id: ARC.chainId,
    name: ARC.blockchain,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC.rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const receipt = await client.getTransactionReceipt({
    hash: done.txHash as `0x${string}`,
  });

  const ownerTx = await client.getTransaction({
    hash: done.txHash as `0x${string}`,
  });
  const from = ownerTx.from ? getAddress(ownerTx.from) : null;

  const logs = await client.getLogs({
    address: ARC.identityRegistry as `0x${string}`,
    event: registeredEvent,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  const match = logs.find(
    (l) =>
      l.args.agentURI === input.metadataURI &&
      (from ? l.args.owner === from : true),
  );
  const agentId = match?.args.agentId;
  if (agentId === undefined) {
    throw new Error(
      `${logPrefix} Could not parse Registered event for ${input.agentSlug}`,
    );
  }
  return agentId.toString();
}

export type RunMintIdentityOwnersOptions = {
  /** Console / error prefix, default `[mint-identity]` */
  logPrefix?: string;
};

/**
 * For every `purpose='owner'` row with null/empty erc8004_token_id, register on-chain and update DB.
 */
export async function runMintIdentityOwners(
  options?: RunMintIdentityOwnersOptions,
): Promise<void> {
  const logPrefix = options?.logPrefix ?? '[mint-identity]';

  const { data: rows, error } = await adminDb
    .from('wallets')
    .select('*')
    .eq('purpose', 'owner');

  if (error) {
    throw new Error(`${logPrefix} Supabase query failed: ${error.message}`);
  }

  const candidates = (rows ?? []).filter((r) =>
    needsMint(r as PersistedWalletRow),
  ) as PersistedWalletRow[];

  let skippedNoSlug = 0;
  let succeeded = 0;
  let failed = 0;

  console.log(
    `${logPrefix} identityRegistry=${ARC.identityRegistry} owner rows missing erc8004_token_id: ${candidates.length}`,
  );

  for (const row of candidates) {
    const slug = row.agent_slug?.trim();
    if (!slug) {
      skippedNoSlug += 1;
      console.warn(
        `${logPrefix} skip wallet_id=${row.wallet_id}: missing agent_slug`,
      );
      continue;
    }

    const metadataURI = metadataUriForSlug(slug);

    try {
      const agentId = await registerAndParseAgentId(
        {
          ownerWalletId: row.wallet_id,
          agentSlug: slug,
          metadataURI,
        },
        logPrefix,
      );

      const updated = await adminDb
        .from('wallets')
        .update({ erc8004_token_id: agentId })
        .eq('wallet_id', row.wallet_id)
        .select('*')
        .single();

      if (updated.error) {
        throw new Error(updated.error.message);
      }

      succeeded += 1;
      console.log(
        `${logPrefix} OK slug=${slug} agentId=${agentId} owner=${row.address}`,
      );
    } catch (e) {
      failed += 1;
      console.error(
        `${logPrefix} FAIL slug=${slug} wallet_id=${row.wallet_id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  console.log(`\n${logPrefix} summary`);
  console.log(`  candidates: ${candidates.length}`);
  console.log(`  skipped (no agent_slug): ${skippedNoSlug}`);
  console.log(`  succeeded: ${succeeded}`);
  console.log(`  failed: ${failed}`);
}
