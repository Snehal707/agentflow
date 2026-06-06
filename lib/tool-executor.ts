import { createPublicClient, formatUnits, getAddress, http, parseAbi } from 'viem';

import { ARC } from './arc-config';
import { AGENTFLOW_TOOLS } from './agentflow-tools';
import { APP_URLS } from './app-urls';
import { generateJWT } from './auth';
import { resolveArcTokenSymbol } from './swap-symbols';
import { adminDb, getRedis } from '../db/client';
import { type SwapSimulationExecutionPayload } from '../agents/swap/subagents/simulation';
import { getOrCreateUserAgentWallet } from './dcw';
import { formatPortfolioSnapshotRecordsForChat } from './format-portfolio-chat';
import { buildPortfolioSnapshot } from '../agents/portfolio/portfolio';
import { resolvePayee } from './agentpay-payee';
import { getUserPositionsAcrossProviders, listAllVaults } from './vault/router';
import {
  FEE_DISCLAIMER,
  RESOLUTION_DISCLAIMER,
} from './predmarket/providers/achmarket';
import {
  executeUserPaidAgentViaX402,
  PREDMARKET_AGENT_PRICE_LABEL,
  PREDMARKET_RUN_URL,
  SWAP_AGENT_PRICE_LABEL,
  SWAP_RUN_URL,
  VAULT_AGENT_PRICE_LABEL,
  VAULT_RUN_URL,
  type ExecutionPaymentEntry,
} from './paidAgentX402';
import { SUPPORTED_BRIDGE_SOURCES } from './bridge/supportedSources';

const redis = getRedis();

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const ARC_USDC = resolveArcTokenSymbol('USDC');
const ARC_EURC = resolveArcTokenSymbol('EURC');
const ARC_WETH = (() => {
  const configured =
    process.env.ARC_WETH_ADDRESS?.trim() ||
    process.env.WETH_ADDRESS?.trim() ||
    '0xDe5DB9049a8dd344dC1B7Bbb098f9da60930A6dA';
  try {
    return normalizeAddress(configured);
  } catch {
    return null;
  }
})();
const DEFAULT_RESEARCH_ERROR = 'Research could not complete right now.';
const PUBLIC_API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL?.trim() || `http://127.0.0.1:${process.env.PORT || '4000'}`;
const NATURAL_CONFIRMATION_PROMPT = 'Reply YES to confirm or NO to cancel.';
type ToolValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      missingFields: string[];
      wrongTypes: string[];
    };

type RecentExecutionMeta = {
  entries: Array<
    Omit<ExecutionPaymentEntry, 'mode'> & {
      mode?: ExecutionPaymentEntry['mode'] | 'a2a';
      buyerAgent?: string;
      sellerAgent?: string;
    }
  >;
};

type ToolExecutionContext = {
  readonly?: boolean;
  maxLength?: number;
  rawUserMessage?: string;
};

type PredictionMarketListState = {
  filter?: Record<string, unknown>;
  nextOffset: number;
  total: number;
  pageSize: number;
};

type VaultExecutionPayload = {
  action: 'deposit' | 'withdraw';
  amount: string;
  provider: string;
  vaultAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  vaultSymbol: string;
  vaultLabel: string;
  assetSymbol: string;
  network: 'testnet' | 'mainnet';
  experimental: boolean;
  notes: string[];
  expectedSharesRaw?: string;
  expectedSharesBurnedRaw?: string;
  currentPosition?: {
    sharesRaw: string;
    sharesFormatted: string;
    underlyingValueRaw: string;
    underlyingValueFormatted: string;
    underlyingSymbol: string;
  };
};

type PredictExecutionPayload = {
  action: 'buy' | 'sell' | 'redeem' | 'refund';
  provider: string;
  marketAddress: `0x${string}`;
  marketTitle: string;
  network: 'testnet' | 'mainnet';
  experimental: boolean;
  notes: string[];
  outcomeIdx?: number;
  outcomeLabel?: string;
  amount?: string;
  sharesWad?: string;
  preview: Record<string, any>;
  executionPayload?: Record<string, any>;
};

function userMessageHasExplicitPaymentAmount(message: string | undefined): boolean {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return true;
  if (/(?:^|[^\w])(?:\$)?\d+(?:\.\d+)?(?!\s*(?:am|pm)\b)(?:\s*(?:usdc|eurc|usd|dollars?|bucks?))?\b/i.test(text)) {
    return true;
  }
  return /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\s+(?:usdc|eurc|usd|dollars?|bucks?)\b/i.test(
    text,
  );
}

type PendingPayload =
  | {
      tool: 'swap_tokens';
      args: Record<string, any>;
      payload: SwapSimulationExecutionPayload;
    }
  | {
      tool: 'vault_action';
      args: Record<string, any>;
      payload: VaultExecutionPayload;
    }
  | {
      tool: 'predict_action';
      args: Record<string, any>;
      payload: PredictExecutionPayload;
    };

type LocalPendingEntry = {
  value: PendingPayload;
  expiresAt: number;
};

const localPendingStore = new Map<string, LocalPendingEntry>();
const recentExecutionMetaStore = new Map<string, RecentExecutionMeta>();
const localPredmarketListStateStore = new Map<
  string,
  { value: PredictionMarketListState; expiresAt: number }
>();

function pendingKey(sessionId: string): string {
  return `chat:pending:${sessionId}`;
}

function readLocalPending(sessionId: string): PendingPayload | null {
  const entry = localPendingStore.get(sessionId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    localPendingStore.delete(sessionId);
    return null;
  }
  return entry.value;
}

function writeLocalPending(sessionId: string, value: PendingPayload): void {
  localPendingStore.set(sessionId, {
    value,
    expiresAt: Date.now() + 300_000,
  });
}

function deleteLocalPending(sessionId: string): void {
  localPendingStore.delete(sessionId);
}

function predictionMarketListStateKey(sessionId: string): string {
  return `chat:predmarket:list:${sessionId}`;
}

function readLocalPredmarketListState(sessionId: string): PredictionMarketListState | null {
  const entry = localPredmarketListStateStore.get(sessionId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    localPredmarketListStateStore.delete(sessionId);
    return null;
  }
  return entry.value;
}

function writeLocalPredmarketListState(sessionId: string, value: PredictionMarketListState): void {
  localPredmarketListStateStore.set(sessionId, {
    value,
    expiresAt: Date.now() + 900_000,
  });
}

function deleteLocalPredmarketListState(sessionId: string): void {
  localPredmarketListStateStore.delete(sessionId);
}

function setRecentExecutionMeta(sessionId: string, meta: RecentExecutionMeta): void {
  recentExecutionMetaStore.set(sessionId, meta);
}

export function appendRecentExecutionEntries(
  sessionId: string,
  entries: RecentExecutionMeta['entries'],
): void {
  if (!entries.length) return;
  const existing = recentExecutionMetaStore.get(sessionId);
  recentExecutionMetaStore.set(sessionId, {
    entries: [...(existing?.entries ?? []), ...entries],
  });
}

export function takeRecentExecutionMeta(sessionId: string): RecentExecutionMeta | null {
  const meta = recentExecutionMetaStore.get(sessionId) ?? null;
  recentExecutionMetaStore.delete(sessionId);
  return meta;
}

function normalizeAddress(address: string): `0x${string}` {
  return getAddress(address) as `0x${string}`;
}

function shortTx(txHash?: string | null): string {
  if (!txHash) return '';
  return txHash.length <= 14 ? txHash : `${txHash.slice(0, 8)}...${txHash.slice(-4)}`;
}

