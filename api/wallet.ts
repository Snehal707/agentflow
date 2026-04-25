import { Router } from 'express';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  verifyMessage,
} from 'viem';
import { adminDb } from '../db/client';
import { authMiddleware, type JWTPayload } from '../lib/auth';
import {
  executeTransaction,
  getOrCreateUserAgentWallet,
  waitForTransaction,
} from '../lib/dcw';
import { ARC } from '../lib/arc-config';
import { getDailyLimit } from '../lib/ratelimit';
import { transferToGateway } from '../lib/circleWallet';
import {
  fetchGatewayBalancesForDepositors,
  fetchGatewayBalanceForAddress,
  getOrCreateGatewayFundingWallet,
} from '../lib/gateway-balance';

const router = Router();
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const GATEWAY_API_BASE_URL =
  process.env.GATEWAY_API_BASE_URL?.trim() || 'https://gateway-api-testnet.circle.com/v1';
const ARC_TESTNET_DOMAIN = Number(process.env.GATEWAY_DOMAIN?.trim() || '26');
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function uniqueAddresses(addresses: Array<string | undefined | null>): `0x${string}`[] {
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const value of addresses) {
    if (!value || !isAddress(value)) continue;
    const normalized = getAddress(value) as `0x${string}`;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC.alchemyRpc || ARC.rpc] },
  },
});

function arcReadRpcUrls(): string[] {
  const urls = [ARC.alchemyRpc, ARC.rpc].filter((url): url is string => Boolean(url?.trim()));
  return Array.from(new Set(urls));
}

/** Default Arc read transport for legacy paths; resilient balance reads use readArcWithFallback. */
function arcReadTransport() {
  return http(arcReadRpcUrls()[0] || ARC.rpc);
}

function shortReadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split('\n')[0] || error.message;
  }
  return String(error);
}

function isRateLimitError(error: unknown): boolean {
  const msg = shortReadError(error).toLowerCase();
  return (
    msg.includes('compute units') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('capacity')
  );
}

function walletReadFailure(error: unknown, fallback: string): { status: number; error: string } {
  const message = shortReadError(error);
  if (isRateLimitError(error)) {
    return {
      status: 429,
      error: 'Arc wallet balance reads are being rate-limited right now. Retry in a few seconds.',
    };
  }
  if (/eth_call|eth_getbalance|request body|raw call arguments|contract call|viem@|alchemy/i.test(message)) {
    return {
      status: 502,
      error: 'Arc wallet balance reads failed while querying live balances. Retry in a few seconds.',
    };
  }
  return {
    status: 500,
    error: fallback,
  };
}

async function readArcWithFallback<T>(
  label: string,
  read: (client: ReturnType<typeof createPublicClient>) => Promise<T>,
  fallback: T,
): Promise<T> {
  const urls = arcReadRpcUrls();
  let lastError: unknown;
  for (const rpcUrl of urls) {
    try {
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { retryCount: 0 }),
      });
      return await read(client);
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error)) {
        // Rate-limited — skip to next URL immediately rather than waiting
        console.warn(`[wallet] ${label} rate-limited on ${rpcUrl}, trying next RPC`);
        continue;
      }
      console.warn(`[wallet] ${label} read failed on ${rpcUrl}: ${shortReadError(error)}`);
    }
  }
  console.warn(`[wallet] ${label} read unavailable, using fallback: ${shortReadError(lastError)}`);
  return fallback;
}

/**
 * When every Arc RPC fails, throw instead of returning 0n — so `/api/wallet/execution`
 * does not return HTTP 200 with fake “empty wallet” balances (the root cause of “always zero” UIs).
 */
async function readArcOrThrow<T>(
  label: string,
  read: (client: ReturnType<typeof createPublicClient>) => Promise<T>,
): Promise<T> {
  const urls = arcReadRpcUrls();
  if (urls.length === 0) {
    throw new Error(
      '[wallet] No Arc RPC URLs configured. Set ALCHEMY_ARC_RPC and/or ARC public RPC in environment.',
    );
  }
  let lastError: unknown;
  for (const rpcUrl of urls) {
    try {
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { retryCount: 0 }),
      });
      return await read(client);
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error)) {
        console.warn(`[wallet] ${label} rate-limited on ${rpcUrl}, trying next RPC`);
        continue;
      }
      console.warn(`[wallet] ${label} read failed on ${rpcUrl}: ${shortReadError(error)}`);
    }
  }
  throw new Error(
    `Arc ${label} failed after all RPC attempts. Configure a reliable Alchemy/Infura URL (e.g. ALCHEMY_ARC_RPC). ` +
      `Last error: ${shortReadError(lastError)}`,
  );
}

