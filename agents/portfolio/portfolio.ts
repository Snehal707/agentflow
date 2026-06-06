import { ARC } from '../../lib/arc-config';
import { callHermesDeep } from '../../lib/hermes';
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
} from 'viem';
import { arcTestnet } from 'viem/chains';
import { fetchGatewayBalancesForDepositors } from '../../lib/gateway-balance';
import { formatPortfolioSnapshotRecordsForChat } from '../../lib/format-portfolio-chat';
import { getUserPositionsAcrossProviders } from '../../lib/predmarket/router';
import type { UserMarketPosition } from '../../lib/predmarket/types';
import { getProviderPosition, listAllVaults } from '../../lib/vault/router';

const ARC_USDC = getAddress('0x3600000000000000000000000000000000000000');
const ARC_EURC = getAddress('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a');
const ARC_EXPLORER_BASE = (process.env.ARC_EXPLORER_BASE_URL?.trim() ||
  'https://testnet.arcscan.app').replace(/\/+$/, '');
const ARC_EXPLORER_API = `${ARC_EXPLORER_BASE}/api/v2`;
const KNOWN_GATEWAY_WALLETS = new Set([
  getAddress('0x0077777d7EBA4688BDeF3E311b846F25870A19B9'),
]);

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

type ExplorerToken = {
  address_hash: string;
  decimals: string | null;
  exchange_rate: string | null;
  name: string | null;
  symbol: string | null;
};

type ExplorerTokenBalance = {
  token: ExplorerToken;
  value: string;
};

type ExplorerAddressRef = {
  hash: string;
  name?: string | null;
};

type ExplorerTransactionItem = {
  hash: string;
  block_number: number;
  timestamp: string;
  result?: string | null;
  status?: string | null;
  method?: string | null;
  transaction_types?: string[] | null;
  fee?: { value?: string | null } | null;
  value?: string | null;
  from: ExplorerAddressRef;
  to: ExplorerAddressRef | null;
  decoded_input?: {
    method_call?: string | null;
    parameters?: Array<{ name?: string; value?: string }>;
  } | null;
};

type ExplorerTokenTransferItem = {
  transaction_hash: string;
  block_number: number;
  timestamp: string;
  method?: string | null;
  type?: string | null;
  from: ExplorerAddressRef;
  to: ExplorerAddressRef;
  token: ExplorerToken;
  total: {
    decimals: string;
    value: string;
  };
};

type ExplorerPage<T> = {
  items: T[];
  next_page_params?: Record<string, string | number | null> | null;
};

type AlchemyEnhancedDiagnostics = {
  available: boolean;
  error: string | null;
};

type ArcDataDiagnostics = {
  rpcAvailable: boolean;
  tokenApiUsed: boolean;
  note: string;
  error: string | null;
};

type GatewayBalanceDiagnostics = {
  source: 'gateway_api' | 'transfer_estimate';
  error: string | null;
};

export type PortfolioHolding = {
  id: string;
  kind: 'native' | 'erc20' | 'vault_share';
  symbol: string;
  name: string;
  address: string | null;
  balanceRaw: string;
  balanceFormatted: string;
  usdPrice: number | null;
  usdValue: number | null;
  source: string;
  notes: string[];
};

export type PortfolioPosition = {
  id: string;
  kind: 'swap_liquidity' | 'gateway_position' | 'prediction_market';
  name: string;
  protocol: string;
  amountFormatted: string;
  usdValue: number | null;
  costBasisUsd: number | null;
  pnlUsd: number | null;
  notes: string[];
  marketAddress?: string;
  stage?: string;
  canRedeem?: boolean;
  canRefund?: boolean;
};

export type PortfolioRecentTransaction = {
  hash: string;
  timestamp: string;
  status: string;
  method: string;
  from: string;
  to: string | null;
  summary: string;
  explorerUrl: string;
};

export type PortfolioTransfer = {
  hash: string;
  timestamp: string;
  token: string;
  tokenAddress: string;
  direction: 'in' | 'out';
  amount: string;
  counterparty: string;
  counterpartyName: string | null;
  type: string | null;
};

export type PortfolioPnlSummary = {
  costBasisUsd: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  methodology: string;
};

export type PortfolioAssessment = {
  report: string;
  riskScore: number;
  recommendations: string[];
  notes: string[];
};

export type PortfolioSnapshot = {
  walletAddress: string;
  holdings: PortfolioHolding[];
  positions: PortfolioPosition[];
  recentTransactions: PortfolioRecentTransaction[];
  tokenTransfers: PortfolioTransfer[];
  pnlSummary: PortfolioPnlSummary;
  diagnostics: {
    alchemyRpcProvider: string;
    arcData: ArcDataDiagnostics;
    /** Legacy shape kept for older frontend builds; Arc Testnet does not require Alchemy Token API. */
    alchemyEnhanced: AlchemyEnhancedDiagnostics;
    explorerBaseUrl: string;
    gatewayBalance: GatewayBalanceDiagnostics;
  };
};

