export type PortfolioRequestMode = 'snapshot' | 'clarify' | 'discussion' | null;

const PORTFOLIO_SUBJECT_RE =
  /\b(?:portfolio|holdings|wallet|funds|balances?|vault\s+shares?|gateway\s+reserve|recent\s+(?:arc\s+)?activity|positions?)\b/i;
const PORTFOLIO_REFERENCE_SUBJECT_RE = /\b(?:portfolio|holdings|positions?)\b/i;
const OTHER_ACTION_RE =
  /\b(?:swap|trade|convert|exchange|bridge|deposit|withdraw|stake|send|pay|invoice|request)\b/i;
const SNAPSHOT_ACTION_RE =
  /\b(?:show|display|list|summarize|scan|review|analy[sz]e|overview|break\s*down|pull\s+up)\b/i;
const SNAPSHOT_STATE_QUESTION_RE =
  /^(?:what(?:'s| is)(?:\s+in)?\s+my\s+(?:wallet|portfolio)|what\s+do\s+i\s+own|what\s+am\s+i\s+holding|what\s+(?:holdings|funds|balances?)\s+do\s+i\s+have)(?:\s+(?:right\s+now|currently))?\??$/i;
const PORTFOLIO_ANALYSIS_REQUEST_RE =
  /^(?:(?:make|create|generate|run|perform|do)\s+(?:a\s+)?)?(?:my\s+)?portfolio\s+(?:analysis|report|review|assessment|overview)(?:\s+(?:for\s+me|now|please))?\??$/i;
const PORTFOLIO_ANALYSIS_VERB_RE =
  /^(?:make|create|generate|run|perform|do)\b[\s\S]{0,40}\bportfolio\b[\s\S]{0,40}\b(?:analysis|report|review|assessment|overview)\b/i;
const INFORMATIONAL_OR_REFERENTIAL_QUESTION_RE =
  /^(?:how|where|when|why|is|are|was|were|do|does|did|should)\b/i;
const INDIRECT_REQUEST_RE = /^(?:can|could|would|will)\s+you\b/i;
const BARE_SNAPSHOT_RE = /^(?:my\s+)?(?:portfolio|holdings|positions)\??$/i;
const DISCUSSION_RE =
  /\b(?:think|thoughts?|opinion|good|bad|healthy|risky|risk|safe|balanced|diversified|diversification|improve|assessment|assess|rate|rating)\b/i;

export function isVaultPositionRequest(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return (
    /\bvault\b[\s\S]{0,40}\b(?:positions?|holdings?|shares?|balance|balances?)\b/i.test(normalized) ||
    /\b(?:positions?|holdings?|shares?|balance|balances?)\b[\s\S]{0,40}\bvault\b/i.test(normalized) ||
    /\bin my vault\b/i.test(normalized)
  );
}

/**
 * Decides whether a portfolio-shaped turn is a live snapshot request or a
 * question that needs a natural confirmation before a paid portfolio read.
 */
export function classifyPortfolioRequestMode(message: string): PortfolioRequestMode {
  const normalized = message.trim();
  if (!normalized) return null;
  if (/\b(?:prediction\s+markets?|prediction\s+(?:market\s+)?positions?|predmarket|market\s+positions?)\b/i.test(normalized)) {
    return null;
  }
  if (isVaultPositionRequest(normalized)) {
    return null;
  }
  if (
    PORTFOLIO_ANALYSIS_REQUEST_RE.test(normalized) ||
    PORTFOLIO_ANALYSIS_VERB_RE.test(normalized)
  ) {
    return 'snapshot';
  }
  if (SNAPSHOT_STATE_QUESTION_RE.test(normalized)) return 'snapshot';
  if (!PORTFOLIO_SUBJECT_RE.test(normalized)) return null;
  if (OTHER_ACTION_RE.test(normalized)) return null;

  if (DISCUSSION_RE.test(normalized)) {
    return 'discussion';
  }

  if (BARE_SNAPSHOT_RE.test(normalized)) {
    return 'snapshot';
  }

  if (INFORMATIONAL_OR_REFERENTIAL_QUESTION_RE.test(normalized)) {
    return 'clarify';
  }

  if (INDIRECT_REQUEST_RE.test(normalized)) {
    return SNAPSHOT_ACTION_RE.test(normalized) ? 'snapshot' : 'clarify';
  }

  if (SNAPSHOT_ACTION_RE.test(normalized)) {
    return 'snapshot';
  }

  return PORTFOLIO_REFERENCE_SUBJECT_RE.test(normalized) ? 'clarify' : null;
}
