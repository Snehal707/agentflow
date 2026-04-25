import dotenv from 'dotenv';
import { BridgeKit, ArcTestnet, EthereumSepolia, BaseSepolia } from '@circle-fin/bridge-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import { createPublicClient, defineChain, formatEther, formatUnits, getAddress, http, parseAbi } from 'viem';

import { adminDb } from '../../db/client';
import { getCircleClient, type PersistedWalletRow } from '../../lib/dcw';

dotenv.config();

export type SupportedSourceChain = 'ethereum-sepolia' | 'base-sepolia';

export interface BridgeTransferEvent {
  event:
    | 'preflight'
    | 'estimated'
    | 'approved'
    | 'burned'
    | 'attested'
    | 'minted'
    | 'completed'
    | 'blocked'
    | 'error';
  data: Record<string, unknown>;
}

export interface BridgePreflight {
  source: {
    key: SupportedSourceChain;
    chain: string;
    circleBlockchain: string;
    walletId: string;
    address: string;
    nativeSymbol: string;
    nativeBalance: string;
    usdcBalance: string;
  };
  destination: {
    chain: string;
    operatorAddress: string;
    recipientAddress: string;
  };
  estimate?: unknown;
  sdkArcDomain: number | null;
}

export interface ExecuteBridgeResult {
  ok: boolean;
  reason?: string;
  preflight: BridgePreflight;
  result?: unknown;
  /** Non-blocking hints from estimate (e.g. high fee %). */
  warnings?: string[];
}

export interface SimulateBridgeResult {
  ok: boolean;
  reason?: string;
  preflight: BridgePreflight;
  warnings: string[];
}

export interface SupportedBridgeSourceInfo {
  key: SupportedSourceChain;
  label: string;
  circleBlockchain: string;
  chainId: number;
  cctpDomain: number | null;
  usdcAddress: string | null;
}

export interface BridgeSourceWalletCheck {
  key: SupportedSourceChain;
  label: string;
  walletAddress: string;
  nativeSymbol: string;
  nativeBalance: string;
  usdcBalance: string;
  hasGas: boolean;
  hasUsdc: boolean;
  enoughUsdcForAmount: boolean | null;
  ready: boolean;
  error?: string;
}

export interface BridgePrecheckReport {
  walletAddress: string;
  requestedAmount?: string;
  supportedSources: SupportedBridgeSourceInfo[];
  checks: BridgeSourceWalletCheck[];
}

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

const SOURCE_CHAIN_CONFIG: Record<
  SupportedSourceChain,
  {
    key: SupportedSourceChain;
    bridgeChain: typeof EthereumSepolia.chain | typeof BaseSepolia.chain;
    circleBlockchain: string;
    definition: {
      chain: string;
      chainId: number;
      name: string;
      nativeCurrency: { name: string; symbol: string; decimals: number };
      rpcEndpoints: readonly string[];
      usdcAddress: string | null;
    };
  }
> = {
  'ethereum-sepolia': {
    key: 'ethereum-sepolia',
    bridgeChain: EthereumSepolia.chain,
    circleBlockchain: 'ETH-SEPOLIA',
    definition: EthereumSepolia,
  },
  'base-sepolia': {
    key: 'base-sepolia',
    bridgeChain: BaseSepolia.chain,
    circleBlockchain: 'BASE-SEPOLIA',
    definition: BaseSepolia,
  },
};

const SOURCE_CHAIN_DOMAIN: Record<SupportedSourceChain, number | null> = {
  'ethereum-sepolia': 0,
  'base-sepolia': 6,
};

const ARC_CHAIN = ArcTestnet.chain as typeof ArcTestnet.chain;
const BRIDGE_SOURCE_REF_ID: Record<SupportedSourceChain, string> = {
  'ethereum-sepolia': 'bridge:owner:ETH-SEPOLIA',
  'base-sepolia': 'bridge:owner:BASE-SEPOLIA',
};

type BridgeContext = {
  adapter: ReturnType<typeof createCircleWalletsAdapter>;
  kit: BridgeKit;
  sourceConfig: ReturnType<typeof getSourceChainConfig>;
  sourceWallet: { walletId: string; address: string };
  bridgeOwner: PersistedWalletRow;
  recipientAddress: `0x${string}`;
  amount: string;
};

function parseBridgeTxHash(result: unknown): string | null {
  const root = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  const steps = Array.isArray(root?.steps) ? root.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const record = step as Record<string, unknown>;
    const values =
      record.values && typeof record.values === 'object'
        ? (record.values as Record<string, unknown>)
        : undefined;
    for (const source of [record, values].filter(Boolean) as Record<string, unknown>[]) {
      for (const key of ['txHash', 'transactionHash', 'hash'] as const) {
        const value = source[key];
        if (typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)) {
          return value;
        }
      }
    }
  }
  for (const key of ['txHash', 'transactionHash', 'hash'] as const) {
    const value = root?.[key];
    if (typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)) {
      return value;
    }
  }
  return null;
}