type TokenBalanceRead = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: bigint;
  formattedBalance: string;
  usdPrice: number | null;
  usdValue: number | null;
  notes: string[];
};

function inferVaultHoldingMeta(symbol: string, name: string): {
  isVaultShare: boolean;
  impliedUsdPrice: number | null;
  note: string | null;
} {
  const upperSymbol = symbol.trim().toUpperCase();
  const lowerName = name.trim().toLowerCase();
  const isVaultShare =
    upperSymbol.startsWith('AFV') ||
    upperSymbol.startsWith('APV') ||
    upperSymbol.startsWith('LUNE') ||
    lowerName.includes('vault');

  if (!isVaultShare) {
    return { isVaultShare: false, impliedUsdPrice: null, note: null };
  }

  if (upperSymbol.includes('USDC') || lowerName.includes('usdc')) {
    return {
      isVaultShare: true,
      impliedUsdPrice: 1,
      note: 'Vault share valued from USDC-denominated vault balance.',
    };
  }
  if (upperSymbol.includes('EURC') || lowerName.includes('eurc')) {
    return {
      isVaultShare: true,
      impliedUsdPrice: 1,
      note: 'Vault share valued from EURC-denominated vault balance.',
    };
  }
  return {
    isVaultShare: true,
    impliedUsdPrice: null,
    note: 'Vault share detected, but no stable-value hint was available.',
  };
}

function isLegacyAgentFlowVault(symbol: string, name: string): boolean {
  const upperSymbol = symbol.trim().toUpperCase();
  const lowerName = name.trim().toLowerCase();
  return upperSymbol.startsWith('AFV') || upperSymbol.startsWith('APV') || lowerName.includes('agentflow vault');
}

type TokenPriceMap = Record<string, number | null>;

type PositionCostSummary = {
  vaultBasisUsd: number;
  swapBasisUsd: number;
  gatewayBasisUsd: number;
};

type GatewayBalanceResult = {
  availableUsd: number;
  totalUsd: number;
  source: 'gateway_api' | 'transfer_estimate';
  error: string | null;
  note: string;
};

const PORTFOLIO_REPORT_PROMPT = `You are AgentFlow's portfolio analyst.
Return strict JSON with this exact schema:
{"report":string,"riskScore":number,"recommendations":[string],"notes":[string]}

Rules:
- The report must be markdown.
- Be concise and specific.
- Use exact wallet values from the input.
- Do not include full wallet addresses or labels like "Wallet scanned".
- Do not include raw "Risk score: N" lines; express risk in plain English instead.
- Do not include a methodology section unless the user explicitly asked for technical methodology.
- Explain that Arc Testnet balances are read with standard JSON-RPC/eth_call plus Arcscan/Gateway data; do not claim Alchemy Token API is required.
- Mention meaningful DeFi positions like vault shares, swap liquidity, and gateway balances when present.
- Only describe Gateway balances as estimated when diagnostics.gatewayBalance.source is "transfer_estimate".
- Recommendations must be user-facing portfolio guidance, not developer workflow advice.
- Do not recommend testing, simulation, documenting gas patterns, stress tests, or checking network conditions.
- If the wallet is mostly stablecoins, explain that very small PnL changes usually come from swap fees, transfers, and rounding rather than market volatility.
- recommendations must be 2 to 4 actionable strings.
- notes must be 1 to 4 caveats or assumptions.`;