function readNativeUsdcBalance(address: `0x${string}`): Promise<bigint> {
  return readArcWithFallback(
    `native USDC ${address}`,
    (client) => client.getBalance({ address }),
    0n,
  );
}

function readTokenBalance(
  token: `0x${string}`,
  account: `0x${string}`,
  label: string,
): Promise<bigint> {
  return readArcWithFallback(
    `${label} ${account}`,
    (client) =>
      client.readContract({
        address: token,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [account],
      }) as Promise<bigint>,
    0n,
  );
}

function readNativeUsdcBalanceStrict(address: `0x${string}`): Promise<bigint> {
  return readArcOrThrow(
    `native USDC (DCW) ${address}`,
    (client) => client.getBalance({ address }),
  );
}

function readTokenBalanceStrict(
  token: `0x${string}`,
  account: `0x${string}`,
  label: string,
): Promise<bigint> {
  return readArcOrThrow(
    `${label} ${account}`,
    (client) =>
      client.readContract({
        address: token,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [account],
      }) as Promise<bigint>,
  );
}

router.post('/create', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    return res.json({
      walletAddress: auth.walletAddress,
      userAgentWalletAddress: wallet.address,
      userAgentWalletId: wallet.wallet_id,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'wallet create failed' });
  }
});

router.post('/deposit-gateway', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const amountRaw = req.body?.amount;
    if (amountRaw === undefined || amountRaw === null || String(amountRaw).trim() === '') {
      return res.status(400).json({ error: 'amount required' });
    }
    const amount = String(amountRaw).trim();
    try {
      parseUnits(amount, 6);
    } catch {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const result = await transferToGateway({
      walletId: wallet.wallet_id,
      walletAddress: wallet.address,
      maxAmountUsdc: amount,
    });
    if (result.depositState === 'COMPLETE') {
      return res.json({ ok: true, ...result });
    }
    return res.status(400).json({
      ok: false,
      error: result.errorDetails || result.errorReason || result.status || 'Gateway deposit did not complete',
      ...result,
    });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Gateway deposit failed',
    });
  }
});

router.get('/all-balances', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const eoa = getAddress(auth.walletAddress) as `0x${string}`;
    const dcw = getAddress(wallet.address) as `0x${string}`;

    /** Sum Gateway USDC for EOA and DCW — on-chain `deposit` is credited to `msg.sender`. */
    const gatewayDepositors = uniqueAddresses([eoa, dcw]);

    const [eoaBal, eoaNativeBal, dcwBal, dcwNativeBal, gatewayBals] = await Promise.all([
      readTokenBalanceStrict(ARC_USDC as `0x${string}`, eoa, 'EOA USDC'),
      readNativeUsdcBalanceStrict(eoa),
      readTokenBalanceStrict(ARC_USDC as `0x${string}`, dcw, 'DCW USDC'),
      readNativeUsdcBalanceStrict(dcw),
      fetchGatewayBalancesForDepositors(gatewayDepositors),
    ]);

    const gNum = Number(gatewayBals.available);
    const usdc = Number.isFinite(gNum) ? gNum : 0;

    return res.json({
      eoa: {
        address: auth.walletAddress,
        usdc: formatUnits(eoaBal, 6),
        nativeUsdc: formatUnits(eoaNativeBal, 18),
      },
      dcw: {
        address: wallet.address,
        usdc: formatUnits(dcwBal, 6),
        nativeUsdc: formatUnits(dcwNativeBal, 18),
      },
      gateway: {
        address: wallet.address,
        usdc: usdc.toFixed(6),
        queriedDepositors: gatewayDepositors,
      },
    });
  } catch (e) {
    const failure = walletReadFailure(e, 'Failed to fetch balances');
    return res.status(failure.status).json({ error: failure.error });
  }
});