async function prepareBridgeContext(input: {
  sourceChain: SupportedSourceChain;
  recipientAddress: string;
  amount: string;
}): Promise<BridgeContext> {
  const recipientAddress = getAddress(input.recipientAddress);
  const amount = normalizeAmount(input.amount);
  const sourceConfig = getSourceChainConfig(input.sourceChain);
  const bridgeOwner = await getBridgeOwnerWallet();
  const sourceWallet = await ensureSourceWalletForChain(bridgeOwner, sourceConfig.key);

  const adapter = createCircleWalletsAdapter({
    apiKey: requireEnv('CIRCLE_API_KEY'),
    entitySecret: requireEnv('CIRCLE_ENTITY_SECRET'),
  });

  return {
    adapter,
    kit: new BridgeKit(),
    sourceConfig,
    sourceWallet,
    bridgeOwner,
    recipientAddress,
    amount,
  };
}

function buildPreflight(
  ctx: BridgeContext,
  sourceBalances: { nativeBalance: string; usdcBalance: string },
): BridgePreflight {
  return {
    source: {
      key: ctx.sourceConfig.key,
      chain: ctx.sourceConfig.bridgeChain,
      circleBlockchain: ctx.sourceConfig.circleBlockchain,
      walletId: ctx.sourceWallet.walletId,
      address: ctx.sourceWallet.address,
      nativeSymbol: ctx.sourceConfig.definition.nativeCurrency.symbol,
      nativeBalance: sourceBalances.nativeBalance,
      usdcBalance: sourceBalances.usdcBalance,
    },
    destination: {
      chain: ARC_CHAIN,
      operatorAddress: ctx.bridgeOwner.address,
      recipientAddress: ctx.recipientAddress,
    },
    sdkArcDomain: ArcTestnet.cctp?.domain ?? null,
  };
}

/** Estimate + balance checks only — no kit.bridge. */
export async function simulateBridgeTransfer(input: {
  sourceChain: SupportedSourceChain;
  recipientAddress: string;
  amount: string;
  onEvent?: (event: BridgeTransferEvent) => void;
}): Promise<SimulateBridgeResult> {
  const ctx = await prepareBridgeContext(input);
  const sourceBalances = await readSourceBalances(ctx.sourceWallet.address, ctx.sourceConfig.key);
  const preflight = buildPreflight(ctx, sourceBalances);

  emit(input.onEvent, 'preflight', preflight);
  registerKitEvents(ctx.kit, input.onEvent);

  let estimate: unknown;
  try {
    estimate = await ctx.kit.estimate({
      from: {
        adapter: ctx.adapter,
        chain: ctx.sourceConfig.bridgeChain,
        address: ctx.sourceWallet.address,
      },
      to: {
        adapter: ctx.adapter,
        chain: ARC_CHAIN,
        address: ctx.bridgeOwner.address,
        recipientAddress: ctx.recipientAddress,
      },
      amount: ctx.amount,
      token: 'USDC',
    });
    preflight.estimate = makeJsonSafe(estimate);
    emit(input.onEvent, 'estimated', {
      estimate,
    });
  } catch (error) {
    emit(input.onEvent, 'error', {
      step: 'estimate',
      message: toMessage(error),
    });
    throw error;
  }

  const warnings: string[] = [];
  const feeWarn = feePercentWarning(ctx.amount, estimate);
  if (feeWarn) {
    warnings.push(feeWarn);
  }

  const reason = buildBridgeInsufficientFundsReason({
    sourceName: ctx.sourceConfig.definition.name,
    sourceWalletAddress: ctx.sourceWallet.address,
    nativeSymbol: preflight.source.nativeSymbol,
    nativeBalance: preflight.source.nativeBalance,
    usdcBalance: preflight.source.usdcBalance,
    amountNeeded: ctx.amount,
    estimate,
  });
  if (reason) {
    emit(input.onEvent, 'blocked', {
      reason,
      preflight,
    });
    return {
      ok: false,
      reason,
      preflight,
      warnings,
    };
  }

  return {
    ok: true,
    preflight,
    warnings,
  };
}

