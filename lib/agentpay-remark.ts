function cleanRemarkCandidate(candidate: string, maxLength: number): string | undefined {
  const cleaned = candidate
    .trim()
    .replace(/^[:=-]\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!cleaned || cleaned.length > maxLength) return undefined;
  if (/^\d+(?:\.\d+)?(?:\s*(?:usdc|eurc|usd|dollars?))?$/i.test(cleaned)) return undefined;
  if (/\b(?:[a-z0-9][a-z0-9-]*\.arc|0x[a-f0-9]{40})\b/i.test(cleaned)) return undefined;
  return cleaned;
}

export function extractAgentpayRemark(
  message: string,
  options: { maxLength?: number } = {},
): string | undefined {
  const maxLength = options.maxLength ?? 100;
  const normalized = message.trim();
  if (!normalized) return undefined;

  const explicitMatches = [
    ...normalized.matchAll(/\b(?:and\s+)?(?:note|remark|reference|memo)\s*(?::|=|-)?\s+([^\n]+?)\s*$/gi),
  ];
  const explicitCandidate = explicitMatches[explicitMatches.length - 1]?.[1];
  if (explicitCandidate) {
    return cleanRemarkCandidate(explicitCandidate, maxLength);
  }

  const forMatches = [
    ...normalized.matchAll(/\bfor\s+(.+?)(?=\s+\bfor\s+|$)/gi),
  ];
  for (let index = forMatches.length - 1; index >= 0; index -= 1) {
    const candidate = cleanRemarkCandidate(forMatches[index][1], maxLength);
    if (candidate) return candidate;
  }

  return undefined;
}

export const AGENTPAY_SELF_RECIPIENT_HANDLE = '__agentflow_wallet__';

export function isOwnAgentpayAddressRequest(message: string): boolean {
  return /\b(?:my|own)\s+(?:wallet(?:\s+address)?|address)\b/i.test(message);
}
