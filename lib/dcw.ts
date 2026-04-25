import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, getAddress, http, parseAbi } from 'viem';
import { adminDb } from '../db/client';
import { resolveArcRpcUrl } from './arc-config';

const ARC_BLOCKCHAIN = 'ARC-TESTNET';
const ARC_RPC_URL = resolveArcRpcUrl();
const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
const erc20BalanceAbi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

export type WalletPurpose = 'owner' | 'validator' | 'user_agent' | 'treasury';

export interface PersistedWalletRow {
  id: string;
  wallet_id: string;
  address: string;
  wallet_set_id: string;
  purpose: WalletPurpose;
  agent_slug: string | null;
  user_wallet: string | null;
  blockchain: string;
  erc8004_token_id: string | null;
}

export interface TransactionParams {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: string[];
  feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** For user_agent wallets: enforce configured per-user spend controls (and optional balance check). */
  usdcAmount?: number;
}

// SDK surface can evolve faster than local typings; keep the boundary untyped.
let dcwClientSingleton: any | null = null;
let arcPublicClientSingleton: ReturnType<typeof createPublicClient> | null = null;

export function getCircleClient(): any {
  if (!dcwClientSingleton) {
    const apiKey = process.env.CIRCLE_API_KEY?.trim();
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
    if (!apiKey || !entitySecret) {
      throw new Error('[dcw] CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required');
    }
    dcwClientSingleton = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
    });
  }
  return dcwClientSingleton;
}

function getArcPublicClient() {
  if (!arcPublicClientSingleton) {
    arcPublicClientSingleton = createPublicClient({
      transport: http(ARC_RPC_URL),
    });
  }
  return arcPublicClientSingleton;
}

export function getWalletSetId(): string {
  const id =
    process.env.WALLET_SET_ID?.trim() ||
    process.env.CIRCLE_WALLET_SET_ID?.trim();
  if (!id) {
    throw new Error(
      '[dcw] Wallet set id missing: set WALLET_SET_ID (or legacy CIRCLE_WALLET_SET_ID)',
    );
  }
  return id;
}

export async function getOrCreateAgentWallets(agentSlug: string): Promise<{
  ownerWallet: PersistedWalletRow;
  validatorWallet: PersistedWalletRow;
  owner: PersistedWalletRow;
  validator: PersistedWalletRow;
}> {
  const owner = await getOrCreatePurposeWallet({
    agentSlug,
    purpose: 'owner',
    metadataName: `${agentSlug}-owner`,
  });
  const validator = await getOrCreatePurposeWallet({
    agentSlug,
    purpose: 'validator',
    metadataName: `${agentSlug}-validator`,
  });
  return {
    ownerWallet: owner,
    validatorWallet: validator,
    owner,
    validator,
  };
}

export async function getOrCreateUserAgentWallet(
  userWalletAddress: string,
): Promise<PersistedWalletRow> {
  const normalized = normalizeEvmAddress(userWalletAddress);
  const metadataSuffix = normalized.toLowerCase().replace(/^0x/, '');

  const existing = await findPersistedUserAgentWalletByUser(normalized);

  if (existing) {
    const existingRow = existing;
    try {
      const recovered = await findBestRemoteUserAgentWallet(normalized);
      if (recovered && recovered.address !== existingRow.address) {
        const existingScore = await scoreWalletLiquidity(existingRow.address);
        if (recovered.score > existingScore) {
          return adoptRecoveredUserAgentWallet(normalized, recovered, existingRow);
        }
      }
    } catch (error) {
      // RPC providers can throttle read calls briefly; keep serving the persisted wallet.
      console.warn('[dcw] recovered wallet scoring skipped:', error instanceof Error ? error.message : String(error));
    }

    return existingRow;
  }

  const recovered = await findBestRemoteUserAgentWallet(normalized);
  if (recovered) {
    return adoptRecoveredUserAgentWallet(normalized, recovered);
  }

  const setId = getWalletSetId();
  const dcw = getCircleClient();
  const response = await dcw.createWallets({
    walletSetId: setId,
    blockchains: [ARC_BLOCKCHAIN],
    count: 1,
    accountType: 'EOA',
    metadata: [
      {
        name: `user-agent-${metadataSuffix.slice(0, 20)}`,
        refId: `user-agent-${metadataSuffix}`,
      },
    ],
  });

  const w = response.data?.wallets?.[0];
  if (!w?.id || !w?.address) {
    throw new Error('[dcw] createWallets failed for user agent wallet');
  }

  const row: Omit<PersistedWalletRow, 'id'> = {
    wallet_id: w.id,
    address: normalizeEvmAddress(w.address),
    wallet_set_id: setId,
    purpose: 'user_agent',
    agent_slug: null,
    user_wallet: normalized,
    blockchain: ARC_BLOCKCHAIN,
    erc8004_token_id: null,
  };

  const inserted = await adminDb.from('wallets').insert(row).select('*').single();
  if (inserted.error) {
    throw new Error(`[dcw] Failed to persist user agent wallet: ${inserted.error.message}`);
  }

  return inserted.data as PersistedWalletRow;
}

