import type express from 'express';
import { buildResearchBrief } from './orchestrator';
import { buildResearchQueries } from './queryGen';
import { retrieveSources } from './retriever';
import { buildLiveFacts } from './liveFacts';
import { extractClaimsFromSources } from './claimExtractor';
import { verifyClaims } from './verifier';
import { synthesizeResearchReport } from './synthesizer';
import { buildStructuredResearch } from './structuredResearch';
import type {
  LiveFacts,
  ResearchBrief,
  Source,
  SourceDiagnostics,
  StructuredResearch,
  VerifiedClaim,
} from './types';

type DeepResearchStage =
  | { stage: 'brief'; status: 'complete'; summary: string }
  | { stage: 'queries'; status: 'complete'; count: number }
  | { stage: 'retrieval'; status: 'progress'; fetched: number; total: number }
  | { stage: 'claims'; status: 'complete'; count: number }
  | { stage: 'verification'; status: 'complete'; confirmed: number; disputed: number }
  | { stage: 'report'; status: 'streaming' };

type DeepResearchStageHandler = (stage: DeepResearchStage) => void;

export type DeepResearchCoreResult = {
  task: string;
  brief: ResearchBrief;
  queries: string[];
  sources: Source[];
  liveFacts: LiveFacts;
  sourceDiagnostics: SourceDiagnostics;
  claims: VerifiedClaim[];
  structuredResearch: StructuredResearch;
  markdownReport: string;
};

export async function prepareDeepResearchInputs(input: {
  task: string;
  walletContext?: object;
  onStage?: DeepResearchStageHandler;
}): Promise<{
  task: string;
  brief: ResearchBrief;
  queries: string[];
  sources: Source[];
}> {
  const task = input.task.trim();
  if (!task) {
    throw new Error('Task is required');
  }

  const brief = await buildResearchBrief({
    query: task,
    walletContext: input.walletContext,
  });
  input.onStage?.({
    stage: 'brief',
    status: 'complete',
    summary: `${brief.intent} (${brief.time_sensitivity})`,
  });

  const queries = buildResearchQueries(brief);
  input.onStage?.({
    stage: 'queries',
    status: 'complete',
    count: queries.length,
  });

  const sources = await retrieveSources(brief, queries, ({ fetched, total }) => {
    input.onStage?.({
      stage: 'retrieval',
      status: 'progress',
      fetched,
      total,
    });
  });

  return {
    task,
    brief,
    queries,
    sources,
  };
}

export async function runDeepResearchCore(input: {
  task: string;
  walletContext?: object;
  onStage?: DeepResearchStageHandler;
}): Promise<DeepResearchCoreResult> {
  const { task, brief, queries, sources } = await prepareDeepResearchInputs(input);
  const sourceDiagnostics = buildSourceDiagnostics(brief, sources);

  const liveFacts = buildLiveFacts(sources);
  const claimExtractionStartedAt = Date.now();
  const claims = await extractClaimsFromSources(sources);
  console.log(
    `[research] claim extraction completed latency_ms=${Date.now() - claimExtractionStartedAt} sources=${sources.length} claims=${claims.length}`,
  );
  input.onStage?.({
    stage: 'claims',
    status: 'complete',
    count: claims.length,
  });

  const verified = await verifyClaims(brief, claims);
  const disputed = verified.filter((claim) => claim.status === 'Disputed').length;
  const confirmed = verified.filter((claim) => claim.status === 'Confirmed').length;
  input.onStage?.({
    stage: 'verification',
    status: 'complete',
    confirmed,
    disputed,
  });

  input.onStage?.({
    stage: 'report',
    status: 'streaming',
  });

  const synthesisStartedAt = Date.now();
  const markdownReport = await synthesizeResearchReport({
    brief,
    claims: verified,
    liveFacts,
    sources,
    sourceDiagnostics,
  });
  console.log(
    `[research] synthesis completed latency_ms=${Date.now() - synthesisStartedAt} sources=${sources.length} claims=${verified.length}`,
  );
  const structuredResearch = buildStructuredResearch({
    brief,
    verifiedClaims: verified,
    sources,
    sourceDiagnostics,
    markdownReport,
  });

  return {
    task,
    brief,
    queries,
    sources,
    liveFacts,
    sourceDiagnostics,
    claims: verified,
    structuredResearch,
    markdownReport,
  };
}

export function buildSourceDiagnostics(
  brief: ResearchBrief,
  sources: Source[],
): SourceDiagnostics {
  const domainCounts = new Map<string, number>();
  for (const source of sources) {
    domainCounts.set(source.domain, (domainCounts.get(source.domain) ?? 0) + 1);
  }
  const topDomains = [...domainCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain]) => domain)
    .slice(0, 5);
  const distinctDomains = domainCounts.size;
  const requiredDistinctSources = Math.max(1, brief.minimum_source_diversity || 1);
  const hasSufficientDiversity = distinctDomains >= requiredDistinctSources;
  const highReliabilitySources = sources.filter((source) => source.reliability === 'high').length;
  const mediumReliabilitySources = sources.filter((source) => source.reliability === 'medium').length;
  const lowReliabilitySources = sources.filter((source) => source.reliability === 'low').length;
  const largestShare = sources.length
    ? Math.max(...domainCounts.values()) / sources.length
    : 0;
  const reasons: string[] = [];

  if (!hasSufficientDiversity) {
    reasons.push(
      `Only ${distinctDomains} distinct source domain(s) found; ${requiredDistinctSources} required for this brief.`,
    );
  }
  if (brief.scope === 'broad' && largestShare >= 0.67) {
    reasons.push('One source domain dominates a broad-topic source set.');
  }
  if (brief.scope === 'broad' && highReliabilitySources === 0 && mediumReliabilitySources < 2) {
    reasons.push('Broad-topic retrieval found mostly low-authority sources.');
  }
  if (sources.length === 0) {
    reasons.push('No retrievable sources matched the topic contract.');
  }

  const driftRisk: SourceDiagnostics['drift_risk'] =
    reasons.length === 0 ? 'low' : reasons.length >= 2 || sources.length === 0 ? 'high' : 'medium';

  return {
    source_count: sources.length,
    distinct_domains: distinctDomains,
    required_distinct_sources: requiredDistinctSources,
    high_reliability_sources: highReliabilitySources,
    medium_reliability_sources: mediumReliabilitySources,
    low_reliability_sources: lowReliabilitySources,
    has_sufficient_diversity: hasSufficientDiversity,
    drift_risk: driftRisk,
    drift_reasons: reasons,
    top_domains: topDomains,
  };
}

export async function runDeepResearch(req: express.Request, res: express.Response): Promise<void> {
  const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
  if (!task.trim()) {
    res.status(400).json({ error: 'Task is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // @ts-ignore
  res.flushHeaders?.();

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const report = await runDeepResearchCore({
      task,
      walletContext: req.body?.walletContext,
      onStage: (stage) => sendEvent('stage', stage),
    });

    for (const chunk of report.markdownReport.match(/[\s\S]{1,400}/g) ?? [report.markdownReport]) {
      res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent('stage', {
      stage: 'error',
      status: 'failed',
      message,
    });
    res.end();
  }
}
