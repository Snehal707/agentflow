import type { ResearchBrief } from './types';
import { classifyTopic, selectSources } from '../../lib/source-registry';

export function buildResearchQueries(brief: ResearchBrief): string[] {
  const currentYear = new Date().getFullYear();
  const queries = new Set<string>();

  for (const question of brief.sub_questions) {
    const base = question.trim();
    if (!base) continue;

    queries.add(base);
    queries.add(`latest ${base} ${currentYear}`);
    queries.add(`official ${base} report site:.gov OR site:.org`);
    queries.add(`${base} statistics data numbers`);
    queries.add(`criticism concerns ${base}`);
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

  for (const s of topSources.slice(0, 3)) {
    let hostname: string;
    try {
      hostname = new URL(s.baseUrl).hostname;
    } catch {
      continue;
    }
    for (const q of brief.sub_questions.slice(0, 2)) {
      const base = q.trim();
      if (base) {
        queries.add(`${base} site:${hostname}`);
      }
    }
  }

  return Array.from(queries);
}