export async function findPersistedUserAgentWallet(
  userWalletAddress: string,
): Promise<PersistedWalletRow | null> {
  return findPersistedUserAgentWalletByUser(normalizeEvmAddress(userWalletAddress));
}

async function getOrCreatePurposeWallet(input: {
  agentSlug: string;
  purpose: Exclude<WalletPurpose, 'user_agent'>;
  metadataName: string;
}): Promise<PersistedWalletRow> {
  const { agentSlug, purpose, metadataName } = input;

  const existing = await adminDb
    .from('wallets')
    .select('*')
    .eq('agent_slug', agentSlug)
    .eq('purpose', purpose)
    .maybeSingle();

  if (existing.data) {
    return existing.data as PersistedWalletRow;
  }

  const setId = getWalletSetId();
  const dcw = getCircleClient();

  const response = await dcw.createWallets({
    walletSetId: setId,
    blockchains: [ARC_BLOCKCHAIN],
    count: 1,
    accountType: 'EOA',
    metadata: [{ name: metadataName, refId: `${agentSlug}:${purpose}` }],
  });

  const w = response.data?.wallets?.[0];
  if (!w?.id || !w?.address) {
    throw new Error(`[dcw] createWallets failed for ${agentSlug} ${purpose}`);
  }

  const row: Omit<PersistedWalletRow, 'id'> = {
    wallet_id: w.id,
    address: normalizeEvmAddress(w.address),
    wallet_set_id: setId,
    purpose,
    agent_slug: agentSlug,
    user_wallet: null,
    blockchain: ARC_BLOCKCHAIN,
    erc8004_token_id: null,
  };

  const inserted = await adminDb.from('wallets').insert(row).select('*').single();
  if (inserted.error) {
    throw new Error(
      `[dcw] Failed to persist wallet ${agentSlug} ${purpose}: ${inserted.error.message}`,
    );
  }

  return inserted.data as PersistedWalletRow;
}

export async function executeTransaction(params: TransactionParams): Promise<unknown> {
  const { data: walletRow, error } = await adminDb
    .from('wallets')
    .select('purpose, user_wallet')
    .eq('wallet_id', params.walletId)
    .maybeSingle();

  if (error) {
    throw new Error(`[dcw] executeTransaction wallet lookup failed: ${error.message}`);
  }

  if (walletRow?.purpose === 'user_agent' && walletRow.user_wallet) {
    await checkSpendingLimits(walletRow.user_wallet, params.usdcAmount ?? 0);
  }

  const dcw = getCircleClient();
  const feeLevel = params.feeLevel ?? 'HIGH';
  const res = await dcw.createContractExecutionTransaction({
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters,
    fee: { type: 'level', config: { feeLevel } },
  });
  return res;
}

/**
 * Poll Circle transaction status until terminal state or timeout.
 */