router.get('/execution', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const executionWalletAddress = getAddress(wallet.address);
    const eoa = getAddress(auth.walletAddress) as `0x${string}`;
    const vaultAddress = ARC.vaultContract?.trim();
    /** Gateway credits the caller — include EOA + DCW so EOA- and agent-funded deposits both count. */
    const gatewayDepositors = uniqueAddresses([eoa, executionWalletAddress]);

    const [nativeGasRaw, usdcRaw, eurcRaw, vaultSharesRaw, holdings, gatewayBalance] = await Promise.all([
      readNativeUsdcBalanceStrict(executionWalletAddress as `0x${string}`),
      readTokenBalanceStrict(ARC_USDC as `0x${string}`, executionWalletAddress as `0x${string}`, 'DCW USDC'),
      readTokenBalanceStrict(ARC_EURC as `0x${string}`, executionWalletAddress as `0x${string}`, 'DCW EURC'),
      vaultAddress
        ? readTokenBalanceStrict(
            vaultAddress as `0x${string}`,
            executionWalletAddress as `0x${string}`,
            'vault shares',
          )
        : Promise.resolve(0n),
      getArcRpcHoldings(executionWalletAddress).catch(() => []),
      /** Do not swallow Gateway API errors as 0 — that made the UI show “empty” balances on network failure. */
      fetchGatewayBalancesForDepositors(gatewayDepositors),
    ]);

    return res.json({
      walletAddress: auth.walletAddress,
      userAgentWalletAddress: executionWalletAddress,
      userAgentWalletId: wallet.wallet_id,
      gatewayFundingAddress: executionWalletAddress,
      gatewayDepositorAddress: executionWalletAddress,
      gatewayQueriedDepositors: gatewayDepositors,
      explorerUrl: `https://testnet.arcscan.app/address/${executionWalletAddress}`,
      balances: {
        nativeUsdcGas: {
          raw: nativeGasRaw.toString(),
          formatted: formatUnits(nativeGasRaw, 18),
        },
        usdc: {
          raw: usdcRaw.toString(),
          formatted: formatUnits(usdcRaw, 6),
        },
        eurc: {
          raw: eurcRaw.toString(),
          formatted: formatUnits(eurcRaw, 6),
        },
        vaultShares: {
          raw: vaultSharesRaw.toString(),
          formatted: formatUnits(vaultSharesRaw, 6),
        },
        gatewayUsdc: {
          raw: gatewayBalance.available,
          formatted: gatewayBalance.available,
          total: gatewayBalance.total,
        },
      },
      fundingStatus: {
        needsGasFunding: nativeGasRaw < parseUnits('0.02', 18),
        needsUsdcFunding: usdcRaw === 0n,
        needsEurcFunding: eurcRaw === 0n,
        needsVaultShares: vaultSharesRaw === 0n,
      },
      holdings,
    });
  } catch (error: any) {
    const failure = walletReadFailure(error, 'Execution wallet fetch failed');
    return res.status(failure.status).json({ error: failure.error });
  }
});

router.get('/usage', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const dailyLimit = getDailyLimit();

    const today = new Date();
    const y = today.getUTCFullYear();
    const m = `${today.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${today.getUTCDate()}`.padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const { data: rows, error } = await adminDb
      .from('usage_daily')
      .select('agent_slug, count')
      .eq('wallet_address', auth.walletAddress)
      .eq('date', dateStr);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const agents = (rows ?? []).map((r) => ({
      agent_slug: r.agent_slug as string,
      count: Number(r.count ?? 0),
    }));
    const counts = agents.map((a) => a.count);
    const worstUsed = counts.length ? Math.max(...counts) : 0;
    const totalUsed = agents.reduce((s, a) => s + a.count, 0);

    return res.json({
      accessModel: 'pay_per_task',
      dailyLimit,
      date: dateStr,
      agents,
      worstUsed,
      totalUsed,
      remainingApprox: Math.max(0, dailyLimit - worstUsed),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'usage failed' });
  }
});

async function arcUsdcBalanceRow(executionAddr: `0x${string}`): Promise<Record<string, unknown>> {
  const client = createPublicClient({ chain, transport: arcReadTransport() });
  const raw = await client.readContract({
    address: ARC_USDC as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [executionAddr],
  });
  const human = Number(formatUnits(raw, 6));
  return {
    contractAddress: ARC_USDC,
    symbol: 'USDC',
    decimals: 6,
    balance: human,
  };
}

function holdingsIncludeUsdc(holdings: unknown[]): boolean {
  if (!Array.isArray(holdings)) return false;
  for (const h of holdings) {
    const row = h as { symbol?: string; contractAddress?: string };
    if ((row.symbol || '').toUpperCase() === 'USDC') return true;
    if (
      String(row.contractAddress || '').toLowerCase() === ARC_USDC.toLowerCase()
    ) {
      return true;
    }
  }
  return false;
}

