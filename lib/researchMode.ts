export type ResearchReasoningMode = 'fast' | 'deep';

const DEEP_RESEARCH_PATTERNS: RegExp[] = [
  /\bdeep research\b/i,
  /\bdeep[-\s]?dive\b/i,
  /\bcomprehensive research\b/i,
  /\bexhaustive research\b/i,
  /\bdetailed research report\b/i,
  /\bfull research report\b/i,
  /\binstitutional[-\s]?grade research\b/i,
  /\bhigh reasoning\b/i,
];

export function inferResearchReasoningMode(input: {
  task?: string | null;
  explicitMode?: unknown;
  deepResearch?: unknown;
  defaultMode?: ResearchReasoningMode;
}): ResearchReasoningMode {
  if (typeof input.explicitMode === 'string') {
    const normalized = input.explicitMode.trim().toLowerCase();
    if (normalized === 'fast' || normalized === 'deep') {
      return normalized;
    }
  }

  if (input.deepResearch === true || input.deepResearch === 'true') {
    return 'deep';
  }

  const task = input.task?.trim() || '';
  if (task && DEEP_RESEARCH_PATTERNS.some((pattern) => pattern.test(task))) {
    return 'deep';
  }

  return input.defaultMode ?? 'fast';
}