export async function waitForTransaction(
  txId: string,
  label: string,
  maxAttempts = 30,
  delayMs = 2000,
): Promise<{
  id: string;
  state: string | undefined;
  errorReason?: string;
  errorDetails?: string;
  txHash?: string;
}> {
  const dcw = getCircleClient();
  let last: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await dcw.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    last = tx;
    const state = tx?.state as string | undefined;

    console.info(`[dcw] ${label} poll #${attempt + 1} state=${state}`);

    if (
      !state ||
      state === 'COMPLETE' ||
      state === 'FAILED' ||
      state === 'ERROR' ||
      state === 'DENIED' ||
      state === 'CANCELLED'
    ) {
      return {
        id: txId,
        state,
        errorReason: tx?.errorReason,
        errorDetails: tx?.errorDetails,
        txHash: tx?.txHash,
      };
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  return {
    id: txId,
    state: last?.state ?? 'PENDING_TIMEOUT',
    errorReason: last?.errorReason,
    errorDetails: last?.errorDetails,
    txHash: last?.txHash,
  };
}

export async function checkSpendingLimits(
  userWallet: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) {
    return;
  }

  const normalizedUserWallet = normalizeEvmAddress(userWallet);

  const { data: userRow, error: userError } = await adminDb
    .from('users')
    .select('max_per_transaction, max_per_day')
    .eq('wallet_address', normalizedUserWallet)
    .maybeSingle();

  if (userError) {
    throw new Error(`[dcw] checkSpendingLimits user lookup failed: ${userError.message}`);
  }

  const maxPerTransaction = toPositiveNumber(userRow?.max_per_transaction);
  if (maxPerTransaction !== null && amount > maxPerTransaction) {
    throw new Error(
      `[dcw] Spending limit exceeded: amount ${amount} > max_per_transaction ${maxPerTransaction}`,
    );
  }

  const maxPerDay = toPositiveNumber(userRow?.max_per_day);
  if (maxPerDay !== null) {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();

    const { data: dailyTx, error: dailyError } = await adminDb
      .from('transactions')
      .select('amount')
      .eq('from_wallet', normalizedUserWallet)
      .gte('created_at', dayStartIso);

    if (dailyError) {
      throw new Error(
        `[dcw] checkSpendingLimits daily sum lookup failed: ${dailyError.message}`,
      );
    }

    const usedToday = (dailyTx ?? []).reduce((sum, tx) => {
      const n = Number(tx.amount ?? 0);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    if (usedToday + amount > maxPerDay) {
      throw new Error(
        `[dcw] Daily spending limit exceeded: ${usedToday + amount} > ${maxPerDay}`,
      );
    }
  }
}

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchDcwUsdcBalance(walletId: string): Promise<number> {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) {
    return 0;
  }
  const res = await fetch(`https://api.circle.com/v1/w3s/wallets/${walletId}/balances`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    return 0;
  }

  const json = (await res.json()) as {
    data?: { tokenBalances?: Array<{ token?: { symbol?: string }; amount?: string }> };
  };

  const usdcEntry = json.data?.tokenBalances?.find((t) => t.token?.symbol === 'USDC');
  return Number(usdcEntry?.amount ?? 0);
}

function normalizeEvmAddress(address: string): string {
  return getAddress(address.trim());
}

type RemoteUserAgentCandidate = {
  walletId: string;
  address: string;
  createDate?: string;
  score: number;
  erc20UsdcRaw: bigint;
  nativeUsdcGasRaw: bigint;
};

async function listRemoteWalletCandidatesByRefId(refId: string): Promise<Array<{ walletId: string; address: string; createDate?: string }>> {
  const dcw = getCircleClient();
  const response = await dcw.listWallets({
    walletSetId: getWalletSetId(),
    refId,
    blockchain: ARC_BLOCKCHAIN,
    pageSize: 50,
    order: 'DESC',
  } as any);

  const wallets = Array.isArray(response?.data?.wallets) ? response.data.wallets : [];
  return wallets
    .filter(
      (wallet: any) =>
        wallet?.id &&
        wallet?.address &&
        wallet?.blockchain === ARC_BLOCKCHAIN &&
        (wallet?.state === 'LIVE' || !wallet?.state) &&
        (wallet?.accountType === 'EOA' || !wallet?.accountType),
    )
    .map((wallet: any) => ({
      walletId: wallet.id as string,
      address: normalizeEvmAddress(wallet.address as string),
      createDate: typeof wallet.createDate === 'string' ? wallet.createDate : undefined,
    }));
}

async function scoreWalletLiquidity(address: string): Promise<number> {
  try {
    const client = getArcPublicClient();
    const normalized = normalizeEvmAddress(address) as `0x${string}`;
    const [nativeUsdcGasRaw, erc20UsdcRaw] = await Promise.all([
      client.getBalance({ address: normalized }),
      client.readContract({
        address: ARC_USDC_ADDRESS,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [normalized],
      }) as Promise<bigint>,
    ]);

    if (erc20UsdcRaw > 0n) {
      return 2;
    }
    if (nativeUsdcGasRaw > 0n) {
      return 1;
    }
    return 0;
  } catch (error) {
    console.warn('[dcw] liquidity score fallback (rpc error):', error instanceof Error ? error.message : String(error));
    return 0;
  }
}

async function findBestRemoteUserAgentWallet(userWalletAddress: string): Promise<RemoteUserAgentCandidate | null> {
  const normalized = normalizeEvmAddress(userWalletAddress);
  const metadataSuffix = normalized.toLowerCase().replace(/^0x/, '');
  const refIds = Array.from(
    new Set([
      `user-agent-${metadataSuffix}`,
      normalized,
      normalized.toLowerCase(),
    ]),
  );

  const candidatesById = new Map<string, { walletId: string; address: string; createDate?: string }>();
  for (const refId of refIds) {
    const candidates = await listRemoteWalletCandidatesByRefId(refId);
    for (const candidate of candidates) {
      candidatesById.set(candidate.walletId, candidate);
    }
  }

  const baseCandidates = Array.from(candidatesById.values());
  if (!baseCandidates.length) {
    return null;
  }

  const client = getArcPublicClient();
  const hydrated = await Promise.all(
    baseCandidates.map(async (candidate) => {
      const normalizedAddress = candidate.address as `0x${string}`;
      try {
        const [nativeUsdcGasRaw, erc20UsdcRaw] = await Promise.all([
          client.getBalance({ address: normalizedAddress }),
          client.readContract({
            address: ARC_USDC_ADDRESS,
            abi: erc20BalanceAbi,
            functionName: 'balanceOf',
            args: [normalizedAddress],
          }) as Promise<bigint>,
        ]);

        return {
          ...candidate,
          nativeUsdcGasRaw,
          erc20UsdcRaw,
          score: erc20UsdcRaw > 0n ? 2 : nativeUsdcGasRaw > 0n ? 1 : 0,
        };
      } catch (error) {
        console.warn(
          '[dcw] remote candidate hydration fallback:',
          error instanceof Error ? error.message : String(error),
        );
        return {
          ...candidate,
          nativeUsdcGasRaw: 0n,
          erc20UsdcRaw: 0n,
          score: 0,
        };
      }
    }),
  );

  hydrated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.erc20UsdcRaw !== a.erc20UsdcRaw) {
      return b.erc20UsdcRaw > a.erc20UsdcRaw ? 1 : -1;
    }
    if (b.nativeUsdcGasRaw !== a.nativeUsdcGasRaw) {
      return b.nativeUsdcGasRaw > a.nativeUsdcGasRaw ? 1 : -1;
    }
    const aDate = a.createDate ? Date.parse(a.createDate) : 0;
    const bDate = b.createDate ? Date.parse(b.createDate) : 0;
    return bDate - aDate;
  });

  return hydrated[0] ?? null;
}