router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const executionAddr = getAddress(wallet.address as `0x${string}`);
    let holdings: unknown[];
    try {
      holdings = await getArcRpcHoldings(wallet.address);
    } catch {
      holdings = [await arcUsdcBalanceRow(executionAddr)];
    }
    if (!holdingsIncludeUsdc(holdings)) {
      holdings = [...holdings, await arcUsdcBalanceRow(executionAddr)];
    }
    return res.json({
      walletAddress: auth.walletAddress,
      userAgentWalletAddress: wallet.address,
      holdings,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'wallet balance failed' });
  }
});

router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const amountUsdc = Number(req.body?.amountUsdc ?? 0);
    const toAddress = String(req.body?.toAddress ?? auth.walletAddress);

    const result = await performWithdraw({
      walletAddress: auth.walletAddress,
      amountUsdc,
      toAddress,
      requireSignature: false,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'withdraw failed' });
  }
});

router.post('/emergency-withdraw', async (req, res) => {
  try {
    const walletAddress = String(req.body?.walletAddress ?? '');
    const message = String(req.body?.message ?? '');
    const signature = String(req.body?.signature ?? '');
    const amountUsdc = Number(req.body?.amountUsdc ?? 0);
    const toAddress = String(req.body?.toAddress ?? walletAddress);

    const result = await performWithdraw({
      walletAddress,
      message,
      signature,
      amountUsdc,
      toAddress,
      emergency: true,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'emergency withdraw failed' });
  }
});

export default router;

async function performWithdraw(input: {
  walletAddress: string;
  message?: string;
  signature?: string;
  amountUsdc: number;
  toAddress: string;
  emergency?: boolean;
  requireSignature?: boolean;
}): Promise<Record<string, unknown>> {
  if (!isAddress(input.walletAddress)) {
    throw new Error('Valid walletAddress is required');
  }
  if (!isAddress(input.toAddress)) {
    throw new Error('Valid toAddress is required');
  }
  const requireSignature = input.requireSignature ?? true;
  if (requireSignature && (!input.message || !input.signature)) {
    throw new Error('message and signature are required');
  }
  if (!Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
    throw new Error('amountUsdc must be > 0');
  }

  const normalizedWallet = getAddress(input.walletAddress);
  const normalizedTo = getAddress(input.toAddress);
  if (requireSignature) {
    const validSig = await verifyMessage({
      address: normalizedWallet,
      message: input.message as string,
      signature: input.signature as `0x${string}`,
    });
    if (!validSig) {
      throw new Error('Invalid signature');
    }
  }

  const wallet = await getOrCreateUserAgentWallet(normalizedWallet);
  const amountRaw = parseUnits(input.amountUsdc.toFixed(6), 6);

  const tx = await executeTransaction({
    walletId: wallet.wallet_id,
    contractAddress: ARC_USDC,
    abiFunctionSignature: 'transfer(address,uint256)',
    abiParameters: [normalizedTo, amountRaw.toString()],
    feeLevel: 'HIGH',
  });

  const txId = extractTxId(tx);
  if (!txId) {
    throw new Error('Transaction id missing from DCW response');
  }

  const done = await waitForTransaction(txId, input.emergency ? 'emergency-withdraw' : 'withdraw');
  if (done.state !== 'COMPLETE' || !done.txHash) {
    throw new Error(
      `Withdraw failed: state=${done.state ?? 'unknown'} reason=${done.errorReason ?? 'n/a'}`,
    );
  }

  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const receipt = await client.getTransactionReceipt({ hash: done.txHash as `0x${string}` });
  if (receipt.status !== 'success') {
    throw new Error('Withdraw transaction not confirmed onchain');
  }

  return {
    success: true,
    emergency: Boolean(input.emergency),
    walletAddress: normalizedWallet,
    userAgentWalletAddress: wallet.address,
    toAddress: normalizedTo,
    amountUsdc: input.amountUsdc,
    txId,
    txHash: done.txHash,
  };
}

