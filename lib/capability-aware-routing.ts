import {
  parseSupportedBridgeSourceChain,
  SUPPORTED_BRIDGE_SOURCES,
} from './bridge/supportedSources';
import { ACHMARKET_FACTORY } from './predmarket/providers/achmarket';
import { isPredictionMarketBrowseIntent, looksLikePredictionMarketResearch } from './prediction-market-intent';
import { parseSwapTokenSymbols } from './swap-symbols';
import { isSwapExecutionIntent, looksLikeSwapResearch } from './swap-intent';
import { isVaultDiscoveryIntent } from './vault-discovery-intent';
import { LUNEX_VAULTS } from './vault/providers/lunex';
import { isBridgeExecutionIntent, looksLikeBridgeResearch } from './bridge-intent';

export type CapabilityFeature =
  | 'bridge'
  | 'vault'
  | 'swap'
  | 'predmarket'
  | 'counterparty_risk';

export type CapabilityReason =
  | 'not_feature_shaped'
  | 'confirmed_capability'
  | 'missing_action_signal'
  | 'unsupported_entity'
  | 'unsupported_pair'
  | 'unsupported_chain'
  | 'ambiguous'
  | 'external_concept';

export type CapabilityCheckResult = {
  feature: CapabilityFeature;
  featureShaped: boolean;
  actionSignal: boolean;
  capabilityConfirmed: boolean;
  routeToFeature: boolean;
  routeToClarify: boolean;
  routeToResearch: boolean;
  reason: CapabilityReason;
  extracted?: Record<string, unknown>;
};

export type CapabilityRoutingSummary = {
  bridge: CapabilityCheckResult;
  vault: CapabilityCheckResult;
  swap: CapabilityCheckResult;
  predmarket: CapabilityCheckResult;
  counterpartyRisk: CapabilityCheckResult;
};

const COMPARE_CUES_RE = /\b(?:vs|versus|compare|comparison|best|cheapest?|fees?|costs?|sources?|providers?)\b/i;
const EXPLICIT_RESEARCH_CUE_RE =
  /\b(?:research|report|analy[sz]e|analysis|investigate|look\s+into|deep\s+dive)\b/i;
const BRIDGE_CHAIN_SUFFIX_RE = /\b(?:sepolia|testnet|fuji|amoy|atlantic|apothem)\b/g;
const BRIDGE_ACTION_SIGNAL_RE =
  /\b(?:bridge|move|transfer)\b/i;
const BRIDGE_EXTERNAL_SCOPE_RE =
  /\b(?:cctp|layerzero|wormhole|stargate|across|hop|external|outside\s+agentflow|outside\s+arc)\b/i;
const BRIDGE_AMOUNT_RE = /(?:^|[^\w])(?:\$?\d+(?:\.\d+)?)(?:\s*(?:usdc|usd))?\b/i;
const BRIDGE_PATH_RE = /\bfrom\b[\s\S]{0,40}\bto\b/i;

const VAULT_ACTION_RE = /\b(?:show|list|browse|deposit|withdraw|use|open|pick|where)\b/i;
const VAULT_FEATURE_RE = /\b(?:vault|yield|yields|apy|apr|earn|staking|stake|restaking|passive income)\b/i;
const VAULT_PRODUCT_CUE_RE = /\b(?:agentflow|arc|vaults?|yield vaults?|lunex|luneusdc|luneeurc)\b/i;
const VAULT_OPERATIONAL_ASSET_RE = /\b(?:deposit|withdraw)\b[\s\S]{0,40}\b(?:usdc|eurc)\b/i;
const VAULT_ANALYTICAL_RE = /\b(?:best|compare|comparison|providers?|rates?|returns?|yield|yields|apy|apr|status|research|analysis|analy[sz]e)\b/i;
const VAULT_USER_FUNDS_DISCOVERY_RE =
  /\b(?:park\s+my\s+(?:funds?|usdc|eurc|money|cash|idle\s+funds?|idle\s+usdc|idle\s+cash)|earn(?:\s+yield)?\s+on\s+my\s+(?:funds?|usdc|eurc)|best\s+place\s+for\s+my\s+(?:idle\s+funds?|funds?|usdc|eurc|money|cash)|where\s+can\s+i\s+park\s+my\s+(?:funds?|usdc|eurc|money|cash)|yield\s+on\s+my\s+(?:funds?|usdc|eurc))\b/i;
