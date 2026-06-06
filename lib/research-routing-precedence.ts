export function hasExplicitResearchReportRequest(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return (
    /\bresearch\b/i.test(normalized) ||
    /\breport\s+(?:on|about|into|for)\b/i.test(normalized)
  );
}