/** DCW bridge only — call after successful `simulateBridgeTransfer`. */
export async function bridgeTransferExecute(input: {
  sourceChain: SupportedSourceChain;
  recipientAddress: string;
  amount: string;
  onEvent?: (event: BridgeTransferEvent) => void;
}): Promise<ExecuteBridgeResult> {
  const ctx = await prepareBridgeContext(input);
  const sourceBalances = await readSourceBalances(ctx.sourceWallet.address, ctx.sourceConfig.key);
  const preflight = buildPreflight(ctx, sourceBalances);

  emit(input.onEvent, 'preflight', preflight);
  registerKitEvents(ctx.kit, input.onEvent);

  let estimate: unknown;
  try {
    estimate = await ctx.kit.estimate({
      from: {
        adapter: ctx.adapter,
        chain: ctx.sourceConfig.bridgeChain,
        address: ctx.sourceWallet.address,
      },
      to: {
        adapter: ctx.adapter,
        chain: ARC_CHAIN,
        address: ctx.bridgeOwner.address,
        recipientAddress: ctx.recipientAddress,
      },
      amount: ctx.amount,
      token: 'USDC',
    });
    preflight.estimate = makeJsonSafe(estimate);
    emit(input.onEvent, 'estimated', { estimate });
  } catch (error) {
    emit(input.onEvent, 'error', {
      step: 'estimate',
      message: toMessage(error),
    });
    throw error;
  }

  const reason = buildBridgeInsufficientFundsReason({
    sourceName: ctx.sourceConfig.definition.name,
    sourceWalletAddress: ctx.sourceWallet.address,
    nativeSymbol: preflight.source.nativeSymbol,
    nativeBalance: preflight.source.nativeBalance,
    usdcBalance: preflight.source.usdcBalance,
    amountNeeded: ctx.amount,
    estimate,
  });
  if (reason) {
    emit(input.onEvent, 'blocked', { reason, preflight });
    return { ok: false, reason, preflight };
  }

  try {
    const result = await ctx.kit.bridge({
      from: {
        adapter: ctx.adapter,
        chain: ctx.sourceConfig.bridgeChain,
        address: ctx.sourceWallet.address,
      },
      to: {
        adapter: ctx.adapter,
        chain: ARC_CHAIN,
        address: ctx.bridgeOwner.address,
        recipientAddress: ctx.recipientAddress,
      },
      amount: ctx.amount,
      token: 'USDC',
    });

    const safeResult = makeJsonSafe(result);
    emit(input.onEvent, 'completed', {
      result: safeResult,
    });

    return {
      ok: true,
      preflight,
      result: safeResult,
    };
  } catch (error) {
    emit(input.onEvent, 'error', {
      step: 'bridge',
      message: toMessage(error),
    });
    throw error;
  }
}

/**
 * Full flow: simulate (estimate + checks) then bridge. Used by scripts and HTTP `/run`.
 */
export async function executeBridgeTransfer(input: {
  sourceChain: SupportedSourceChain;
  recipientAddress: string;
  amount: string;
  onEvent?: (event: BridgeTransferEvent) => void;
}): Promise<ExecuteBridgeResult> {
  const sim = await simulateBridgeTransfer(input);
  if (!sim.ok) {
    return {
      ok: false,
      reason: sim.reason,
      preflight: sim.preflight,
      warnings: sim.warnings,
    };
  }
  const exec = await bridgeTransferExecute(input);
  return {
    ...exec,
    warnings: [...(sim.warnings ?? []), ...(exec.warnings ?? [])],
  };
}

function bridgeSourceLabel(key: SupportedSourceChain): string {
  if (key === 'ethereum-sepolia') {
    return 'Ethereum Sepolia';
  }
  if (key === 'base-sepolia') {
    return 'Base Sepolia';
  }
  return key;
}

/** User-facing block for Telegram after successful simulation. */
export function formatBridgeSimulationForTelegram(
  sim: SimulateBridgeResult,
  amountUsdc: string,
): string {
  if (!sim.ok) {
    return sim.reason ?? 'Bridge simulation failed.';
  }
  const p = sim.preflight;
  const est = p.estimate as Record<string, unknown> | undefined;
  const recv = formatBridgeReceiveAmount(est, amountUsdc);
  const eta = formatBridgeEta(est);
  const feeLines = formatBridgeFeeLines(est);

  const lines = [
    '📊 Bridge estimate:',
    '',
    `From: ${bridgeSourceLabel(p.source.key)}`,
    'To:   Arc Testnet',
    '',
    `Source wallet:\n${p.source.address}`,
    '',
    `You send:    ${Number(amountUsdc).toFixed(2)} USDC`,
    `You receive: ${recv} USDC`,
    '',
    'Fees:',
    ...feeLines,
    '',
    `⏱ Estimated time: ${eta}`,
    '',
    ...(sim.warnings.length ? [...sim.warnings, ''] : []),
    '✅ Preflight passed',
    '',
    'Execute? Reply YES or NO.',
  ];

  return lines.join('\n');
}

