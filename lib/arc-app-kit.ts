import { AppKit, type GetBalancesResult } from '@circle-fin/app-kit';
import {
  createCircleWalletsAdapter,
  type CircleWalletsAdapter,
} from '@circle-fin/adapter-circle-wallets';
import { getAddress, isAddress } from 'viem';

export type ArcAppKitContext =
  | {
      configured: true;
      kit: AppKit;
      circleWalletsAdapter: CircleWalletsAdapter;
    }
  | {
      configured: false;
      error: string;
    };

export type ArcUnifiedBalanceRead = {
  configured: boolean;
  token: 'USDC';
  confirmed: string;
  pending: string;
  breakdown: Array<{
    depositor: string;
    totalConfirmed: string;
    totalPending: string;
    chains: Array<{
      chain: string;
      confirmed: string;
      pending: string;
      pendingTransactions: Array<{
        transactionHash: string;
        amount: string;
        blockTimestamp: string;
      }>;
    }>;
  }>;
  error?: string;
};

export type ArcDisabledOperationResult = {
  enabled: false;
  operation: 'sendArcUsdc' | 'swapArcStablecoin' | 'bridgeUsdcToArc';
  reason: string;
};

const emptyUnifiedBalance: ArcUnifiedBalanceRead = {
  configured: false,
  token: 'USDC',
  confirmed: '0',
  pending: '0',
  breakdown: [],
};

function getCircleWalletsConfig():
  | { apiKey: string; entitySecret: string; baseUrl?: string }
  | null {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  const baseUrl = process.env.CIRCLE_WALLETS_API_BASE_URL?.trim();

  if (!apiKey || !entitySecret) {
    return null;
  }

  return {
    apiKey,
    entitySecret,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

let cachedAppKit: ArcAppKitContext | null = null;

export function getArcAppKit(): ArcAppKitContext {
  const config = getCircleWalletsConfig();
  if (!config) {
    return {
      configured: false,
      error: 'Circle App Kit is not configured. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.',
    };
  }

  if (cachedAppKit?.configured) {
    return cachedAppKit;
  }

  cachedAppKit = {
    configured: true,
    kit: new AppKit(),
    circleWalletsAdapter: createCircleWalletsAdapter(config),
  };

  return cachedAppKit;
}

function normalizeDepositors(addresses: string[]): `0x${string}`[] {
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];

  for (const address of addresses) {
    if (!isAddress(address)) {
      continue;
    }
    const normalized = getAddress(address) as `0x${string}`;
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeUnifiedBalance(result: GetBalancesResult): ArcUnifiedBalanceRead {
  return {
    configured: true,
    token: 'USDC',
    confirmed: result.totalConfirmedBalance || '0',
    pending: result.totalPendingBalance || '0',
    breakdown: result.breakdown.map((entry) => ({
      depositor: entry.depositor,
      totalConfirmed: entry.totalConfirmed || '0',
      totalPending: entry.totalPending || '0',
      chains: entry.breakdown.map((chain) => ({
        chain: String(chain.chain),
        confirmed: chain.confirmedBalance || '0',
        pending: chain.pendingBalance || '0',
        pendingTransactions: (chain.pendingTransactions ?? []).map((tx) => ({
          transactionHash: tx.transactionHash,
          amount: tx.amount,
          blockTimestamp: tx.blockTimestamp,
        })),
      })),
    })),
  };
}

export async function getUnifiedBalanceForWallets(
  walletAddresses: string[],
): Promise<ArcUnifiedBalanceRead> {
  const appKit = getArcAppKit();
  if (!appKit.configured) {
    return {
      ...emptyUnifiedBalance,
      error: appKit.error,
    };
  }

  const depositors = normalizeDepositors(walletAddresses);
  if (depositors.length === 0) {
    return {
      ...emptyUnifiedBalance,
      configured: true,
      error: 'No valid Unified Balance depositors were provided.',
    };
  }

  const balances = await appKit.kit.unifiedBalance.getBalances({
    token: 'USDC',
    includePending: true,
    networkType: 'testnet',
    sources: depositors.map((address) => ({
      adapter: appKit.circleWalletsAdapter,
      address,
    })),
  });

  return normalizeUnifiedBalance(balances);
}

export function getArcUnifiedBalanceForDepositors(
  depositorAddresses: string[],
): Promise<ArcUnifiedBalanceRead> {
  return getUnifiedBalanceForWallets(depositorAddresses);
}

function disabledAppKitExecution(
  operation: ArcDisabledOperationResult['operation'],
): ArcDisabledOperationResult {
  return {
    enabled: false,
    operation,
    reason:
      'Arc App Kit execution is intentionally disabled in AgentFlow. This wrapper is read-only until spend, swap, and bridge flows are explicitly wired.',
  };
}

export async function sendArcUsdc(): Promise<ArcDisabledOperationResult> {
  return disabledAppKitExecution('sendArcUsdc');
}

export async function swapArcStablecoin(): Promise<ArcDisabledOperationResult> {
  return disabledAppKitExecution('swapArcStablecoin');
}

export async function bridgeUsdcToArc(): Promise<ArcDisabledOperationResult> {
  return disabledAppKitExecution('bridgeUsdcToArc');
}