const VAULT_AGENTFLOW_DISCOVERY_RE =
  /\b(?:agentflow|arc)\b[\s\S]{0,40}\b(?:vaults?|yield|earn|options?)\b|\b(?:agentflow\s+vaults?|arc\s+vaults?|what\s+yield\s+options?\s+does\s+agentflow\s+have)\b/i;
const VAULT_EXTERNAL_SCOPE_RE =
  /\b(?:defi|aave|lido|compound|morpho|yearn|convex|pendle|external|outside\s+agentflow|outside\s+arc)\b/i;

const SWAP_ACTION_RE = /\b(?:for\s+me|do\s+it|execute|now|go\s+ahead)\b/i;
const SWAP_AMOUNT_RE = /(?:^|[^\w])(?:\$?\d+(?:\.\d+)?)(?:\s*(?:usdc|eurc|usd))?\b/i;
const SWAP_FEATURE_RE = /\b(?:swap|convert|exchange|trade)\b/i;
const SWAP_HELP_RE =
  /\b(?:how|what|which|supported|supports?|available|works?|route|routes|tokens?|pairs?|help|guide|walk\s+me\s+through|explain|show\s+me|tell\s+me)\b/i;
const SWAP_EXTERNAL_SCOPE_RE =
  /\b(?:dex\s+providers?|uniswap|sushiswap|1inch|cowswap|external|outside\s+agentflow|outside\s+arc)\b/i;

const COUNTERPARTY_FEATURE_RE =
  /\b(?:risk|reputation|trust|safe\s+to\s+pay|counterparty|background|due\s+diligence)\b/i;
const COUNTERPARTY_PAYMENT_RE =
  /\b(?:pay|send|invoice|contact|vendor|recipient|counterparty)\b/i;
const ARC_HANDLE_RE = /\b[a-z0-9][a-z0-9_.-]{1,63}\.arc\b/i;
const EVM_ADDRESS_RE = /\b0x[a-f0-9]{40}\b/i;
const CONTACT_LIKE_RE = /\b(?:to|for|about|with)\s+([a-z0-9][a-z0-9_.-]{1,63})\b/i;

const SUPPORTED_SWAP_SYMBOLS = ['USDC', 'EURC'] as const;
const SUPPORTED_VAULT_TERMS = new Set(
  [
    'lunex',
    'lunexusdc',
    'lunexeurc',
    ...LUNEX_VAULTS.flatMap((vault) => [
      vault.label,
      vault.vaultSymbol,
      `${vault.assetSymbol} vault`,
    ]),
  ].map((value) => normalizeText(value).replace(/\s+/g, '')),
);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function makeResult(
  feature: CapabilityFeature,
  partial: Partial<CapabilityCheckResult> & { reason: CapabilityReason },
): CapabilityCheckResult {
  return {
    feature,
    featureShaped: false,
    actionSignal: false,
    capabilityConfirmed: false,
    routeToFeature: false,
    routeToClarify: false,
    routeToResearch: false,
    ...partial,
  };
}

function deriveBridgeAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const source of SUPPORTED_BRIDGE_SOURCES) {
    const candidates = [source.key, source.label];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate).replace(BRIDGE_CHAIN_SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      aliases.set(normalized, source.key);
      const firstWord = normalized.split(' ')[0];
      if (firstWord && !aliases.has(firstWord)) {
        aliases.set(firstWord, source.key);
      }
    }
  }
  return aliases;
}

const BRIDGE_ALIASES = deriveBridgeAliases();

function extractBridgeSources(message: string): string[] {
  const normalized = normalizeText(message);
  const found = new Set<string>();
  for (const [alias, key] of BRIDGE_ALIASES.entries()) {
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) found.add(key);
  }
  return [...found];
}

