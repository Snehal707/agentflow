const EXPLICIT_VAULT_WORDS = /\bvaults?\b/i;
const USER_FUNDS_CUES = [
  /\bmy\s+(?:usdc|eurc|funds?|cash|stablecoins?|money|idle\s+funds?|idle\s+usdc|idle\s+cash)\b/i,
  /\bpark\s+my\b/i,
  /\bearn(?:\s+yield)?\s+on\s+my\b/i,
  /\bbest\s+place\s+for\s+my\b/i,
  /\bwhere\s+can\s+i\s+park\s+my\b/i,
];
const AGENTFLOW_YIELD_CUES = [
  /\bagentflow\b[\s\S]{0,40}\b(?:vaults?|yield|earn|options?)\b/i,
  /\barc\b[\s\S]{0,40}\b(?:vaults?|yield|earn|options?)\b/i,
  /\bwhat\s+yield\s+options?\s+does\s+agentflow\s+have\b/i,
  /\bagentflow\s+vaults?\b/i,
  /\barc\s+vaults?\b/i,
];
const YIELD_ACTIONS = /\b(?:show|list|browse|compare|explore|which|what|where|best|earn|park|deposit)\b/i;
const NEGATIVE_ACTIONS = /\b(?:withdraw|redeem|unstake|remove)\b/i;

/**
 * AgentFlow vault discovery should trigger only on explicit product cues:
 * - direct vault wording
 * - the user's own funds in a "park/earn" framing
 * - AgentFlow/Arc mentioned in a yield context
 *
 * General yield research without those cues should stay on research.
 */
export function isVaultDiscoveryIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (NEGATIVE_ACTIONS.test(normalized)) return false;

  if (EXPLICIT_VAULT_WORDS.test(normalized)) {
    return true;
  }

  if (AGENTFLOW_YIELD_CUES.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (
    YIELD_ACTIONS.test(normalized) &&
    USER_FUNDS_CUES.some((pattern) => pattern.test(normalized))
  ) {
    return true;
  }

  return false;
}

export function looksLikeGeneralYieldResearch(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (isVaultDiscoveryIntent(normalized)) return false;

  return (
    /\b(?:yield|yields|apy|apr|opportunity|opportunities|farming)\b/i.test(normalized) ||
    /\b(?:current\s+state|landscape|vs|versus|compare)\b/i.test(normalized)
  );
}
