/**
 * HTTP health probes for agent microservices (A2A follow-ups should skip when down).
 */
import { checkHttpHealth, deriveHealthUrlFromRunUrl } from './x402Health';

/** Default listen ports when no *_AGENT_URL is set (local dev). */
export const AGENT_DEFAULT_PORTS: Record<string, number> = {
  research: 3001,
  analyst: 3002,
  writer: 3003,
  swap: 3011,
  vault: 3012,
  bridge: 3013,
  portfolio: 3014,
  invoice: 3015,
  vision: 3016,
  transcribe: 3017,
  schedule: 3018,
  split: 3019,
  batch: 3020,
};

type SlugConfig = { envUrl?: string; envPort?: string; defaultPort: number };

const SLUG_CONFIG: Record<string, SlugConfig> = {
  research: { envUrl: 'RESEARCH_AGENT_URL', envPort: 'RESEARCH_AGENT_PORT', defaultPort: 3001 },
  analyst: { envUrl: 'ANALYST_AGENT_URL', envPort: 'ANALYST_AGENT_PORT', defaultPort: 3002 },
  writer: { envUrl: 'WRITER_AGENT_URL', envPort: 'WRITER_AGENT_PORT', defaultPort: 3003 },
  swap: { envUrl: 'SWAP_AGENT_URL', envPort: 'SWAP_AGENT_PORT', defaultPort: 3011 },
  vault: { envUrl: 'VAULT_AGENT_URL', envPort: 'VAULT_AGENT_PORT', defaultPort: 3012 },
  bridge: { envUrl: 'BRIDGE_AGENT_URL', envPort: 'BRIDGE_AGENT_PORT', defaultPort: 3013 },
  portfolio: { envUrl: 'PORTFOLIO_AGENT_URL', envPort: 'PORTFOLIO_AGENT_PORT', defaultPort: 3014 },
  invoice: { envUrl: 'INVOICE_AGENT_URL', envPort: 'INVOICE_AGENT_PORT', defaultPort: 3015 },
  vision: { envUrl: 'VISION_AGENT_URL', envPort: 'VISION_AGENT_PORT', defaultPort: 3016 },
  transcribe: { envUrl: 'TRANSCRIBE_AGENT_URL', envPort: 'TRANSCRIBE_AGENT_PORT', defaultPort: 3017 },
  schedule: { envUrl: 'SCHEDULE_AGENT_URL', envPort: 'SCHEDULE_AGENT_PORT', defaultPort: 3018 },
  split: { envUrl: 'SPLIT_AGENT_URL', envPort: 'SPLIT_AGENT_PORT', defaultPort: 3019 },
  batch: { envUrl: 'BATCH_AGENT_URL', envPort: 'BATCH_AGENT_PORT', defaultPort: 3020 },
};

function resolveAgentRunUrl(configured: string | undefined, fallback: string): string {
  const value = (configured || fallback).trim();
  try {
    const url = new URL(value);
    url.pathname = url.pathname.endsWith('/run')
      ? url.pathname
      : `${url.pathname.replace(/\/+$/, '') || ''}/run`;
    return url.toString();
  } catch {
    return value.endsWith('/run') ? value : `${value.replace(/\/+$/, '')}/run`;
  }
}

/** Canonical `/run` URL for an agent slug (env overrides local default). */
export function getAgentRunUrl(slug: string): string {
  const key = slug.toLowerCase();
  const c = SLUG_CONFIG[key];
  if (!c) {
    return resolveAgentRunUrl(undefined, 'http://127.0.0.1:4000/run');
  }
  const fromEnv = c.envUrl ? process.env[c.envUrl]?.trim() : undefined;
  const port = Number(process.env[c.envPort ?? '']?.trim() || c.defaultPort);
  return resolveAgentRunUrl(fromEnv, `http://127.0.0.1:${port}/run`);
}

export function getAgentHealthUrl(slug: string): string {
  return deriveHealthUrlFromRunUrl(getAgentRunUrl(slug));
}

export async function isAgentHealthy(slug: string, timeoutMs = 2000): Promise<boolean> {
  const url = getAgentHealthUrl(slug);
  const r = await checkHttpHealth(url, timeoutMs);
  return r.ok;
}
