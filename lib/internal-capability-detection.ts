import { PRODUCT_KNOWLEDGE, type ProductKnowledgeDoc } from './product-rag';
import { LUNEX_VAULTS } from './vault/providers/lunex';
import { SUPPORTED_BRIDGE_SOURCES } from './bridge/supportedSources';
import { getDexProviderNames } from './dex/router';

export type InternalCapability =
  | 'vault'
  | 'swap'
  | 'bridge'
  | 'agentpay_feature'
  | 'telegram_feature'
  | 'agentflow_feature';

export type InternalEntityKind =
  | 'vault'
  | 'swap_provider'
  | 'bridge_source'
  | 'agentpay_feature'
  | 'telegram_feature'
  | 'agentflow_feature';

export type CapabilityMatch = {
  capability: InternalCapability;
  matchedKeywords: string[];
  agentFlowFramingScore: number;
  externalFramingScore: number;
  decision: 'internal' | 'web';
  agentFlowSignals: string[];
  externalSignals: string[];
};

export type InternalEntityDescriptor = {
  kind: InternalEntityKind;
  canonicalName: string;
  aliases: string[];
  metadata: Record<string, unknown>;
};

export type EntityMatch = {
  descriptor: InternalEntityDescriptor;
  matchedAlias: string;
  matchType: 'exact' | 'strong';
};

type CapabilityVocabulary = {
  capability: InternalCapability;
  keywords: string[];
  requiresFramingForEveryKeyword?: boolean;
  noFramingKeywords?: string[];
};

type QuerySignals = {
  normalized: string;
  agentFlowSignals: string[];
  externalSignals: string[];
  agentFlowFramingScore: number;
  externalFramingScore: number;
};

type RawSignalBuckets = {
  agentFlowSignals: string[];
  externalSignals: string[];
};

const PRODUCT_DOC_BY_ID = new Map(PRODUCT_KNOWLEDGE.map((doc) => [doc.id, doc] as const));

const CAPABILITY_VOCABULARY: CapabilityVocabulary[] = [
  {
    capability: 'vault',
    keywords: ['vault', 'vaults', 'yield', 'yields', 'earn', 'stake', 'staking', 'apy'],
    requiresFramingForEveryKeyword: true,
    noFramingKeywords: ['vault', 'vaults'],
  },
  {
    capability: 'swap',
    keywords: ['swap', 'swaps', 'convert', 'conversion', 'exchange', 'trade', 'fees'],
    requiresFramingForEveryKeyword: true,
    noFramingKeywords: ['swap', 'swaps'],
  },
  {
    capability: 'bridge',
    keywords: ['bridge', 'bridging', 'supported bridge chains', 'supported chains', 'source chains', 'move funds'],
    requiresFramingForEveryKeyword: true,
    noFramingKeywords: ['bridge', 'bridging'],
  },
  {
    capability: 'agentpay_feature',
    keywords: [
      'agentpay',
      '.arc',
      'arc handle',
      'scheduled payment',
      'scheduled payments',
      'schedule payment',
      'schedule payments',
      'schedule',
      'scheduled',
      'recurring payment',
      'recurring payments',
      'recurring',
      'split payment',
      'split payments',
      'splitting',
      'batch payment',
      'batch payments',
      'payout',
      'payouts',
      'send',
      'request',
      'payment request',
      'payment requests',
      'payee',
      'recipient',
      'payment link',
      'payment links',
      'pay link',
      'pay links',
      'qr',
      'invoice',
      'invoices',
      'contacts',
      'payment history',
    ],
    requiresFramingForEveryKeyword: true,
    noFramingKeywords: ['agentpay', '.arc', 'arc handle', 'payment link', 'pay link', 'payment history'],
  },
  {
    capability: 'telegram_feature',
    keywords: ['telegram', 'link telegram', 'telegram bridge', 'telegram bot', 'bot'],
  },
  {
    capability: 'agentflow_feature',
    keywords: ['agentflow', 'execution wallet', 'gateway', 'wallet modes'],
  },
];

const DIRECT_CAPABILITY_QUESTION_PATTERNS = [
  /\bshow me\b/,
  /\blist\b/,
  /\bhow do i\b/,
  /\bwhat is\b/,
  /\bwhat are\b/,
  /\bcan i\b/,
];

