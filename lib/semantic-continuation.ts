export type SemanticContinuationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function looksLikeSemanticFollowup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  return (
    words.length <= 18 &&
    /\b(?:he|him|his|she|her|they|them|their|it|its|that|this|there|those|these|one|same|where|which|what about|how about|from|i said|you said)\b/i.test(
      normalized,
    )
  );
}

function compactSemanticFact(value: string, limit = 220): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function buildSemanticContinuationContext(
  message: string,
  history: SemanticContinuationMessage[] = [],
): string | null {
  const normalized = message.trim().toLowerCase();
  if (!looksLikeSemanticFollowup(message) || !history.length) {
    return null;
  }

  const recent = history
    .filter((turn) => typeof turn.content === 'string' && turn.content.trim())
    .slice(-8);
  const recentText = recent.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
  const lowerRecentText = recentText.toLowerCase();

  const topics: string[] = [];
  const entities: string[] = [];
  const knownFacts: string[] = [];
  const unknownFields: string[] = [];

  if (/\bagentflow was built by snehal\b/i.test(recentText) || /\bSnehal\b.*\bAgentFlow\b/i.test(recentText)) {
    topics.push('agentflow_founder');
    entities.push('person: Snehal (@SnehalRekt), role: AgentFlow builder/founder');
    knownFacts.push(
      'AgentFlow was built by Snehal (@SnehalRekt), a solo founder building Web3 AI agents on Arc Network.',
    );
    if (/\bwhere\b/i.test(normalized) || /\bfrom\b/i.test(normalized)) {
      unknownFields.push('Snehal personal location, hometown, or origin is not verified in the current context.');
    }
  }

  if (/\bbridge\b|\bsource chain\b|\bchain\b.*\bbalance\b|\bbalance\b.*\bchain\b/i.test(recentText)) {
    topics.push('bridge_to_arc');
    knownFacts.push(
      'Bridge to Arc source-chain balances must come from the live wallet-aware bridge flow or deterministic backend result for the current turn.',
    );
  }

  if (/\bswap\b|\bturn\b.*\binto\b|\btrade\b/i.test(lowerRecentText)) {
    topics.push('swap');
  }

  if (/\bpayment\b|\bpay\b|\binvoice\b|\bagentpay\b/i.test(lowerRecentText)) {
    topics.push('agentpay');
  }

  if (
    /\b(?:portfolio|holdings|wallet tokens?|gateway reserve|vault shares?|prediction market positions?|allocation|payment liquidity)\b/i.test(
      lowerRecentText,
    )
  ) {
    topics.push('portfolio');
    knownFacts.push(
      'The recent thread contains a portfolio report or portfolio discussion. Resolve short references such as it, that, and there against that report before asking the user to run another portfolio check.',
    );
  }

  if (!topics.length && !entities.length) {
    const lastUser = [...recent].reverse().find((turn) => turn.role === 'user')?.content;
    const lastAssistant = [...recent].reverse().find((turn) => turn.role === 'assistant')?.content;
    if (!lastUser && !lastAssistant) {
      return null;
    }
    topics.push('recent_conversation');
    if (lastUser) {
      knownFacts.push(`Previous user turn: ${compactSemanticFact(lastUser)}`);
    }
    if (lastAssistant) {
      knownFacts.push(`Previous assistant answer: ${compactSemanticFact(lastAssistant)}`);
    }
  }

  const requestedField =
    /\bwhere\b/i.test(normalized) || /\bfrom\b/i.test(normalized)
      ? 'origin/location'
      : /\bwho\b/i.test(normalized)
        ? 'identity'
        : /\bwhich\b/i.test(normalized)
          ? 'selection'
          : /\bhow\b/i.test(normalized)
            ? 'method/status'
            : 'referenced detail';

  return [
    'Current semantic continuation context:',
    '- The current user message appears to be a follow-up to the recent thread.',
    '- Resolve pronouns and deictic references such as he, it, that, this, there, which, and from against this context before answering.',
    `- Requested field: ${requestedField}.`,
    `- Last topic(s): ${Array.from(new Set(topics)).join(', ')}.`,
    entities.length ? `- Recent entity/entities: ${Array.from(new Set(entities)).join('; ')}.` : '',
    knownFacts.length ? `- Known recent fact(s): ${Array.from(new Set(knownFacts)).join(' ')}` : '',
    unknownFields.length ? `- Unknown field(s): ${Array.from(new Set(unknownFields)).join(' ')}` : '',
    '- Answer only the requested follow-up. If the requested field is unknown or not verified in this context, say that directly in one short sentence.',
    '- Do not repeat the prior answer or restate known facts unless needed to resolve the reference.',
    topics.includes('agentflow_founder')
      ? '- For AgentFlow founder/team follow-ups, do not offer external research; answer only from current verified context.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
