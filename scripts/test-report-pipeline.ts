import assert from 'node:assert/strict';
import {
  collectPreferredReportSources,
  finalizeReportMarkdown,
} from '../lib/reportPipeline';
import { buildPrimaryFirecrawlQueryVariants } from '../lib/live-data';

const badWriterMarkdown = `# Iran-US Tensions Research Report

**Prepared by:** AgentFlow AI

## Executive Summary

No active full-scale war is confirmed. The Strait of Hormuz is fully blocked and fresh direct shipping strikes are confirmed.

## Current Status

- No active full-scale war is confirmed
- The route is fully blocked
- Fresh direct shipping strikes are confirmed

## Analysis

Global shipping is severely impacted and no immediate safe route alternatives remain.

## Conclusion

No war is confirmed and the route is fully blocked.`;

const directApUrl =
  'https://apnews.com/article/iran-hormuz-shipping-tolls-china-de5159966cde7de7b964b3c2c67eec07';
const directPbsUrl =
  'https://www.pbs.org/newshour/world/a-houthi-missile-attack-on-israel-raises-concerns-about-red-sea-shipping-routes-being-blocked';
const aggregatorUrl =
  'https://news.google.com/rss/articles/example-google-news-link';

const research = {
  topic: 'Iran-US Tensions and Shipping Route Impact',
  facts: [
    {
      claim: 'Recent strong-source reporting describes the broader conflict as active',
      value: 'Active conflict framing in late March 2026',
      status: 'reported',
      date_or_period: '2026-03-30',
      confidence: 'high',
      support: 'Current article set',
      source_name: 'Reuters',
      source_url:
        'https://www.reuters.com/world/middle-east/chinese-container-ships-pass-through-strait-hormuz-second-attempt-data-shows-2026-03-30/',
    },
    {
      claim: 'The Strait of Hormuz is severely constrained, with limited passage still occurring',
      value: 'Limited transit resumed',
      status: 'reported',
      date_or_period: '2026-03-26',
      confidence: 'high',
      support: 'Latest shipping article',
      source_name: 'AP News',
      source_url: directApUrl,
    },
    {
      claim: 'Red Sea route risk is elevated, but fresh direct strikes on shipping are not confirmed',
      value: 'Elevated risk only',
      status: 'reported',
      date_or_period: '2026-03-29',
      confidence: 'medium',
      support: 'Latest Red Sea article',
      source_name: 'PBS News',
      source_url: directPbsUrl,
    },
  ],
  recent_developments: [
    {
      event: 'AP News reported that Iran was formalizing passage controls in Hormuz while some traffic still moved.',
      status: 'reported',
      date_or_period: '2026-03-26',
      importance: 'Route-level shipping status',
      support: 'AP News article',
      source_name: 'AP News',
      source_url: directApUrl,
    },
    {
      event: 'PBS News reported that a Houthi strike on Israel raised Red Sea shipping fears without confirming fresh shipping attacks.',
      status: 'reported',
      date_or_period: '2026-03-29',
      importance: 'Route risk',
      support: 'PBS News article',
      source_name: 'PBS News',
      source_url: directPbsUrl,
    },
  ],
  metrics: [
    {
      name: 'Traffic collapse signal',
      value: 'About 90%',
      unit: 'drop in transit since the war began',
      date_or_period: '2026-03-26',
      support: 'AP News article',
      source_name: 'AP News',
      source_url: directApUrl,
    },
  ],
  risks_or_caveats: [
    'Route access remains highly sensitive to political and military signaling.',
    'Red Sea route risk could increase further even if fresh direct shipping strikes are not yet confirmed.',
  ],
  sources: [
    {
      name: 'AP News',
      url: aggregatorUrl,
      used_for: 'Aggregator duplicate that should lose to the direct URL',
    },
    {
      name: 'AP News',
      url: directApUrl,
      used_for: 'Direct Hormuz article',
    },
    {
      name: 'PBS News',
      url: directPbsUrl,
      used_for: 'Direct Red Sea article',
    },
  ],
};

