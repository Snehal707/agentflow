import type { ResearchBrief } from './types';
import { classifyTopic, selectSources } from '../../lib/source-registry';

export function buildResearchQueries(brief: ResearchBrief): string[] {
  const currentYear = new Date().getFullYear();
  const queries = new Set<string>();
  const cleanedQuery = cleanResearchQuery(brief.query) || brief.query.trim();
  const isPaymentsAdoptionQuery =
    /\bx402\b/i.test(cleanedQuery) ||
    (/\bpayments?\b/i.test(cleanedQuery) && /\badoption\b/i.test(cleanedQuery));
  const isCreatorAudienceMetricQuery =
    /\b(subscribers?|followers?|views?|audience|reach)\b/i.test(cleanedQuery) &&
    /\b(youtube|channel|creator|streamer|influencer|tiktok|instagram|x|twitter|mrbeast)\b/i.test(cleanedQuery);

  if (cleanedQuery) {
    queries.add(cleanedQuery);
  }
  if (brief.scope === 'broad') {
    queries.add(`${cleanedQuery} overview ${currentYear}`);
    queries.add(`${cleanedQuery} latest developments ${currentYear}`);
    queries.add(`${cleanedQuery} statistics data report`);
    queries.add(`${cleanedQuery} official data report`);
  } else {
    queries.add(`${cleanedQuery} ${currentYear}`);
    queries.add(`${cleanedQuery} evidence analysis`);
    queries.add(`${cleanedQuery} primary source ${currentYear}`);
    queries.add(`${cleanedQuery} latest official update`);
  }

  if (isPaymentsAdoptionQuery) {
    queries.add(`${cleanedQuery} merchant adoption`);
    queries.add(`${cleanedQuery} enterprise adoption`);
    queries.add(`${cleanedQuery} checkout integration`);
    queries.add(`${cleanedQuery} payment processors merchant usage`);
    queries.add(`${cleanedQuery} stablecoin payments adoption`);
    queries.add(`${cleanedQuery} business models regulation`);
    queries.add(`${cleanedQuery} developers API integration commerce`);
    queries.add(`x402 payments merchant adoption ${currentYear}`);
  }

  if (isCreatorAudienceMetricQuery) {
    queries.add(`${cleanedQuery} official channel current subscribers`);
    queries.add(`${cleanedQuery} live subscriber count official youtube channel`);
    queries.add(`${cleanedQuery} socialblade current subscribers`);
    queries.add(`${cleanedQuery} official creator channel statistics ${currentYear}`);
  }

  for (const mustAnswer of brief.must_answer) {
    const base = cleanResearchQuery(mustAnswer);
    if (!base) continue;
    queries.add(`${cleanedQuery} ${base}`);
    queries.add(`${base} ${currentYear}`);
  }

  for (const question of brief.sub_questions) {
    const base = cleanResearchQuery(question);
    if (!base) continue;

    queries.add(base);
    queries.add(`latest ${base} ${currentYear}`);
    queries.add(`official ${base} report site:.gov OR site:.org`);
    queries.add(`${base} statistics data numbers`);
    queries.add(`${base} source documents`);
    queries.add(`${base} expert commentary ${currentYear}`);
    queries.add(`criticism concerns ${base}`);
  }

  if (brief.scope === 'broad') {
    queries.add(`${cleanedQuery} risks challenges analysis`);
    queries.add(`${cleanedQuery} expert analysis ${currentYear}`);
    queries.add(`${cleanedQuery} industry outlook ${currentYear}`);
    queries.add(`${cleanedQuery} regulatory update ${currentYear}`);
    queries.add(`${cleanedQuery} adoption trends ${currentYear}`);
    queries.add(`${cleanedQuery} Reuters ${currentYear}`);
    queries.add(`${cleanedQuery} BBC ${currentYear}`);
    queries.add(`${cleanedQuery} Wikipedia background`);
    queries.add(`${cleanedQuery} academic research overview`);
  }

  if (!queries.size) {
    queries.add(brief.query);
  }

  // Add source-aware query variants for high-trust sources that match the topic
  const { labels, intent } = classifyTopic(brief.query);
  const topSources = selectSources(brief.query, 5);
  console.log(
    `[research] deep-pipeline sources (intent=${intent} labels=${labels.join(',')}):`,
    topSources.map((s) => s.name).join(', '),
  );

  for (const s of topSources.slice(0, 5)) {
    let hostname: string;
    try {
      hostname = new URL(s.baseUrl).hostname;
    } catch {
      continue;
    }
    for (const q of brief.sub_questions.slice(0, 4)) {
      const base = q.trim();
      if (base) {
        queries.add(`${base} site:${hostname}`);
      }
    }
  }

  return Array.from(queries);
}

function cleanResearchQuery(value: string): string {
  return value
    .replace(/\bExecution context:[\s\S]*$/i, '')
    .replace(/\bMarket address for AgentFlow trade routing only:[^\n]*/gi, ' ')
    .replace(/\bDo not research the contract address itself[^\n]*/gi, ' ')
    .replace(/\bFocus on the real-world event[^\n]*/gi, ' ')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, ' ')
    .replace(/\brsearch\b/gi, 'research')
    .replace(/^\s*(make|write|create|generate|prepare|give)(?:\s+(?:me|us))?(?:\s+a)?\s+/i, '')
    .replace(/^\s*(deep|full|detailed|comprehensive|fast)\s+/i, '')
    .replace(/^\s*research\s+(?:the\s+)?(?:prediction\s+)?market(?:\s+topic)?[:\s-]*/i, '')
    .replace(/^\s*research\s+(?:on|about|into|for)\s+/i, '')
    .replace(/^\s*research\s+/i, '')
    .replace(/\bresearch report\b/gi, ' ')
    .replace(/\breport\b/gi, ' ')
    .replace(/\banalysis\b/gi, ' ')
    .replace(/\bsmoke\s+\d+\b/gi, ' ')
    .replace(/\b(?:summarize|summary|briefly|in one short paragraph|one short paragraph)\b/gi, ' ')
    .replace(/[?.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
