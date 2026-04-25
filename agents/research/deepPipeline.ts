import type express from 'express';
import { buildResearchBrief } from './orchestrator';
import { buildResearchQueries } from './queryGen';
import { retrieveSources } from './retriever';
import { buildLiveFacts } from './liveFacts';
import { extractClaimsFromSources } from './claimExtractor';
import { verifyClaims } from './verifier';
import { synthesizeResearchReport } from './synthesizer';
import type { LiveFacts, ResearchBrief, Source, VerifiedClaim } from './types';

type DeepResearchStage =
  | { stage: 'brief'; status: 'complete'; summary: string }
  | { stage: 'queries'; status: 'complete'; count: number }
  | { stage: 'retrieval'; status: 'progress'; fetched: number; total: number }
  | { stage: 'claims'; status: 'complete'; count: number }
  | { stage: 'verification'; status: 'complete'; confirmed: number; disputed: number }
  | { stage: 'report'; status: 'streaming' };

export type DeepResearchCoreResult = {
  task: string;
  brief: ResearchBrief;
  queries: string[];
  sources: Source[];
  liveFacts: LiveFacts;
  claims: VerifiedClaim[];
  result: string;
};

export async function runDeepResearchCore(input: {
  task: string;
  walletContext?: object;
  onStage?: (stage: DeepResearchStage) => void;
}): Promise<DeepResearchCoreResult> {
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

  const liveFacts = buildLiveFacts(sources);
  const claims = await extractClaimsFromSources(sources);
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

  const result = await synthesizeResearchReport({
    brief,
    claims: verified,
    liveFacts,
  });

  return {
    task,
    brief,
    queries,
    sources,
    liveFacts,
    claims: verified,
    result,
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

    for (const chunk of report.result.match(/[\s\S]{1,400}/g) ?? [report.result]) {
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
