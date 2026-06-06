import { isAddress, getAddress } from 'viem';
import type { CapabilityMatch, EntityMatch, InternalCapability, InternalEntityKind } from './internal-capability-detection';
import { retrieveProductKnowledge } from './product-rag';
import { getDexProviderNames, getBestQuote } from './dex/router';
import { parseSwapTokenSymbols } from './swap-symbols';
import { SUPPORTED_BRIDGE_SOURCES } from './bridge/supportedSources';
import { getNameInfoOnChain } from './agentpay-registry';
import { getProviderPosition, getVaultApy, listAllVaults } from './vault/router';

export type InternalContext = {
  generated_at: string;
  capabilities: CapabilityMatch[];
  entities: Array<{
    kind: InternalEntityKind;
    canonicalName: string;
    matchedAlias: string;
    metadata: Record<string, unknown>;
  }>;
  evidence: Record<string, unknown>;
  limitations: string[];
  public_web_used: boolean;
};

type BuildInternalCapabilityContextInput = {
  query: string;
  capabilities: CapabilityMatch[];
  entities: EntityMatch[];
  walletContext?: Record<string, unknown> | null;
};

type ProductDocEvidence = {
  id: string;
  title: string;
  summary: string;
  score: number;
  facts: string[];
};

type RetrievalResult = {
  evidence: Record<string, unknown>;
  limitations: string[];
};

const TELEGRAM_DOC_IDS = new Set(['telegram', 'bridge']);
const AGENTFLOW_DOC_IDS = new Set(['capabilities', 'about', 'research', 'getting-started', 'wallet-modes']);
const BRIDGE_DOC_IDS = new Set(['bridge', 'bridge-source-chains']);
const SWAP_DOC_IDS = new Set(['swap', 'pricing']);
const VAULT_DOC_IDS = new Set(['vault', 'portfolio-funds']);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractWalletAddress(walletContext?: Record<string, unknown> | null): `0x${string}` | null {
  const candidates = [
    walletContext?.scanned_wallet_address,
    walletContext?.executionWalletAddress,
    walletContext?.owner_wallet_address,
    walletContext?.walletAddress,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isAddress(candidate)) {
      return getAddress(candidate);
    }
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function buildProductEvidence(query: string, docIds?: Set<string>): ProductDocEvidence[] {
  return retrieveProductKnowledge(query, { limit: 5, minScore: 6 })
    .filter((doc) => !docIds || docIds.has(doc.id))
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      score: doc.score,
      facts: doc.facts,
    }));
}

function hasExplicitYieldFocus(query: string): boolean {
  return /\b(yield|yields|apy|apr|earn)\b/i.test(query);
}

function extractTokenPair(query: string): { tokenIn: `0x${string}`; tokenOut: `0x${string}`; fromSym: string; toSym: string } | null {
  const upper = query.toUpperCase();
  const symbols = unique((upper.match(/\b(?:USDC|EURC)\b/g) ?? []).map((symbol) => symbol.trim()));
  if (symbols.length < 2) return null;
  const parsed = parseSwapTokenSymbols(symbols[0], symbols[1]);
  if (!parsed) return null;
  return {
    tokenIn: parsed.tokenIn,
    tokenOut: parsed.tokenOut,
    fromSym: symbols[0],
    toSym: symbols[1],
  };
}

function extractArcHandle(query: string): string | null {
  const match = query.match(/\b([a-z0-9-]+\.arc)\b/i);
  return match ? match[1] : null;
}