function extractSwapSymbols(message: string): string[] {
  const normalized = normalizeText(message).toUpperCase();
  return SUPPORTED_SWAP_SYMBOLS.filter((symbol) => new RegExp(`\\b${symbol}\\b`, 'i').test(normalized));
}

function extractVaultTerms(message: string): string[] {
  const normalized = normalizeText(message).replace(/\s+/g, '');
  const found: string[] = [];
  for (const term of SUPPORTED_VAULT_TERMS) {
    if (term && normalized.includes(term)) found.push(term);
  }
  return [...new Set(found)];
}

function extractCounterpartyCandidate(message: string): string | null {
  const handleMatch = message.match(ARC_HANDLE_RE);
  if (handleMatch) return handleMatch[0];
  const addressMatch = message.match(EVM_ADDRESS_RE);
  if (addressMatch) return addressMatch[0];
  const contactMatch = message.match(CONTACT_LIKE_RE);
  if (contactMatch?.[1]) return contactMatch[1];
  return null;
}

export function analyzeBridgeCapability(message: string): CapabilityCheckResult {
  const normalized = normalizeText(message);
  const extractedSources = extractBridgeSources(message);
  const compareOnly = COMPARE_CUES_RE.test(normalized);
  const explicitResearchCue = EXPLICIT_RESEARCH_CUE_RE.test(normalized);
  const bridgeVerb = /\bbridge\b/i.test(normalized);
  const targetsArc = /\barc\b/i.test(normalized);
  const bridgeAmbiguityCue =
    compareOnly ||
    /\bcompare\s+bridge\s+sources?\b/i.test(normalized) ||
    (bridgeVerb && /\bsources?\b/i.test(normalized));
  const bridgeExternalScope = BRIDGE_EXTERNAL_SCOPE_RE.test(normalized);
  const featureShaped =
    isBridgeExecutionIntent(message) ||
    looksLikeBridgeResearch(message) ||
    (compareOnly && extractedSources.length >= 1) ||
    bridgeVerb;
  if (!featureShaped) {
    return makeResult('bridge', { reason: 'not_feature_shaped' });
  }

  const explicitSource =
    message.match(/\bfrom\s+([a-z0-9][a-z0-9\s-]{1,40})\b/i)?.[1]?.trim() ?? null;
  const parsedSource = explicitSource ? parseSupportedBridgeSourceChain(explicitSource) : undefined;
  const actionSignal =
    isBridgeExecutionIntent(message) ||
    BRIDGE_ACTION_SIGNAL_RE.test(normalized) && (BRIDGE_AMOUNT_RE.test(normalized) || BRIDGE_PATH_RE.test(normalized));
  const capabilityConfirmed =
    Boolean(parsedSource) ||
    extractedSources.length >= 1 ||
    bridgeVerb;

  if (capabilityConfirmed && actionSignal) {
    return makeResult('bridge', {
      featureShaped: true,
      actionSignal: true,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: {
        supportedSources: extractedSources,
        parsedSource: parsedSource ?? null,
        targetsArc,
      },
    });
  }

  if (capabilityConfirmed && !actionSignal && !explicitResearchCue && !bridgeExternalScope) {
    return makeResult('bridge', {
      featureShaped: true,
      actionSignal: false,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: {
        supportedSources: extractedSources,
        parsedSource: parsedSource ?? null,
        targetsArc,
        bridgeAmbiguityCue,
        bridgeExternalScope: false,
      },
    });
  }

  return makeResult('bridge', {
    featureShaped: true,
    actionSignal,
    capabilityConfirmed,
    routeToResearch: true,
    reason:
      capabilityConfirmed && (explicitResearchCue || bridgeExternalScope)
        ? 'external_concept'
        : capabilityConfirmed
          ? 'missing_action_signal'
          : 'unsupported_chain',
    extracted: {
      supportedSources: extractedSources,
      parsedSource: parsedSource ?? null,
      targetsArc,
      bridgeExternalScope,
    },
  });
}

