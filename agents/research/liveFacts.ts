import type { LiveFacts, Source } from './types';

export function buildLiveFacts(sources: Source[]): LiveFacts {
  const latestEvents = [...sources]
    .filter((source) => source.reliability !== 'low')
    .sort((a, b) => {
      const aTs = Date.parse(a.date || '') || 0;
      const bTs = Date.parse(b.date || '') || 0;
      return bTs - aTs;
    })
    .slice(0, 6)
    .map((source) => ({
      date: source.date || new Date().toISOString(),
      event: source.title,
      source: source.url,
    }));

  return {
    latest_events: latestEvents,
    market_data: {},
    prices: {},
    timestamps: {
      generated_at: new Date().toISOString(),
    },
  };
}
