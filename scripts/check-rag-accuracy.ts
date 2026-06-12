// RAG accuracy guard — pure (no DB / no network).
//
// Asserts that the hard-coded values in PRODUCT_KNOWLEDGE (prices, bridge source
// chains, usage caps) still match the actual source-of-truth constants in code.
// This is the self-policing check for the drift class that bit us with funding:
// someone changes a value in code but forgets to update the doc string.
//
// Run:  npx tsx scripts/check-rag-accuracy.ts   (exit 1 on any mismatch)

// NOTE: import only pure, side-effect-free modules here so this guard runs in CI
// without any secrets (no Supabase/Redis env). That is why prices come from
// lib/coreAgentSpecs and limits from lib/usageLimits, not api/agent-store or
// lib/ratelimit (both of which boot the DB client at import time).
import { PRODUCT_KNOWLEDGE } from '../lib/product-rag';
import { SUPPORTED_BRIDGE_SOURCES } from '../lib/bridge/supportedSources';
import { CORE_AGENT_SPECS } from '../lib/coreAgentSpecs';
import {
  VISION_DAILY_LIMIT_DEFAULT,
  TRANSCRIBE_DAILY_LIMIT_DEFAULT,
  PAY_PER_TASK_DAILY_LIMIT_DEFAULT,
  PAY_PER_TASK_MINUTE_LIMIT_DEFAULT,
} from '../lib/usageLimits';

const errors: string[] = [];

function docById(id: string): string {
  const doc = PRODUCT_KNOWLEDGE.find((d) => d.id === id);
  if (!doc) {
    errors.push(`RAG doc "${id}" is missing entirely.`);
    return '';
  }
  return [doc.title, doc.summary, ...doc.facts].join(' \n ').toLowerCase();
}

function expectIn(haystack: string, needle: string, context: string): void {
  if (!haystack.includes(needle.toLowerCase())) {
    errors.push(`${context}: expected to find "${needle}" in the RAG doc, but it was not present.`);
  }
}

// 1) Bridge source chains — count + every label, straight from the registry.
{
  const hay = docById('bridge-source-chains');
  expectIn(hay, `${SUPPORTED_BRIDGE_SOURCES.length} source chains`, 'Bridge chain count');
  for (const source of SUPPORTED_BRIDGE_SOURCES) {
    expectIn(hay, source.label, `Bridge chain "${source.label}"`);
  }
}

// 2) Per-agent prices — each of the 12 core agents, from CORE_AGENT_SPECS.
// (Display label differs from the slug in a few cases.)
{
  const hay = docById('pricing');
  const slugToDocLabel: Record<string, string> = {
    research: 'research',
    swap: 'swap',
    vault: 'vault',
    predmarket: 'prediction markets',
    bridge: 'bridge',
    portfolio: 'portfolio',
    invoice: 'invoice',
    vision: 'vision',
    transcribe: 'voice input',
    schedule: 'schedule',
    split: 'split',
    batch: 'batch',
  };
  for (const spec of CORE_AGENT_SPECS) {
    const label = slugToDocLabel[spec.slug];
    if (!label) {
      errors.push(`Pricing: no doc-label mapping for agent slug "${spec.slug}" — add it to this guard.`);
      continue;
    }
    const priceStr =
      spec.fallbackPrice === 0 ? '$0' : `$${spec.fallbackPrice.toFixed(3)}`;
    expectIn(hay, `${label} ${priceStr}`, `Price for "${spec.slug}"`);
  }
}

// 3) Usage caps & rate limits — from the real defaults.
{
  const hay = docById('limits-and-caps');
  expectIn(hay, `${PAY_PER_TASK_DAILY_LIMIT_DEFAULT} actions per wallet per day`, 'Pay-per-task daily limit');
  expectIn(hay, `${PAY_PER_TASK_MINUTE_LIMIT_DEFAULT} actions per wallet per minute`, 'Pay-per-task minute limit');
  expectIn(hay, `vision defaults to ${VISION_DAILY_LIMIT_DEFAULT} attachment`, 'Vision daily cap');
  expectIn(hay, `defaults to ${TRANSCRIBE_DAILY_LIMIT_DEFAULT} transcriptions`, 'Transcribe daily cap');
}

if (errors.length) {
  console.error(`\n[RAG_ACCURACY] FAILED — ${errors.length} mismatch(es):\n`);
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\nFix: update the relevant doc in lib/product-rag.ts (and the mirror in ' +
      'agentflow-frontend/lib/docsContent.ts), then re-run `npx tsx scripts/ingest-rag.ts`.\n',
  );
  process.exit(1);
}

console.log(
  '[RAG_ACCURACY] OK — bridge chains, agent prices, and usage caps in the RAG match the code constants.',
);
console.log(
  '  Note: analyst/writer pipeline prices use inline server.ts defaults and are not auto-guarded here.',
);
process.exit(0);
