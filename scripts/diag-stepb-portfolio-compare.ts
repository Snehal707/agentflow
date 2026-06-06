/**
 * Step B diagnostics: compare chat-like executeDcw (no caller body) vs slug-like ({})
 * Logs appear in this process. Run:
 *   npx tsx --env-file=.env scripts/diag-stepb-portfolio-compare.ts
 *
 * HTTP /api/dcw path logs only on server stdout — use curl separately if needed.
 */
import { randomUUID } from 'crypto';
import '../lib/loadEnv';
import { ARC } from '../lib/arc-config';
import { resolveAgentRunUrl } from '../lib/a2a-followups';
import { executeDcwPaidAgentViaX402 } from '../lib/paidAgentX402';

const PORTFOLIO = Number(process.env.PORTFOLIO_AGENT_PORT || 3014);
const PORTFOLIO_URL = resolveAgentRunUrl(
  process.env.PORTFOLIO_AGENT_URL?.trim(),
  `http://127.0.0.1:${PORTFOLIO}/run`,
);

function parsePriceUsdLabel(input: string | undefined, fallback: string): string {
  const n = Number((input ?? fallback).trim());
  return `$${(Number.isFinite(n) ? n : Number(fallback)).toFixed(3)}`;
}

const portfolioPrice = parsePriceUsdLabel(process.env.PORTFOLIO_AGENT_PRICE, '0.015');
const slugPrice = `${portfolioPrice} USDC`;

async function main(): Promise<void> {
  const wa = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!wa) {
    throw new Error('TEST_WALLET_ADDRESS is required');
  }

  console.log('\n=== A: chat-like (omit body; matches chat portfolio invocation) ===\n');
  try {
    await executeDcwPaidAgentViaX402({
      userWalletAddress: wa,
      agent: 'portfolio',
      price: portfolioPrice,
      url: PORTFOLIO_URL,
      requestId: `stepB_chatlike_${randomUUID()}`,
    });
    console.log('[stepB] chat-like: SUCCESS');
  } catch (e) {
    console.log('[stepB] chat-like: FAILED', e instanceof Error ? e.message : e);
  }

  console.log('\n=== B: slug-like (explicit body {} plus DCW slug price label) ===\n');
  try {
    await executeDcwPaidAgentViaX402({
      userWalletAddress: wa,
      agent: 'portfolio',
      price: slugPrice,
      url: PORTFOLIO_URL,
      body: {},
      requestId: `stepB_sluglike_${randomUUID()}`,
    });
    console.log('[stepB] slug-like: SUCCESS');
  } catch (e) {
    console.log('[stepB] slug-like: FAILED', e instanceof Error ? e.message : e);
  }

  console.log(
    [
      `\n=== C: HTTP POST (logs on backend process only) ===`,
      `curl -s http://127.0.0.1:4000/api/dcw/agents/portfolio/run \\`,
      `  -H "Authorization: Bearer <jwt>" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-agentflow-request-id: stepB_http_<uuid>" \\`,
      `  -d "{}"`,
      `\n(use generateJWT(TEST_WALLET_ADDRESS); watch server console for [x402Server diag])`,
      `\nARC.chainId=${ARC.chainId}`,
    ].join('\n'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
