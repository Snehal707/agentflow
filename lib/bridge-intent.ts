const BRIDGE_VERBS = /\b(?:bridge|bridging)\b/i;
const BRIDGE_EXECUTION_CUES = /\b(?:for\s+me|do\s+it|execute|now|go\s+ahead)\b/i;
const BRIDGE_RESEARCH_CUES = /\b(?:best|cheapest?|compare|comparison|costs?|fees?|versus|vs)\b/i;
const BRIDGE_AMOUNT_CUES = /(?:^|[^\w])(?:\$?\d+(?:\.\d+)?)(?:\s*(?:usdc|usd))?\b/i;
const BRIDGE_TARGET_CUES = /\b(?:to|onto|into|over\s+to)\s+arc\b|\barc\b/i;
const BRIDGE_SOURCE_CUES = /\b(?:from\s+(?:base|arbitrum|ethereum|optimism|op|polygon|avalanche|linea|unichain))\b/i;
const DIRECT_BRIDGE_COMMAND = /^(?:please\s+)?bridge\b[\s\S]{0,120}\b(?:to|onto|into)\s+arc\b/i;

export function isBridgeExecutionIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (!BRIDGE_VERBS.test(normalized)) return false;
  if (!BRIDGE_TARGET_CUES.test(normalized)) return false;
  if (BRIDGE_RESEARCH_CUES.test(normalized) && !BRIDGE_EXECUTION_CUES.test(normalized) && !BRIDGE_AMOUNT_CUES.test(normalized)) {
    return false;
  }

  return (
    BRIDGE_EXECUTION_CUES.test(normalized) ||
    BRIDGE_AMOUNT_CUES.test(normalized) ||
    BRIDGE_SOURCE_CUES.test(normalized) ||
    DIRECT_BRIDGE_COMMAND.test(normalized)
  );
}

export function looksLikeBridgeResearch(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (isBridgeExecutionIntent(normalized)) return false;

  return BRIDGE_VERBS.test(normalized) && BRIDGE_RESEARCH_CUES.test(normalized);
}
