export type ResearchReasoningMode = 'fast' | 'deep';

export function inferResearchReasoningMode(input: {
  task?: string | null;
  explicitMode?: unknown;
  deepResearch?: unknown;
  defaultMode?: ResearchReasoningMode;
}): ResearchReasoningMode {
  const explicitMode =
    typeof input.explicitMode === 'string' ? input.explicitMode.trim().toLowerCase() : '';
  if (explicitMode === 'deep') return 'deep';
  if (explicitMode === 'fast') return 'fast';

  if (input.deepResearch === true) return 'deep';
  if (typeof input.deepResearch === 'string' && /^(1|true|yes|deep)$/i.test(input.deepResearch.trim())) {
    return 'deep';
  }

  const task = typeof input.task === 'string' ? input.task.toLowerCase() : '';
  if (
    /\bdeep\s+(?:research\s+)?report\b/.test(task) ||
    /\bdeep\s+research\b/.test(task) ||
    /\bdeep\s+dive\b/.test(task) ||
    /\b(?:full|detailed|comprehensive|in-depth|indepth)\s+(?:research\s+)?report\b/.test(task)
  ) {
    return 'deep';
  }

  return input.defaultMode ?? 'fast';
}