const analysis = {
  core_thesis:
    'The broader conflict is active in current reporting, Hormuz is severely constrained with limited passage resuming, and Red Sea risk is elevated without fresh direct shipping strikes being confirmed.',
  key_insights: [
    {
      title: 'Conflict status',
      insight:
        'The active-conflict framing should be preserved rather than downgraded to generic tensions.',
      why_it_matters: 'That changes the baseline risk context for investors.',
      confidence: 'high',
      evidence_refs: ['Reuters late-March 2026 conflict coverage'],
    },
  ],
  decision_relevant_conclusion:
    'Investors should treat Hormuz as severely disrupted but not absolutely closed, and treat the Red Sea as elevated risk rather than a confirmed fresh shipping shutdown.',
};

const liveData = {
  current_events: {
    article_snapshots: [
      {
        title: 'Iran starts to formalize its chokehold on the Strait of Hormuz with a toll booth regime',
        url: directApUrl,
        publisher: 'AP News',
        seen_at: '2026-03-26T00:00:00.000Z',
        summary: 'AP reported that traffic had fallen sharply and some vessels still paid for passage.',
      },
      {
        title:
          'A Houthi missile attack on Israel raises concerns about Red Sea shipping routes being blocked',
        url: directPbsUrl,
        publisher: 'PBS News',
        seen_at: '2026-03-29T00:00:00.000Z',
        summary:
          'PBS reported elevated shipping concerns without confirming fresh direct commercial shipping strikes.',
      },
    ],
    framing_signals: {
      broader_conflict_status: 'reported_active_war',
      hormuz_route_status: 'severely_constrained_with_limited_passage',
      red_sea_route_status: 'elevated_risk_latest_direct_shipping_strikes_not_confirmed',
      support: [
        {
          title: 'Active-conflict reporting',
          source_name: 'Reuters',
          source_url:
            'https://www.reuters.com/world/middle-east/chinese-container-ships-pass-through-strait-hormuz-second-attempt-data-shows-2026-03-30/',
          date_or_period: '2026-03-30',
        },
        {
          title: 'Hormuz route status',
          source_name: 'AP News',
          source_url: directApUrl,
          date_or_period: '2026-03-26',
        },
        {
          title: 'Red Sea route status',
          source_name: 'PBS News',
          source_url: directPbsUrl,
          date_or_period: '2026-03-29',
        },
      ],
    },
  },
};

const preferredSources = collectPreferredReportSources({
  research,
  liveData,
});
assert.ok(
  preferredSources.some((source) => source.url === directApUrl),
  'Expected direct AP URL to be retained as a preferred source.',
);
assert.ok(
  !preferredSources.some((source) => source.url === aggregatorUrl),
  'Expected Google News aggregator URL to be dropped when a direct URL exists.',
);

const finalized = finalizeReportMarkdown({
  task: 'Iran-US Tensions and Shipping Route Impact Report',
  writerMarkdown: badWriterMarkdown,
  research,
  analysis,
  liveData,
});

assert.equal(
  finalized.validationIssues.length,
  0,
  `Expected no validation issues, got: ${finalized.validationIssues.join('; ')}`,
);
assert.match(
  finalized.markdown,
  /broader conflict .* active|describes the broader conflict as active/i,
);
assert.doesNotMatch(finalized.markdown, /\bno active full-scale war is confirmed\b/i);
assert.doesNotMatch(finalized.markdown, /\bfresh direct shipping strikes are confirmed\b/i);
assert.doesNotMatch(finalized.markdown, /\bis fully blocked\b/i);
assert.doesNotMatch(finalized.markdown, /\bnot confirmed\b[^.\n]*\bbut confirmed\b/i);
assert.match(finalized.markdown, /limited successful transits? still occurring/i);
assert.match(
  finalized.markdown,
  /fresh direct strikes on commercial shipping are not confirmed/i,
);
assert.doesNotMatch(finalized.markdown, /\binsurance spikes? (?:are|were|remain)\b/i);
assert.doesNotMatch(finalized.markdown, /\bno immediate safe route alternatives remain\b/i);
assert.ok(finalized.markdown.includes(directApUrl));
assert.ok(!finalized.markdown.includes(aggregatorUrl));

const narrativeLines = finalized.markdown
  .split('\n')
  .map((line) => line.trim())
  .filter(
    (line) =>
      line &&
      !/^#/.test(line) &&
      !/^\*\*Prepared by:\*\*/.test(line) &&
      !/^- /.test(line) &&
      !/^## /.test(line),
  );