async function findPersistedUserAgentWalletByUser(
  normalizedUserWallet: string,
): Promise<PersistedWalletRow | null> {
  const exact = await adminDb
    .from('wallets')
    .select('*')
    .eq('purpose', 'user_agent')
    .eq('user_wallet', normalizedUserWallet)
    .limit(20);

  if (exact.error) {
    throw new Error(`[dcw] Failed to query user agent wallet: ${exact.error.message}`);
  }
  const exactRows = Array.isArray(exact.data) ? (exact.data as PersistedWalletRow[]) : [];
  if (exactRows.length > 0) {
    return chooseBestPersistedUserAgentWallet(exactRows);
  }

  const lowercased = await adminDb
    .from('wallets')
    .select('*')
    .eq('purpose', 'user_agent')
    .eq('user_wallet', normalizedUserWallet.toLowerCase())
    .limit(20);

  if (lowercased.error) {
    throw new Error(`[dcw] Failed to query lowercase user agent wallet: ${lowercased.error.message}`);
  }

  const lowerRows = Array.isArray(lowercased.data)
    ? (lowercased.data as PersistedWalletRow[])
    : [];

  return lowerRows.length > 0 ? chooseBestPersistedUserAgentWallet(lowerRows) : null;
}

async function findPersistedWalletByRecoveredCandidate(
  recovered: RemoteUserAgentCandidate,
): Promise<PersistedWalletRow | null> {
  const byWalletId = await adminDb
    .from('wallets')
    .select('*')
    .eq('wallet_id', recovered.walletId)
    .limit(20);

  if (byWalletId.error) {
    throw new Error(`[dcw] Failed to query recovered wallet by wallet_id: ${byWalletId.error.message}`);
  }
  const walletIdRows = Array.isArray(byWalletId.data)
    ? (byWalletId.data as PersistedWalletRow[])
    : [];
  if (walletIdRows.length > 0) {
    return chooseBestPersistedUserAgentWallet(walletIdRows);
  }

  const byAddress = await adminDb
    .from('wallets')
    .select('*')
    .eq('address', recovered.address)
    .limit(20);

  if (byAddress.error) {
    throw new Error(`[dcw] Failed to query recovered wallet by address: ${byAddress.error.message}`);
  }

  const addressRows = Array.isArray(byAddress.data)
    ? (byAddress.data as PersistedWalletRow[])
    : [];

  return addressRows.length > 0 ? chooseBestPersistedUserAgentWallet(addressRows) : null;
}

