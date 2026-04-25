import QRCode from 'qrcode';
import { createPublicClient, defineChain, getAddress, http, parseAbiItem } from 'viem';
import { adminDb } from '../db/client';
import { executeTransaction, waitForTransaction } from './dcw';

const RESERVED_HANDLES = new Set(['circle', 'arc', 'agentflow', 'usdc']);
const PAYMENT_BASE = 'agentflow.one/pay';

const AGENTFLOW_REGISTRY_ADDRESS =
  process.env.AGENTFLOW_REGISTRY_ADDRESS?.trim() ?? '';

const chain = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? '5042002'),
  name: process.env.ARC_NETWORK ?? 'ARC-TESTNET',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC ?? 'https://rpc.testnet.arc.network'] },
  },
});

export async function resolveHandle(handle: string): Promise<string> {
  const normalized = normalizeHandle(handle);

  const { data: row, error } = await adminDb
    .from('arc_handles')
    .select('wallet_address')
    .eq('handle', normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`[handles] Supabase resolve failed: ${error.message}`);
  }
  if (row?.wallet_address) {
    return normalizeAddress(row.wallet_address);
  }

  return resolveOnChain(normalized);
}

export async function registerHandle(
  handle: string,
  walletAddress: string,
): Promise<{ success: boolean; txHash?: string }> {
  const normalizedHandle = normalizeHandle(handle);
  const normalizedAddress = normalizeAddress(walletAddress);

  if (RESERVED_HANDLES.has(normalizedHandle)) {
    throw new Error(`[handles] Handle "${normalizedHandle}" is reserved`);
  }

  const { data: existing, error: existingErr } = await adminDb
    .from('arc_handles')
    .select('wallet_address')
    .eq('handle', normalizedHandle)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`[handles] Handle availability check failed: ${existingErr.message}`);
  }
  if (existing?.wallet_address) {
    throw new Error('[handles] Handle is already taken');
  }

  const onChainOwner = await resolveOnChain(normalizedHandle, true);
  if (onChainOwner) {
    throw new Error('[handles] Handle is already taken onchain');
  }

  const { data: walletRow, error: walletErr } = await adminDb
    .from('wallets')
    .select('wallet_id')
    .eq('address', normalizedAddress)
    .maybeSingle();

  if (walletErr) {
    throw new Error(`[handles] Wallet lookup failed: ${walletErr.message}`);
  }
  if (!walletRow?.wallet_id) {
    throw new Error(
      '[handles] No DCW wallet mapped for this address; cannot execute onchain register',
    );
  }

  const tx = await tryRegisterOnChain(walletRow.wallet_id, normalizedHandle, normalizedAddress);
  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[handles] register transaction id missing');
  }
  const txResult = await waitForTransaction(txId, `register-handle:${normalizedHandle}`);
  if (txResult.state !== 'COMPLETE') {
    return { success: false, txHash: txResult.txHash };
  }

  const { error: upsertErr } = await adminDb.from('arc_handles').upsert(
    {
      handle: normalizedHandle,
      wallet_address: normalizedAddress,
      handle_type: 'consumer',
      verified: true,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'handle' },
  );
  if (upsertErr) {
    throw new Error(`[handles] Failed to persist handle: ${upsertErr.message}`);
  }

  return { success: true, txHash: txResult.txHash };
}

export function getPaymentUrl(handle: string): string {
  return `${PAYMENT_BASE}/${normalizeHandle(handle)}`;
}

export async function generateQR(handle: string): Promise<Buffer> {
  const url = `https://${getPaymentUrl(handle)}`;
  return QRCode.toBuffer(url, { type: 'png', margin: 1, width: 512 });
}

async function resolveOnChain(handle: string, returnNullIfUnavailable = false): Promise<string> {
  if (!AGENTFLOW_REGISTRY_ADDRESS) {
    if (returnNullIfUnavailable) {
      return '';
    }
    throw new Error('[handles] AGENTFLOW_REGISTRY_ADDRESS is required for onchain fallback');
  }

  const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const candidates = [
    { sig: 'function resolve(string) view returns (address)', fn: 'resolve' },
    { sig: 'function getHandleOwner(string) view returns (address)', fn: 'getHandleOwner' },
    { sig: 'function handles(string) view returns (address)', fn: 'handles' },
  ] as const;

  for (const candidate of candidates) {
    try {
      const owner = (await client.readContract({
        address: AGENTFLOW_REGISTRY_ADDRESS as `0x${string}`,
        abi: [parseAbiItem(candidate.sig)],
        functionName: candidate.fn,
        args: [handle],
      })) as string;

      if (owner && owner !== '0x0000000000000000000000000000000000000000') {
        return normalizeAddress(owner);
      }
      return '';
    } catch {
      // try next candidate
    }
  }

  if (returnNullIfUnavailable) {
    return '';
  }
  throw new Error('[handles] Could not resolve handle onchain: unknown contract ABI');
}

async function tryRegisterOnChain(
  walletId: string,
  handle: string,
  walletAddress: string,
): Promise<unknown> {
  if (!AGENTFLOW_REGISTRY_ADDRESS) {
    throw new Error('[handles] AGENTFLOW_REGISTRY_ADDRESS is required for register');
  }

  const candidates = [
    { sig: 'register(string,address)', args: [handle, walletAddress] },
    { sig: 'register(string)', args: [handle] },
  ] as const;

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      return await executeTransaction({
        walletId,
        contractAddress: AGENTFLOW_REGISTRY_ADDRESS,
        abiFunctionSignature: candidate.sig,
        abiParameters: candidate.args as unknown as string[],
        feeLevel: 'HIGH',
      });
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`[handles] Failed to register handle onchain: ${String(lastErr)}`);
}

export function normalizeHandle(handle: string): string {
  const cleaned = handle.trim().toLowerCase().replace(/\.arc$/, '');
  if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(cleaned)) {
    throw new Error('[handles] Invalid handle format');
  }
  return cleaned;
}

function normalizeAddress(address: string): string {
  return getAddress(address.trim());
}

function extractTransactionId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}
