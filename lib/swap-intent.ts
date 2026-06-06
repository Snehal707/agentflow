const SWAP_VERBS = /\b(?:swap|swapping|convert|converting|exchange|exchanging|trade|trading|flip|turn)\b/i;
const EXECUTION_CUES = /\b(?:for\s+me|do\s+it|execute|now|go\s+ahead)\b/i;
const RESEARCH_CUES =
  /\b(?:best|cheapest?|worth|compare|comparison|route|routes|fees?|fee|slippage)\b/i;
const DIRECT_SWAP_COMMAND =
  /^(?:please\s+)?(?:execute\s+)?(?:swap|convert|exchange|trade)\b[\s\S]{0,120}\b(?:to|into|for)\b[\s\S]{0,80}$/i;
const AMOUNT_CUES = /(?:^|[^\w])(?:\$?\d+(?:\.\d+)?)(?:\s*(?:usdc|eurc|usd|eth|btc|sol))?\b/i;

export function isSwapExecutionIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (!SWAP_VERBS.test(normalized)) return false;
  if (RESEARCH_CUES.test(normalized) && !EXECUTION_CUES.test(normalized) && !AMOUNT_CUES.test(normalized)) {
    return false;
  }

  return EXECUTION_CUES.test(normalized) || AMOUNT_CUES.test(normalized) || DIRECT_SWAP_COMMAND.test(normalized);
}

export function looksLikeSwapResearch(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (isSwapExecutionIntent(normalized)) return false;

  return (
    SWAP_VERBS.test(normalized) &&
    RESEARCH_CUES.test(normalized)
  ) || /\bswap\s+fees?\s+comparison\b/i.test(normalized);
}