async function adoptRecoveredUserAgentWallet(
  normalizedUserWallet: string,
  recovered: RemoteUserAgentCandidate,
  existingRow?: PersistedWalletRow,
): Promise<PersistedWalletRow> {
  const currentRow = existingRow ?? (await findPersistedWalletByRecoveredCandidate(recovered));

  if (!currentRow) {
    const row: Omit<PersistedWalletRow, 'id'> = {
      wallet_id: recovered.walletId,
      address: recovered.address,
      wallet_set_id: getWalletSetId(),
      purpose: 'user_agent',
      agent_slug: null,
      user_wallet: normalizedUserWallet,
      blockchain: ARC_BLOCKCHAIN,
      erc8004_token_id: null,
    };

    const inserted = await adminDb.from('wallets').insert(row).select('*').single();
    if (inserted.error) {
      throw new Error(`[dcw] Failed to persist recovered user agent wallet: ${inserted.error.message}`);
    }

    return inserted.data as PersistedWalletRow;
  }

  if (currentRow.purpose !== 'user_agent') {
    throw new Error(
      `[dcw] Recovered wallet ${recovered.walletId} already belongs to ${currentRow.purpose} and cannot be reassigned`,
    );
  }

  if (
    currentRow.user_wallet &&
    normalizeEvmAddress(currentRow.user_wallet) !== normalizedUserWallet
  ) {
    throw new Error(
      `[dcw] Recovered wallet ${recovered.walletId} is already assigned to another user wallet`,
    );
  }

  const updated = await adminDb
    .from('wallets')
    .update({
      wallet_id: recovered.walletId,
      address: recovered.address,
      wallet_set_id: getWalletSetId(),
      purpose: 'user_agent',
      agent_slug: null,
      user_wallet: normalizedUserWallet,
      blockchain: ARC_BLOCKCHAIN,
    })
    .eq('id', currentRow.id)
    .select('*')
    .single();

  if (updated.error) {
    throw new Error(`[dcw] Failed to adopt recovered user agent wallet: ${updated.error.message}`);
  }

  return updated.data as PersistedWalletRow;
}

async function chooseBestPersistedUserAgentWallet(
  rows: PersistedWalletRow[],
): Promise<PersistedWalletRow> {
  if (rows.length === 1) {
    return rows[0];
  }

  const scored = await Promise.all(
    rows.map(async (row, index) => ({
      row,
      index,
      score: await scoreWalletLiquidity(row.address),
    })),
  );

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return scored[0].row;
}