function shortAddr(address?: string | null): string {
  if (!address) return '';
  return address.length <= 14 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function explorerLinkLine(label: string, href?: string | null): string {
  if (!href) return label;
  return `[${label}](${href})`;
}

function truncateText(value: string, max: number): string {
  const clean = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

async function fetchAgentPayPreview(
  sessionId: string,
  walletAddress: string,
  to: string,
  resolvedAddress: string | null,
  amount: string,
  remark?: string,
): Promise<void> {
  const res = await fetch(`${PUBLIC_API_BASE_URL}/api/pay/brain/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      walletAddress,
      to,
      resolvedAddress,
      amount,
      remark,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || 'Failed to store pending payment');
  }
}

function formatAgentPayPreview(
  to: string,
  resolvedAddress: string | null,
  amount: string,
  remark?: string,
): string {
  const recipient = resolvedAddress
    ? `${to} (${resolvedAddress.slice(0, 8)}...${resolvedAddress.slice(-4)})`
    : to;
  const lines = [`Send ${amount} USDC to ${recipient}?`];
  if (remark) {
    lines.push(`Note: ${remark}`);
  }
  lines.push('', NATURAL_CONFIRMATION_PROMPT);
  return lines.join('\n');
}

function formatAgentPayResult(
  to: string,
  amount: string,
  txHash: string,
  explorerLink: string,
  remark?: string,
): string {
  return [
    '- **Payment sent on Arc**',
    '',
    `Recipient: ${to}`,
    `Amount: ${amount} USDC`,
    remark ? `Note: ${remark}` : null,
    `Tx: ${explorerLinkLine(txHash, explorerLink || txHash)}`,
    explorerLink ? `Explorer: ${explorerLinkLine(explorerLink, explorerLink)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatSwapExecutionResult(input: {
  approvalTxHash?: string | null;
  approvalExplorerLink?: string | null;
  txHash: string;
  explorerLink?: string | null;
  amountOut: string;
  tokenOutSymbol: string;
  amountIn?: string | number | null;
  tokenInSymbol?: string | null;
  executionTarget?: string | null;
  provider?: string | null;
}): string {
  const txOwnerLabel = input.executionTarget ? `${input.executionTarget} Tx:` : 'Tx:';
  const swapLine =
    input.amountIn != null && input.tokenInSymbol
      ? `Swap: ${input.amountIn} ${input.tokenInSymbol} -> ~${input.amountOut} ${input.tokenOutSymbol}`
      : `Amount out: ${input.amountOut} ${input.tokenOutSymbol}`;
  return [
    swapLine,
    'Swap complete on Arc.',
    input.approvalTxHash ? 'Approval tx:' : null,
    input.approvalTxHash ?? null,
    input.executionTarget ? `Executed from: ${txOwnerLabel}` : txOwnerLabel,
    input.txHash,
    input.explorerLink ? `Explorer: ${input.explorerLink}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(digits);
}

function formatSignedMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '$0.00';
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const precision = abs >= 0.01 ? digits : abs >= 0.0001 ? 4 : 6;
  return `${prefix}$${abs.toFixed(precision)}`;
}

function formatSignedPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0.00%';
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const precision = abs >= 0.01 ? digits : abs >= 0.0001 ? 4 : 6;
  return `${prefix}${abs.toFixed(precision)}%`;
}

function formatTokenAmountSmart(
  rawValue: string | null | undefined,
  decimals = 6,
): string {
  if (!rawValue) return '0.00';
  const value = Number(formatUnits(BigInt(rawValue), decimals));
  if (!Number.isFinite(value)) return '0.00';
  if (value === 0) return '0.000000';
  if (value < 0.001) return value.toFixed(6);
  if (value < 1) return value.toFixed(4);
  return value.toFixed(3);
}

function tokenLabelForRoute(address: string): string {
  const normalized = address.toLowerCase();
  if (normalized === '0x0000000000000000000000000000000000000000') return 'USDC';
  if (ARC_USDC && normalized === ARC_USDC.toLowerCase()) return 'USDC';
  if (ARC_EURC && normalized === ARC_EURC.toLowerCase()) return 'EURC';
  if (ARC_WETH && normalized === ARC_WETH.toLowerCase()) return 'WETH';
  return shortAddr(address);
}

function formatRouteBreakdown(
  segments: Array<{
    isV3: boolean;
    path: `0x${string}`[];
    fees: number[];
    bps: number;
  }>,
  requested?: {
    tokenIn?: `0x${string}` | null;
    tokenOut?: `0x${string}` | null;
  },
): string {
  if (!segments.length) return 'Direct route';
  return segments
    .map((segment, index) => {
      const venue = segment.isV3 ? 'V3' : 'V2';
      const normalizedPath = [...segment.path];
      const requestedTokenIn = requested?.tokenIn ?? null;
      const requestedTokenOut = requested?.tokenOut ?? null;
      const requestedIn = requestedTokenIn?.toLowerCase();
      const requestedOut = requestedTokenOut?.toLowerCase();

      if (
        requestedIn &&
        normalizedPath.length > 0 &&
        normalizedPath[0]?.toLowerCase() !== requestedIn
      ) {
        normalizedPath.unshift(requestedTokenIn!);
      }
      if (
        requestedOut &&
        normalizedPath.length > 0 &&
        normalizedPath[normalizedPath.length - 1]?.toLowerCase() !== requestedOut
      ) {
        normalizedPath.push(requestedTokenOut!);
      }

      const dedupedPath = normalizedPath.filter(
        (address, pathIndex) =>
          pathIndex === 0 ||
          address.toLowerCase() !== normalizedPath[pathIndex - 1]?.toLowerCase(),
      );
      const path = dedupedPath.map((address) => tokenLabelForRoute(address)).join(' -> ');
      const split = `${(segment.bps / 100).toFixed(2)}%`;
      const fees =
        segment.fees.length
          ? ` | fee ${segment.fees.map((fee) => `${(fee / 10_000).toFixed(2)}%`).join('/')}`
          : '';
      return `${index + 1}. ${venue} ${path} | split ${split}${fees}`;
    })
    .join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchVaultAgent<T>(
  walletAddress: `0x${string}`,
  body: Record<string, unknown>,
): Promise<T> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${generateJWT(walletAddress)}`,
  };
  if (internalKey) {
    headers['x-agentflow-paid-internal'] = internalKey;
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(VAULT_RUN_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...body,
          walletAddress,
        }),
      });
      const json = (await response.json().catch(() => null)) as (T & {
        error?: string;
      }) | null;
      if (!response.ok || !json) {
        throw new Error(json?.error || 'Vault request failed.');
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Vault request failed.');
}

async function fetchPredmarketAgent<T>(
  walletAddress: `0x${string}`,
  body: Record<string, unknown>,
): Promise<T> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${generateJWT(walletAddress)}`,
  };
  if (internalKey) {
    headers['x-agentflow-paid-internal'] = internalKey;
  }
  const response = await fetch(PREDMARKET_RUN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      walletAddress,
    }),
  });
  const json = (await response.json().catch(() => null)) as (T & {
    error?: string;
  }) | null;
  if (!response.ok || !json) {
    throw new Error(json?.error || 'Prediction market request failed.');
  }
  return json;
}

function listSupportedBridgeSourceLabels(): string {
  return SUPPORTED_BRIDGE_SOURCES.map((source) => source.label).join(', ');
}

function formatVaultListResult(
  vaults: Array<Record<string, any>>,
  options: { readonly?: boolean } = {},
): string {
  if (!vaults.length) {
    return 'No vault options available right now.';
  }

  const body = vaults
    .map((vault) => {
      const apyValue =
        typeof vault.apy?.apy === 'number' && Number.isFinite(vault.apy.apy)
          ? `${vault.apy.apy.toFixed(1)}%`
          : '5.3%';
      const method =
        typeof vault.apy?.method === 'string' ? vault.apy.method : 'unknown';
      const noteLines = Array.isArray(vault.notes)
        ? vault.notes.map((note: string) => `  - ${note}`).join('\n')
        : '';
      return [
        `### ${vault.label}`,
        `- **APY:** ${apyValue}${method === 'mock_fallback' ? ' (preview)' : ''}`,
        `- **Provider:** ${vault.provider}`,
        `- **Network:** ${vault.network}${vault.experimental ? ' (experimental)' : ''}`,
        noteLines ? `- **Notes:**\n${noteLines}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return truncateText(
    `## Yield vaults on Arc Testnet\n\n${body}\n\n${
      options.readonly
        ? 'Telegram vault execution is disabled for safety. Use the web app to deposit or withdraw.'
        : 'Choose a vault below or say something like `deposit 25 USDC to luneUSDC`.'
    }`,
    1400,
  );
}

function formatVaultPositionResult(positions: Array<Record<string, any>>): string {
  if (!positions.length) {
    return "No vault positions yet. Reply 'show vault options' to see available vaults.";
  }

  const lines = positions.map((position) => {
    const vault = position.vault as Record<string, any>;
    return `• ${vault.label} - ${position.underlyingValueFormatted} ${position.underlyingSymbol} (${position.sharesFormatted} shares)\nProvider: ${position.provider} | Network: ${vault.network}`;
  });
  const totalRaw = positions.reduce(
    (sum, position) => sum + BigInt(String(position.underlyingValueRaw ?? '0')),
    0n,
  );

  return truncateText(
    `Your vault positions:\n\n${lines.join('\n\n')}\n\nTotal across all vaults: ${formatTokenAmountSmart(totalRaw.toString(), 6)} USDC equivalent`,
    1200,
  );
}

function formatVaultPreview(preview: Record<string, any>): string {
  const noteLines = Array.isArray(preview.notes)
    ? preview.notes.map((note: string) => `Note: ${note}`).join('\n')
    : '';

  if (preview.action === 'deposit') {
    return truncateText(
      `## Vault deposit preview\n\n` +
        `- **Vault:** ${preview.vault}\n` +
        `- **Provider:** ${preview.provider}\n` +
        `- **Network:** ${preview.network}${preview.experimental ? ' (experimental)' : ''}\n` +
        `- **Deposit amount:** ${preview.amount} ${preview.assetSymbol || 'USDC'}\n` +
        `- **Estimated shares:** ~${preview.expectedSharesFormatted} ${preview.vaultSymbol || 'vault'}\n` +
        (noteLines ? `- **Notes:**\n${Array.isArray(preview.notes) ? preview.notes.map((note: string) => `  - ${note}`).join('\n') : ''}\n` : '') +
        `\n${NATURAL_CONFIRMATION_PROMPT}`,
      900,
    );
  }

  return truncateText(
    `## Vault withdraw preview\n\n` +
      `- **Vault:** ${preview.vault}\n` +
      `- **Provider:** ${preview.provider}\n` +
      `- **Network:** ${preview.network}${preview.experimental ? ' (experimental)' : ''}\n` +
      `- **Withdraw amount:** ${preview.amount} ${preview.currentPosition?.underlyingSymbol || 'USDC'}\n` +
      `- **Current position:** ${preview.currentPosition?.underlyingValueFormatted || '0'} ${preview.currentPosition?.underlyingSymbol || 'USDC'} (${preview.currentPosition?.sharesFormatted || '0'} shares)\n` +
      `- **Estimated shares burned:** ~${preview.expectedSharesBurnedFormatted} shares\n` +
      (noteLines ? `- **Notes:**\n${Array.isArray(preview.notes) ? preview.notes.map((note: string) => `  - ${note}`).join('\n') : ''}\n` : '') +
      `\n${NATURAL_CONFIRMATION_PROMPT}`,
    900,
  );
}

async function getVaultBalanceSummary(walletAddress: `0x${string}`): Promise<string> {
  try {
    const [vaults, positions] = await Promise.all([
      listAllVaults(),
      getUserPositionsAcrossProviders(walletAddress),
    ]);

    if (!vaults.length) {
      return 'Vaults: unavailable right now';
    }

    if (!positions.length) {
      return `Vaults: ${vaults.length} available | Positions: 0`;
    }

    const totalUnderlying = positions.reduce((sum, position) => {
      const next = Number(position.underlyingValueFormatted);
      return Number.isFinite(next) ? sum + next : sum;
    }, 0);

    return `Vaults: ${vaults.length} available | Positions: ${positions.length} | Value: ${formatMoney(totalUnderlying)}`;
  } catch (error) {
    console.warn('[tool-executor] vault summary failed:', error);
    return 'Vaults: available';
  }
}

