import { createPublicClient, defineChain, getAddress, http, parseAbiItem } from 'viem';
import { adminDb } from '../db/client';
import { ARC } from './arc-config';
import { executeTransaction, waitForTransaction } from './dcw';

const ONE_HOUR_MS = 60 * 60 * 1000;

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

type ExecutionResult = Record<string, unknown>;

export async function recordReputation(
  agentId: string,
  score: number,
  tag: string,
  validatorWallet: string,
): Promise<{ success: boolean; txHash?: string }> {
  const validatorAddress = normalizeAddress(validatorWallet);
  const { data: validatorRow, error: validatorErr } = await adminDb
    .from('wallets')
    .select('wallet_id, purpose')
    .eq('address', validatorAddress)
    .eq('purpose', 'validator')
    .maybeSingle();

  if (validatorErr) {
    throw new Error(`[reputation] validator lookup failed: ${validatorErr.message}`);
  }
  if (!validatorRow?.wallet_id) {
    throw new Error('[reputation] Validator wallet not found in Supabase');
  }

  const tx = await tryGiveFeedback(validatorRow.wallet_id, agentId, score, tag);
  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[reputation] giveFeedback did not return transaction id');
  }

  const result = await waitForTransaction(txId, 'reputation-feedback');
  if (result.state !== 'COMPLETE') {
    return { success: false, txHash: result.txHash };
  }

  const agentAddress = await resolveAgentAddressById(agentId);
  await upsertReputationCache(agentAddress, score);
  return { success: true, txHash: result.txHash };
}

export async function recordReputationSafe(
  ...args: Parameters<typeof recordReputation>
): Promise<void> {
  try {
    await recordReputation(...args);
  } catch (err) {
    console.warn('[reputation] non-critical, skipping:', err);
  }
}

export async function getReputationScore(agentAddress: string): Promise<number> {
  const normalized = normalizeAddress(agentAddress);
  const { data: cache, error } = await adminDb
    .from('reputation_cache')
    .select('score, last_updated')
    .eq('agent_address', normalized)
    .maybeSingle();

  if (!error && cache?.score !== null && cache?.score !== undefined) {
    const stale = isStale(cache.last_updated as string | null);
    if (!stale) {
      return Number(cache.score);
    }
  }

  const onChain = await fetchScoreFromArc(normalized);
  if (onChain !== null) {
    await upsertReputationCache(normalized, onChain);
    return onChain;
  }

  return Number(cache?.score ?? 0);
}

export function calculateScore(agentSlug: string, executionResult: ExecutionResult): number {
  const slug = agentSlug.toLowerCase();

  if (slug === 'swap') {
    const slippage = toNumber(executionResult.slippage);
    const expected = toNumber(executionResult.expectedSlippage);
    return slippage !== null && expected !== null && slippage <= expected ? 95 : 60;
  }

  if (slug === 'vault') {
    const actualApy = toNumber(executionResult.actualAPY);
    const quotedApy = toNumber(executionResult.quotedAPY);
    if (actualApy === null || quotedApy === null || quotedApy === 0) {
      return 50;
    }
    const diff = Math.abs(actualApy - quotedApy);
    return diff <= Math.abs(quotedApy) * 0.05 ? 90 : 50;
  }

  if (slug === 'bridge') {
    const confirmMs = toNumber(executionResult.confirmMs);
    return confirmMs !== null && confirmMs < 30_000 ? 95 : 70;
  }

  if (slug === 'research') {
    const feedback = toNumber(executionResult.user_feedback);
    return feedback !== null && feedback > 0 ? 90 : 70;
  }

  if (slug === 'vision') {
    const extractor = String(executionResult.extractor ?? '');
    return extractor === 'hermes' || extractor === 'hermes-text' ? 88 : 78;
  }

  if (slug === 'transcribe') {
    const textLength = toNumber(executionResult.textLength);
    return textLength !== null && textLength > 0 ? 90 : 65;
  }

  return 70;
}

async function tryGiveFeedback(
  validatorWalletId: string,
  agentId: string,
  score: number,
  tag: string,
): Promise<unknown> {
  const agentNumeric = Number(agentId);
  const scoreInt = Math.trunc(score);
  const signatures = [
    { sig: 'giveFeedback(uint256,int256,string)', args: [String(agentNumeric), String(scoreInt), tag] },
    { sig: 'giveFeedback(uint256,int256)', args: [String(agentNumeric), String(scoreInt)] },
    { sig: 'giveFeedback(uint256,uint256,string)', args: [String(agentNumeric), String(Math.max(scoreInt, 0)), tag] },
    { sig: 'giveFeedback(uint256,uint256)', args: [String(agentNumeric), String(Math.max(scoreInt, 0))] },
  ] as const;

  let lastError: unknown;
  for (const candidate of signatures) {
    try {
      return await executeTransaction({
        walletId: validatorWalletId,
        contractAddress: ARC.reputationRegistry,
        abiFunctionSignature: candidate.sig,
        abiParameters: candidate.args as unknown as string[],
        feeLevel: 'HIGH',
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `[reputation] Unable to call giveFeedback() with known signatures: ${String(lastError)}`,
  );
}

async function fetchScoreFromArc(agentAddress: string): Promise<number | null> {
  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const signatures = [
    {
      sig: 'function getReputation(address) view returns (uint256)',
      fn: 'getReputation',
      args: [agentAddress as `0x${string}`],
    },
    {
      sig: 'function reputationOf(address) view returns (uint256)',
      fn: 'reputationOf',
      args: [agentAddress as `0x${string}`],
    },
    {
      sig: 'function getScore(address) view returns (uint256)',
      fn: 'getScore',
      args: [agentAddress as `0x${string}`],
    },
  ] as const;

  for (const candidate of signatures) {
    try {
      const result = (await client.readContract({
        address: ARC.reputationRegistry as `0x${string}`,
        abi: [parseAbiItem(candidate.sig)],
        functionName: candidate.fn,
        args: candidate.args,
      })) as bigint;
      return Number(result);
    } catch {
      // Try next signature.
    }
  }

  return null;
}

async function resolveAgentAddressById(agentId: string): Promise<string> {
  const { data: walletRow } = await adminDb
    .from('wallets')
    .select('address')
    .eq('erc8004_token_id', agentId)
    .maybeSingle();

  if (walletRow?.address) {
    return normalizeAddress(walletRow.address);
  }

  // Fallback key when we only have agentId and no mapping row.
  return `agent:${agentId}`;
}

async function upsertReputationCache(agentAddress: string, score: number): Promise<void> {
  const { data: existing } = await adminDb
    .from('reputation_cache')
    .select('total_calls')
    .eq('agent_address', agentAddress)
    .maybeSingle();

  const totalCalls = Number(existing?.total_calls ?? 0) + 1;

  const { error } = await adminDb.from('reputation_cache').upsert(
    {
      agent_address: agentAddress,
      score: Math.trunc(score),
      total_calls: totalCalls,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'agent_address' },
  );

  if (error) {
    throw new Error(`[reputation] cache upsert failed: ${error.message}`);
  }
}

function extractTransactionId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}

function normalizeAddress(address: string): string {
  return getAddress(address.trim());
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isStale(lastUpdated: string | null): boolean {
  if (!lastUpdated) {
    return true;
  }
  const t = new Date(lastUpdated).getTime();
  if (!Number.isFinite(t)) {
    return true;
  }
  return Date.now() - t > ONE_HOUR_MS;
}