export async function buildPortfolioSnapshot(
  walletAddress: string,
  options: { gatewayDepositors?: string[] } = {},
): Promise<PortfolioSnapshot> {
  if (!isAddress(walletAddress)) {
    throw new Error('Valid walletAddress is required');
  }

  const normalizedWallet = getAddress(walletAddress);
  const alchemyRpcUrl = requireAlchemyRpc();
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(alchemyRpcUrl),
  });

  const [arcData, explorerBalances, transactions, transferHistory] = await Promise.all([
    checkArcDataAvailability(alchemyRpcUrl),
    fetchExplorerTokenBalances(normalizedWallet),
    fetchExplorerTransactions(normalizedWallet, 12),
    fetchExplorerTokenTransfers(normalizedWallet, 120),
  ]);

  const priceMap = await buildTokenPriceMap(normalizedWallet, explorerBalances);
  const gatewayBalance = await resolveGatewayBalance(
    normalizedWallet,
    transferHistory,
    options.gatewayDepositors,
  );
  const holdings = await buildHoldings({
    client,
    walletAddress: normalizedWallet,
    explorerBalances,
    priceMap,
  });

  const positionCosts = calculatePositionCostBasis(normalizedWallet, transferHistory);
  const positions = await buildPositions({
    client,
    walletAddress: normalizedWallet,
    priceMap,
    transferHistory,
    gatewayBalance,
    positionCosts,
  });
  const predictionMarketPositions = await buildPredictionMarketPortfolioPositions(normalizedWallet);
  positions.push(...predictionMarketPositions);

  const currentValueUsd = roundUsd(
    holdings.reduce((sum, item) => sum + (item.usdValue ?? 0), 0) +
      positions.reduce((sum, item) => sum + (item.usdValue ?? 0), 0),
  );

  const stableHoldingBasisUsd = roundUsd(
    holdings.reduce((sum, item) => {
      if (item.kind === 'vault_share') {
        return sum;
      }
      return sum + (item.usdValue ?? 0);
    }, 0),
  );

  const vaultHolding = holdings.find((item) => item.kind === 'vault_share');
  const vaultCurrentUsd = vaultHolding?.usdValue ?? 0;
  const swapCostBasisUsd = roundUsd(
    positions
      .filter((item) => item.kind === 'swap_liquidity')
      .reduce((sum, item) => sum + Number(item.costBasisUsd ?? 0), 0),
  );
  const gatewayCostBasisUsd = roundUsd(
    positions
      .filter((item) => item.kind === 'gateway_position')
      .reduce((sum, item) => sum + Number(item.costBasisUsd ?? 0), 0),
  );

  const costBasisUsd = roundUsd(
    stableHoldingBasisUsd +
      positionCosts.vaultBasisUsd +
      swapCostBasisUsd +
      gatewayCostBasisUsd,
  );

  const pnlUsd = roundUsd(currentValueUsd - costBasisUsd);
  const pnlPct = costBasisUsd > 0 ? roundUsd((pnlUsd / costBasisUsd) * 100) : 0;

  return {
    walletAddress: normalizedWallet,
    holdings,
    positions,
    recentTransactions: transactions.map((item) => mapTransaction(item)),
    tokenTransfers: transferHistory.slice(0, 20).map((item) => mapTransfer(normalizedWallet, item)),
    pnlSummary: {
      costBasisUsd,
      currentValueUsd,
      pnlUsd,
      pnlPct,
      methodology:
        'Stable balances are marked at $1. Arc native USDC is treated as the canonical wallet balance, with the mirrored ERC-20 view omitted to avoid double counting. Vault basis uses net USDC deposited minus withdrawn. Swap liquidity basis uses net stablecoin supplied to the pool. Gateway value uses the Circle Gateway balance API when available and falls back to transfer history only if the live balance cannot be read.',
    },
    diagnostics: {
      alchemyRpcProvider: sanitizeRpcUrl(alchemyRpcUrl),
      arcData,
      alchemyEnhanced: {
        available: false,
        error: null,
      },
      explorerBaseUrl: ARC_EXPLORER_BASE,
      gatewayBalance: {
        source: gatewayBalance.source,
        error: gatewayBalance.error,
      },
    },
  };
}

export async function generatePortfolioAssessment(
  snapshot: PortfolioSnapshot,
  context?: { walletAddress?: string; agentSlug?: string },
): Promise<PortfolioAssessment> {
  const { alchemyEnhanced: _legacyAlchemyEnhanced, ...diagnosticsForPrompt } = snapshot.diagnostics;
  const promptSnapshot = {
    ...snapshot,
    diagnostics: diagnosticsForPrompt,
  };

  const response = await callHermesDeep(
    PORTFOLIO_REPORT_PROMPT,
    JSON.stringify(promptSnapshot),
    {
      walletAddress: context?.walletAddress,
      agentSlug: context?.agentSlug ?? 'portfolio',
    },
  );

  try {
    const parsed = parsePortfolioAssessmentJson(response);
    return {
      report: typeof parsed.report === 'string' ? parsed.report : response,
      riskScore: clampRiskScore(parsed.riskScore),
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map((item) => String(item))
        : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : [],
    };
  } catch {
    return {
      report: response,
      riskScore: 50,
      recommendations: [],
      notes: ['Hermes response was not strict JSON; raw report returned instead.'],
    };
  }
}

export function buildPortfolioQuickSummary(
  snapshot: PortfolioSnapshot,
  options: { postAction?: boolean } = {},
): string {
  return formatPortfolioSnapshotRecordsForChat(
    {
      holdings: snapshot.holdings as unknown as Array<Record<string, unknown>>,
      positions: snapshot.positions as unknown as Array<Record<string, unknown>>,
      recentTransactions: snapshot.recentTransactions as unknown as Array<Record<string, unknown>>,
      pnl: snapshot.pnlSummary as unknown as Record<string, unknown>,
    },
    {
      title: options.postAction ? '## Portfolio after this action' : undefined,
      maxLength: 2000,
    },
  );
}

