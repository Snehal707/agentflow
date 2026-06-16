import '../lib/loadEnv';
import { fetchLiveData } from '../lib/live-data';

// Standalone gate diagnostic. Calls fetchLiveData directly (same understanding + Firecrawl +
// SearXNG + entity gate the chat path uses) but starts NO server, so there is no payment/agent
// noise and no EADDRINUSE. Answers conclusively, per market: did the SEARCH return little
// (engine-thin) or did the ENTITY GATE reject a lot (gate too strict)?
//
// Run: RESEARCH_GATE_TRACE=1 npx tsx scripts/debug-predmarket-gate.ts
// Watch for the "[research][gate] ... candidates=N kept=K rejected=R rejectedHosts=..." line
// printed during each case, then compare it to the POST-PIPELINE article count below.

process.env.RESEARCH_GATE_TRACE = process.env.RESEARCH_GATE_TRACE || '1';

function predmarketPrompt(question: string, category: string): string {
  return [
    `research the prediction market topic: ${question}`,
    'Listed outcomes in AgentFlow: Yes / No.',
    `Prediction market category in AgentFlow: ${category}.`,
    'Prediction market provider in AgentFlow: achmarket.',
    'Use the market category to disambiguate the subject before searching. For example: crypto markets should be researched as crypto/blockchain topics, sports markets as teams/tournaments, and macro/commodity markets by their real-world underlying drivers.',
    'Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.',
  ].join('\n');
}

const cases: Array<{ id: string; expectation: string; task: string }> = [
  {
    id: 'monad (target: should WIDEN)',
    expectation: 'real-but-obscure crypto launch — want kept >> 1',
    task: predmarketPrompt('Will Monad mainnet launch before December 31, 2026?', 'Crypto'),
  },
  {
    id: 'zynq (control: should STAY THIN)',
    expectation: 'fake market — kept should be ~0, no Xilinx/quantum re-admission',
    task: predmarketPrompt('Will ZYNQ Protocol launch QuantumNet before September 30, 2026?', 'Crypto'),
  },
  {
    id: 'ada (control: should STAY THIN, no curacao)',
    expectation: 'ambiguous ticker — Cardano-only, no homonym drift',
    task: predmarketPrompt('Will ADA reach $2.50 before September 30, 2026?', 'Crypto'),
  },
];

async function run(): Promise<void> {
  for (const testCase of cases) {
    console.log(`\n================ ${testCase.id} ================`);
    console.log(`expectation: ${testCase.expectation}`);
    const startedAt = Date.now();
    try {
      const raw = await fetchLiveData(testCase.task, { originalTask: testCase.task });
      const payload = raw.trim() ? (JSON.parse(raw) as Record<string, any>) : {};
      const understanding = payload.prediction_market_understanding;
      const articles: Array<Record<string, any>> = payload?.dynamic_sources?.articles ?? [];

      console.log(`elapsed_ms=${Date.now() - startedAt}`);
      console.log('resolved entity:', JSON.stringify(understanding?.entity ?? null));
      console.log(`POST-PIPELINE dynamic_sources.articles (web search) = ${articles.length}`);
      for (const article of articles) {
        console.log(`  - ${article.publisher || article.title || '?'}  ${article.url || ''}`);
      }
      // Structured market data is allowlist-gated (pickCoinTargets / pickChainTargets). If the
      // asset isn't in COIN_KEYWORDS it falls back to BTC/ETH/SOL — confirm whether the
      // "CoinGecko/DefiLlama" sources are real for this market or generic fallback noise.
      const coinAssets: Array<Record<string, any>> = payload?.coingecko?.assets ?? [];
      const defiChains: Array<Record<string, any>> = payload?.defillama?.chains ?? [];
      console.log(
        `STRUCTURED coingecko=[${coinAssets.map((a) => a.symbol || a.coinId).join(',')}] defillama=[${defiChains
          .map((c) => c.chain)
          .join(',')}]  <- is this the asset, or generic BTC/ETH/SOL fallback?`,
      );
      console.log('source_diagnostics:', JSON.stringify(payload?.source_diagnostics ?? null));
    } catch (error) {
      console.log('FAILED:', error instanceof Error ? error.message : String(error));
    }
  }
}

void run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
