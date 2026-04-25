import assert from 'node:assert/strict';
import {
  collectPreferredReportSources,
  finalizeReportMarkdown,
} from '../lib/reportPipeline';

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

console.log('Before example:');
console.log(badWriterMarkdown.split('\n').slice(0, 12).join('\n'));
console.log('\nAfter example:');
console.log(finalized.markdown.split('\n').slice(0, 26).join('\n'));
console.log('\nReport pipeline regression checks passed.');