function parsePortfolioAssessmentJson(response: string): Partial<PortfolioAssessment> {
  const candidates = collectPortfolioAssessmentCandidates(response);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<PortfolioAssessment>;
      if (isPortfolioAssessmentShape(parsed)) {
        return parsed;
      }
    } catch {
      const repaired = repairPortfolioAssessmentJson(candidate);
      try {
        const parsed = JSON.parse(repaired) as Partial<PortfolioAssessment>;
        if (isPortfolioAssessmentShape(parsed)) {
          return parsed;
        }
      } catch {
        const extracted = extractPortfolioAssessmentFields(candidate);
        if (isPortfolioAssessmentShape(extracted)) {
          return extracted;
        }
      }
    }
  }

  throw new Error('Portfolio assessment JSON parse failed');
}

function collectPortfolioAssessmentCandidates(response: string): string[] {
  const cleaned = response.trim();
  const candidates = new Set<string>();
  if (cleaned) {
    candidates.add(cleaned);
  }

  const fencedMatches = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const body = match[1]?.trim();
    if (body) {
      candidates.add(body);
    }
  }

  for (const objectText of extractBalancedJsonObjects(cleaned)) {
    candidates.add(objectText);
  }

  return [...candidates];
}

function extractBalancedJsonObjects(input: string): string[] {
  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        results.push(input.slice(start, index + 1).trim());
        start = -1;
      }
    }
  }

  return results;
}

function repairPortfolioAssessmentJson(candidate: string): string {
  return candidate
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\*\*(report|riskScore|recommendations|notes)\*\*\s*:/g, '"$1":')
    .replace(/([{,]\s*)(report|riskScore|recommendations|notes)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
}

function isPortfolioAssessmentShape(value: unknown): value is Partial<PortfolioAssessment> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    'report' in candidate ||
    'riskScore' in candidate ||
    'recommendations' in candidate ||
    'notes' in candidate
  );
}

function extractPortfolioAssessmentFields(candidate: string): Partial<PortfolioAssessment> {
  const result: Partial<PortfolioAssessment> = {};

  const reportMatch = candidate.match(
    /"report"\s*:\s*"([\s\S]*?)"\s*,\s*"riskScore"/i,
  );
  if (reportMatch?.[1]) {
    result.report = decodeJsonLikeString(reportMatch[1]).trim();
  }

  const riskScoreMatch = candidate.match(/"riskScore"\s*:\s*([0-9.]+)/i);
  if (riskScoreMatch?.[1]) {
    result.riskScore = Number(riskScoreMatch[1]);
  }

  const recommendationsMatch = candidate.match(
    /"recommendations"\s*:\s*\[([\s\S]*?)\]\s*,\s*"notes"/i,
  );
  if (recommendationsMatch?.[1]) {
    result.recommendations = extractJsonLikeStringArray(recommendationsMatch[1]);
  }

  const notesMatch = candidate.match(/"notes"\s*:\s*\[([\s\S]*?)\]\s*}/i);
  if (notesMatch?.[1]) {
    result.notes = extractJsonLikeStringArray(notesMatch[1]);
  }

  return result;
}

function extractJsonLikeStringArray(source: string): string[] {
  const matches = [...source.matchAll(/"((?:\\.|[^"])*)"/g)];
  return matches
    .map((match) => decodeJsonLikeString(match[1] ?? '').trim())
    .filter(Boolean);
}

