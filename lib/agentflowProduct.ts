export const AGENTFLOW_CAPABILITY_BULLETS = [
  'Research-first workspace: any-topic reports, portfolio impact analysis, and prediction-market research.',
  'Product surfaces: chat workspace, agent store, AgentPay, portfolio + funds, execution wallet + Gateway, and Telegram continuity.',
  'AgentPay: send, request, split, batch, invoice, contacts, payment links, QR receive, and scheduled payments.',
  'Execution: prediction markets, swaps, provider vault flows, Bridge to Arc, balances, portfolio context, image analysis, and voice to text.',
] as const;

export const AGENTFLOW_CHAT_CAPABILITY_GUIDANCE = [
  'Keep AgentFlow product answers user-facing and short.',
  'Treat AgentFlow as a DCW-first chat app on Arc.',
  'Use the local landing-page product sections as source of truth: Research, Product Surfaces, Wallet Flow, AgentPay B2B, AgentPay C2B/C2C, AgentPay + Telegram, Intelligence Stack, Hermes Engine, Semantic Memory, and Trust.',
  'Do not mention removed or stale website sections such as Features, Solutions, Workspace, Protocol, or ASCII agent.',
  'Do not volunteer internal agent rosters, exact agent counts, hidden tools, or architecture unless the user explicitly asks for the technical map.',
  'Prediction markets are a first-class product surface alongside AgentPay, portfolio, swaps, vault, Bridge to Arc, and research.',
  'EOA is mainly the connected identity/signing wallet and is required for the bridge web flow source-chain signature. DCW / Agent wallet is the default execution wallet for normal in-chat actions.',
] as const;

export function isExplicitFullCapabilityRequest(message: string): boolean {
  return /\b(full\s+technical\s+map|full\s+capability\s+map|complete\s+capability\s+map|circle\s+stack|supported\s+bridge\s+source\s+chains?)\b/i.test(
    message,
  );
}

export function formatAgentFlowCapabilityReply(): string {
  return 'I can help with AgentPay payments, portfolio and funds, research, swaps, vaults, prediction markets, Bridge to Arc, image analysis, and voice notes. What do you want to do first?';
}

export function formatAgentFlowDefinitionReply(): string {
  return [
    'AgentFlow is a research-first app for payments, portfolio + funds, prediction markets, and guided onchain execution on Arc.',
    'The product surfaces are chat, agent store, AgentPay, portfolio + funds, execution wallet + Gateway, and Telegram continuity.',
  ].join(' ');
}

export function formatAgentFlowHowItWorksReply(): string {
  return [
    'You ask in plain language, and AgentFlow guides the right workflow for payments, research, portfolio, swaps, Bridge to Arc, provider vaults, and prediction markets.',
    'Before risky actions move funds, AgentFlow validates details and shows a preview.',
  ].join(' ');
}