const AGENTFLOW_SCOPE_PATTERNS = [
  /\bagentflow\b/,
  /\bon agentflow\b/,
  /\bvia agentflow\b/,
  /\bon arc\b/,
  /\bvia arc\b/,
];

const PRODUCT_SHAPED_PATTERNS = [
  /\boptions on\b/,
  /\bavailable\b/,
  /\bsupported\b/,
  /\bsupported chains\b/,
  /\bsupported source chains\b/,
];

const POSSESSIVE_FUNDS_PATTERNS = [
  /\bmy idle\b/,
  /\bmy funds\b/,
  /\bpark my\b/,
  /\bearn on my\b/,
  /\bmy balance\b/,
  /\bmy holdings\b/,
];

const ANALYTICAL_PATTERNS = [
  /\boutlook\b/,
  /\bforecast\b/,
  /\banalysis\b/,
  /\bcompare\b/,
  /\bcomparison\b/,
  /\bmechanics\b/,
  /\barchitecture\b/,
  /\bdesigns?\b/,
];

const INDUSTRY_SCOPE_PATTERNS = [
  /\bdefi\b/,
  /\bindustry\b/,
  /\bstrateg(?:y|ies)\b/,
  /\byield curve\b/,
  /\bl2\b/,
  /\blayer 2\b/,
  /\bprediction market mechanics\b/,
];

const EXTERNAL_ENTITY_PATTERNS = [
  /\btelegram stock\b/,
  /\baave\b/,
  /\blido\b/,
  /\bstripe\b/,
];

const AGENTPAY_CONTEXT_PATTERNS = [
  /\bagentpay\b/,
  /\bagentflow\b/,
  /\bpayment\b/,
  /\bpayments\b/,
  /\busdc\b/,
  /\beurc\b/,
  /\brecipient\b/,
  /\brecipients\b/,
  /\bpayee\b/,
  /\bpayees\b/,
  /\brequest\b/,
  /\binvoice\b/,
  /\bcontacts?\b/,
  /\bqr\b/,
  /\bpayment link\b/,
  /\bpay link\b/,
  /\bwallet\b/,
  /\.arc\b/,
];

const ACTION_VERBS = [
  'send',
  'pay',
  'swap',
  'deposit',
  'withdraw',
  'bridge',
  'move',
  'create',
  'schedule',
  'split',
  'batch',
  'fund',
];

const ACTION_AMOUNT_RE = /\b\d+(?:\.\d+)?\s*(?:usdc|eurc|usd|dollars?)?\b/i;
const ACTION_HANDLE_RE = /\b[a-z0-9-]+\.arc\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function hasWordBoundaryMatch(normalizedQuery: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i').test(normalizedQuery);
}

function buildAgentFlowEntityAliases(): string[] {
  const vaultAliases = LUNEX_VAULTS.flatMap((vault) => [
    vault.label,
    vault.vaultSymbol,
    vault.assetSymbol,
  ]);
  const bridgeAliases = SUPPORTED_BRIDGE_SOURCES.flatMap((source) => [source.key, source.label]);
  return unique([
    '.arc',
    ...vaultAliases,
    ...getDexProviderNames(),
    ...bridgeAliases,
  ]).map(normalize);
}

function collectRawSignals(normalizedQuery: string): RawSignalBuckets {
  const agentFlowSignals: string[] = [];
  const externalSignals: string[] = [];
  const agentFlowEntityAliases = buildAgentFlowEntityAliases();

  for (const pattern of DIRECT_CAPABILITY_QUESTION_PATTERNS) {
    if (pattern.test(normalizedQuery)) agentFlowSignals.push(pattern.source);
  }
  for (const pattern of AGENTFLOW_SCOPE_PATTERNS) {
    if (pattern.test(normalizedQuery)) agentFlowSignals.push(pattern.source);
  }
  for (const pattern of PRODUCT_SHAPED_PATTERNS) {
    if (pattern.test(normalizedQuery)) agentFlowSignals.push(pattern.source);
  }
  for (const pattern of POSSESSIVE_FUNDS_PATTERNS) {
    if (pattern.test(normalizedQuery)) agentFlowSignals.push(pattern.source);
  }
  for (const alias of agentFlowEntityAliases) {
    if (alias && hasWordBoundaryMatch(normalizedQuery, alias)) {
      agentFlowSignals.push(alias);
    }
  }

  for (const pattern of ANALYTICAL_PATTERNS) {
    if (pattern.test(normalizedQuery)) externalSignals.push(pattern.source);
  }
  for (const pattern of INDUSTRY_SCOPE_PATTERNS) {
    if (pattern.test(normalizedQuery)) externalSignals.push(pattern.source);
  }
  for (const pattern of EXTERNAL_ENTITY_PATTERNS) {
    if (pattern.test(normalizedQuery)) externalSignals.push(pattern.source);
  }
  if (/\bmacro\b|\beconomy\b/.test(normalizedQuery)) {
    externalSignals.push('macro-economy');
  }

  return {
    agentFlowSignals: unique(agentFlowSignals),
    externalSignals: unique(externalSignals),
  };
}

