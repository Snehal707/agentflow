const EXPLICIT_RESEARCH_REQUEST: RegExp[] = [
  /^\s*research\b/i,
  /\bresearch\s+report\b/i,
  /\b(?:make|do|run|write|create|give\s+me|prepare|generate)\s+(?:a\s+)?research\b/i,
  /\b(?:make|write|create|prepare|generate)\s+(?:a\s+)?report\s+(?:on|about)\s+\S/i,
];

export function isExplicitResearchRequest(message: string): boolean {
  return EXPLICIT_RESEARCH_REQUEST.some((pattern) => pattern.test(message));
}