export function formatBridgeSimulationForChat(
  sim: SimulateBridgeResult,
  amountUsdc: string,
): string {
  if (!sim.ok) {
    return sim.reason ?? 'Bridge simulation failed.';
  }
  const p = sim.preflight;
  const est = p.estimate as Record<string, unknown> | undefined;
  const recv = formatBridgeReceiveAmount(est, amountUsdc);
  const eta = formatBridgeEta(est);
  const feeLines = formatBridgeFeeLines(est);

  return [
    'Bridge estimate:',
    '',
    `From: ${bridgeSourceLabel(p.source.key)}`,
    'To: Arc Testnet',
    '',
    'AgentFlow-managed source wallet:',
    p.source.address,
    '',
    'Recipient on Arc:',
    p.destination.recipientAddress,
    '',
    `You send:    ${Number(amountUsdc).toFixed(2)} USDC`,
    `You receive: ${recv} USDC`,
    '',
    'Fees:',
    ...feeLines,
    '',
    `Estimated time: ${eta}`,
    '',
    'AgentFlow sponsors bridge execution, so no Gateway balance is required for this bridge.',
    '',
    ...(sim.warnings.length ? [...sim.warnings, ''] : []),
    'Preflight passed.',
    '',
    'Reply YES to execute or NO to cancel.',
  ].join('\n');
}

function formatBridgeReceiveAmount(
  est: Record<string, unknown> | undefined,
  amountUsdc: string,
): string {
  const value = firstDefinedNumberLike([
    est?.amountReceived,
    est?.receiveAmount,
    (est?.destination as Record<string, unknown> | undefined)?.amount,
    (est?.destination as Record<string, unknown> | undefined)?.amountReceived,
    (est?.destination as Record<string, unknown> | undefined)?.receiveAmount,
    (est?.quote as Record<string, unknown> | undefined)?.amountReceived,
    (est?.quote as Record<string, unknown> | undefined)?.amountOut,
    est?.netAmount,
    est?.expectedOutput,
  ]);
  if (value == null) {
    const mintFee = findMintFee(est);
    const providerFee = findProviderFee(est);
    const amountNum = Number(amountUsdc);
    const mintFeeNum = mintFee != null ? Number(mintFee) : NaN;
    const providerFeeNum = providerFee != null ? Number(providerFee) : NaN;
    if (Number.isFinite(amountNum) && Number.isFinite(mintFeeNum)) {
      const totalFee = mintFeeNum + (Number.isFinite(providerFeeNum) ? providerFeeNum : 0);
      const computed = Math.max(amountNum - totalFee, 0).toFixed(6);
      return computed.replace(/0+$/, '').replace(/\.$/, '');
    }
    return amountUsdc;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : String(value);
}

function formatBridgeEta(est: Record<string, unknown> | undefined): string {
  const seconds = firstDefinedNumberLike([
    est?.estimatedTimeSeconds,
    est?.time,
    est?.duration,
    est?.seconds,
    (est?.estimatedTime as Record<string, unknown> | undefined)?.seconds,
  ]);
  if (seconds != null) {
    const secNum = Number(seconds);
    if (Number.isFinite(secNum) && secNum > 0) {
      return `~${Math.round(secNum)} seconds (Fast Transfer)`;
    }
  }
  if (typeof est?.estimatedTime === 'string' && est.estimatedTime.trim()) {
    return est.estimatedTime.trim();
  }
  return '~15 seconds (CCTP Fast Transfer)';
}

function formatBridgeFeeLines(est: Record<string, unknown> | undefined): string[] {
  if (!est) {
    return ['—'];
  }

  const lines: string[] = [];
  const gasFees = Array.isArray(est.gasFees) ? est.gasFees : [];
  let hasMintGasLine = false;
  for (const fee of gasFees) {
    if (!fee || typeof fee !== 'object') {
      continue;
    }
    const item = fee as Record<string, unknown>;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Gas';
    const token = typeof item.token === 'string' && item.token.trim() ? item.token.trim() : 'token';
    const amount = firstDefinedNumberLike([
      (item.fees as Record<string, unknown> | undefined)?.fee,
      item.fee,
    ]);
    if (amount != null) {
      lines.push(`→ ${name} gas: ~${String(amount)} ${token}`);
      if (name.trim().toLowerCase() === 'mint') {
        hasMintGasLine = true;
      }
    }
  }

  const mintFee = findMintFee(est);
  if (mintFee != null && !hasMintGasLine) {
    lines.push(`→ Mint fee: ${String(mintFee)} USDC`);
  }

  const providerFee = findProviderFee(est);
  if (providerFee != null) {
    lines.push(`→ Provider fee: ${String(providerFee)} USDC`);
  }

  return lines.length ? lines : ['—'];
}

function findMintFee(est: Record<string, unknown> | undefined): string | number | null {
  if (!est) {
    return null;
  }
  const gasFees = Array.isArray(est.gasFees) ? est.gasFees : [];
  const mintGasFee = gasFees.find((fee) => {
    if (!fee || typeof fee !== 'object') {
      return false;
    }
    const name = (fee as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim().toLowerCase() === 'mint';
  }) as Record<string, unknown> | undefined;

  return firstDefinedNumberLike([
    (mintGasFee?.fees as Record<string, unknown> | undefined)?.fee,
    mintGasFee?.fee,
    est.mintFee,
    est.fee,
    est.totalFee,
    (est.fees as Record<string, unknown> | undefined)?.mint,
    (est.fees as Record<string, unknown> | undefined)?.total,
  ]);
}

function findProviderFee(est: Record<string, unknown> | undefined): string | number | null {
  if (!est) {
    return null;
  }
  const fees = Array.isArray(est.fees) ? est.fees : [];
  const providerFee = fees.find((fee) => {
    if (!fee || typeof fee !== 'object') {
      return false;
    }
    const type = (fee as Record<string, unknown>).type;
    return typeof type === 'string' && type.trim().toLowerCase() === 'provider';
  }) as Record<string, unknown> | undefined;

  return firstDefinedNumberLike([
    providerFee?.amount,
    providerFee?.fee,
  ]);
}

function firstDefinedNumberLike(values: unknown[]): string | number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return value.trim();
      }
    }
  }
  return null;
}

