const PREDICTION_MARKET_TERMS = /\b(?:prediction\s+markets?|prediction\s+market|predmarket|polymarket)\b/i;
const BROWSE_VERBS = /\b(?:show|list|browse|explore|open|view|see)\b/i;
const USER_MARKET_CUES =
  /\b(?:my\s+(?:prediction\s+markets?|markets?|bets?|positions?)|markets?\s+i(?:'ve| have)\s+bet\s+on)\b/i;
const BETTING_DISCOVERY_CUES =
  /\b(?:what\s+can\s+i\s+(?:bet|wager)\s+on|what\s+markets?\s+are\s+(?:open|live|available)|markets?\s+available)\b/i;
const STRATEGIC_RESEARCH_CUES =
  /\b(?:current\s+state|status|landscape|outlook|trends?|trend|compare|comparison)\b/i;

export function isAmbiguousPredictionMarketIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;

  return /^(?:prediction\s+markets?|predmarket)$/i.test(normalized);
}

export function isPredictionMarketBrowseIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;

  if (BETTING_DISCOVERY_CUES.test(normalized)) {
    return true;
  }

  if (PREDICTION_MARKET_TERMS.test(normalized) && (BROWSE_VERBS.test(normalized) || USER_MARKET_CUES.test(normalized))) {
    return true;
  }

  return false;
}

export function looksLikePredictionMarketResearch(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (isPredictionMarketBrowseIntent(normalized)) return false;

  return PREDICTION_MARKET_TERMS.test(normalized) && STRATEGIC_RESEARCH_CUES.test(normalized);
}
