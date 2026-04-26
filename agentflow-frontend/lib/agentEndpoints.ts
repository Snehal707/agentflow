const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export const agentUpstreamRunUrlBySlug: Record<string, string> = {
  ascii: `${normalizeBaseUrl(BACKEND)}/agent/ascii/run`,
  research: `${normalizeBaseUrl(BACKEND)}/agent/research/run`,
  analyst: `${normalizeBaseUrl(BACKEND)}/agent/analyst/run`,
  writer: `${normalizeBaseUrl(BACKEND)}/agent/writer/run`,
  swap: `${normalizeBaseUrl(
    process.env.SWAP_AGENT_URL ||
      process.env.NEXT_PUBLIC_SWAP_AGENT_URL ||
      "http://127.0.0.1:3011",
  )}/run`,
  vault: `${normalizeBaseUrl(
    process.env.VAULT_AGENT_URL ||
      process.env.NEXT_PUBLIC_VAULT_AGENT_URL ||
      "http://127.0.0.1:3012",
  )}/run`,
  bridge: `${normalizeBaseUrl(
    process.env.BRIDGE_AGENT_URL ||
      process.env.NEXT_PUBLIC_BRIDGE_AGENT_URL ||
      "http://127.0.0.1:3013",
  )}/run`,
  portfolio: `${normalizeBaseUrl(
    process.env.PORTFOLIO_AGENT_URL ||
      process.env.NEXT_PUBLIC_PORTFOLIO_AGENT_URL ||
      "http://127.0.0.1:3014",
  )}/run`,
  invoice: `${normalizeBaseUrl(
    process.env.INVOICE_AGENT_URL ||
      process.env.NEXT_PUBLIC_INVOICE_AGENT_URL ||
      "http://127.0.0.1:3015",
  )}/run`,
  vision: `${normalizeBaseUrl(
    process.env.VISION_AGENT_URL ||
      process.env.NEXT_PUBLIC_VISION_AGENT_URL ||
      "http://127.0.0.1:3016",
  )}/run`,
  transcribe: `${normalizeBaseUrl(
    process.env.TRANSCRIBE_AGENT_URL ||
      process.env.NEXT_PUBLIC_TRANSCRIBE_AGENT_URL ||
      "http://127.0.0.1:3017",
  )}/run`,
};

export function getAgentRunUrl(slug: string): string {
  const normalized = slug.toLowerCase();
  if (!agentUpstreamRunUrlBySlug[normalized]) {
    throw new Error(`Unknown agent slug: ${slug}`);
  }
  return `/api/agents/${normalized}`;
}

export function getAgentUpstreamRunUrl(slug: string): string {
  const normalized = slug.toLowerCase();
  const url = agentUpstreamRunUrlBySlug[normalized];
  if (!url) {
    throw new Error(`Unknown agent slug: ${slug}`);
  }
  return url;
}

export const defaultPriceBySlug: Record<string, string> = {
  ascii: process.env.NEXT_PUBLIC_ASCII_AGENT_PRICE || "0.001",
  research: "0.005",
  analyst: "0.003",
  writer: "0.008",
  swap: "0.010",
  vault: "0.012",
  bridge: "0.009",
  portfolio: "0.015",
  invoice: "0.025",
  vision: process.env.NEXT_PUBLIC_VISION_AGENT_PRICE || "0.004",
  transcribe: process.env.NEXT_PUBLIC_TRANSCRIBE_AGENT_PRICE || "0.002",
};

export { BACKEND };