function formatUsdcMoneyFromRaw(rawValue: string | null | undefined): string {
  const raw = BigInt(String(rawValue || '0'));
  const value = Number(formatUnits(raw, 18));
  if (!Number.isFinite(value)) return '$0.00';
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  })}`;
}

function formatShares18(rawValue: string | null | undefined): string {
  const raw = BigInt(String(rawValue || '0'));
  const value = Number(formatUnits(raw, 18));
  if (!Number.isFinite(value)) return '0';
  if (value === 0) return '0';
  if (value < 1) return value.toFixed(4);
  if (value < 1000) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatUtcDate(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'unknown';
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}

function formatProbability(probability: unknown): string {
  const value = Number(probability ?? 0);
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
}

function predictionNotes(notes: unknown): string[] {
  const provided = Array.isArray(notes)
    ? notes.map((note) => String(note)).filter(Boolean)
    : [];
  return provided.length ? provided : [RESOLUTION_DISCLAIMER, FEE_DISCLAIMER];
}

function formatPredictionMarketList(
  markets: Array<Record<string, any>>,
  options?: {
    offset?: number;
    limit?: number;
    requestedAll?: boolean;
  },
): string {
  if (!markets.length) {
    return 'No prediction markets available right now.';
  }

  const offset = Math.max(0, Number(options?.offset ?? 0));
  const requestedLimit = Math.max(1, Number(options?.limit ?? 5));
  const visibleMarkets = markets.slice(offset, offset + requestedLimit);
  const body = visibleMarkets.map((market) => {
    const outcomes = Array.isArray(market.outcomes)
      ? market.outcomes
          .map((outcome: Record<string, any>) => `${outcome.label} ${formatProbability(outcome.impliedProbability)}`)
          .join(' / ')
      : 'Outcomes unavailable';

    return [
      `### 🎯 ${market.title}`,
      `- **Outcomes:** ${outcomes}`,
      `- **Volume:** ${formatUsdcMoneyFromRaw(market.totalVolumeRaw)}`,
      `- **Closes:** ${formatUtcDate(market.deadline)}`,
      `- **Category:** ${market.category}`,
      `- **Provider:** ${market.provider}`,
      `- **Network:** ${market.network}${market.experimental ? ' (experimental)' : ''}`,
      `- **Address:** \`${market.address}\``,
    ].join('\n');
  }).join('\n\n');
  const shownThrough = offset + visibleMarkets.length;
  const remainingCount = Math.max(0, markets.length - shownThrough);
  const showingLine =
    markets.length > visibleMarkets.length
      ? `Showing ${offset + 1}-${shownThrough} of ${markets.length} markets.`
      : `Showing all ${markets.length} market${markets.length === 1 ? '' : 's'}.`;

  const notes = predictionNotes(markets[0]?.notes)
    .map((note) => `- ${note}`)
    .join('\n');

  const moreLine =
    remainingCount > 0
      ? options?.requestedAll
        ? `\n\n${showingLine}\n\nThere are ${remainingCount} more market${remainingCount === 1 ? '' : 's'} still available. Reply \`show more markets\` to continue the list, or add a category/search term to narrow it.`
        : `\n\n${showingLine}\n\nThere are ${remainingCount} more market${remainingCount === 1 ? '' : 's'} available. Reply \`show more markets\` to continue, or ask for a category/search term to narrow the list.`
      : `\n\n${showingLine}`;

  return `## Prediction markets on AchMarket\n\n${body}${moreLine}\n\n## ⚠️ Important notes\n${notes}\n\nReply \`tell me about [market title]\` for details, or use the outcome buttons to trade. You can also say \`bet X USDC on outcome 0 for [market]\` if you already know the outcome index.`;
}

function formatPredictionMarketDetail(detail: Record<string, any>): string {
  const outcomes = Array.isArray(detail.outcomes)
    ? detail.outcomes.map((outcome: Record<string, any>) =>
        `- ${outcome.label}: ${formatProbability(outcome.impliedProbability)} (${formatShares18(outcome.totalSharesRaw)} shares)`,
      ).join('\n')
    : '- No outcomes available';
  const notes = predictionNotes(detail.notes)
    .map((note) => `- ${note}`)
    .join('\n');
  const stage = String(detail.stage || 'unknown');

  const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);
  const actionHint =
    stage === 'active'
      ? 'Use the outcome buttons to trade, or say `bet X USDC on outcome 0 for this market` if you already know the outcome index.'
      : stage === 'resolved'
        ? 'This market is resolved. If you hold the winning outcome, reply `redeem [market]` to claim.'
        : stage === 'cancelled' || stage === 'expired'
          ? 'This market is closed. If you participated, reply `refund [market]` to check whether a refund is available.'
          : 'This market is not open for new trades right now.';

  return truncateText(
    `## ${detail.title}\n\n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\n### 📋 Description\n${detail.description || 'No description available.'}\n\n### 📊 Outcomes\n${outcomes}\n\n### Market stats\n- **Volume:** ${formatUsdcMoneyFromRaw(detail.totalVolumeRaw)}\n- **Participants:** ${detail.participantCount ?? 0}\n- **Deadline:** ${formatUtcDate(detail.deadline)}\n- **Stage:** ${stageLabel}\n\n### ⚠️ Important notes\n${notes}\n\n${actionHint}`,
    1800,
  );
}

function formatPredictionPositions(positions: Array<Record<string, any>>): string {
  if (!positions.length) {
    return "You don't have any prediction market positions yet. Reply `show prediction markets` to browse live markets.\n\n## ⚠️ Important notes\n- " + RESOLUTION_DISCLAIMER + "\n- " + FEE_DISCLAIMER;
  }

  const body = positions.map((position) => {
    const outcomeLine = Array.isArray(position.outcomes)
      ? position.outcomes
          .filter((outcome: Record<string, any>) => BigInt(String(outcome.sharesRaw || '0')) > 0n)
          .map((outcome: Record<string, any>) => `${outcome.sharesFormatted} ${outcome.label} shares`)
          .join(' | ')
      : 'No shares';
    const claimLine = position.canRedeem
      ? 'Redeemable now'
      : position.canRefund
        ? 'Refundable now'
        : `Stage: ${position.stage}`;
    return [
      `### 📊 ${position.market?.title || 'Prediction market position'}`,
      `- **Position:** ${outcomeLine || 'No shares'}`,
      `- **Net deposit:** ${formatUsdcMoneyFromRaw(position.netDepositedRaw)}`,
      `- **Status:** ${claimLine}`,
      `- **Provider:** ${position.provider}`,
      `- **Address:** \`${position.market?.address || 'unknown'}\``,
    ].join('\n');
  }).join('\n\n');

  return truncateText(
    `## Your prediction market positions\n\n${body}\n\n## ⚠️ Important notes\n- ${RESOLUTION_DISCLAIMER}\n- ${FEE_DISCLAIMER}\n\nReply \`redeem [market]\` for resolved markets where you can claim.`,
    1800,
  );
}

function formatPredictionPreview(action: string, detail: Record<string, any>, preview: Record<string, any>): string {
  const notes = predictionNotes(detail.notes)
    .map((note) => `- ${note}`)
    .join('\n');
  const stage = String(detail.stage || 'unknown').toLowerCase();
  const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);

  if (action === 'buy') {
    return truncateText(
      `## Bet ${preview.requestedBudgetFormatted || `${preview.costFormatted || '0 USDC'}`} on ${preview.outcomeLabel}?\n\n**Market:** ${detail.title}  \n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\n### Preview\n- **Stage:** ${stageLabel}\n- **You'll receive:** ~${preview.sharesFormatted} ${preview.outcomeLabel} shares\n- **Current implied probability:** ${formatProbability(preview.currentImpliedProbability)}\n- **Slippage protection:** ${(Number(preview.slippageBps || 0) / 100).toFixed(0)}% (max ${preview.maxCostFormatted})\n\n### ⚠️ Resolution\n${notes}\n\n${preview.note}\n\nReply **YES** to execute or **NO** to cancel.`,
      1800,
    );
  }

  if (action === 'sell') {
    return truncateText(
      `## Sell ${preview.sharesFormatted} ${preview.outcomeLabel} shares?\n\n**Market:** ${detail.title}  \n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\n### Preview\n- **Estimated proceeds:** ${preview.proceedsFormatted}\n- **Slippage protection:** ${(Number(preview.slippageBps || 0) / 100).toFixed(0)}% (min ${preview.minReceiveFormatted})\n\n### ⚠️ Resolution\n${notes}\n\nReply **YES** to execute or **NO** to cancel.`,
      1700,
    );
  }

  if (action === 'redeem') {
    if (!preview.canRedeem) {
      return truncateText(
        `## ${detail.title}\n\n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\nRedeem is not available right now.\n\n**Reason:** ${preview.reason || 'Market not resolved or no winning position.'}\n\n### ⚠️ Important notes\n${notes}`,
        1400,
      );
    }
    return truncateText(
      `## Redeem winnings?\n\n**Market:** ${detail.title}  \n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\n- **Estimated payout:** ${preview.expectedPayoutFormatted}\n\n### ⚠️ Important notes\n${notes}\n\nReply **YES** to execute or **NO** to cancel.`,
      1600,
    );
  }

  if (!preview.canRefund) {
    return truncateText(
      `## ${detail.title}\n\n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\nRefund is not available right now.\n\n**Reason:** ${preview.reason || 'Market is not cancelled or expired.'}\n\n### ⚠️ Important notes\n${notes}`,
      1400,
    );
  }
  return truncateText(
    `## Refund this market?\n\n**Market:** ${detail.title}  \n**Provider:** ${detail.provider}  \n**Network:** ${detail.network}${detail.experimental ? ' (experimental)' : ''}\n\n- **Estimated refund:** ${preview.expectedRefundFormatted}\n\n### ⚠️ Important notes\n${notes}\n\nReply **YES** to execute or **NO** to cancel.`,
    1600,
  );
}