function feePercentWarning(amountStr: string, estimate: unknown): string | null {
  const amt = Number(amountStr);
  if (!Number.isFinite(amt) || amt <= 0) {
    return null;
  }
  const est = estimate as Record<string, unknown>;
  const candidates = [
    est?.totalFee,
    est?.fee,
    est?.mintFee,
    est?.forwardingFee,
    (est?.fees as Record<string, unknown>)?.total,
  ];
  let feeNum = 0;
  for (const c of candidates) {
    const n = typeof c === 'string' || typeof c === 'number' ? Number(c) : NaN;
    if (Number.isFinite(n) && n > feeNum) {
      feeNum = n;
    }
  }
  if (!(feeNum > 0)) {
    return null;
  }
  const pct = (feeNum / amt) * 100;
  if (pct >= 1) {
    return `⚠️ Fee is ~${pct.toFixed(2)}% of your transfer amount`;
  }
  return null;
}

function buildBridgeInsufficientFundsReason(input: {
  sourceName: string;
  sourceWalletAddress: string;
  nativeSymbol: string;
  nativeBalance: string;
  usdcBalance: string;
  amountNeeded: string;
  estimate: unknown;
}): string | null {
  const nativeBalance = Number(input.nativeBalance);
  const usdcBalance = Number(input.usdcBalance);
  const amountNeeded = Number(input.amountNeeded);
  const nativeNeeded = estimateRequiredNativeFee(input.estimate);

  const reasons = [
    !Number.isFinite(nativeBalance) || nativeBalance <= 0
      ? `❌ No ${input.nativeSymbol} for gas on ${input.sourceName}\nFund: ${input.sourceWalletAddress}`
      : nativeNeeded > 0 && nativeBalance < nativeNeeded
        ? `❌ Insufficient ${input.nativeSymbol} for gas on ${input.sourceName}\nBalance: ${input.nativeBalance} ${input.nativeSymbol}\nNeeded: ${nativeNeeded.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')} ${input.nativeSymbol}\nFund: ${input.sourceWalletAddress}`
        : null,
    !Number.isFinite(usdcBalance) || usdcBalance < amountNeeded
      ? `❌ Insufficient USDC on ${input.sourceName}\nBalance: ${input.usdcBalance} USDC\nNeeded: ${input.amountNeeded} USDC\nFund: ${input.sourceWalletAddress}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return reasons.length ? reasons.join('\n') : null;
}

function estimateRequiredNativeFee(estimate: unknown): number {
  const est = estimate as Record<string, unknown> | undefined;
  if (!est) {
    return 0;
  }
  const gasFees = Array.isArray(est.gasFees) ? est.gasFees : [];
  let total = 0;
  for (const fee of gasFees) {
    if (!fee || typeof fee !== 'object') {
      continue;
    }
    const item = fee as Record<string, unknown>;
    const feeValue = (item.fees as Record<string, unknown> | undefined)?.fee ?? item.fee;
    const feeNum = typeof feeValue === 'number' ? feeValue : Number(feeValue);
    if (Number.isFinite(feeNum) && feeNum > 0) {
      total += feeNum;
    }
  }
  return total;
}

export async function getBridgeOwnerWallet(): Promise<PersistedWalletRow> {
  const { data, error } = await adminDb
    .from('wallets')
    .select('*')
    .eq('agent_slug', 'bridge')
    .eq('purpose', 'owner')
    .maybeSingle();

  if (error) {
    throw new Error(`[bridge] Failed loading bridge owner wallet: ${error.message}`);
  }
  if (!data) {
    throw new Error('[bridge] Bridge owner wallet not found in Supabase');
  }

  return data as PersistedWalletRow;
}

export function getSupportedSourceChains(): SupportedSourceChain[] {
  return Object.keys(SOURCE_CHAIN_CONFIG) as SupportedSourceChain[];
}

export function listSupportedBridgeSourcesDetailed(): SupportedBridgeSourceInfo[] {
  return getSupportedSourceChains().map((key) => {
    const config = SOURCE_CHAIN_CONFIG[key];
    return {
      key,
      label: bridgeSourceLabel(key),
      circleBlockchain: config.circleBlockchain,
      chainId: config.definition.chainId,
      cctpDomain: SOURCE_CHAIN_DOMAIN[key],
      usdcAddress: config.definition.usdcAddress,
    };
  });
}

export async function inspectBridgeSourceWallet(input: {
  walletAddress: string;
  sourceChain?: SupportedSourceChain;
  amount?: string;
}): Promise<BridgePrecheckReport> {
  const walletAddress = getAddress(input.walletAddress);
  const requestedAmount =
    typeof input.amount === 'string' && input.amount.trim()
      ? normalizeAmount(input.amount)
      : undefined;
  const requestedAmountNum = requestedAmount ? Number(requestedAmount) : null;
  const sourceKeys = input.sourceChain ? [input.sourceChain] : getSupportedSourceChains();

  const checks = await Promise.all(
    sourceKeys.map(async (key): Promise<BridgeSourceWalletCheck> => {
      const config = getSourceChainConfig(key);
      try {
        const balances = await readSourceBalances(walletAddress, key);
        const nativeBalanceNum = Number(balances.nativeBalance);
        const usdcBalanceNum = Number(balances.usdcBalance);
        const hasGas = Number.isFinite(nativeBalanceNum) && nativeBalanceNum > 0;
        const hasUsdc = Number.isFinite(usdcBalanceNum) && usdcBalanceNum > 0;
        const enoughUsdcForAmount =
          requestedAmountNum == null
            ? null
            : Number.isFinite(usdcBalanceNum) && usdcBalanceNum >= requestedAmountNum;

        return {
          key,
          label: bridgeSourceLabel(key),
          walletAddress,
          nativeSymbol: config.definition.nativeCurrency.symbol,
          nativeBalance: balances.nativeBalance,
          usdcBalance: balances.usdcBalance,
          hasGas,
          hasUsdc,
          enoughUsdcForAmount,
          ready: hasGas && (requestedAmountNum == null ? hasUsdc : enoughUsdcForAmount === true),
        };
      } catch (error) {
        return {
          key,
          label: bridgeSourceLabel(key),
          walletAddress,
          nativeSymbol: config.definition.nativeCurrency.symbol,
          nativeBalance: '0',
          usdcBalance: '0',
          hasGas: false,
          hasUsdc: false,
          enoughUsdcForAmount: requestedAmountNum == null ? null : false,
          ready: false,
          error: toMessage(error),
        };
      }
    }),
  );

  return {
    walletAddress,
    requestedAmount,
    supportedSources: listSupportedBridgeSourcesDetailed(),
    checks,
  };
}

export function formatBridgePrecheckForChat(report: BridgePrecheckReport): string {
  const supportedSources = report.supportedSources.map((source) => source.label).join(', ');
  const lines = [
    `Supported bridge source chains right now: ${supportedSources}.`,
    `Source wallet: ${report.walletAddress}`,
  ];

  if (report.requestedAmount) {
    lines.push(`Requested bridge amount: ${formatBridgeDisplayAmount(report.requestedAmount)} USDC`);
  }

  lines.push('');

  for (const check of report.checks) {
    lines.push(`${check.label}:`);
    if (check.error) {
      lines.push('- Status: balance read failed.');
      lines.push(`- Error: ${check.error}`);
      lines.push('');
      continue;
    }

    lines.push(`- Gas: ${formatBridgeDisplayAmount(check.nativeBalance)} ${check.nativeSymbol}`);
    lines.push(`- USDC: ${formatBridgeDisplayAmount(check.usdcBalance)} USDC`);
    lines.push(`- Status: ${formatBridgeReadinessStatus(check, report.requestedAmount)}`);
    lines.push('');
  }

  lines.push(
    report.requestedAmount
      ? 'Tell me to bridge from a ready source chain when you want the live estimate.'
      : 'Tell me the source chain and amount when you want a live bridge estimate.',
  );

  return lines.join('\n').trim();
}

export function getAgentFlowCircleStackSummary(): string {
  const supportedSources = listSupportedBridgeSourcesDetailed()
    .map((source) => `${source.label} (${source.key})`)
    .join(', ');

  return [
    'AgentFlow Circle stack summary:',
    '- AgentFlow is an Arc-native agent economy for research, AgentPay, portfolio intelligence, and onchain execution through specialized agents.',
    '- Arc Testnet is the execution chain and uses native USDC for gas.',
    '- The connected EOA is primarily the identity, signing, and funding wallet.',
    '- The Agent wallet / DCW is the app-managed Circle developer-controlled wallet used for AgentFlow execution in chat.',
    '- The Funding page is for Arc USDC deposits and withdrawals between the EOA, the Agent wallet, and the Gateway reserve. It is not a manual bridge surface.',
    '- Bridge runs use AgentFlow-managed Circle source wallets on supported source chains and deliver USDC to the selected Arc recipient wallet.',
    '- Bridge is the one sponsored execution path in AgentFlow, and it is protected by a per-user daily sponsored limit.',
    "- Gateway is Circle's unified USDC balance layer and is used for nanopayments and low-latency liquidity flows.",
    "- CCTP / Bridge Kit is Circle's native USDC bridge protocol and supports many more chains than AgentFlow currently exposes in this app.",
    `- AgentFlow currently supports executable bridge source chains: ${supportedSources}.`,
    '- AgentFlow wallet capabilities: live USDC, EURC, vault, and Gateway balances; DCW-first Arc portfolio summaries; and transaction/payment history.',
    '- AgentPay capabilities: send USDC, receive through payment links and .arc names, create requests, preview before execution, confirm with YES, and record payment history.',
    '- Contact capabilities: save contacts, list contacts, update/delete contacts, resolve saved contacts, and pay contacts by name.',
    '- Scheduled payment capabilities: create recurring USDC sends, list active schedules, cancel schedules, and use preview-then-confirm flows.',
    '- Split and batch capabilities: split USDC equally across multiple recipients and run CSV/batch/payroll-style USDC payouts.',
    '- Invoice capabilities: create invoice previews, confirm invoices, create AgentPay payment requests, list invoices, and check invoice status.',
    '- Swap capabilities: simulate and execute USDC to EURC or EURC to USDC swaps on Arc after YES confirmation.',
    '- Vault capabilities: deposit USDC into the AgentFlow vault for 5% APY yield, withdraw from the vault, and show vault positions.',
    '- Research capabilities: run the multi-agent research pipeline for DeFi, Arc ecosystem, markets, macro, news, and user-requested analysis.',
    '- Media capabilities: Vision analyzes attached images and can trigger research when appropriate; Transcribe is the mic dictation path that converts captured speech into chat text only.',
    '- Agent roster: ascii, research, analyst, writer, swap, vault, bridge, portfolio, invoice, vision, transcribe, schedule, split, and batch.',
    '- A2A economy capabilities: specialized agents can pay each other through x402 nanopayments for follow-up work.',
    '- Benchmark capabilities: the Benchmark page is a shared platform proof page for nanopayments, A2A hops, and Arc margin; benchmark runs are private to the signed-in user.',
    '- Treasury capabilities: agent owner wallets are monitored and auto-topped up for x402 nanopayments; economy stats expose treasury health and the bridge sponsor budget is protected by per-user limits.',
    '- Product guidance capabilities: explain EOA vs DCW mode, Circle DCW, Gateway, x402, Arc-native USDC gas, Firecrawl-backed research, and AgentFlow routing.',
    '- If a user asks what AgentFlow can bridge right now, answer from that executable subset.',
    '- If a user asks what AgentFlow can do broadly, answer with the full AgentFlow product map above, not only bridge or DeFi features.',
    '- If a user asks what Circle CCTP or Bridge Kit supports generally, explain that the protocol support is broader and use research or official docs for the latest list instead of guessing.',
    '- Do not enumerate Circle-wide chain support from memory. Offer to fetch the latest official support list instead.',
  ].join('\n');
}

export function getArcSdkDomain(): number | null {
  return ArcTestnet.cctp?.domain ?? null;
}

async function ensureSourceWalletForChain(
  bridgeOwner: PersistedWalletRow,
  sourceChain: SupportedSourceChain,
): Promise<{ walletId: string; address: string }> {
  const dcw = getCircleClient();
  const refId = BRIDGE_SOURCE_REF_ID[sourceChain];
  const sourceConfig = getSourceChainConfig(sourceChain);

  const existing = await dcw.listWallets({
    walletSetId: bridgeOwner.wallet_set_id,
    refId,
    blockchain: sourceConfig.circleBlockchain,
    pageSize: 10,
    order: 'DESC',
  } as any);

  const liveWallet = (existing?.data?.wallets ?? []).find(
    (wallet: any) => wallet?.id && wallet?.address && (wallet?.state === 'LIVE' || !wallet?.state),
  );
  if (liveWallet?.id && liveWallet?.address) {
    return {
      walletId: liveWallet.id as string,
      address: getAddress(liveWallet.address as string),
    };
  }

  const created = await dcw.createWallets({
    walletSetId: bridgeOwner.wallet_set_id,
    blockchains: [sourceConfig.circleBlockchain],
    count: 1,
    accountType: 'EOA',
    metadata: [
      {
        name: `bridge-owner-${sourceConfig.circleBlockchain.toLowerCase()}`,
        refId,
      },
    ],
  });

  const wallet = created?.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    throw new Error(`[bridge] Failed to create ${sourceConfig.circleBlockchain} bridge source wallet`);
  }

  return {
    walletId: wallet.id as string,
    address: getAddress(wallet.address as string),
  };
}

async function readSourceBalances(
  address: string,
  sourceChain: SupportedSourceChain,
): Promise<{ nativeBalance: string; usdcBalance: string }> {
  const sourceConfig = getSourceChainConfig(sourceChain);
  const chainDef = sourceConfig.definition;
  const chain = defineChain({
    id: chainDef.chainId,
    name: chainDef.name,
    nativeCurrency: chainDef.nativeCurrency,
    rpcUrls: { default: { http: [...chainDef.rpcEndpoints] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(chainDef.rpcEndpoints[0]),
  });

  const [nativeBalanceRaw, usdcBalanceRaw] = await Promise.all([
    client.getBalance({ address: getAddress(address) }),
    chainDef.usdcAddress
      ? (client.readContract({
          address: getAddress(chainDef.usdcAddress) as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [getAddress(address)],
        }) as Promise<bigint>)
      : Promise.resolve(0n),
  ]);

  return {
    nativeBalance: formatEther(nativeBalanceRaw),
    usdcBalance: formatUnits(usdcBalanceRaw, 6),
  };
}

function registerKitEvents(
  kit: BridgeKit,
  onEvent?: (event: BridgeTransferEvent) => void,
): void {
  kit.on('approve', (payload: any) => {
    emit(onEvent, 'approved', eventPayloadToRecord(payload));
  });
  kit.on('burn', (payload: any) => {
    emit(onEvent, 'burned', eventPayloadToRecord(payload));
  });
  kit.on('fetchAttestation', (payload: any) => {
    emit(onEvent, 'attested', eventPayloadToRecord(payload));
  });
  kit.on('mint', (payload: any) => {
    emit(onEvent, 'minted', eventPayloadToRecord(payload));
  });
}

function pickEvmTxHash(obj: Record<string, unknown> | null | undefined): string | undefined {
  if (!obj) return undefined;
  for (const key of ['txHash', 'transactionHash', 'hash'] as const) {
    const v = obj[key];
    if (typeof v === 'string' && /^0x[a-fA-F0-9]{64}$/.test(v)) return v;
  }
  return undefined;
}

function eventPayloadToRecord(payload: any): Record<string, unknown> {
  const values = payload?.values;
  const fromValues = values && typeof values === 'object' ? pickEvmTxHash(values as Record<string, unknown>) : undefined;
  const txHash =
    fromValues ??
    pickEvmTxHash(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined);
  return makeJsonSafe({
    method: payload?.method,
    values: values ?? null,
    txHash,
  });
}

function emit(
  onEvent: ((event: BridgeTransferEvent) => void) | undefined,
  event: BridgeTransferEvent['event'],
  data: unknown,
): void {
  onEvent?.({ event, data: makeJsonSafe(data) });
}

function getSourceChainConfig(sourceChain: SupportedSourceChain) {
  const config = SOURCE_CHAIN_CONFIG[sourceChain];
  if (!config) {
    throw new Error(`[bridge] Unsupported source chain: ${sourceChain}`);
  }
  return config;
}

function normalizeAmount(amount: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('[bridge] amount must be a positive decimal string');
  }
  return parsed.toString();
}

function formatBridgeDisplayAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  if (numeric === 0) {
    return '0';
  }
  if (numeric < 0.001) {
    return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (numeric < 1) {
    return numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  return numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatBridgeReadinessStatus(
  check: BridgeSourceWalletCheck,
  requestedAmount?: string,
): string {
  if (requestedAmount) {
    if (check.hasGas && check.enoughUsdcForAmount === true) {
      return `ready for ${formatBridgeDisplayAmount(requestedAmount)} USDC`;
    }
    if (!check.hasGas && check.enoughUsdcForAmount === true) {
      return `USDC is available, but gas is missing on ${check.label}`;
    }
    if (check.hasGas && check.enoughUsdcForAmount === false) {
      return `gas is available, but USDC is below ${formatBridgeDisplayAmount(requestedAmount)} USDC`;
    }
    return `missing gas and not enough USDC for ${formatBridgeDisplayAmount(requestedAmount)} USDC`;
  }

  if (check.hasGas && check.hasUsdc) {
    return 'gas and USDC detected';
  }
  if (!check.hasGas && check.hasUsdc) {
    return 'USDC detected, but gas is missing';
  }
  if (check.hasGas && !check.hasUsdc) {
    return 'gas detected, but USDC is missing';
  }
  return 'no gas or USDC detected';
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[bridge] Missing required environment variable: ${name}`);
  }
  return value;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeJsonSafe(value: unknown): Record<string, unknown> {
  const normalized = jsonSafe(value);
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>;
  }
  return { value: normalized };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        jsonSafe(entry),
      ]),
    );
  }
  return String(value);
}