function selectAgentPayDocIds(query: string): Set<string> {
  const normalized = query.toLowerCase();
  const docIds = new Set<string>(['agentpay']);

  if (/\b(schedule|scheduled|recurring|weekly|monthly|daily|every week|every month|every day|frequency|cadence)\b/.test(normalized)) {
    docIds.add('schedule-payments');
  }

  if (/\b(split|splitting|divide|share|between|equally)\b/.test(normalized)) {
    docIds.add('split-payments');
  }

  if (/\b(batch|bulk|payroll|payout|payouts|mass payment)\b/.test(normalized) || (/\bcsv\b/.test(normalized) && !/\b(schedule|scheduled|split)\b/.test(normalized))) {
    docIds.add('batch-payments');
  }

  if (/\b(invoice|invoices|bill|billing|receipt)\b/.test(normalized)) {
    docIds.add('invoices');
  }

  if (/\b(contact|contacts|address book|saved contact|payee|recipient)\b/.test(normalized)) {
    docIds.add('contacts');
  }

  if (/\b(payment links?|pay links?|qr|receive|scan to pay|request money)\b/.test(normalized)) {
    docIds.add('payment-links-qr');
  }

  if (/\.arc|\barc handle\b|\bhandles?\b/.test(normalized)) {
    docIds.add('arc-handles');
  }

  if (/\b(send|request|payment history|history)\b/.test(normalized)) {
    docIds.add('agentpay');
  }

  return docIds;
}