function formatPredictionExecutionResult(
  pending: PredictExecutionPayload,
  result: Record<string, any>,
): string {
  const txHash = typeof result.txHash === 'string' ? result.txHash : '';
  const explorer = result.receipt?.explorerLink || '';
  const txLine = txHash ? explorerLinkLine(txHash, explorer) : 'Explorer link unavailable';

  if (pending.action === 'buy') {
    return truncateText(
      `## Bet executed\n\n- **Tx:** ${txLine}\n- **Provider:** ${result.provider || pending.provider}\n- **Market:** ${pending.marketTitle}\n- **Position:** ${result.sharesReceivedFormatted || formatShares18(result.sharesReceivedRaw)} ${pending.outcomeLabel || 'shares'} for ~${result.costPaidFormatted || formatUsdcMoneyFromRaw(result.costPaidRaw)}`,
      900,
    );
  }
  if (pending.action === 'sell') {
    return truncateText(
      `## Sell executed\n\n- **Tx:** ${txLine}\n- **Provider:** ${result.provider || pending.provider}\n- **Market:** ${pending.marketTitle}\n- **Sold:** ${result.sharesSoldFormatted || formatShares18(result.sharesSoldRaw)} ${pending.outcomeLabel || 'shares'}\n- **Received:** ${result.proceedsReceivedFormatted || formatUsdcMoneyFromRaw(result.proceedsReceivedRaw)}`,
      900,
    );
  }
  if (pending.action === 'redeem') {
    return truncateText(
      `## Redeem executed\n\n- **Tx:** ${txLine}\n- **Provider:** ${result.provider || pending.provider}\n- **Market:** ${pending.marketTitle}\n- **Payout:** ${result.payoutReceivedFormatted || formatUsdcMoneyFromRaw(result.payoutReceivedRaw)}`,
      900,
    );
  }
  return truncateText(
    `## Refund executed\n\n- **Tx:** ${txLine}\n- **Provider:** ${result.provider || pending.provider}\n- **Market:** ${pending.marketTitle}\n- **Refund:** ${result.refundReceivedFormatted || formatUsdcMoneyFromRaw(result.refundReceivedRaw)}`,
    900,
  );
}

function normalizePredictionStage(detail: Record<string, any>): string {
  return String(detail.stage || 'unknown').trim().toLowerCase();
}

function predictionBuyUnavailableReason(detail: Record<string, any>): string | null {
  const stage = normalizePredictionStage(detail);
  if (stage === 'active') {
    return null;
  }
  if (stage === 'resolved') {
    return 'This market is resolved, so new buys are closed. If you already hold the winning outcome, use redeem instead.';
  }
  if (stage === 'cancelled' || stage === 'expired') {
    return 'This market is no longer active for new buys. If you already participated, check whether refund is available instead.';
  }
  if (stage === 'suspended') {
    return 'This market is suspended right now, so new buys are temporarily disabled.';
  }
  return `This market is not active (${stage || 'unknown'}), so new buys are disabled.`;
}

function getToolSchema(toolName: string): Record<string, any> | null {
  const tool = AGENTFLOW_TOOLS.find((entry) => entry.function.name === toolName);
  return (tool?.function.parameters as Record<string, any> | undefined) ?? null;
}

function validateToolArgs(toolName: string, args: Record<string, any>): ToolValidationResult {
  const schema = getToolSchema(toolName);
  if (!schema) {
    return { ok: true };
  }

  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, any>)
      : {};
  const missingFields = required.filter(
    (field) => args[field] === undefined || args[field] === null || args[field] === '',
  );
  const wrongTypes: string[] = [];

  for (const [field, fieldSchema] of Object.entries(properties)) {
    const value = args[field];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const expectedType = typeof fieldSchema?.type === 'string' ? fieldSchema.type : '';
    if (expectedType === 'string' && typeof value !== 'string' && typeof value !== 'number') {
      wrongTypes.push(field);
      continue;
    }
    if (expectedType === 'boolean' && typeof value !== 'boolean') {
      wrongTypes.push(field);
      continue;
    }
    if (expectedType === 'number' && typeof value !== 'number') {
      wrongTypes.push(field);
      continue;
    }
    if (Array.isArray(fieldSchema?.enum) && !fieldSchema.enum.includes(value)) {
      wrongTypes.push(field);
    }
  }

  if (missingFields.length > 0 || wrongTypes.length > 0) {
    const parts = [
      missingFields.length ? `missing required field(s): ${missingFields.join(', ')}` : '',
      wrongTypes.length ? `wrong type/value for field(s): ${wrongTypes.join(', ')}` : '',
    ].filter(Boolean);
    return {
      ok: false,
      reason: parts.join('; '),
      missingFields,
      wrongTypes,
    };
  }

  return { ok: true };
}

function unwrapProtectedAgentError(error: unknown, toolName: string): string {
  const raw = errorMessage(error).trim();
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: string;
        executionWalletAddress?: string;
      };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        const clean = parsed.error.replace(/^\[[^\]]+\]\s*/i, '').trim();
        if (
          parsed.executionWalletAddress &&
          /execution wallet has insufficient token balance/i.test(clean)
        ) {
          return `Error executing ${toolName}: ${clean}\n\nAgent wallet: ${parsed.executionWalletAddress}`;
        }
        return `Error executing ${toolName}: ${clean}`;
      }
    } catch {
      // fall through to string cleanup
    }
  }

  if (/Payment retry failed with status \d+:/i.test(raw)) {
    const trimmed = raw.replace(/^Error:\s*/i, '');
    const afterColon = trimmed.replace(/^Payment retry failed with status \d+:\s*/i, '').trim();
    if (afterColon) {
      return `Error executing ${toolName}: ${afterColon}`;
    }
  }

  return `Error executing ${toolName}: ${raw}`;
}

export async function loadPendingAction(sessionId: string): Promise<PendingPayload | null> {
  try {
    const raw = await redis.get(pendingKey(sessionId));
    if (raw) {
      const parsed = JSON.parse(raw) as PendingPayload;
      writeLocalPending(sessionId, parsed);
      return parsed;
    }
  } catch (error) {
    console.warn('[tool-executor] Redis load failed:', errorMessage(error));
  }
  return readLocalPending(sessionId);
}

async function storePending(sessionId: string, value: PendingPayload): Promise<void> {
  writeLocalPending(sessionId, value);
  try {
    await redis.set(pendingKey(sessionId), JSON.stringify(value), 'EX', 300);
  } catch (error) {
    console.warn('[tool-executor] Redis store failed:', errorMessage(error));
  }
}

export async function clearPendingAction(sessionId: string): Promise<void> {
  deleteLocalPending(sessionId);
  deleteLocalPredmarketListState(sessionId);
  try {
    await redis.del(pendingKey(sessionId), predictionMarketListStateKey(sessionId));
  } catch (error) {
    console.warn('[tool-executor] Redis clear failed:', errorMessage(error));
  }
}

async function loadPredmarketListState(
  sessionId: string,
): Promise<PredictionMarketListState | null> {
  try {
    const raw = await redis.get(predictionMarketListStateKey(sessionId));
    if (raw) {
      const parsed = JSON.parse(raw) as PredictionMarketListState;
      writeLocalPredmarketListState(sessionId, parsed);
      return parsed;
    }
  } catch (error) {
    console.warn('[tool-executor] Predmarket list state load failed:', errorMessage(error));
  }
  return readLocalPredmarketListState(sessionId);
}

async function storePredmarketListState(
  sessionId: string,
  value: PredictionMarketListState,
): Promise<void> {
  writeLocalPredmarketListState(sessionId, value);
  try {
    await redis.set(predictionMarketListStateKey(sessionId), JSON.stringify(value), 'EX', 900);
  } catch (error) {
    console.warn('[tool-executor] Predmarket list state store failed:', errorMessage(error));
  }
}

async function clearPredmarketListState(sessionId: string): Promise<void> {
  deleteLocalPredmarketListState(sessionId);
  try {
    await redis.del(predictionMarketListStateKey(sessionId));
  } catch (error) {
    console.warn('[tool-executor] Predmarket list state clear failed:', errorMessage(error));
  }
}

async function readTokenBalance(
  tokenAddress: `0x${string}` | null,
  walletAddress: `0x${string}`,
): Promise<bigint | null> {
  if (!tokenAddress) return null;
  const client = createPublicClient({
    transport: http(ARC.alchemyRpc || ARC.rpc),
  });

  try {
    return (await client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    })) as bigint;
  } catch {
    return null;
  }
}

async function collectSseText(response: Response): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let report = '';
  let fallback = '';
  let receipt = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }

        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          if (typeof parsed.delta === 'string') {
            fallback += parsed.delta;
          }
          if (parsed.type === 'report' && typeof parsed.markdown === 'string') {
            report = parsed.markdown;
          }
          if (parsed.type === 'receipt') {
            receipt = formatResearchPipelineReceipt(parsed);
          }
          if (parsed.type === 'error' && typeof parsed.message === 'string') {
            return parsed.message;
          }
        } catch {
          fallback += payload;
        }
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  return [receipt, report || fallback].filter(Boolean).join('\n\n').trim();
}