function extractTxId(tx: unknown): string | null {
  const obj = tx as { data?: { id?: string; transaction?: { id?: string } } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}

async function readErc20BalanceRow(params: {
  client: ReturnType<typeof createPublicClient>;
  walletAddress: `0x${string}`;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  usdPrice?: number | null;
}): Promise<Record<string, unknown> | null> {
  const raw = await params.client.readContract({
    address: params.contractAddress as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [params.walletAddress],
  });
  if (raw === 0n) {
    return null;
  }
  const balance = Number(formatUnits(raw, params.decimals));
  const usdPrice = params.usdPrice ?? null;
  return {
    contractAddress: params.contractAddress,
    symbol: params.symbol,
    name: params.name,
    decimals: params.decimals,
    balance,
    usdPrice,
    usdValue: usdPrice !== null ? balance * usdPrice : null,
    source: 'arc_rpc_eth_call_balanceOf',
  };
}

async function getArcRpcHoldings(address: string): Promise<unknown[]> {
  const client = createPublicClient({ chain, transport: arcReadTransport() });
  const walletAddress = getAddress(address) as `0x${string}`;
  const rows: Array<Record<string, unknown>> = [];

  const nativeRaw = await client.getBalance({ address: walletAddress });
  if (nativeRaw > 0n) {
    const balance = Number(formatUnits(nativeRaw, 18));
    rows.push({
      contractAddress: null,
      symbol: 'USDC_GAS',
      name: 'Arc Native USDC Gas',
      decimals: 18,
      balance,
      usdPrice: 1,
      usdValue: balance,
      source: 'arc_rpc_eth_getBalance',
    });
  }

  const tokenRows = await Promise.all([
    readErc20BalanceRow({
      client,
      walletAddress,
      contractAddress: ARC_USDC,
      symbol: 'USDC',
      name: 'USDC',
      decimals: 6,
      usdPrice: 1,
    }),
    readErc20BalanceRow({
      client,
      walletAddress,
      contractAddress: ARC_EURC,
      symbol: 'EURC',
      name: 'EURC',
      decimals: 6,
      usdPrice: 1,
    }),
    ARC.vaultContract && isAddress(ARC.vaultContract)
      ? readErc20BalanceRow({
          client,
          walletAddress,
          contractAddress: ARC.vaultContract,
          symbol: 'VAULT',
          name: 'Vault Shares',
          decimals: 6,
        })
      : Promise.resolve(null),
  ]);

  rows.push(...tokenRows.filter((row): row is Record<string, unknown> => Boolean(row)));
  return rows;
}

const GATEWAY_WALLET_CONTRACT = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
const GATEWAY_MINTER_CONTRACT = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as const;
const ARC_EXPLORER_BASE_URL = 'https://testnet.arcscan.app';
const GATEWAY_EIP712_DOMAIN = { name: 'GatewayWallet', version: '1' } as const;
const GATEWAY_EIP712_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ],
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
} as const;
const GATEWAY_MAX_UINT256 = ((1n << 256n) - 1n).toString();
const GATEWAY_DEFAULT_MAX_FEE = parseUnits('2.01', 6).toString();
const MIN_GATEWAY_MINT_GAS_USDC = parseUnits('0.05', 18);

router.get('/gateway/balance', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const executionWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const executionAddress = getAddress(executionWallet.address) as `0x${string}`;
    const eoa = getAddress(auth.walletAddress) as `0x${string}`;
    const queriedDepositors = uniqueAddresses([eoa, executionAddress]);
    const balance = await fetchGatewayBalancesForDepositors(queriedDepositors);

    return res.json({
      balance: balance.available,
      currency: 'USDC',
      walletAddress: executionAddress,
      queriedDepositors,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'gateway balance failed' });
  }
});

router.post('/gateway/deposit', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    return res.json({
      depositAddress: wallet.address,
      network: 'ARC-TESTNET',
      instructions: 'Send USDC to this Agent Wallet on Arc Testnet, then deposit from Agent Wallet to Gateway.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'gateway deposit info failed' });
  }
});

router.post('/gateway/withdraw', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const amount = String(req.body?.amount ?? '').trim();
    const toAddress = req.body?.toAddress ? String(req.body.toAddress) : auth.walletAddress;
    const normalizedToAddress = normalizeAddressOrThrow(toAddress, 'toAddress');
    const gatewayWallet = await getOrCreateUserAgentWallet(auth.walletAddress);

    const result = await executeGatewayWithdrawal({
      walletId: gatewayWallet.wallet_id,
      walletAddress: gatewayWallet.address,
      amount,
      recipientAddress: normalizedToAddress,
      label: 'gateway-withdraw',
    });

    await logTransaction({
      fromWallet: gatewayWallet.address,
      toWallet: normalizedToAddress,
      amount: result.amount,
      arcTxId: result.txHash,
      actionType: 'gateway_withdraw',
      status: 'completed',
    });

    return res.json({
      txHash: result.txHash,
      explorerLink: getExplorerTxLink(result.txHash),
      amount: result.amount,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'gateway withdraw failed' });
  }
});