export function analyzeVaultCapability(message: string): CapabilityCheckResult {
  const normalized = normalizeText(message);
  const matchedTerms = extractVaultTerms(message);
  const explicitResearchCue = EXPLICIT_RESEARCH_CUE_RE.test(normalized);
  const hasVaultWord = /\bvaults?\b/i.test(message);
  const hasLunexReference = /\b(?:lunex|luneusdc|luneeurc)\b/i.test(message) || matchedTerms.length > 0;
  const hasOperationalAssetContext = VAULT_OPERATIONAL_ASSET_RE.test(message);
  const hasUserFundDiscoveryCue = VAULT_USER_FUNDS_DISCOVERY_RE.test(message);
  const hasAgentflowDiscoveryCue = VAULT_AGENTFLOW_DISCOVERY_RE.test(message);
  const featureShaped =
    isVaultDiscoveryIntent(message) ||
    VAULT_FEATURE_RE.test(normalized) ||
    hasLunexReference;
  if (!featureShaped) {
    return makeResult('vault', { reason: 'not_feature_shaped' });
  }

  const explicitProductCue =
    hasVaultWord ||
    hasLunexReference ||
    hasOperationalAssetContext ||
    hasUserFundDiscoveryCue ||
    hasAgentflowDiscoveryCue ||
    VAULT_PRODUCT_CUE_RE.test(normalized);
  const actionSignal =
    hasOperationalAssetContext ||
    hasUserFundDiscoveryCue ||
    hasAgentflowDiscoveryCue ||
    (hasVaultWord && VAULT_ACTION_RE.test(normalized)) ||
    (hasLunexReference && /\b(?:show|list|browse|open|pick|use|deposit|withdraw)\b/i.test(normalized));
  const capabilityConfirmed = explicitProductCue;
  const vaultAmbiguityCue =
    COMPARE_CUES_RE.test(normalized) ||
    (hasLunexReference &&
      !hasVaultWord &&
      /\b(?:yield|yields|apy|apr|returns?)\b/i.test(normalized));
  const vaultExternalScope = VAULT_EXTERNAL_SCOPE_RE.test(normalized);

  if (capabilityConfirmed && actionSignal) {
    return makeResult('vault', {
      featureShaped: true,
      actionSignal: true,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: { matchedTerms },
    });
  }

  if (capabilityConfirmed && !actionSignal && !explicitResearchCue && !vaultExternalScope) {
    return makeResult('vault', {
      featureShaped: true,
      actionSignal: false,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: {
        matchedTerms,
        hasVaultWord,
        hasLunexReference,
        hasOperationalAssetContext,
        hasUserFundDiscoveryCue,
        hasAgentflowDiscoveryCue,
        vaultAmbiguityCue,
        vaultExternalScope: false,
      },
    });
  }

  return makeResult('vault', {
    featureShaped: true,
    actionSignal,
    capabilityConfirmed,
    routeToResearch: true,
    reason:
      capabilityConfirmed && (explicitResearchCue || vaultExternalScope)
        ? 'external_concept'
        : capabilityConfirmed
          ? 'missing_action_signal'
          : 'unsupported_entity',
    extracted: {
      matchedTerms,
      hasVaultWord,
      hasLunexReference,
      hasOperationalAssetContext,
      hasUserFundDiscoveryCue,
      hasAgentflowDiscoveryCue,
      vaultExternalScope,
    },
  });
}