function formatResearchPipelineReceipt(payload: Record<string, unknown>): string {
  const total = typeof payload.total === 'string' ? payload.total : '';
  const entries = Array.isArray(payload.entries)
    ? payload.entries as Array<Record<string, unknown>>
    : [];
  const paid = entries
    .map((entry) => {
      const agent = typeof entry.agent === 'string' ? entry.agent : '';
      const price = typeof entry.price === 'string' ? entry.price : '';
      const ref =
        typeof entry.transactionRef === 'string' && entry.transactionRef
          ? ` (${entry.transactionRef.slice(0, 8)}...)`
          : '';
      return agent && price ? `${agent}: ${price}${ref}` : '';
    })
    .filter(Boolean);

  if (!total && paid.length === 0) {
    return '';
  }

  return [
    'x402 nanopayments settled for research pipeline.',
    total ? `Total: ${total} USDC` : '',
    paid.length ? `Payments: ${paid.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function summarizePortfolio(snapshot: any): string {
  const parts: string[] = [];

  if (typeof snapshot?.currentValueUsd === 'number') {
    parts.push(`Value: $${formatMoney(snapshot.currentValueUsd)}`);
  }
  if (typeof snapshot?.pnlUsd === 'number') {
    parts.push(`PnL: $${formatMoney(snapshot.pnlUsd)}`);
  }

  if (Array.isArray(snapshot?.holdings) && snapshot.holdings.length > 0) {
    const top = snapshot.holdings
      .slice(0, 3)
      .map((holding: any) => {
        const symbol = typeof holding?.symbol === 'string' ? holding.symbol : 'Asset';
        const amount = typeof holding?.amountFormatted === 'string'
          ? holding.amountFormatted
          : typeof holding?.amount === 'number'
            ? String(holding.amount)
            : null;
        return amount ? `${symbol} ${amount}` : symbol;
      })
      .filter(Boolean)
      .join(', ');

    if (top) {
      parts.push(`Top: ${top}`);
    }
  }

  if (typeof snapshot?.report === 'string' && snapshot.report.trim()) {
    parts.push(snapshot.report.trim());
  }

  return truncateText(parts.join(' | '), 600);
}

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  walletCtx: {
    walletAddress: string;
    executionWalletId?: string;
    executionWalletAddress?: string;
    executionTarget?: 'EOA' | 'DCW';
  },
  sessionId: string,
  context: ToolExecutionContext = {},
): Promise<string> {
  const skipValidation =
    toolName === 'agentpay_send' &&
    args &&
    typeof args === 'object' &&
    args.confirmed === true;
  const validation = skipValidation ? { ok: true as const } : validateToolArgs(toolName, args);
  if (!validation.ok) {
    console.warn('[TOOL_VALIDATION_FAILED]', {
      tool: toolName,
      missing_fields: validation.missingFields,
      wrong_types: validation.wrongTypes,
    });
    if (toolName === 'bridge_precheck' && validation.wrongTypes?.includes('sourceChain')) {
      const sourceHint = String(args?.sourceChain || '').trim();
      const sourceLabel = /^base$/i.test(sourceHint) ? 'Base Sepolia' : sourceHint || 'the source chain';
      return `How much USDC do you want to bridge from ${sourceLabel} to Arc?`;
    }
    return `Tool validation error for ${toolName}: ${validation.reason}. Ask the user one concise clarification question before trying again.`;
  }

  console.log('[tool-executor] called:', toolName, JSON.stringify(args));

  try {
    switch (toolName) {
      case 'get_balance': {
        const address =
          walletCtx.executionTarget === 'DCW'
            ? (
                walletCtx.executionWalletAddress?.trim() ||
                (await getOrCreateUserAgentWallet(walletCtx.walletAddress)).address
              )
            : walletCtx.walletAddress.trim();
        if (!address) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        const walletAddress = normalizeAddress(address);
        const client = createPublicClient({
          transport: http(ARC.alchemyRpc || ARC.rpc),
        });
        const balances = { usdc: '0.00', eurc: '0.00', vault: '0.00' };

        try {
          console.log('[tool-executor] reading USDC balance for:', address);
          if (ARC_USDC) {
            const usdcRaw = (await client.readContract({
              address: ARC_USDC,
              abi: ERC20_BALANCE_ABI,
              functionName: 'balanceOf',
              args: [walletAddress],
            })) as bigint;
            balances.usdc = formatMoney(Number(formatUnits(usdcRaw, 6)));
          }
        } catch (e) {
          console.warn('[tool-executor] USDC read failed:', e);
        }

        try {
          console.log('[tool-executor] reading EURC balance for:', address);
          if (ARC_EURC) {
            const eurcRaw = (await client.readContract({
              address: ARC_EURC,
              abi: ERC20_BALANCE_ABI,
              functionName: 'balanceOf',
              args: [walletAddress],
            })) as bigint;
            balances.eurc = formatMoney(Number(formatUnits(eurcRaw, 6)));
          }
        } catch (e) {
          console.warn('[tool-executor] EURC read failed:', e);
        }

        const vaultSummary = await getVaultBalanceSummary(walletAddress);
        const result = `USDC: ${balances.usdc} | EURC: ${balances.eurc} | ${vaultSummary}`;
        console.log('[tool-executor] result:', result);
        return result;
      }

      case 'agentpay_send': {
        const { to, amount, remark, confirmed } = args;
        const normalizedWallet = walletCtx.walletAddress.trim();
        if (!normalizedWallet) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (walletCtx.executionTarget === 'EOA') {
          const result = 'Payment sends run in DCW mode. Switch execution mode to DCW to send from chat.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (confirmed) {
          const res = await fetch(`${PUBLIC_API_BASE_URL}/api/pay/brain/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${generateJWT(normalizeAddress(normalizedWallet))}`,
            },
            body: JSON.stringify({ sessionId }),
          });

          const json = (await res.json().catch(() => null)) as
            | {
                ok?: boolean;
                txHash?: string;
                explorerLink?: string;
                error?: string;
                to?: string;
                amount?: string;
                remark?: string;
              }
            | null;

          if (!res.ok || !json?.ok || !json.txHash) {
            const reason = json?.error || 'Failed to execute pending payment';
            const result = `Payment failed: ${reason}`;
            console.log('[tool-executor] result:', result);
            return result;
          }

          const result = formatAgentPayResult(
            typeof to === 'string' && to ? to : json.to || 'recipient',
            typeof amount === 'string' && amount ? amount : json.amount || 'unknown',
            json.txHash,
            json.explorerLink || json.txHash,
            typeof remark === 'string' && remark.trim() ? remark.trim() : json.remark,
          );
          console.log('[tool-executor] result:', result);
          return result;
        }

        const toValue = typeof to === 'string' ? to : '';
        if (!to || typeof to !== 'string') {
          const result = 'Who should I send to? Please provide a handle or address.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
          const result = 'How much USDC should I send?';
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (!userMessageHasExplicitPaymentAmount(context.rawUserMessage)) {
          const result = `How much do you want to send to ${toValue}?`;
          console.log('[tool-executor] result:', result);
          return result;
        }

        let resolvedAddress: string | null = null;
        try {
          resolvedAddress = await resolvePayee(toValue, normalizedWallet);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const result = `Couldn't resolve recipient: ${reason}`;
          console.log('[tool-executor] result:', result);
          return result;
        }

        try {
          await fetchAgentPayPreview(
            sessionId,
            normalizedWallet,
            toValue,
            resolvedAddress,
            String(amount),
            typeof remark === 'string' ? remark : undefined,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const result = `Couldn't prepare payment: ${reason}`;
          console.log('[tool-executor] result:', result);
          return result;
        }

        const result = formatAgentPayPreview(
          toValue,
          resolvedAddress,
          String(amount),
          typeof remark === 'string' ? remark : undefined,
        );
        console.log('[tool-executor] result:', result);
        return result;
      }

      case 'agentpay_request': {
        const { from, amount, remark } = args;
        if (!from || typeof from !== 'string') {
          const result = 'Who should I request money from? Provide a handle or address.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
          const result = 'How much USDC do you want to request?';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const normalizedWallet = walletCtx.walletAddress.trim();
        if (!normalizedWallet) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        let resolvedFrom: string;
        try {
          resolvedFrom = await resolvePayee(from, normalizedWallet);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const result = `Couldn't resolve recipient: ${reason}`;
          console.log('[tool-executor] result:', result);
          return result;
        }

        const res = await fetch(`${PUBLIC_API_BASE_URL}/api/pay/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${generateJWT(normalizeAddress(normalizedWallet))}`,
          },
          body: JSON.stringify({
            fromWallet: from,
            amount: String(amount),
            ...(typeof remark === 'string' && remark.trim()
              ? { remark: remark.trim() }
              : {}),
          }),
        });

        const json = (await res.json().catch(() => null)) as
          | { requestId?: string; error?: string }
          | null;

        if (!res.ok || !json?.requestId) {
          const reason = json?.error || 'Failed to create payment request';
          const result = `Payment request failed: ${reason}`;
          console.log('[tool-executor] result:', result);
          return result;
        }

        const shortFrom = `${resolvedFrom.slice(0, 8)}...${resolvedFrom.slice(-4)}`;
        const remarkLine =
          typeof remark === 'string' && remark.trim()
            ? `\nNote: ${remark.trim()}`
            : '';

        const result = [
          `Payment request sent to ${from} (${shortFrom}).`,
          `Amount: ${amount} USDC${remarkLine}`,
          '',
          "They'll see your request in their AgentPay inbox.",
        ].join('\n');
        console.log('[tool-executor] result:', result);
        return result;
      }

      case 'swap_tokens': {
        const { amount, tokenIn, tokenOut, confirmed } = args;
        const userWalletAddress = walletCtx.walletAddress.trim();
        if (!userWalletAddress) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (walletCtx.executionTarget === 'EOA') {
          if (confirmed) {
            await clearPendingAction(sessionId);
          }
          const result =
            "You selected EOA mode, which means you execute manually from your own wallet.\n\nDCW mode is the agent-execution mode, where AgentFlow executes for you in chat.\n\nThis automated in-chat swap flow currently runs only in DCW mode. If you want AgentFlow to execute it for you here, switch execution mode to DCW. If you want to stay in EOA mode, execute the swap manually from your own wallet.";
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (!confirmed) {
          if (!walletCtx.executionWalletAddress?.trim()) {
            const result =
              `Your execution wallet is not set up yet.\nFund it at ${APP_URLS.funds} to start swapping.`;
            console.log('[tool-executor] result:', result);
            return result;
          }

          const tokenInAddress = resolveArcTokenSymbol(String(tokenIn));
          const tokenOutAddress = resolveArcTokenSymbol(String(tokenOut));
          if (!tokenInAddress || !tokenOutAddress) {
            const result = 'Unsupported swap pair. Use USDC or EURC.';
            console.log('[tool-executor] result:', result);
            return result;
          }

          const previewResponse = await fetch(SWAP_RUN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${generateJWT(normalizeAddress(userWalletAddress))}`,
            },
            body: JSON.stringify({
              walletAddress: userWalletAddress,
              executionTarget: 'DCW',
              confirmed: false,
              tokenIn: tokenInAddress,
              tokenOut: tokenOutAddress,
              amountIn: String(amount),
              slippageBps: 100,
              fromSym: String(tokenIn),
              toSym: String(tokenOut),
            }),
          });
          const simulation = (await previewResponse.json().catch(() => null)) as
            | {
                success?: boolean;
                error?: string;
                provider?: string;
                route?: Array<{
                  isV3: boolean;
                  path: `0x${string}`[];
                  fees: number[];
                  bps: number;
                }>;
                payload?: SwapSimulationExecutionPayload;
              }
            | null;
          console.log('[tool-executor] raw swap sim:', JSON.stringify(simulation));

          if (!previewResponse.ok || !simulation?.success || !simulation.payload) {
            const result = truncateText(
              simulation?.error || 'Swap simulation failed.',
              300,
            );
            console.log('[tool-executor] result:', result);
            return result;
          }

          await storePending(sessionId, {
            tool: 'swap_tokens',
            args,
            payload: simulation.payload,
          });

          const amountOut = formatTokenAmountSmart(
            simulation.payload.quoteAmountOutRaw,
            simulation.payload.tokenOutDecimals,
          );
          const impact =
            simulation.payload.priceImpactPct === null
              ? 'n/a'
              : `${simulation.payload.priceImpactPct.toFixed(2)}%`;
          const routeBreakdown = formatRouteBreakdown(simulation.payload.routeSegments, {
            tokenIn: simulation.payload.tokenIn,
            tokenOut: simulation.payload.tokenOut,
          });

          const result = truncateText(
            [
              `Swap ${amount} ${tokenIn} -> ${amountOut} ${tokenOut}`,
              '',
              `Provider: ${simulation.payload.provider}`,
              '',
              `Impact: ${impact}`,
              '',
              'Route:',
              '',
              routeBreakdown
                .split('\n')
                .map((line) => `- ${line.replace(/^\d+\.\s*/, '')}`)
                .join('\n'),
              '',
              NATURAL_CONFIRMATION_PROMPT,
            ].join('\n'),
            700,
          );
          console.log('[tool-executor] result:', result);
          return result;
        }

        const pending = await loadPendingAction(sessionId);
        if (!pending || pending.tool !== 'swap_tokens') {
          const result = 'No pending swap found. Ask me to simulate it first.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const paidResult = await executeUserPaidAgentViaX402<{
          success?: boolean;
          error?: string;
          provider?: string;
          txId?: string;
          approvalTxId?: string | null;
          approvalTxHash?: string | null;
          txHash?: string;
          receipt?: {
            explorerLink?: string;
            approvalExplorerLink?: string | null;
            approvalTxHash?: string | null;
            quoteOutRaw?: string;
          };
        }>({
          agent: 'swap',
          price: SWAP_AGENT_PRICE_LABEL,
          userWalletAddress: normalizeAddress(userWalletAddress),
          requestId: `chat_swap_${sessionId}_${Date.now()}`,
          url: SWAP_RUN_URL,
          body: {
            confirmed: true,
            tokenIn: pending.payload.tokenIn,
            tokenOut: pending.payload.tokenOut,
            amount: pending.payload.amount,
            amountInRaw: pending.payload.amountRaw,
            expectedOutRaw: pending.payload.quoteAmountOutRaw,
            routeData: pending.payload.routeData,
            provider: pending.payload.provider,
            slippageBps: Math.round(pending.payload.requestedSlippage * 100),
            fromSym: pending.payload.fromSym,
            toSym: pending.payload.toSym,
          },
        });
        await clearPendingAction(sessionId);
        if (!paidResult.data?.success || !paidResult.data?.txHash) {
          const failure =
            typeof paidResult.data?.error === 'string' && paidResult.data.error.trim()
              ? paidResult.data.error.trim()
              : 'Swap execution failed.';
          console.log('[tool-executor] result:', failure);
          return failure;
        }
        setRecentExecutionMeta(sessionId, {
          entries: [paidResult.paymentEntry],
        });

        const finalResult = truncateText(
          formatSwapExecutionResult({
            approvalTxHash: paidResult.data.receipt?.approvalTxHash ?? paidResult.data.approvalTxHash ?? null,
            approvalExplorerLink: paidResult.data.receipt?.approvalExplorerLink || '',
            txHash: paidResult.data.txHash,
            explorerLink: paidResult.data.receipt?.explorerLink || '',
            amountIn: pending.payload.amount,
            tokenInSymbol: pending.payload.fromSym,
            amountOut: formatTokenAmountSmart(
              paidResult.data.receipt?.quoteOutRaw ?? pending.payload.quoteAmountOutRaw,
              pending.payload.tokenOutDecimals,
            ),
            tokenOutSymbol: pending.payload.toSym,
            executionTarget: 'DCW',
            provider: paidResult.data.provider || pending.payload.provider || null,
          }),
          700,
        );
        console.log('[tool-executor] result:', finalResult);
        return finalResult;
      }

      case 'vault_action': {
        const { action, amount, confirmed, provider, vaultSymbol } = args;
        const userWalletAddress = walletCtx.walletAddress.trim();
        if (!userWalletAddress) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (action === 'list') {
          const vaultList = await fetchVaultAgent<{
            success?: boolean;
            vaults?: Array<Record<string, any>>;
          }>(normalizeAddress(userWalletAddress), { action: 'list' });
          const result = formatVaultListResult(vaultList.vaults || [], {
            readonly: context.readonly,
          });
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (action === 'position') {
          const positions = await fetchVaultAgent<{
            success?: boolean;
            positions?: Array<Record<string, any>>;
          }>(normalizeAddress(userWalletAddress), { action: 'position' });
          const result = formatVaultPositionResult(positions.positions || []);
          console.log('[tool-executor] result:', result);
          return result;
        }
        if (walletCtx.executionTarget === 'EOA') {
          if (confirmed) {
            await clearPendingAction(sessionId);
          }
          const result =
            "You selected EOA mode, which means you execute manually from your own wallet.\n\nDCW mode is the agent-execution mode, where AgentFlow executes for you in chat.\n\nThis automated in-chat vault flow currently runs only in DCW mode. If you want AgentFlow to execute it for you here, switch execution mode to DCW. If you want to stay in EOA mode, execute the vault action manually from your own wallet.";
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (!confirmed) {
          const vaultList = await fetchVaultAgent<{
            success?: boolean;
            vaults?: Array<Record<string, any>>;
          }>(normalizeAddress(userWalletAddress), { action: 'list' });
          const vaults = Array.isArray(vaultList.vaults) ? vaultList.vaults : [];
          const matchedVault =
            vaults.find((vault) => vaultSymbol && vault.vaultSymbol === vaultSymbol) ||
            vaults.find((vault) => {
              const hint = String(args.amountTokenHint || '').toUpperCase();
              return (
                hint === String(vault.assetSymbol).toUpperCase() &&
                (!provider || vault.provider === provider)
              );
            });

          let resolvedVault = matchedVault;
          if (!resolvedVault && action === 'withdraw') {
            const positionResult = await fetchVaultAgent<{
              success?: boolean;
              positions?: Array<Record<string, any>>;
            }>(normalizeAddress(userWalletAddress), { action: 'position' });
            const nonzero = Array.isArray(positionResult.positions)
              ? positionResult.positions
              : [];
            if (nonzero.length === 1) {
              resolvedVault = nonzero[0].vault;
            } else if (nonzero.length > 1) {
              const result = `You have positions in: ${nonzero
                .map((position) => position.vault.vaultSymbol)
                .join(' and ')}. Which one?`;
              console.log('[tool-executor] result:', result);
              return result;
            }
          }

          if (!resolvedVault) {
            const result =
              action === 'withdraw'
                ? 'Which vault should I withdraw from: luneUSDC or luneEURC?'
                : 'Which vault should I use: luneUSDC or luneEURC?';
            console.log('[tool-executor] result:', result);
            return result;
          }

          const previewResult = await fetchVaultAgent<{
            success?: boolean;
            preview?: Record<string, any>;
          }>(normalizeAddress(userWalletAddress), {
            action,
            amount,
            provider: resolvedVault.provider,
            vaultAddress: resolvedVault.address,
            confirmed: false,
          });

          await storePending(sessionId, {
            tool: 'vault_action',
            args: {
              action,
              amount,
              provider: resolvedVault.provider,
              vaultSymbol: resolvedVault.vaultSymbol,
              confirmed: false,
            },
            payload: {
              action: String(action) as 'deposit' | 'withdraw',
              amount: String(amount),
              provider: resolvedVault.provider,
              vaultAddress: resolvedVault.address,
              assetAddress: previewResult.preview?.assetAddress as `0x${string}`,
              vaultSymbol: resolvedVault.vaultSymbol,
              vaultLabel: resolvedVault.label,
              assetSymbol: resolvedVault.assetSymbol,
              network: resolvedVault.network,
              experimental: resolvedVault.experimental,
              notes: resolvedVault.notes,
              expectedSharesRaw: previewResult.preview?.expectedSharesRaw,
              expectedSharesBurnedRaw: previewResult.preview?.expectedSharesBurnedRaw,
              currentPosition: previewResult.preview?.currentPosition,
            },
          });

          const result = formatVaultPreview({
            ...previewResult.preview,
            provider: resolvedVault.provider,
            vaultSymbol: resolvedVault.vaultSymbol,
            assetSymbol: resolvedVault.assetSymbol,
            network: resolvedVault.network,
            experimental: resolvedVault.experimental,
            notes: resolvedVault.notes,
          });
          console.log('[tool-executor] result:', result);
          return result;
        }

        const pending = await loadPendingAction(sessionId);
        if (!pending || pending.tool !== 'vault_action') {
          const result = 'No pending vault action found. Ask me to simulate it first.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const paidResult = await executeUserPaidAgentViaX402<{
          success?: boolean;
          error?: string;
          provider?: string;
          approvalTxId?: string | null;
          approvalTxHash?: string | null;
          txHash?: string;
          vaultSymbol?: string;
          assetSymbol?: string;
          sharesReceivedFormatted?: string;
          sharesBurnedFormatted?: string;
          assetsReceivedFormatted?: string;
          receipt?: {
            explorerLink?: string;
            approvalExplorerLink?: string | null;
          };
        }>({
          agent: 'vault',
          price: VAULT_AGENT_PRICE_LABEL,
          userWalletAddress: normalizeAddress(userWalletAddress),
          requestId: `chat_vault_${sessionId}_${Date.now()}`,
          url: VAULT_RUN_URL,
          body: {
            action: pending.payload.action,
            amount: pending.payload.amount,
            provider: pending.payload.provider,
            vaultAddress: pending.payload.vaultAddress,
            confirmed: true,
          },
        });
        await clearPendingAction(sessionId);
        if (!paidResult.data?.success || !paidResult.data?.txHash) {
          const failure =
            typeof paidResult.data?.error === 'string' && paidResult.data.error.trim()
              ? paidResult.data.error.trim()
              : 'Vault execution failed.';
          console.log('[tool-executor] result:', failure);
          return failure;
        }
        setRecentExecutionMeta(sessionId, { entries: [paidResult.paymentEntry] });

        const finalResult =
          pending.payload.action === 'deposit'
            ? truncateText(
                `Vault deposit complete on Arc.\n\n` +
                  `Vault: ${pending.payload.vaultLabel}\n\n` +
                  `${
                    paidResult.data.approvalTxHash
                      ? `Approval tx:\n\n${paidResult.data.approvalTxHash}\n\n${
                          paidResult.data.receipt?.approvalExplorerLink
                            ? `Approval explorer: ${paidResult.data.receipt.approvalExplorerLink}\n\n`
                            : ''
                        }`
                      : ''
                  }` +
                  `Deposit tx:\n\n${paidResult.data.txHash}\n\n` +
                  `${
                    paidResult.data.receipt?.explorerLink
                      ? `Explorer: ${paidResult.data.receipt.explorerLink}\n\n`
                      : ''
                  }` +
                  `Shares received: ${paidResult.data.sharesReceivedFormatted || '0'} ${paidResult.data.vaultSymbol || pending.payload.vaultSymbol}`,
                700,
              )
            : truncateText(
                `Vault withdraw complete on Arc.\n\n` +
                  `Vault: ${pending.payload.vaultLabel}\n\n` +
                  `Withdraw tx:\n\n${paidResult.data.txHash}\n\n` +
                  `${
                    paidResult.data.receipt?.explorerLink
                      ? `Explorer: ${paidResult.data.receipt.explorerLink}\n\n`
                      : ''
                  }` +
                  `Shares burned: ${paidResult.data.sharesBurnedFormatted || '0'} ${paidResult.data.vaultSymbol || pending.payload.vaultSymbol}\n\n` +
                  `Assets received: ${paidResult.data.assetsReceivedFormatted || pending.payload.amount} ${paidResult.data.assetSymbol || pending.payload.assetSymbol}`,
                700,
              );
        console.log('[tool-executor] result:', finalResult);
        return finalResult;
      }

      case 'predict_action': {
        const {
          action,
          amount,
          sharesWad,
          marketAddress,
          outcomeIdx,
          provider = 'achmarket',
          filter,
          confirmed,
        } = args;
        const userWalletAddress = walletCtx.walletAddress.trim();
        if (!userWalletAddress) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const normalizedWallet = normalizeAddress(userWalletAddress);
        const normalizedMarketAddress =
          typeof marketAddress === 'string' && marketAddress.trim()
            ? normalizeAddress(marketAddress)
            : null;

        if (action === 'list') {
          const listMode =
            typeof args.listMode === 'string' && args.listMode.trim()
              ? args.listMode.trim().toLowerCase()
              : 'default';
          const normalizedFilter =
            filter && typeof filter === 'object'
              ? {
                  ...(filter as Record<string, unknown>),
                  category:
                    typeof (filter as Record<string, unknown>).category === 'string' &&
                    String((filter as Record<string, unknown>).category).trim().toLowerCase() === 'all'
                      ? undefined
                      : (filter as Record<string, unknown>).category,
                  stage:
                    typeof (filter as Record<string, unknown>).stage === 'string' &&
                    String((filter as Record<string, unknown>).stage).trim()
                      ? String((filter as Record<string, unknown>).stage).trim().toLowerCase()
                      : 'active',
                }
              : { stage: 'active' };
          const marketList = await fetchPredmarketAgent<{
            success?: boolean;
            markets?: Array<Record<string, any>>;
          }>(normalizedWallet, { action: 'list', filter: normalizedFilter });
          let markets = marketList.markets || [];
          const canBroadenEmptyList =
            markets.length === 0 &&
            !('category' in normalizedFilter) &&
            !('searchTerm' in normalizedFilter) &&
            (!('stage' in normalizedFilter) || normalizedFilter.stage === 'active');
          if (canBroadenEmptyList) {
            const fallbackMarketList = await fetchPredmarketAgent<{
              success?: boolean;
              markets?: Array<Record<string, any>>;
            }>(normalizedWallet, { action: 'list', filter: {} });
            if ((fallbackMarketList.markets || []).length > 0) {
              markets = fallbackMarketList.markets || [];
            }
          }
          const pageSize = listMode === 'all' || listMode === 'next' ? 20 : 5;
          let offset = 0;

          if (listMode === 'next') {
            const priorState = await loadPredmarketListState(sessionId);
            if (!priorState || priorState.nextOffset >= markets.length) {
              await clearPredmarketListState(sessionId);
              const result = markets.length
                ? 'No more markets in the current list. Reply `show prediction markets` to restart, or add a category/search term to narrow the list.'
                : 'No prediction markets available right now.';
              console.log('[tool-executor] result:', result);
              return result;
            }
            offset = priorState.nextOffset;
          } else {
            await clearPredmarketListState(sessionId);
          }

          const shownCount = Math.min(pageSize, Math.max(0, markets.length - offset));
          const nextOffset = offset + shownCount;
            if (markets.length > nextOffset) {
              await storePredmarketListState(sessionId, {
              filter: normalizedFilter,
                nextOffset,
                total: markets.length,
                pageSize,
            });
          } else {
            await clearPredmarketListState(sessionId);
          }

          const result = formatPredictionMarketList(markets, {
            offset,
            limit: pageSize,
            requestedAll: listMode === 'all',
          });
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (action === 'detail') {
          if (!normalizedMarketAddress) {
            const result = 'Which market? Share the market address or ask me to show markets first.';
            console.log('[tool-executor] result:', result);
            return result;
          }
          const detailResult = await fetchPredmarketAgent<{
            success?: boolean;
            detail?: Record<string, any>;
          }>(normalizedWallet, {
            action: 'detail',
            provider,
            marketAddress: normalizedMarketAddress,
          });
          const result = formatPredictionMarketDetail(detailResult.detail || {});
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (action === 'position') {
          const positionsResult = await fetchPredmarketAgent<{
            success?: boolean;
            positions?: Array<Record<string, any>>;
          }>(normalizedWallet, { action: 'position' });
          const result = formatPredictionPositions(positionsResult.positions || []);
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (walletCtx.executionTarget === 'EOA') {
          if (confirmed) {
            await clearPendingAction(sessionId);
          }
          const result =
            "You selected EOA mode, which means you execute manually from your own wallet.\n\nDCW mode is the agent-execution mode, where AgentFlow executes for you in chat.\n\nThis automated in-chat prediction market flow currently runs only in DCW mode. If you want AgentFlow to execute it for you here, switch execution mode to DCW. If you want to stay in EOA mode, execute the market action manually from your own wallet.";
          console.log('[tool-executor] result:', result);
          return result;
        }

        if (!normalizedMarketAddress) {
          const result = 'marketAddress is required for this prediction market action.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const detailResult = await fetchPredmarketAgent<{
          success?: boolean;
          detail?: Record<string, any>;
        }>(normalizedWallet, {
          action: 'detail',
          provider,
          marketAddress: normalizedMarketAddress,
        });
        const detail = detailResult.detail || {};

        if (!confirmed) {
          if (action === 'buy') {
            const buyUnavailableReason = predictionBuyUnavailableReason(detail);
            if (buyUnavailableReason) {
              const result = truncateText(
                `## ${detail.title || 'Prediction market'}\n\n**Provider:** ${detail.provider || provider}  \n**Network:** ${detail.network || 'testnet'}${detail.experimental ? ' (experimental)' : ''}\n\nBuy is not available right now.\n\n**Reason:** ${buyUnavailableReason}`,
                1200,
              );
              console.log('[tool-executor] result:', result);
              return result;
            }
            const previewResult = await fetchPredmarketAgent<{
              success?: boolean;
              preview?: Record<string, any>;
            }>(normalizedWallet, {
              action: 'buy',
              provider,
              marketAddress: normalizedMarketAddress,
              outcomeIdx,
              amount,
              confirmed: false,
            });
            const preview = previewResult.preview || {};
            if (!preview.executionPayload) {
              const result = 'Prediction market buy preview failed.';
              console.log('[tool-executor] result:', result);
              return result;
            }
            await storePending(sessionId, {
              tool: 'predict_action',
              args: {
                action,
                amount,
                provider,
                marketAddress: normalizedMarketAddress,
                outcomeIdx,
                confirmed: false,
              },
              payload: {
                action: 'buy',
                provider,
                marketAddress: normalizedMarketAddress,
                marketTitle: String(detail.title || normalizedMarketAddress),
                network: detail.network || 'testnet',
                experimental: Boolean(detail.experimental),
                notes: predictionNotes(detail.notes),
                outcomeIdx: Number(outcomeIdx),
                outcomeLabel: String(preview.outcomeLabel || ''),
                amount: String(amount),
                preview,
                executionPayload: preview.executionPayload,
              },
            });
            const result = formatPredictionPreview('buy', detail, preview);
            console.log('[tool-executor] result:', result);
            return result;
          }

          if (action === 'sell') {
            const previewResult = await fetchPredmarketAgent<{
              success?: boolean;
              preview?: Record<string, any>;
            }>(normalizedWallet, {
              action: 'sell',
              provider,
              marketAddress: normalizedMarketAddress,
              outcomeIdx,
              sharesWad,
              confirmed: false,
            });
            const preview = previewResult.preview || {};
            if (!preview.executionPayload) {
              const result = 'Prediction market sell preview failed.';
              console.log('[tool-executor] result:', result);
              return result;
            }
            await storePending(sessionId, {
              tool: 'predict_action',
              args: {
                action,
                sharesWad,
                provider,
                marketAddress: normalizedMarketAddress,
                outcomeIdx,
                confirmed: false,
              },
              payload: {
                action: 'sell',
                provider,
                marketAddress: normalizedMarketAddress,
                marketTitle: String(detail.title || normalizedMarketAddress),
                network: detail.network || 'testnet',
                experimental: Boolean(detail.experimental),
                notes: predictionNotes(detail.notes),
                outcomeIdx: Number(outcomeIdx),
                outcomeLabel: String(preview.outcomeLabel || ''),
                sharesWad: String(sharesWad),
                preview,
                executionPayload: preview.executionPayload,
              },
            });
            const result = formatPredictionPreview('sell', detail, preview);
            console.log('[tool-executor] result:', result);
            return result;
          }

          if (action === 'redeem') {
            const previewResult = await fetchPredmarketAgent<{
              success?: boolean;
              preview?: Record<string, any>;
            }>(normalizedWallet, {
              action: 'redeem',
              provider,
              marketAddress: normalizedMarketAddress,
              confirmed: false,
            });
            const preview = previewResult.preview || {};
            const result = formatPredictionPreview('redeem', detail, preview);
            if (preview.canRedeem) {
              await storePending(sessionId, {
                tool: 'predict_action',
                args: {
                  action,
                  provider,
                  marketAddress: normalizedMarketAddress,
                  confirmed: false,
                },
                payload: {
                  action: 'redeem',
                  provider,
                  marketAddress: normalizedMarketAddress,
                  marketTitle: String(detail.title || normalizedMarketAddress),
                  network: detail.network || 'testnet',
                  experimental: Boolean(detail.experimental),
                  notes: predictionNotes(detail.notes),
                  preview,
                },
              });
            }
            console.log('[tool-executor] result:', result);
            return result;
          }

          const previewResult = await fetchPredmarketAgent<{
            success?: boolean;
            preview?: Record<string, any>;
          }>(normalizedWallet, {
            action: 'refund',
            provider,
            marketAddress: normalizedMarketAddress,
            confirmed: false,
          });
          const preview = previewResult.preview || {};
          const result = formatPredictionPreview('refund', detail, preview);
          if (preview.canRefund) {
            await storePending(sessionId, {
              tool: 'predict_action',
              args: {
                action: 'refund',
                provider,
                marketAddress: normalizedMarketAddress,
                confirmed: false,
              },
              payload: {
                action: 'refund',
                provider,
                marketAddress: normalizedMarketAddress,
                marketTitle: String(detail.title || normalizedMarketAddress),
                network: detail.network || 'testnet',
                experimental: Boolean(detail.experimental),
                notes: predictionNotes(detail.notes),
                preview,
              },
            });
          }
          console.log('[tool-executor] result:', result);
          return result;
        }

        const pending = await loadPendingAction(sessionId);
        if (!pending || pending.tool !== 'predict_action') {
          const result = 'No pending prediction market action found. Ask me to preview it first.';
          console.log('[tool-executor] result:', result);
          return result;
        }

        const paidResult = await executeUserPaidAgentViaX402<Record<string, any>>({
          agent: 'predmarket',
          price: PREDMARKET_AGENT_PRICE_LABEL,
          userWalletAddress: normalizedWallet,
          requestId: `chat_predmarket_${sessionId}_${Date.now()}`,
          url: PREDMARKET_RUN_URL,
          body: {
            action: pending.payload.action,
            provider: pending.payload.provider,
            marketAddress: pending.payload.marketAddress,
            outcomeIdx: pending.payload.outcomeIdx,
            amount: pending.payload.amount,
            sharesWad: pending.payload.sharesWad,
            executionPayload: pending.payload.executionPayload,
            confirmed: true,
          },
        });
        await clearPendingAction(sessionId);
        if (!paidResult.data?.success || !paidResult.data?.txHash) {
          const failure =
            typeof paidResult.data?.error === 'string' && paidResult.data.error.trim()
              ? paidResult.data.error.trim()
              : 'Prediction market execution failed.';
          console.log('[tool-executor] result:', failure);
          return failure;
        }
        setRecentExecutionMeta(sessionId, { entries: [paidResult.paymentEntry] });
        const finalResult = formatPredictionExecutionResult(pending.payload, paidResult.data);
        console.log('[tool-executor] result:', finalResult);
        return finalResult;
      }

      case 'bridge_precheck': {
        const supportedSourceLabels = listSupportedBridgeSourceLabels();
        const result = truncateText(
          [
            `Supported bridge source chains right now: ${supportedSourceLabels}.`,
            'Bridge to Arc uses your connected wallet on the source chain and mints USDC into your AgentFlow wallet on Arc.',
            'The best source chain is usually the supported chain where your connected wallet already has USDC and enough gas.',
          ].join('\n'),
          600,
        );
        console.log('[tool-executor] result:', result);
        return result;
      }

      case 'get_portfolio': {
        const address =
          walletCtx.executionTarget === 'DCW' && walletCtx.executionWalletAddress?.trim()
            ? walletCtx.executionWalletAddress.trim()
            : walletCtx.walletAddress.trim();
        if (!address) {
          const result = 'No wallet connected.';
          console.log('[tool-executor] result:', result);
          return result;
        }
        const walletAddress = normalizeAddress(address);
        const snapshot = await buildPortfolioSnapshot(walletAddress);
        const holdings = Array.isArray(snapshot.holdings)
          ? (snapshot.holdings as Array<Record<string, unknown>>)
          : [];
        const positions = Array.isArray(snapshot.positions)
          ? (snapshot.positions as Array<Record<string, unknown>>)
          : [];
        const recentTransactions = Array.isArray(snapshot.recentTransactions)
          ? (snapshot.recentTransactions as Array<Record<string, unknown>>)
          : [];
        const pnl = snapshot.pnlSummary && typeof snapshot.pnlSummary === 'object'
          ? (snapshot.pnlSummary as Record<string, unknown>)
          : null;
        const result = formatPortfolioSnapshotRecordsForChat(
          {
            holdings,
            positions,
            recentTransactions,
            pnl,
          },
          { maxLength: 1600 },
        );
        console.log('[tool-executor] result:', result);
        return result;
      }

      case 'research': {
        const { query, mode } = args;
        let enrichedQuery = String(query);
        if (
          /\barc\b/i.test(enrichedQuery) &&
          !/token|price|market cap|coin/i.test(enrichedQuery)
        ) {
          enrichedQuery = `${enrichedQuery} Arc Network blockchain Circle L1 stablecoin`;
        }
        const response = await fetch('http://localhost:4000/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            task: enrichedQuery,
            userAddress: walletCtx.walletAddress,
            reasoningMode: 'fast',
            deep: false,
            deepResearch: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const result = truncateText(errorText || DEFAULT_RESEARCH_ERROR, 300);
          console.log('[tool-executor] result:', result);
          return result;
        }

        const report = await collectSseText(response);
        const maxLength =
          typeof context.maxLength === 'number' && context.maxLength > 0
            ? context.maxLength
            : 800;
        const result = truncateText(report || DEFAULT_RESEARCH_ERROR, maxLength);
        console.log('[tool-executor] result:', result);
        return result;
      }

      default: {
        const result = `Unknown tool: ${toolName}`;
        console.log('[tool-executor] result:', result);
        return result;
      }
    }
  } catch (err) {
    console.error('[tool-executor] ERROR:', toolName, err);
    if (toolName === 'vault_action') {
      return [
        'I could not load the provider vaults right now.',
        '',
        'AgentFlow only supports integrated third-party provider vaults, such as luneUSDC and luneEURC. Choose one of those provider vaults, then retry when the vault service is reachable.',
      ].join('\n');
    }
    return unwrapProtectedAgentError(err, toolName);
  }
}