const duplicateNarrativeLines = narrativeLines.filter(
  (line, index) =>
    narrativeLines.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) !==
    index,
);
assert.equal(
  duplicateNarrativeLines.length,
  0,
  `Expected no repeated narrative lines, got: ${duplicateNarrativeLines.join(' | ')}`,
);

const normalizedClaimSections = new Set(
  finalized.claims
    .filter((claim) =>
      ['current_status', 'reported_developments', 'data_and_statistics'].includes(claim.section),
    )
    .map((claim) => claim.section),
);
assert.ok(
  normalizedClaimSections.has('current_status'),
  'Expected current-status claims to exist in normalized claim layer.',
);
assert.ok(
  normalizedClaimSections.has('reported_developments'),
  'Expected reported-development claims to exist in normalized claim layer.',
);

const writerOnlyMarkdown = `# Arc Network — Research Report

**Prepared by:** AgentFlow AI

## Executive Summary

Arc is Circle's L1 where USDC is native gas; this report is grounded in the writer pass only.

## Key Facts

- Sub-second finality on Arc testnet for USDC-first apps.

## Conclusion

Writer output must be shown even when research JSON has no facts array.`;

const writerWinsUnstructured = finalizeReportMarkdown({
  task: 'Arc Network overview',
  writerMarkdown: writerOnlyMarkdown,
  research: null,
  analysis: null,
  liveData: null,
});
assert.match(writerWinsUnstructured.markdown, /Arc is Circle's L1/i);
assert.doesNotMatch(
  writerWinsUnstructured.markdown,
  /too thin to support a confident executive summary/i,
  'Writer markdown must not be replaced by claim fallback when research lacks structured JSON.',
);

const writerWithNestedDuplicateSources = `## Summary

Bitcoin has live market data available.

- **Sources:**
  - coingecko.com (2026-06-01, via API)
  - defillama.com (2026-06-01, via API and BTC page)

- **Takeaway:**

Keep the report source list clean.`;

const normalizedNestedSources = finalizeReportMarkdown({
  task: 'Bitcoin fast report',
  writerMarkdown: writerWithNestedDuplicateSources,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-01T00:00:00.000Z',
    coingecko: {
      assets: [{ coinId: 'bitcoin', last_updated_at: '2026-06-01T00:00:00.000Z' }],
    },
    defillama: {
      chains: [{ chain: 'Bitcoin' }],
    },
  },
});
assert.equal(
  normalizedNestedSources.markdown.match(/^## Sources$/gm)?.length,
  1,
  'Expected one normalized Sources section for nested bold source headings.',
);
assert.doesNotMatch(normalizedNestedSources.markdown, /\bvia API\b/i);
assert.match(normalizedNestedSources.markdown, /https:\/\/www\.coingecko\.com\/en\/coins\/bitcoin/);
assert.match(normalizedNestedSources.markdown, /https:\/\/defillama\.com\/chain\/Bitcoin/);
assert.match(
  normalizedNestedSources.markdown,
  /- \[CoinGecko\]\(https:\/\/www\.coingecko\.com\/en\/coins\/bitcoin\) - live market data/,
);
assert.doesNotMatch(normalizedNestedSources.markdown, /CoinGecko: https:\/\//);
assert.match(normalizedNestedSources.markdown, /Keep the report source list clean\./);

const bitcoinWithIrrelevantDynamicSources = finalizeReportMarkdown({
  task: 'make a research report on bitcoin',
  writerMarkdown: '## Summary\n\nBitcoin report.',
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-01T00:00:00.000Z',
    coingecko: {
      assets: [{ coinId: 'bitcoin', last_updated_at: '2026-06-01T00:00:00.000Z' }],
    },
    dynamic_sources: {
      articles: [
        { title: 'Unrelated key page', url: 'https://key.com/example', summary: 'Unrelated.' },
        { title: 'Unrelated app page', url: 'https://play.google.com/store/apps/example', summary: 'Unrelated.' },
        { title: 'Unrelated music page', url: 'https://tunebat.com/example', summary: 'Unrelated.' },
        { title: 'Unrelated dictionary page', url: 'https://dict.leo.org/example', summary: 'Unrelated.' },
      ],
    },
  },
});
assert.match(bitcoinWithIrrelevantDynamicSources.markdown, /CoinGecko/);
assert.doesNotMatch(
  bitcoinWithIrrelevantDynamicSources.markdown,
  /\b(?:key\.com|play\.google\.com|tunebat\.com|dict\.leo\.org)\b/i,
);

const bitcoinTransactionsWithOnchainSource = finalizeReportMarkdown({
  task: "Make research report on the bitcoin's last 24h transactions",
  writerMarkdown: '## Summary\n\nBitcoin network transaction report.',
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-01T00:00:00.000Z',
    bitcoin_onchain: {
      source: 'Mempool.space blocks API',
      chain: 'Bitcoin',
      window: 'last_24h_from_tip',
      latest_block_height: 951982,
      latest_block_time: '2026-06-01T12:00:00.000Z',
      window_start_time: '2026-05-31T12:00:00.000Z',
      confirmed_transaction_count_24h: 612345,
      block_count_24h: 144,
    },
  },
});
assert.match(bitcoinTransactionsWithOnchainSource.markdown, /Mempool\.space/);
assert.match(bitcoinTransactionsWithOnchainSource.markdown, /https:\/\/mempool\.space\/blocks/);