function decodeJsonLikeString(source: string): string {
  return source
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function clampRiskScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function requireAlchemyRpc(): string {
  const value = process.env.ALCHEMY_ARC_RPC?.trim();
  if (!value) {
    throw new Error('ALCHEMY_ARC_RPC is required for portfolio analysis');
  }
  return value;
}

function hasPredictionMarketShares(position: UserMarketPosition): boolean {
  return position.outcomes.some((outcome) => {
    try {
      return BigInt(outcome.sharesRaw || '0') > 0n;
    } catch {
      return Number(outcome.sharesFormatted || 0) > 0;
    }
  });
}

function hasPredictionMarketNetDeposit(position: UserMarketPosition): boolean {
  try {
    return BigInt(position.netDepositedRaw || '0') > 0n;
  } catch {
    return Number(position.netDepositedFormatted || 0) > 0;
  }
}

function formatPredictionMarketOutcomeSummary(position: UserMarketPosition): string {
  const outcomes = position.outcomes
    .filter((outcome) => {
      try {
        return BigInt(outcome.sharesRaw || '0') > 0n;
      } catch {
        return Number(outcome.sharesFormatted || 0) > 0;
      }
    })
    .map((outcome) => `${outcome.sharesFormatted} ${outcome.label}`)
    .join(' | ');
  const netDeposit = Number(position.netDepositedFormatted || 0);
  const depositLabel = Number.isFinite(netDeposit) && netDeposit > 0
    ? `net deposit ${netDeposit.toFixed(2)} USDC`
    : '';
  return [outcomes, depositLabel].filter(Boolean).join('; ') || 'position detected';
}

async function buildPredictionMarketPortfolioPositions(
  walletAddress: string,
): Promise<PortfolioPosition[]> {
  try {
    const positions = await getUserPositionsAcrossProviders(getAddress(walletAddress) as `0x${string}`);
    return positions
      .filter((position) => {
        const actionable = position.canRedeem || position.canRefund;
        const active = position.stage === 'active';
        return (active || actionable) && (hasPredictionMarketShares(position) || hasPredictionMarketNetDeposit(position) || actionable);
      })
      .map((position) => {
        const netDeposit = Number(position.netDepositedFormatted || 0);
        const status = position.canRedeem
          ? 'Redeemable now'
          : position.canRefund
            ? 'Refundable now'
            : `Stage: ${position.stage}`;
        return {
          id: `predmarket:${position.provider}:${position.market.address}`,
          kind: 'prediction_market',
          name: position.market.title || 'Prediction market position',
          protocol: position.provider || 'predmarket',
          amountFormatted: formatPredictionMarketOutcomeSummary(position),
          usdValue: null,
          costBasisUsd: Number.isFinite(netDeposit) ? roundUsd(netDeposit) : null,
          pnlUsd: null,
          notes: [
            status,
            `Address: ${position.market.address}`,
            'Prediction market shares are shown only when active, redeemable, or refundable.',
          ],
          marketAddress: position.market.address,
          stage: position.stage,
          canRedeem: position.canRedeem,
          canRefund: position.canRefund,
        } satisfies PortfolioPosition;
      });
  } catch (error) {
    console.warn('[portfolio] prediction market positions unavailable:', toMessage(error));
    return [];
  }
}

async function checkArcDataAvailability(rpcUrl: string): Promise<ArcDataDiagnostics> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_chainId',
        params: [],
      }),
    });
    const json = (await response.json()) as { result?: string; error?: { message?: string } };
    if (!response.ok || json.error || !json.result) {
      throw new Error(json.error?.message ?? `Arc RPC health failed (${response.status})`);
    }
    return {
      rpcAvailable: true,
      tokenApiUsed: false,
      note:
        'Alchemy Arc RPC is live. Portfolio reads use standard JSON-RPC, ERC-20 balanceOf, Arcscan, and Gateway APIs.',
      error: null,
    };
  } catch (error) {
    return {
      rpcAvailable: false,
      tokenApiUsed: false,
      note: 'Arc RPC health check failed; downstream reads may use partial data.',
      error: toMessage(error),
    };
  }
}

async function buildTokenPriceMap(
  walletAddress: Address,
  explorerBalances: ExplorerTokenBalance[],
): Promise<TokenPriceMap> {
  const addresses = new Set<string>([ARC_USDC, ARC_EURC]);
  for (const item of explorerBalances) {
    if (isAddress(item.token.address_hash)) {
      addresses.add(getAddress(item.token.address_hash));
    }
  }
  const result: TokenPriceMap = {};
  for (const address of addresses) {
    if (address === ARC_USDC || address === ARC_EURC) {
      result[address] = 1;
      continue;
    }
    result[address] = null;
  }

  for (const item of explorerBalances) {
    const address = isAddress(item.token.address_hash)
      ? getAddress(item.token.address_hash)
      : null;
    if (!address || address === ARC_USDC || address === ARC_EURC) {
      continue;
    }
    const price = Number(item.token.exchange_rate);
    if (Number.isFinite(price) && price > 0) {
      result[address] = price;
    }
  }

  // Keep native and stable assumptions explicit; Arc Testnet does not support
  // Alchemy enhanced token pricing methods on the Arc RPC endpoint.
  result[ARC_USDC] = 1;
  result[ARC_EURC] = 1;

  // Wallet address currently unused by pricing, but keeping the signature explicit helps future expansion.
  void walletAddress;
  return result;
}

