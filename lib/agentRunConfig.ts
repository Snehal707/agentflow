import { resolveAgentRunUrl } from './a2a-followups';

function parsePrice(input: string | undefined, fallback: string): string {
  return `$${(Number(input || fallback) || Number(fallback)).toFixed(3)}`;
}

/** Match server.ts PORTFOLIO_URL + portfolioPrice for A2A follow-ups. */
export const PORTFOLIO_AGENT_RUN_URL = resolveAgentRunUrl(
  process.env.PORTFOLIO_AGENT_URL?.trim(),
  'http://127.0.0.1:3014/run',
);

export const PORTFOLIO_AGENT_PRICE_LABEL = parsePrice(process.env.PORTFOLIO_AGENT_PRICE, '0.015');
