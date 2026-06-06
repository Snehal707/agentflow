/** Visible user probe only — never Portfolio context / injections. */
export function resolveCapabilityRoutingProbe(
  rawUserMessage: string | undefined,
  fullMessage: string,
): string {
  if (typeof rawUserMessage === 'string' && rawUserMessage.trim()) {
    return rawUserMessage.trim();
  }
  const head = fullMessage.split(/\n\nPortfolio context:\s*\n/i)[0] ?? fullMessage;
  return head.trim();
}

/** Routing noise: punctuation-only / ultra-short probes never hit product FAQs. */
export function isNoiseOnlyChatProbe(probe: string): boolean {
  const t = probe.trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  const collapsed = t.replace(/\s+/g, '');
  if (!collapsed.length) return true;
  if (/^[^\w]+$/.test(collapsed)) return true;
  return false;
}

export type CapabilityThreadContext = {
  messageCount: number;
  hasAssistantMessage: boolean;
};

/** Frustration / meta / clarification — never standalone product FAQ. */
export function hasProductRoutingBypassSignals(normalizedProbe: string): boolean {
  return (
    /\bare\s+you\b/i.test(normalizedProbe) ||
    /\bi\s+mean\b/i.test(normalizedProbe) ||
    /\bi\s+am\s+talking\s+about\b/i.test(normalizedProbe) ||
    /\bi['’]m\s+talking\s+about\b/i.test(normalizedProbe) ||
    /\bnot\s+this\b/i.test(normalizedProbe) ||
    /\byou\s+are\s+not\s+getting\b/i.test(normalizedProbe) ||
    /\blol\b/i.test(normalizedProbe) ||
    /\bcould\s+you\b/i.test(normalizedProbe) ||
    /\bpatch\b/i.test(normalizedProbe) ||
    /\byourself\b/i.test(normalizedProbe) ||
    /\bwhat\s+happened\b/i.test(normalizedProbe) ||
    /\bhappened\s*\?\s*$/i.test(normalizedProbe)
  );
}

const CAPABILITY_FAQ_PROBE_MAX_LEN = 120;

/**
 * Anchored standalone AgentFlow FAQ only. Requires shallow thread (fresh / near-empty chat).
 */
export function shouldHandleAsAgentFlowCapabilityQuestion(
  capabilityProbe: string,
  thread: CapabilityThreadContext,
): boolean {
  const trimmed = capabilityProbe.trim();
  if (!trimmed || trimmed.length > CAPABILITY_FAQ_PROBE_MAX_LEN) return false;
  if (isNoiseOnlyChatProbe(trimmed)) return false;

  const normalizedMulti = trimmed.toLowerCase();
  if (hasProductRoutingBypassSignals(normalizedMulti)) return false;

  if (thread.hasAssistantMessage || thread.messageCount > 2) return false;

  const line = normalizedMulti.replace(/\s+/g, ' ').trim();
  const anchored = [
    /^what\s+can\s+agentflow\s+do(?:\s+(?:today|right\s+now))?\??[!.\s]*$/i,
    /^what\s+does\s+agentflow\s+do\??[!.\s]*$/i,
    /^what\s+is\s+agentflow\??[!.\s]*$/i,
    /^how\s+does\s+agentflow\s+work\??[!.\s]*$/i,
    /^what\s+can\s+you\s+do\??[!.\s]*$/i,
    /^what\s+can\s+you\s+help\s+with\??[!.\s]*$/i,
  ];
  return anchored.some((pattern) => pattern.test(line));
}

export function buildCapabilityThreadContext(
  messages: ReadonlyArray<{ role: string; content: string }>,
): CapabilityThreadContext {
  return {
    messageCount: messages.length,
    hasAssistantMessage: messages.some((m) => m.role === 'assistant'),
  };
}