router.post('/gateway/to-execution', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const amount = String(req.body?.amount ?? '').trim();
    const gatewayWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const executionWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const executionWalletAddress = getAddress(executionWallet.address);

    const result = await executeGatewayWithdrawal({
      walletId: gatewayWallet.wallet_id,
      walletAddress: gatewayWallet.address,
      amount,
      recipientAddress: executionWalletAddress,
      label: 'gateway-to-execution',
    });

    const client = createPublicClient({ chain, transport: http(ARC.rpc) });
    const newBalanceRaw = (await client.readContract({
      address: ARC_USDC as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [executionWalletAddress as `0x${string}`],
    })) as bigint;

    await logTransaction({
      fromWallet: gatewayWallet.address,
      toWallet: executionWalletAddress,
      amount: result.amount,
      arcTxId: result.txHash,
      actionType: 'gateway_to_execution',
      status: 'completed',
    });

    return res.json({
      success: true,
      amount: result.amount,
      executionWalletAddress,
      newBalance: formatUnits(newBalanceRaw, 6),
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'gateway to execution failed' });
  }
});

type GatewayTransferResult = {
  txHash: string;
  amount: string;
  recipientAddress: `0x${string}`;
};

async function executeGatewayWithdrawal(input: {
  walletId: string;
  walletAddress: string;
  amount: string;
  recipientAddress: string;
  label: string;
}): Promise<GatewayTransferResult> {
  const walletAddress = normalizeAddressOrThrow(input.walletAddress, 'walletAddress');
  const recipientAddress = normalizeAddressOrThrow(input.recipientAddress, 'recipientAddress');
  const amount = normalizeUsdcAmount(input.amount, 'amount');
  const client = createPublicClient({ chain, transport: arcReadTransport() });
  const nativeGasRaw = await client.getBalance({ address: walletAddress });

  if (nativeGasRaw < MIN_GATEWAY_MINT_GAS_USDC) {
    throw new Error(
      `Gateway withdrawal needs direct Arc USDC in the Agent Wallet for gas. Have ${formatUnits(
        nativeGasRaw,
        18,
      )} native USDC; keep at least ${formatUnits(MIN_GATEWAY_MINT_GAS_USDC, 18)} USDC direct, then retry.`,
    );
  }

  const gatewayBalance = await fetchGatewayBalanceForAddress(walletAddress);
  const availableRaw = parseUnits(gatewayBalance.available || '0', 6);

  if (amount.raw > availableRaw) {
    throw new Error(
      `Insufficient Gateway balance: requested ${amount.normalized} USDC, available ${gatewayBalance.available} USDC`,
    );
  }

  const burnIntent = await createGatewayBurnIntent({
    depositorAddress: walletAddress,
    recipientAddress,
    amountRaw: amount.raw,
  });

  const circleWalletMod = await import('../lib/circleWallet');
  const signature = await circleWalletMod.signTypedDataWithCircleWallet(input.walletId, burnIntent);

  const transferResponse = await fetch(`${GATEWAY_API_BASE_URL}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        burnIntent: burnIntent.message,
        signature,
      },
    ]),
  });

  const transferJson = (await transferResponse.json().catch(() => ({}))) as {
    attestation?: string;
    signature?: string;
    message?: string;
    error?: string;
  };

  if (!transferResponse.ok || !transferJson.attestation || !transferJson.signature) {
    const details =
      transferJson.message ||
      transferJson.error ||
      `HTTP ${transferResponse.status}`;
    throw new Error(`Gateway transfer failed: ${details}`);
  }

  const tx = await executeTransaction({
    walletId: input.walletId,
    contractAddress: GATEWAY_MINTER_CONTRACT,
    abiFunctionSignature: 'gatewayMint(bytes,bytes)',
    abiParameters: [transferJson.attestation, transferJson.signature],
    feeLevel: 'HIGH',
  });

  const txId = extractTxId(tx);
  if (!txId) {
    throw new Error('Gateway mint transaction id missing');
  }

  const completed = await waitForTransaction(txId, input.label);
  if (completed.state !== 'COMPLETE' || !completed.txHash) {
    const details = [completed.errorReason, completed.errorDetails].filter(Boolean).join(': ');
    throw new Error(
      `Gateway mint failed: state=${completed.state ?? 'unknown'} reason=${details || 'n/a'}`,
    );
  }

  const receipt = await client.getTransactionReceipt({ hash: completed.txHash as `0x${string}` });
  if (receipt.status !== 'success') {
    throw new Error('Gateway mint transaction not confirmed onchain');
  }

  return {
    txHash: completed.txHash,
    amount: amount.normalized,
    recipientAddress,
  };
}

function normalizeAddressOrThrow(value: string, fieldName: string): `0x${string}` {
  if (!isAddress(value)) {
    throw new Error(`Valid ${fieldName} is required`);
  }
  return getAddress(value);
}

function normalizeUsdcAmount(value: string, fieldName: string): { normalized: string; raw: bigint } {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`${fieldName} must be a positive USDC string with up to 6 decimals`);
  }
  const raw = parseUnits(trimmed, 6);
  if (raw <= 0n) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return {
    normalized: formatUnits(raw, 6),
    raw,
  };
}

function addressToBytes32(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

async function createGatewayBurnIntent(input: {
  depositorAddress: string;
  recipientAddress: string;
  amountRaw: bigint;
}): Promise<Record<string, unknown>> {
  const { randomBytes } = await import('node:crypto');
  const depositorAddress = normalizeAddressOrThrow(input.depositorAddress, 'depositorAddress');
  const recipientAddress = normalizeAddressOrThrow(input.recipientAddress, 'recipientAddress');

  return {
    types: GATEWAY_EIP712_TYPES,
    domain: GATEWAY_EIP712_DOMAIN,
    primaryType: 'BurnIntent',
    message: {
      maxBlockHeight: GATEWAY_MAX_UINT256,
      maxFee: GATEWAY_DEFAULT_MAX_FEE,
      spec: {
        version: 1,
        sourceDomain: ARC_TESTNET_DOMAIN,
        destinationDomain: ARC_TESTNET_DOMAIN,
        sourceContract: addressToBytes32(GATEWAY_WALLET_CONTRACT),
        destinationContract: addressToBytes32(GATEWAY_MINTER_CONTRACT),
        sourceToken: addressToBytes32(ARC_USDC),
        destinationToken: addressToBytes32(ARC_USDC),
        sourceDepositor: addressToBytes32(depositorAddress),
        destinationRecipient: addressToBytes32(recipientAddress),
        sourceSigner: addressToBytes32(depositorAddress),
        destinationCaller: addressToBytes32('0x0000000000000000000000000000000000000000'),
        value: input.amountRaw.toString(),
        salt: `0x${randomBytes(32).toString('hex')}`,
        hookData: '0x',
      },
    },
  };
}

async function logTransaction(input: {
  fromWallet: string;
  toWallet: string;
  amount: string;
  arcTxId?: string;
  agentSlug?: string | null;
  actionType: string;
  status: string;
}): Promise<void> {
  const { error } = await adminDb.from('transactions').insert({
    from_wallet: input.fromWallet,
    to_wallet: input.toWallet,
    amount: Number(input.amount),
    arc_tx_id: input.arcTxId ?? null,
    agent_slug: input.agentSlug ?? null,
    action_type: input.actionType,
    status: input.status,
  });

  if (error && !String(error.message).toLowerCase().includes('duplicate')) {
    throw new Error(`Failed to log transaction: ${error.message}`);
  }
}

function getExplorerTxLink(txHash: string): string {
  return `${ARC_EXPLORER_BASE_URL}/tx/${txHash}`;
}

async function performEmergencyWithdrawAll(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<Record<string, unknown>> {
  const normalizedWallet = normalizeAddressOrThrow(input.walletAddress, 'walletAddress');
  if (!input.message || !input.signature) {
    throw new Error('message and signature are required');
  }

  const validSig = await verifyMessage({
    address: normalizedWallet,
    message: input.message,
    signature: input.signature as `0x${string}`,
  });
  if (!validSig) {
    throw new Error('Invalid signature');
  }

  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const executionWallet = await getOrCreateUserAgentWallet(normalizedWallet);
  const executionWalletAddress = getAddress(executionWallet.address);
  const gatewayWallet = await getOrCreateGatewayFundingWallet(normalizedWallet);
  const executionUsdcRaw = (await client.readContract({
    address: ARC_USDC as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [executionWalletAddress as `0x${string}`],
  })) as bigint;
  const gatewayBalance = await fetchGatewayBalanceForAddress(gatewayWallet.address);
  const gatewayAvailableRaw = parseUnits(gatewayBalance.available || '0', 6);

  let dcwTxHash = '';
  let gatewayTxHash = '';
  let totalWithdrawnRaw = 0n;

  if (executionUsdcRaw > 0n) {
    const tx = await executeTransaction({
      walletId: executionWallet.wallet_id,
      contractAddress: ARC_USDC,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [normalizedWallet, executionUsdcRaw.toString()],
      feeLevel: 'HIGH',
    });

    const txId = extractTxId(tx);
    if (!txId) {
      throw new Error('Execution wallet withdrawal transaction id missing');
    }

    const completed = await waitForTransaction(txId, 'emergency-withdraw-execution');
    if (completed.state !== 'COMPLETE' || !completed.txHash) {
      throw new Error(
        `Execution wallet emergency withdrawal failed: state=${completed.state ?? 'unknown'} reason=${completed.errorReason ?? 'n/a'}`,
      );
    }

    const receipt = await client.getTransactionReceipt({ hash: completed.txHash as `0x${string}` });
    if (receipt.status !== 'success') {
      throw new Error('Execution wallet emergency withdrawal not confirmed onchain');
    }

    dcwTxHash = completed.txHash;
    totalWithdrawnRaw += executionUsdcRaw;

    await logTransaction({
      fromWallet: executionWalletAddress,
      toWallet: normalizedWallet,
      amount: formatUnits(executionUsdcRaw, 6),
      arcTxId: completed.txHash,
      actionType: 'emergency_withdraw_execution',
      status: 'completed',
    });
  }

  if (gatewayAvailableRaw > 0n) {
    const gatewayResult = await executeGatewayWithdrawal({
      walletId: gatewayWallet.walletId,
      walletAddress: gatewayWallet.address,
      amount: formatUnits(gatewayAvailableRaw, 6),
      recipientAddress: normalizedWallet,
      label: 'emergency-withdraw-gateway',
    });

    gatewayTxHash = gatewayResult.txHash;
    totalWithdrawnRaw += gatewayAvailableRaw;

    await logTransaction({
      fromWallet: gatewayWallet.address,
      toWallet: normalizedWallet,
      amount: gatewayResult.amount,
      arcTxId: gatewayResult.txHash,
      actionType: 'emergency_withdraw_gateway',
      status: 'completed',
    });
  }

  return {
    dcwTxHash,
    gatewayTxHash,
    totalWithdrawn: formatUnits(totalWithdrawnRaw, 6),
  };
}

function installEmergencyWithdrawWrapper(): void {
  const stack = (router as any).stack as Array<{
    route?: {
      path?: string;
      methods?: Record<string, boolean>;
      stack?: Array<{ handle?: (...args: unknown[]) => unknown }>;
    };
  }>;

  const emergencyLayer = stack?.find(
    (layer) => layer.route?.path === '/emergency-withdraw' && layer.route?.methods?.post,
  );
  const existingHandle = emergencyLayer?.route?.stack?.[0]?.handle;

  if (!emergencyLayer?.route?.stack?.length || !existingHandle) {
    return;
  }

  const currentHandle = emergencyLayer.route.stack[0].handle as any;
  if (currentHandle?.__agentflowV3EmergencyWrapper) {
    return;
  }

  const wrappedHandle = async (req: any, res: any, next: any) => {
    const amountUsdc = Number(req.body?.amountUsdc ?? 0);
    if (Number.isFinite(amountUsdc) && amountUsdc > 0) {
      return existingHandle(req, res, next);
    }

    try {
      const walletAddress = String(req.body?.walletAddress ?? '');
      const message = String(req.body?.message ?? '');
      const signature = String(req.body?.signature ?? '');
      const result = await performEmergencyWithdrawAll({
        walletAddress,
        message,
        signature,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message ?? 'emergency withdraw failed' });
    }
  };

  (wrappedHandle as any).__agentflowV3EmergencyWrapper = true;
  emergencyLayer.route.stack[0].handle = wrappedHandle;
}

installEmergencyWithdrawWrapper();