async function retrieveVaultContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  const evidence: Record<string, unknown> = {
    product_kb: buildProductEvidence(input.query, VAULT_DOC_IDS),
  };
  const limitations: string[] = [];
  const walletAddress = extractWalletAddress(input.walletContext);
  const matchedVaultSymbols = new Set(
    input.entities
      .filter((entity) => entity.descriptor.kind === 'vault')
      .map((entity) => String(entity.descriptor.metadata.vaultAddress ?? '')),
  );

  const vaults = await listAllVaults();
  evidence.vaults = matchedVaultSymbols.size
    ? vaults.filter((vault) => matchedVaultSymbols.has(vault.address))
    : vaults;

  if (walletAddress) {
    const positions = await Promise.all(
      (evidence.vaults as Array<{ provider: string; address: `0x${string}` }>).map(async (vault) => {
        try {
          const position = await getProviderPosition(vault.provider, walletAddress, vault.address);
          return { vaultAddress: vault.address, provider: vault.provider, position };
        } catch (error) {
          return {
            vaultAddress: vault.address,
            provider: vault.provider,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    evidence.positions = positions;
  }

  if (hasExplicitYieldFocus(input.query)) {
    const apyResults = await Promise.all(
      (evidence.vaults as Array<{ provider: string; address: `0x${string}` }>).map(async (vault) => {
        try {
          const apy = await withTimeout(getVaultApy(vault.provider, vault.address), 10_000);
          return { vaultAddress: vault.address, provider: vault.provider, apy };
        } catch (error) {
          limitations.push(`Vault APY unavailable for ${vault.address}: ${error instanceof Error ? error.message : String(error)}`);
          return {
            vaultAddress: vault.address,
            provider: vault.provider,
            apy: null,
          };
        }
      }),
    );
    evidence.apy = apyResults;
  }

  return { evidence, limitations };
}

async function retrieveSwapContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  const evidence: Record<string, unknown> = {
    product_kb: buildProductEvidence(input.query, SWAP_DOC_IDS),
    providers: getDexProviderNames(),
  };
  const limitations: string[] = [];
  const tokenPair = extractTokenPair(input.query);
  if (tokenPair) {
    try {
      evidence.quote = await getBestQuote({
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        amountInRaw: 1_000_000n,
        slippageBps: 100,
      });
      evidence.quote_pair = {
        from: tokenPair.fromSym,
        to: tokenPair.toSym,
        basis_amount: '1.0',
      };
    } catch (error) {
      limitations.push(`Swap quote unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { evidence, limitations };
}

async function retrieveBridgeContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  return {
    evidence: {
      product_kb: buildProductEvidence(input.query, BRIDGE_DOC_IDS),
      supported_sources: SUPPORTED_BRIDGE_SOURCES,
      live_state_available: false,
    },
    limitations: [
      'Source-chain balances are not available in this internal research path.',
      'Live bridge state or liquidity is not available in this internal research path.',
      'For wallet-specific bridge readiness, use the web bridge flow.',
    ],
  };
}

async function retrieveAgentPayContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  const selectedDocIds = selectAgentPayDocIds(input.query);
  const evidence: Record<string, unknown> = {
    product_kb: buildProductEvidence(input.query, selectedDocIds),
    selected_doc_ids: [...selectedDocIds],
  };
  const limitations: string[] = [];
  const arcHandle = extractArcHandle(input.query);
  if (arcHandle) {
    try {
      const info = await getNameInfoOnChain(arcHandle);
      evidence.arc_handle = {
        handle: arcHandle,
        info,
      };
    } catch (error) {
      limitations.push(`.arc handle lookup unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { evidence, limitations };
}

async function retrieveTelegramContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  return {
    evidence: {
      product_kb: buildProductEvidence(input.query, TELEGRAM_DOC_IDS),
      explicit_rules: [
        'Telegram supports continuity, notifications, and linked workflow follow-through.',
        'Bridge flows are web-only and require the AgentFlow web app for signing.',
      ],
    },
    limitations: [],
  };
}

async function retrieveAgentFlowFeatureContext(input: BuildInternalCapabilityContextInput): Promise<RetrievalResult> {
  return {
    evidence: {
      product_kb: buildProductEvidence(input.query, AGENTFLOW_DOC_IDS),
    },
    limitations: [],
  };
}

function entitySummary(entities: EntityMatch[]): InternalContext['entities'] {
  return entities.map((entity) => ({
    kind: entity.descriptor.kind,
    canonicalName: entity.descriptor.canonicalName,
    matchedAlias: entity.matchedAlias,
    metadata: entity.descriptor.metadata,
  }));
}

function mergeEvidence(target: Record<string, unknown>, key: string, evidence: Record<string, unknown>): void {
  const current = (target[key] as Record<string, unknown> | undefined) ?? {};
  target[key] = {
    ...current,
    ...evidence,
  };
}

export async function buildInternalCapabilityContext(
  input: BuildInternalCapabilityContextInput,
): Promise<InternalContext> {
  const context: InternalContext = {
    generated_at: new Date().toISOString(),
    capabilities: input.capabilities,
    entities: entitySummary(input.entities),
    evidence: {},
    limitations: [],
    public_web_used: false,
  };

  const seen = new Set<InternalCapability>();
  for (const capability of input.capabilities) {
    if (seen.has(capability.capability)) continue;
    seen.add(capability.capability);

    if (capability.capability === 'vault') {
      const vault = await retrieveVaultContext(input);
      mergeEvidence(context.evidence, 'vault', vault.evidence as Record<string, unknown>);
      context.limitations.push(...(vault.limitations as string[]));
      continue;
    }

    if (capability.capability === 'swap') {
      const swap = await retrieveSwapContext(input);
      mergeEvidence(context.evidence, 'swap', swap.evidence as Record<string, unknown>);
      context.limitations.push(...(swap.limitations as string[]));
      continue;
    }

    if (capability.capability === 'bridge') {
      const bridge = await retrieveBridgeContext(input);
      mergeEvidence(context.evidence, 'bridge', bridge.evidence as Record<string, unknown>);
      context.limitations.push(...(bridge.limitations as string[]));
      continue;
    }

    if (capability.capability === 'agentpay_feature') {
      const agentpay = await retrieveAgentPayContext(input);
      mergeEvidence(context.evidence, 'agentpay', agentpay.evidence as Record<string, unknown>);
      context.limitations.push(...(agentpay.limitations as string[]));
      continue;
    }

    if (capability.capability === 'telegram_feature') {
      const telegram = await retrieveTelegramContext(input);
      mergeEvidence(context.evidence, 'telegram', telegram.evidence as Record<string, unknown>);
      context.limitations.push(...(telegram.limitations as string[]));
      continue;
    }

    if (capability.capability === 'agentflow_feature') {
      const feature = await retrieveAgentFlowFeatureContext(input);
      mergeEvidence(context.evidence, 'agentflow', feature.evidence as Record<string, unknown>);
      context.limitations.push(...(feature.limitations as string[]));
    }
  }

  context.limitations = unique(context.limitations);
  return context;
}