async function buildHoldings(params: {
  client: ReturnType<typeof createPublicClient>;
  walletAddress: Address;
  explorerBalances: ExplorerTokenBalance[];
  priceMap: TokenPriceMap;
}): Promise<PortfolioHolding[]> {
  const { client, walletAddress, explorerBalances, priceMap } = params;
  const candidates = new Set<string>([ARC_USDC, ARC_EURC]);
  const knownVaults = await listAllVaults();
  const knownVaultByAddress = new Map(
    knownVaults.map((vault) => [getAddress(vault.address), vault] as const),
  );

  for (const item of explorerBalances) {
    if (isAddress(item.token.address_hash)) {
      candidates.add(getAddress(item.token.address_hash));
    }
  }

  const nativeBalance = await client.getBalance({ address: walletAddress });
  const holdings: PortfolioHolding[] = [];
  const nativeBalanceFormatted = Number(formatUnits(nativeBalance, 18));
  if (nativeBalance > 0n) {
    holdings.push({
      id: 'native-usdc',
      kind: 'native',
      symbol: 'USDC',
      name: 'USDC',
      address: null,
      balanceRaw: nativeBalance.toString(),
      balanceFormatted: formatUnits(nativeBalance, 18),
      usdPrice: 1,
      usdValue: roundUsd(nativeBalanceFormatted),
      source: 'ALCHEMY_ARC_RPC eth_getBalance',
      notes: [
        'Native USDC on Arc (18 decimals); network fees are paid from this balance.',
      ],
    });
  }

  for (const candidate of candidates) {
    const token = await readTokenBalance(client, candidate as Address, walletAddress, priceMap);
    if (!token || token.rawBalance <= 0n) {
      continue;
    }

    if (isLegacyAgentFlowVault(token.symbol, token.name)) {
      continue;
    }

    const vaultMeta = inferVaultHoldingMeta(token.symbol, token.name);
    const knownVault = knownVaultByAddress.get(token.address);
    let displayBalanceFormatted = token.formattedBalance;
    let displayUsdPrice = vaultMeta.impliedUsdPrice ?? token.usdPrice;
    let displayUsdValue =
      vaultMeta.impliedUsdPrice !== null
        ? roundUsd(Number(token.formattedBalance) * vaultMeta.impliedUsdPrice)
        : token.usdValue;
    const extraNotes: string[] = [];

    if (knownVault) {
      try {
        const providerPosition = await getProviderPosition(
          knownVault.provider,
          walletAddress,
          knownVault.address,
        );
        displayBalanceFormatted = providerPosition.underlyingValueFormatted;
        if (
          providerPosition.underlyingSymbol === 'USDC' ||
          providerPosition.underlyingSymbol === 'EURC'
        ) {
          displayUsdPrice = 1;
          displayUsdValue = roundUsd(Number(providerPosition.underlyingValueFormatted));
        }
        extraNotes.push(
          `Vault balance shown as underlying ${providerPosition.underlyingSymbol} value from provider position.`,
        );
      } catch (error) {
        extraNotes.push(
          `Vault underlying read failed; using raw token balance instead (${toMessage(error)}).`,
        );
      }
    }

    if (token.address === ARC_USDC && nativeBalance > 0n) {
      const tokenBalanceFormatted = Number(token.formattedBalance);
      if (roughlyEqual(tokenBalanceFormatted, nativeBalanceFormatted, 0.000001)) {
        const nativeHolding = holdings.find((item) => item.id === 'native-usdc');
        nativeHolding?.notes.push(
          `ERC-20 USDC at ${ARC_USDC} mirrors this Arc native balance and is not counted separately.`,
        );
        continue;
      }
    }

    holdings.push({
      id: token.address,
      kind: vaultMeta.isVaultShare ? 'vault_share' : 'erc20',
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      balanceRaw: token.rawBalance.toString(),
      balanceFormatted: displayBalanceFormatted,
      usdPrice: displayUsdPrice,
      usdValue: displayUsdValue,
      source: 'ALCHEMY_ARC_RPC eth_call',
      notes: [...token.notes, vaultMeta.note, ...extraNotes].filter((note): note is string => Boolean(note)),
    });
  }

  return sortByUsdValue(holdings);
}

async function buildPositions(params: {
  client: ReturnType<typeof createPublicClient>;
  walletAddress: Address;
  priceMap: TokenPriceMap;
  transferHistory: ExplorerTokenTransferItem[];
  gatewayBalance: GatewayBalanceResult;
  positionCosts: PositionCostSummary;
}): Promise<PortfolioPosition[]> {
  const { client, walletAddress, priceMap, gatewayBalance, positionCosts } = params;
  const positions: PortfolioPosition[] = [];

  const gatewayPosition = buildGatewayPosition(gatewayBalance, positionCosts.gatewayBasisUsd);
  if (gatewayPosition) {
    positions.push(gatewayPosition);
  }

  return sortByUsdValue(positions);
}

async function readTokenBalance(
  client: ReturnType<typeof createPublicClient>,
  tokenAddress: Address,
  walletAddress: Address,
  priceMap: TokenPriceMap,
): Promise<TokenBalanceRead | null> {
  try {
    const [rawBalance, decimals, symbol, name] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
      }) as Promise<bigint>,
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }) as Promise<number>,
      client
        .readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        })
        .catch(() => null) as Promise<string | null>,
      client
        .readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
        })
        .catch(() => null) as Promise<string | null>,
    ]);

    const formattedBalance = formatUnits(rawBalance, decimals);
    const numericBalance = Number(formattedBalance);
    const usdPrice = priceMap[tokenAddress] ?? null;
    const usdValue =
      usdPrice !== null && Number.isFinite(numericBalance)
        ? roundUsd(numericBalance * usdPrice)
        : null;

    return {
      address: tokenAddress,
      symbol: symbol || abbreviateAddress(tokenAddress),
      name: name || symbol || abbreviateAddress(tokenAddress),
      decimals,
      rawBalance,
      formattedBalance,
      usdPrice,
      usdValue,
      notes:
        usdPrice === null
          ? ['No price feed available on Arc Testnet; USD value left blank.']
          : [],
    };
  } catch {
    return null;
  }
}