function collectSignals(normalizedQuery: string): QuerySignals {
  const rawSignals = collectRawSignals(normalizedQuery);
  return {
    normalized: normalizedQuery,
    agentFlowSignals: rawSignals.agentFlowSignals,
    externalSignals: rawSignals.externalSignals,
    agentFlowFramingScore: rawSignals.agentFlowSignals.length,
    externalFramingScore: rawSignals.externalSignals.length,
  };
}

function docById(id: string): ProductKnowledgeDoc | undefined {
  return PRODUCT_DOC_BY_ID.get(id);
}

function collectProductDocAliases(docIds: string[]): string[] {
  const aliases: string[] = [];
  for (const docId of docIds) {
    const doc = docById(docId);
    if (!doc) continue;
    aliases.push(doc.title, doc.id, ...doc.keywords);
  }
  return unique(aliases.map(normalize).filter(Boolean));
}

function buildEntityDescriptors(capabilities: InternalCapability[]): InternalEntityDescriptor[] {
  const descriptors: InternalEntityDescriptor[] = [];

  if (capabilities.includes('vault')) {
    for (const vault of LUNEX_VAULTS) {
      descriptors.push({
        kind: 'vault',
        canonicalName: vault.vaultSymbol,
        aliases: unique(
          [vault.vaultSymbol, vault.label, vault.assetSymbol, vault.label.replace(/\s+vault$/i, ''), 'lunex']
            .map(normalize)
            .filter(Boolean),
        ),
        metadata: {
          provider: 'lunex',
          vaultAddress: vault.address,
          assetAddress: vault.asset,
          assetSymbol: vault.assetSymbol,
          label: vault.label,
        },
      });
    }
  }

  if (capabilities.includes('swap')) {
    for (const providerName of getDexProviderNames()) {
      descriptors.push({
        kind: 'swap_provider',
        canonicalName: providerName,
        aliases: unique([providerName].map(normalize).filter(Boolean)),
        metadata: { provider: providerName },
      });
    }
  }

  if (capabilities.includes('bridge')) {
    for (const source of SUPPORTED_BRIDGE_SOURCES) {
      descriptors.push({
        kind: 'bridge_source',
        canonicalName: source.key,
        aliases: unique([source.key, source.label].map(normalize).filter(Boolean)),
        metadata: {
          key: source.key,
          label: source.label,
          domain: source.domain,
        },
      });
    }
  }

  if (capabilities.includes('agentpay_feature')) {
    descriptors.push({
      kind: 'agentpay_feature',
      canonicalName: 'agentpay',
      aliases: collectProductDocAliases([
        'agentpay',
        'schedule-payments',
        'split-payments',
        'batch-payments',
        'invoices',
        'contacts',
        'arc-handles',
        'payment-links-qr',
      ]),
      metadata: { docIds: ['agentpay', 'schedule-payments', 'split-payments', 'batch-payments', 'invoices', 'contacts', 'arc-handles', 'payment-links-qr'] },
    });
  }

  if (capabilities.includes('telegram_feature')) {
    descriptors.push({
      kind: 'telegram_feature',
      canonicalName: 'telegram',
      aliases: collectProductDocAliases(['telegram', 'bridge']),
      metadata: { docIds: ['telegram', 'bridge'] },
    });
  }

  if (capabilities.includes('agentflow_feature')) {
    descriptors.push({
      kind: 'agentflow_feature',
      canonicalName: 'agentflow',
      aliases: collectProductDocAliases([
        'capabilities',
        'about',
        'research',
        'getting-started',
        'wallet-modes',
      ]),
      metadata: { docIds: ['capabilities', 'about', 'research', 'getting-started', 'wallet-modes'] },
    });
  }

  return descriptors;
}

