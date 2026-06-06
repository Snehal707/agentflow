const PORTFOLIO_TERMS =
  '(?:portfolio|holdings|positions|money|funds|savings|investments?|crypto|coins?|assets?|tokens?|wallet)';
const OPTIONAL_MODIFIERS = '(?:[a-z0-9-]+\\s+){0,2}';
const OWNERSHIP_TARGET = `my\\s+${OPTIONAL_MODIFIERS}${PORTFOLIO_TERMS}`;
const IMPACT_PREFIX = '(?:affect|affects|affected|affecting|impact|impacts|impacted|impacting|mean\\s+for|do\\s+to)';
const IMPACT_NOUN = '(?:impact|effect|implications?)';
const ANALYTIC_PREFIX = '(?:analy[sz]e|research|assess|evaluate|review|check)';
const ANALYTIC_NOUNS = '(?:risk|exposure|concentration|diversification)';

const DIRECT_PATTERNS = [
  new RegExp(`\\b${IMPACT_PREFIX}\\s+${OWNERSHIP_TARGET}\\b`, 'i'),
  new RegExp(`\\b${IMPACT_NOUN}\\s+(?:of\\s+)?[\\s\\S]{0,120}?\\b(?:for|on)\\s+${OWNERSHIP_TARGET}\\b`, 'i'),
  new RegExp(`\\b(?:what|how)\\s+(?:does|will)\\b[\\s\\S]{0,120}?\\b${IMPACT_PREFIX}\\s+${OWNERSHIP_TARGET}\\b`, 'i'),
  new RegExp(`\\b${ANALYTIC_PREFIX}\\b[\\s\\S]{0,80}?\\b${OWNERSHIP_TARGET}\\b[\\s\\S]{0,80}?\\b${ANALYTIC_NOUNS}\\b`, 'i'),
  new RegExp(`\\b${OWNERSHIP_TARGET}\\b[\\s\\S]{0,80}?\\b${ANALYTIC_NOUNS}\\b`, 'i'),
  new RegExp(`\\bis\\s+${OWNERSHIP_TARGET}\\b[\\s\\S]{0,40}?\\b(?:diversified|overexposed)\\b`, 'i'),
  new RegExp(`\\b(?:with|using|include|including|add)\\s+(?:my\\s+)?${PORTFOLIO_TERMS}\\s+context\\b`, 'i'),
  new RegExp(`\\b(?:with|using|include|including|add)\\s+context\\s+(?:of|from|for)\\s+(?:my\\s+)?${PORTFOLIO_TERMS}\\b`, 'i'),
];

export function detectPortfolioImpactIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return DIRECT_PATTERNS.some((pattern) => pattern.test(text));
}

export function stripPortfolioImpactPhrasing(task: string): string {
  let stripped = task;

  stripped = stripped
    .replace(new RegExp(`\\b(?:for|on)\\s+${OWNERSHIP_TARGET}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b${IMPACT_PREFIX}\\s+${OWNERSHIP_TARGET}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(?:with|using|include|including|add)\\s+(?:my\\s+)?${PORTFOLIO_TERMS}\\s+context\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(?:with|using|include|including|add)\\s+context\\s+(?:of|from|for)\\s+(?:my\\s+)?${PORTFOLIO_TERMS}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b${IMPACT_NOUN}\\s+(?:of\\s+)?`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  stripped = stripped
    .replace(/^(?:how\s+does|how\s+will|what\s+does|what\s+will)\s+/i, '')
    .replace(/^(?:impact\s+of|effect\s+of)\s+/i, '')
    .replace(/\b(?:affect|impact|mean|do)\b\s*$/i, '')
    .replace(/\b(?:for|on|to)\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped || task.trim();
}