function buildGatewayPosition(
  gatewayBalance: GatewayBalanceResult,
  gatewayBasisUsd: number,
): PortfolioPosition | null {
  if (gatewayBalance.totalUsd <= 0) {
    return null;
  }

  const usdValue = roundUsd(gatewayBalance.totalUsd);
  const costBasisUsd = roundUsd(gatewayBasisUsd > 0 ? gatewayBasisUsd : usdValue);
  return {
    id: 'gateway:arc',
    kind: 'gateway_position',
    name: 'Gateway Position',
    protocol: 'Circle Gateway',
    amountFormatted: `${formatNumber(gatewayBalance.totalUsd)} USDC`,
    usdValue,
    costBasisUsd,
    pnlUsd: roundUsd(usdValue - costBasisUsd),
    notes: [
      gatewayBalance.note,
      gatewayBalance.source === 'transfer_estimate' && gatewayBalance.error
        ? `Live Gateway balance unavailable: ${gatewayBalance.error}`
        : null,
    ].filter((note): note is string => Boolean(note)),
  };
}

function calculatePositionCostBasis(
  walletAddress: Address,
  transferHistory: ExplorerTokenTransferItem[],
): PositionCostSummary {
  let vaultBasisUsd = 0;
  let swapBasisUsd = 0;
  let gatewayBasisUsd = 0;
  for (const item of transferHistory) {
    const tokenAddress = normalizeExplorerAddress(item.token.address_hash);
    if (!tokenAddress || (tokenAddress !== ARC_USDC && tokenAddress !== ARC_EURC)) {
      continue;
    }

    const amountUsd = Number(formatUnits(BigInt(item.total.value), Number(item.total.decimals)));
    const fromAddress = normalizeExplorerAddress(item.from.hash);
    const toAddress = normalizeExplorerAddress(item.to.hash);

    if (toAddress && KNOWN_GATEWAY_WALLETS.has(toAddress) && fromAddress === walletAddress) {
      gatewayBasisUsd += amountUsd;
    }
    if (fromAddress && KNOWN_GATEWAY_WALLETS.has(fromAddress) && toAddress === walletAddress) {
      gatewayBasisUsd -= amountUsd;
    }
  }

  return {
    vaultBasisUsd: Math.max(0, roundUsd(vaultBasisUsd)),
    swapBasisUsd: Math.max(0, roundUsd(swapBasisUsd)),
    gatewayBasisUsd: Math.max(0, roundUsd(gatewayBasisUsd)),
  };
}

async function fetchExplorerTokenBalances(walletAddress: Address): Promise<ExplorerTokenBalance[]> {
  return fetchExplorerJson<ExplorerTokenBalance[]>(`/addresses/${walletAddress}/token-balances`);
}

async function fetchExplorerTransactions(
  walletAddress: Address,
  limit: number,
): Promise<ExplorerTransactionItem[]> {
  const items = await fetchExplorerPaged<ExplorerTransactionItem>(
    `/addresses/${walletAddress}/transactions`,
    Math.max(limit, 1),
  );
  return items.slice(0, limit);
}