function maybeMatchCapabilityKeyword(
  normalizedQuery: string,
  vocabulary: CapabilityVocabulary,
): string[] {
  if (vocabulary.capability === 'agentpay_feature') {
    return maybeMatchAgentPayKeywords(normalizedQuery, vocabulary);
  }

  const matches: string[] = [];
  for (const keyword of vocabulary.keywords) {
    if (!hasWordBoundaryMatch(normalizedQuery, normalize(keyword))) continue;
    if (
      vocabulary.requiresFramingForEveryKeyword &&
      !vocabulary.noFramingKeywords?.includes(keyword)
    ) {
      matches.push(keyword);
      continue;
    }
    matches.push(keyword);
  }
  return unique(matches);
}

function hasAgentPayContext(normalizedQuery: string): boolean {
  return AGENTPAY_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalizedQuery));
}

function maybeMatchAgentPayKeywords(
  normalizedQuery: string,
  vocabulary: CapabilityVocabulary,
): string[] {
  const matches: string[] = [];
  const hasContext = hasAgentPayContext(normalizedQuery);

  for (const keyword of vocabulary.keywords) {
    const normalizedKeyword = normalize(keyword);
    if (!hasWordBoundaryMatch(normalizedQuery, normalizedKeyword)) continue;

    const isSafeKeyword = vocabulary.noFramingKeywords?.includes(keyword);
    if (isSafeKeyword) {
      matches.push(keyword);
      continue;
    }

    if (hasContext) {
      matches.push(keyword);
    }
  }

  return unique(matches);
}

export function hasActionSignal(query: string): boolean {
  const normalized = normalize(query);
  const hasActionVerb = ACTION_VERBS.some((verb) => hasWordBoundaryMatch(normalized, verb));
  if (!hasActionVerb) return false;
  return ACTION_AMOUNT_RE.test(normalized) || ACTION_HANDLE_RE.test(normalized);
}

export function scoreAgentFlowFraming(query: string): number {
  const normalized = normalize(query);
  const signals = collectRawSignals(normalized).agentFlowSignals;
  return signals.length;
}

export function scoreExternalFraming(query: string): number {
  const normalized = normalize(query);
  const signals = collectRawSignals(normalized).externalSignals;
  return signals.length;
}

export function detectInternalCapabilities(query: string): CapabilityMatch[] {
  if (hasActionSignal(query)) return [];

  const normalizedQuery = normalize(query);
  const signals = collectSignals(normalizedQuery);
  const results: CapabilityMatch[] = [];

  for (const vocabulary of CAPABILITY_VOCABULARY) {
    const matchedKeywords = maybeMatchCapabilityKeyword(normalizedQuery, vocabulary);
    if (matchedKeywords.length === 0) continue;

    const internalWins =
      signals.agentFlowFramingScore > signals.externalFramingScore &&
      signals.agentFlowFramingScore > 0;

    results.push({
      capability: vocabulary.capability,
      matchedKeywords,
      agentFlowFramingScore: signals.agentFlowFramingScore,
      externalFramingScore: signals.externalFramingScore,
      decision: internalWins ? 'internal' : 'web',
      agentFlowSignals: signals.agentFlowSignals,
      externalSignals: signals.externalSignals,
    });
  }

  return results.filter((result) => result.decision === 'internal');
}

export function detectInternalEntities(
  query: string,
  capabilities: CapabilityMatch[],
): EntityMatch[] {
  if (capabilities.length === 0) return [];

  const normalizedQuery = normalize(query);
  const descriptors = buildEntityDescriptors(capabilities.map((capability) => capability.capability));
  const matches: EntityMatch[] = [];

  for (const descriptor of descriptors) {
    for (const alias of descriptor.aliases) {
      if (!alias) continue;
      if (!hasWordBoundaryMatch(normalizedQuery, alias)) continue;
      matches.push({
        descriptor,
        matchedAlias: alias,
        matchType: alias === descriptor.canonicalName ? 'exact' : 'strong',
      });
      break;
    }
  }

  return matches.sort((left, right) => {
    if (left.matchType === right.matchType) {
      return left.descriptor.canonicalName.localeCompare(right.descriptor.canonicalName);
    }
    return left.matchType === 'exact' ? -1 : 1;
  });
}