const predmarketWithMergedFallbackSources = finalizeReportMarkdown({
  task: 'research the prediction market topic: Will ARC launch its Mainnet before June 30, 2026?',
  writerMarkdown: `## Summary

ARC launch timing remains uncertain.

## Sources

- [MEXC](https://www.mexc.com/news/1144042) - live exchange article (accessed 2026-06-13)`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-13T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'Arc roadmap update',
          publisher: 'Circle',
          url: 'https://www.circle.com/blog/arc-mainnet-roadmap',
          summary: 'Circle discusses the Arc roadmap and 2026 launch plan.',
          seen_at: '2026-06-13T00:00:00.000Z',
        },
        {
          title: 'Arc progress update',
          publisher: 'MEXC',
          url: 'https://www.mexc.com/news/1144042',
          summary: 'MEXC covers Arc progress and upcoming milestones.',
          seen_at: '2026-06-13T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.match(predmarketWithMergedFallbackSources.markdown, /https:\/\/www\.mexc\.com\/news\/1144042/);
assert.match(predmarketWithMergedFallbackSources.markdown, /https:\/\/www\.circle\.com\/blog\/arc-mainnet-roadmap/);

const predmarketExpandedQueries = buildPrimaryFirecrawlQueryVariants(
  'GTA 6 release date news | GTA 6 launch delay latest | GTA 6 official announcement',
  'research the prediction market topic: Will GTA 6 launch before November 30, 2026?',
);
assert.ok(
  predmarketExpandedQueries.some((query) => /gta 6 release date news/i.test(query)),
  'Expected prediction-market query builder to preserve subject-specific GTA 6 release queries.',
);
assert.ok(
  predmarketExpandedQueries.some((query) => /rockstar games gta 6 launch confirmed launch timeline|official announcement/i.test(query)),
  'Expected prediction-market query builder to preserve an official GTA release-status query.',
);

const predmarketPromptOnlyQueries = buildPrimaryFirecrawlQueryVariants(
  `research the prediction market topic: Will ARC launch its Mainnet before June 30, 2026?
Listed outcomes in AgentFlow: Yes / No.
Prediction market category in AgentFlow: Crypto.
Prediction market provider in AgentFlow: achmarket.
AgentFlow market address reference: 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96.
Use the market category to disambiguate the subject before searching. For example: crypto markets should be researched as crypto/blockchain topics, sports markets as teams/tournaments, and macro/commodity markets by their real-world underlying drivers.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.`,
  `research the prediction market topic: Will ARC launch its Mainnet before June 30, 2026?
Listed outcomes in AgentFlow: Yes / No.
Prediction market category in AgentFlow: Crypto.
Prediction market provider in AgentFlow: achmarket.
AgentFlow market address reference: 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96.
Use the market category to disambiguate the subject before searching. For example: crypto markets should be researched as crypto/blockchain topics, sports markets as teams/tournaments, and macro/commodity markets by their real-world underlying drivers.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.`,
);
assert.ok(
  predmarketPromptOnlyQueries.some((query) => /site:arc\.network ARC Network mainnet/i.test(query)),
  'Expected prompt-only ARC prediction-market queries to still generate ARC-specific site queries.',
);
assert.ok(
  predmarketPromptOnlyQueries.every((query) => !/Prediction market category in AgentFlow|AgentFlow market address reference|Focus on the real-world event/i.test(query)),
  'Expected prompt-only prediction-market queries to strip AgentFlow scaffolding instead of searching the whole prompt.',
);
assert.ok(
  predmarketPromptOnlyQueries.every((query) => !/long term forecast|future outlook|growth potential/i.test(query)),
  'Expected launch-deadline prediction markets to avoid generic forecast variants and stay on status/roadmap queries.',
);

const worldCupWinnerQueries = buildPrimaryFirecrawlQueryVariants(
  `research the prediction market topic: Who Will Win the FIFA World Cup 2026?
Listed outcomes in AgentFlow: France / Argentina / Brazil / Other.
Prediction market category in AgentFlow: Sports.
Prediction market provider in AgentFlow: achmarket.
Use the market category to disambiguate the subject before searching.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.`,
  `research the prediction market topic: Who Will Win the FIFA World Cup 2026?
Listed outcomes in AgentFlow: France / Argentina / Brazil / Other.
Prediction market category in AgentFlow: Sports.
Prediction market provider in AgentFlow: achmarket.
Use the market category to disambiguate the subject before searching.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.`,
);
assert.ok(
  worldCupWinnerQueries.some((query) => /winner odds|favorites odds|outright odds|power rankings|opta prediction/i.test(query)),
  'Expected sports winner markets to generate outright-odds or ranking queries.',
);
assert.ok(
  worldCupWinnerQueries.every((query) => !/world cup 2026 latest(?: news)?/i.test(query)),
  'Expected sports winner markets to avoid generic latest-news queries that pull live match chatter.',
);

const gtaPredmarketFiltersLowValueSources = finalizeReportMarkdown({
  task: 'research the prediction market topic: Will GTA 6 launch before November 30, 2026?',
  writerMarkdown: `## Summary

Evidence remains mixed.

## Sources

- [dict.leo.org](https://dict.leo.org/englisch-deutsch/grand) - dictionary result
- [speisekartenweb.de](https://www.speisekartenweb.de/restaurants/mannheim/grand-luise-12345) - menu page
- [grandcityproperty.de](https://grandcityproperty.de/) - property page
- [apps.microsoft.com](https://apps.microsoft.com/detail/9NTL0GZ6C1Q2?hl=en-us&gl=US) - Grand Theft Auto V Legacy app listing
- [Rockstar Games](https://www.rockstargames.com/VI) - Grand Theft Auto VI official game page`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'Grand Theft Auto VI official page',
          publisher: 'Rockstar Games',
          url: 'https://www.rockstargames.com/VI',
          summary: 'Official Rockstar Games page for Grand Theft Auto VI.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.match(gtaPredmarketFiltersLowValueSources.markdown, /rockstargames\.com\/VI/i);
assert.doesNotMatch(
  gtaPredmarketFiltersLowValueSources.markdown,
  /\b(?:dict\.leo\.org|speisekartenweb\.de|grandcityproperty\.de|apps\.microsoft\.com)\b/i,
);

const predmarketPromptLeakFallsBack = finalizeReportMarkdown({
  task: 'research the prediction market topic: Will GTA 6 launch before November 30, 2026?',
  writerMarkdown: `Research Pipeline
research agent started
research the prediction market topic: Will GTA 6 launch before November 30, 2026?
Prediction market category in AgentFlow: Games.

## Overview

Thin evidence.`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'Grand Theft Auto VI official page',
          publisher: 'Rockstar Games',
          url: 'https://www.rockstargames.com/VI',
          summary: 'Official Rockstar Games page for Grand Theft Auto VI.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
        {
          title: 'Take-Two confirms GTA VI release timing',
          publisher: 'Take-Two Interactive',
          url: 'https://www.take2games.com/ir/news/gta-vi-release-timing',
          summary: 'Corporate release-timing update for GTA VI.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.doesNotMatch(
  predmarketPromptLeakFallsBack.markdown,
  /\bresearch the prediction market topic:|Prediction market category in AgentFlow:|Research Pipeline|research agent started/i,
);

const arcPredmarketDropsBrowserHomonyms = finalizeReportMarkdown({
  task: `research the prediction market topic: Will ARC launch its Mainnet before June 30, 2026?
Listed outcomes in AgentFlow: Yes / No.
Prediction market category in AgentFlow: Crypto.
Prediction market provider in AgentFlow: achmarket.
AgentFlow market address reference: 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96.
Use the market category to disambiguate the subject before searching.`,
  writerMarkdown: `# ARC mainnet launch before June 30, 2026

## Overview

Thin evidence.

## Sources

- [arc.net](https://arc.net/download)
- [chip.de](https://www.chip.de/downloads/Arc-Browser_185256830.html)
- [DefiLlama](https://defillama.com/chain/Arc)`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'Arc browser download',
          publisher: 'arc.net',
          url: 'https://arc.net/download',
          summary: 'Browser page.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
        {
          title: 'Arc Browser download',
          publisher: 'chip.de',
          url: 'https://www.chip.de/downloads/Arc-Browser_185256830.html',
          summary: 'Browser listing.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
    defillama: {
      source: 'DefiLlama chains API + stablecoins API',
      chains: [{ chain: 'Arc', tvl: 7.77, stablecoins: 0 }],
    },
  },
});
assert.doesNotMatch(
  arcPredmarketDropsBrowserHomonyms.markdown,
  /\barc\.net\b|\bchip\.de\b/i,
);

const arcLaunchPredmarketOmitsDefiLlamaSource = finalizeReportMarkdown({
  task: `research the prediction market topic: Will ARC launch its Mainnet before June 30, 2026?
Listed outcomes in AgentFlow: Yes / No.
Prediction market category in AgentFlow: Crypto.
Prediction market provider in AgentFlow: achmarket.
AgentFlow market address reference: 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96.
Use the market category to disambiguate the subject before searching.`,
  writerMarkdown: `# ARC mainnet launch before June 30, 2026

## Overview

ARC remains in a pre-mainnet stage.

## Sources

- [DefiLlama](https://defillama.com/chain/Arc)`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-15T00:00:00.000Z',
    prediction_market_understanding: {
      subject: 'ARC Network mainnet launch',
      underlying: null,
      questionType: 'launch_milestone',
      resolutionDate: '2026-06-30',
      searchQueries: ['ARC Network mainnet'],
      entity: {
        canonicalName: 'ARC Network',
        aliases: ['ARC', 'ARC Network'],
        officialDomains: ['arc.io', 'circle.com'],
        avoidTerms: ['arc browser'],
        ambiguity: 'medium',
        rationale: 'Crypto category plus mainnet wording points to a blockchain project.',
      },
    },
    dynamic_sources: {
      articles: [
        {
          title: 'ARC Network official page',
          publisher: 'arc.io',
          url: 'https://arc.io/',
          summary: 'Arc L1 blockchain official page.',
          seen_at: '2026-06-15T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.doesNotMatch(
  arcLaunchPredmarketOmitsDefiLlamaSource.markdown,
  /defillama\.com\/chain\/Arc/i,
);

const predmarketMarkdownNormalizerStripsPromptLines = finalizeReportMarkdown({
  task: `research the prediction market topic: Who Will Win the FIFA World Cup 2026?
Listed outcomes in AgentFlow: France / Argentina / Brazil / Other.
Prediction market category in AgentFlow: Sports.
Prediction market provider in AgentFlow: achmarket.
Use the market category to disambiguate the subject before searching.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.`,
  writerMarkdown: `# research the prediction market topic: Who Will Win the FIFA World Cup 2026?
Listed outcomes in AgentFlow: France / Argentina / Brazil / Other.
Prediction market category in AgentFlow: Sports.
Prediction market provider in AgentFlow: achmarket.
Use the market category to disambiguate the subject before searching.
Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.

## Summary

Thin evidence.`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: '2026 FIFA World Cup official information',
          publisher: 'FIFA',
          url: 'https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026',
          summary: 'Tournament format and official information.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.doesNotMatch(
  predmarketMarkdownNormalizerStripsPromptLines.markdown,
  /\bresearch the prediction market topic:|Prediction market category in AgentFlow:|Prediction market provider in AgentFlow:|Listed outcomes in AgentFlow:/i,
);

const xautPredmarketRequiresUnderlyingEvidence = finalizeReportMarkdown({
  task: 'research the prediction market topic: Will Tether Gold (XAUT) reach $4,750 by July 31st?',
  writerMarkdown: `## Summary

XAUT may rise if momentum improves.

## Sources

- [CoinGecko](https://www.coingecko.com/en/coins/tether-gold) - live market data (accessed 2026-06-14)`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    coingecko: {
      assets: [{ coinId: 'tether-gold', last_updated_at: '2026-06-14T00:00:00.000Z' }],
    },
  },
});
assert.match(
  xautPredmarketRequiresUnderlyingEvidence.validationIssues.join('\n'),
  /underlying gold-market evidence/i,
);

const worldCupPredmarketRequiresProbabilityEvidence = finalizeReportMarkdown({
  task: 'research the prediction market topic: Who Will Win the FIFA World Cup 2026?',
  writerMarkdown: `## Summary

France, Argentina, and Brazil remain strong teams.

## Sources

- [FIFA](https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026) - tournament structure
- [Sporting News](https://www.sportingnews.com/us/soccer/news/world-cup-2026-schedule-teams/xyz) - schedule and teams`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'World Cup 2026 schedule and teams',
          publisher: 'Sporting News',
          url: 'https://www.sportingnews.com/us/soccer/news/world-cup-2026-schedule-teams/xyz',
          summary: 'Schedule and participating teams.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
        {
          title: '2026 FIFA World Cup official information',
          publisher: 'FIFA',
          url: 'https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026',
          summary: 'Tournament format and official information.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.match(
  worldCupPredmarketRequiresProbabilityEvidence.validationIssues.join('\n'),
  /odds or probability evidence/i,
);

const sportsPredmarketRetainsNonWhitelistedSources = finalizeReportMarkdown({
  task: 'research the prediction market topic: Who Will Win the FIFA World Cup 2026?',
  writerMarkdown: `## Summary

France, Argentina, and Brazil remain the main contenders.

## Sources

- [ESPN](https://www.espn.com/soccer/story/_/id/12345) - contender analysis
- [ABC News](https://abcnews.go.com/Sports/story?id=12345) - squad update
- [USA Today](https://www.usatoday.com/story/sports/soccer/2026/06/14/example/12345/) - tournament watch list`,
  research: null,
  analysis: null,
  liveData: {
    snapshot_at: '2026-06-14T00:00:00.000Z',
    dynamic_sources: {
      articles: [
        {
          title: 'Contender analysis',
          publisher: 'ESPN',
          url: 'https://www.espn.com/soccer/story/_/id/12345',
          summary: 'Team form analysis.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
        {
          title: 'Squad update',
          publisher: 'ABC News',
          url: 'https://abcnews.go.com/Sports/story?id=12345',
          summary: 'Roster and injury update.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
        {
          title: 'Tournament watch list',
          publisher: 'USA Today',
          url: 'https://www.usatoday.com/story/sports/soccer/2026/06/14/example/12345/',
          summary: 'Team watch list.',
          seen_at: '2026-06-14T00:00:00.000Z',
        },
      ],
    },
  },
});
assert.match(sportsPredmarketRetainsNonWhitelistedSources.markdown, /espn\.com\/soccer\/story/i);
assert.match(sportsPredmarketRetainsNonWhitelistedSources.markdown, /abcnews\.go\.com\/sports/i);
assert.match(sportsPredmarketRetainsNonWhitelistedSources.markdown, /usatoday\.com\/story\/sports\/soccer/i);

console.log('Before example:');
console.log(badWriterMarkdown.split('\n').slice(0, 12).join('\n'));
console.log('\nAfter example:');
console.log(finalized.markdown.split('\n').slice(0, 26).join('\n'));
console.log('\nReport pipeline regression checks passed.');