async function fetchExplorerTokenTransfers(
  walletAddress: Address,
  limit: number,
): Promise<ExplorerTokenTransferItem[]> {
  const items = await fetchExplorerPaged<ExplorerTokenTransferItem>(
    `/addresses/${walletAddress}/token-transfers`,
    Math.max(limit, 1),
  );
  return items
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

async function fetchExplorerPaged<T>(path: string, limit: number): Promise<T[]> {
  const items: T[] = [];
  let nextParams: Record<string, string | number | null> | null | undefined = null;

  while (items.length < limit) {
    const query = new URLSearchParams();
    if (nextParams) {
      for (const [key, value] of Object.entries(nextParams)) {
        if (value !== null && value !== undefined) {
          query.set(key, String(value));
        }
      }
    }
    const suffix = query.toString();
    const page = await fetchExplorerJson<ExplorerPage<T>>(
      `${path}${suffix ? `?${suffix}` : ''}`,
    );
    items.push(...page.items);
    if (!page.next_page_params) {
      break;
    }
    nextParams = page.next_page_params;
  }

  return items;
}

async function fetchExplorerJson<T>(path: string): Promise<T> {
  const response = await fetch(`${ARC_EXPLORER_API}${path}`);
  if (!response.ok) {
    throw new Error(`Arcscan request failed: ${response.status} ${path}`);
  }
  return (await response.json()) as T;
}

async function resolveGatewayBalance(
  walletAddress: Address,
  transferHistory: ExplorerTokenTransferItem[],
  gatewayDepositors?: string[],
): Promise<GatewayBalanceResult> {
  const queriedDepositors = [
    ...new Set(
      (Array.isArray(gatewayDepositors) && gatewayDepositors.length > 0
        ? gatewayDepositors
        : [walletAddress]
      )
        .map((value) => {
          try {
            return isAddress(value) ? getAddress(value) : null;
          } catch {
            return null;
          }
        })
        .filter((value): value is Address => Boolean(value)),
    ),
  ];
  try {
    const liveBalance = await fetchGatewayBalancesForDepositors(queriedDepositors);
    return {
      availableUsd: roundUsd(Number(liveBalance.available)),
      totalUsd: roundUsd(Number(liveBalance.total)),
      source: 'gateway_api',
      error: null,
      note:
        Number(liveBalance.total) > Number(liveBalance.available)
          ? `Live unified balance from Circle Gateway API across ${queriedDepositors.length} depositor${queriedDepositors.length === 1 ? '' : 's'}. ${formatNumber(Number(liveBalance.available))} USDC available and ${formatNumber(Number(liveBalance.total) - Number(liveBalance.available))} USDC withdrawing.`
          : `Live unified balance from Circle Gateway API across ${queriedDepositors.length} depositor${queriedDepositors.length === 1 ? '' : 's'}.`,
    };
  } catch (error) {
    const estimatedUsd = estimateGatewayNetUsd(walletAddress, transferHistory);
    return {
      availableUsd: estimatedUsd,
      totalUsd: estimatedUsd,
      source: 'transfer_estimate',
      error: toMessage(error),
      note:
        estimatedUsd > 0
          ? 'Fallback estimate from net USDC transfers because the live Gateway balance could not be read.'
          : 'Gateway balance API unavailable and no active Gateway position was inferred from transfer history.',
    };
  }
}

function mapTransaction(item: ExplorerTransactionItem): PortfolioRecentTransaction {
  const decoded = item.decoded_input?.method_call || item.method || 'transaction';
  const feeValue = item.fee?.value ? Number(formatUnits(BigInt(item.fee.value), 18)) : null;
  const summaryParts = [
    decoded,
    item.to?.name || item.to?.hash || null,
    feeValue !== null ? `fee ${formatNumber(feeValue)} USDC` : null,
  ].filter(Boolean);

  return {
    hash: item.hash,
    timestamp: item.timestamp,
    status: item.result || item.status || 'unknown',
    method: decoded,
    from: item.from.hash,
    to: item.to?.hash || null,
    summary: summaryParts.join(' • '),
    explorerUrl: `${ARC_EXPLORER_BASE}/tx/${item.hash}`,
  };
}

function mapTransfer(walletAddress: Address, item: ExplorerTokenTransferItem): PortfolioTransfer {
  const fromAddress = normalizeExplorerAddress(item.from.hash);
  const toAddress = normalizeExplorerAddress(item.to.hash);
  const direction = fromAddress === walletAddress ? 'out' : 'in';
  const counterparty = direction === 'out' ? item.to.hash : item.from.hash;
  const counterpartyName = direction === 'out' ? item.to.name || null : item.from.name || null;

  return {
    hash: item.transaction_hash,
    timestamp: item.timestamp,
    token: item.token.symbol || abbreviateAddress(item.token.address_hash),
    tokenAddress: item.token.address_hash,
    direction,
    amount: formatUnits(BigInt(item.total.value), Number(item.total.decimals)),
    counterparty,
    counterpartyName,
    type: item.type || null,
  };
}

function estimateGatewayNetUsd(
  walletAddress: Address,
  transferHistory: ExplorerTokenTransferItem[],
): number {
  let gatewayNetUsd = 0;
  for (const item of transferHistory) {
    const tokenAddress = normalizeExplorerAddress(item.token.address_hash);
    if (tokenAddress !== ARC_USDC) {
      continue;
    }
    const toAddress = normalizeExplorerAddress(item.to.hash);
    const fromAddress = normalizeExplorerAddress(item.from.hash);
    const amount = Number(formatUnits(BigInt(item.total.value), Number(item.total.decimals)));
    if (toAddress && KNOWN_GATEWAY_WALLETS.has(toAddress) && fromAddress === walletAddress) {
      gatewayNetUsd += amount;
    }
    if (fromAddress && KNOWN_GATEWAY_WALLETS.has(fromAddress) && toAddress === walletAddress) {
      gatewayNetUsd -= amount;
    }
  }
  return roundUsd(Math.max(0, gatewayNetUsd));
}

function normalizeExplorerAddress(value: string | undefined | null): Address | null {
  if (!value || !isAddress(value)) {
    return null;
  }
  return getAddress(value);
}

function abbreviateAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sortByUsdValue<T extends { usdValue: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roughlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function sanitizeRpcUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/[^/]+$/, '/[redacted]')}`;
  } catch {
    return '[redacted]';
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