export function analyzeSwapCapability(message: string): CapabilityCheckResult {
  const normalized = normalizeText(message);
  const symbols = extractSwapSymbols(message);
  const explicitResearchCue = EXPLICIT_RESEARCH_CUE_RE.test(normalized);
  const featureShaped = isSwapExecutionIntent(message) || looksLikeSwapResearch(message) || SWAP_FEATURE_RE.test(normalized);
  if (!featureShaped) {
    return makeResult('swap', { reason: 'not_feature_shaped' });
  }

  const actionSignal =
    isSwapExecutionIntent(message) ||
    (SWAP_FEATURE_RE.test(normalized) && (SWAP_AMOUNT_RE.test(normalized) || SWAP_ACTION_RE.test(normalized)));
  const swapAmbiguityCue = COMPARE_CUES_RE.test(normalized);
  const swapExternalScope = SWAP_EXTERNAL_SCOPE_RE.test(normalized);
  const swapHelpCue = SWAP_HELP_RE.test(normalized);
  const genericSwapProductIntent =
    SWAP_FEATURE_RE.test(normalized) &&
    !swapExternalScope &&
    !explicitResearchCue;
  const capabilityConfirmed =
    (symbols.length >= 2 && Boolean(parseSwapTokenSymbols(symbols[0], symbols[1]))) ||
    (genericSwapProductIntent && (swapAmbiguityCue || swapHelpCue || !actionSignal));

  if (capabilityConfirmed && actionSignal && !looksLikeSwapResearch(message)) {
    return makeResult('swap', {
      featureShaped: true,
      actionSignal: true,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: { symbols },
    });
  }

  if (capabilityConfirmed && !actionSignal && !explicitResearchCue && !swapExternalScope) {
    return makeResult('swap', {
      featureShaped: true,
      actionSignal: false,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: { symbols, swapAmbiguityCue, swapHelpCue, swapExternalScope: false },
    });
  }

  return makeResult('swap', {
    featureShaped: true,
    actionSignal,
    capabilityConfirmed,
    routeToResearch: true,
    reason:
      capabilityConfirmed && (explicitResearchCue || swapExternalScope)
        ? 'external_concept'
        : capabilityConfirmed
          ? 'missing_action_signal'
          : 'unsupported_pair',
    extracted: { symbols, swapExternalScope },
  });
}

export function analyzeCounterpartyRiskCapability(message: string): CapabilityCheckResult {
  const normalized = normalizeText(message);
  const featureShaped = COUNTERPARTY_FEATURE_RE.test(normalized);
  if (!featureShaped) {
    return makeResult('counterparty_risk', { reason: 'not_feature_shaped' });
  }

  const candidate = extractCounterpartyCandidate(message);
  const actionSignal = COUNTERPARTY_PAYMENT_RE.test(normalized) || Boolean(candidate);
  const capabilityConfirmed = candidate
    ? ARC_HANDLE_RE.test(candidate) || EVM_ADDRESS_RE.test(candidate) || COUNTERPARTY_PAYMENT_RE.test(normalized)
    : false;

  if (capabilityConfirmed) {
    return makeResult('counterparty_risk', {
      featureShaped: true,
      actionSignal,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: { counterparty: candidate },
    });
  }

  return makeResult('counterparty_risk', {
    featureShaped: true,
    actionSignal,
    capabilityConfirmed: false,
    routeToResearch: true,
    reason: 'external_concept',
    extracted: { counterparty: candidate },
  });
}

export function analyzePredmarketCapability(message: string): CapabilityCheckResult {
  const featureShaped =
    isPredictionMarketBrowseIntent(message) ||
    looksLikePredictionMarketResearch(message);
  if (!featureShaped) {
    return makeResult('predmarket', { reason: 'not_feature_shaped' });
  }

  const capabilityConfirmed = Boolean(ACHMARKET_FACTORY);
  const actionSignal = isPredictionMarketBrowseIntent(message);

  if (capabilityConfirmed && actionSignal) {
    return makeResult('predmarket', {
      featureShaped: true,
      actionSignal: true,
      capabilityConfirmed: true,
      routeToFeature: true,
      reason: 'confirmed_capability',
      extracted: { provider: 'achmarket' },
    });
  }

  return makeResult('predmarket', {
    featureShaped: true,
    actionSignal,
    capabilityConfirmed,
    routeToResearch: true,
    reason: capabilityConfirmed ? 'missing_action_signal' : 'unsupported_entity',
    extracted: { provider: 'achmarket' },
  });
}

export function analyzeCapabilityAwareRouting(message: string): CapabilityRoutingSummary {
  return {
    bridge: analyzeBridgeCapability(message),
    vault: analyzeVaultCapability(message),
    swap: analyzeSwapCapability(message),
    predmarket: analyzePredmarketCapability(message),
    counterpartyRisk: analyzeCounterpartyRiskCapability(message),
  };
}
