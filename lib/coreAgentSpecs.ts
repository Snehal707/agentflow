// Pure, side-effect-free definition of the core agent specs (no DB / express
// imports) so it can be imported by guards/scripts and by api/agent-store.ts
// without booting the Supabase/Redis clients.

export type CoreAgentSlug =
  | 'research'
  | 'swap'
  | 'vault'
  | 'predmarket'
  | 'bridge'
  | 'portfolio'
  | 'invoice'
  | 'vision'
  | 'transcribe'
  | 'schedule'
  | 'split'
  | 'batch';

export type CoreAgentSpec = {
  slug: CoreAgentSlug;
  name: string;
  description: string;
  category: string;
  envPriceKey: string;
  fallbackPrice: number;
};

export const CORE_AGENT_SPECS: CoreAgentSpec[] = [
  {
    slug: 'research',
    name: 'Research',
    description:
      'Three-stage research pipeline: Research gathers live evidence, Analyst interprets it, and Writer delivers the final report.',
    category: 'Research',
    envPriceKey: 'RESEARCH_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'swap',
    name: 'Swap',
    description: 'Quotes and executes live Arc USDC swap flows with guardrails and verification.',
    category: 'DeFi',
    envPriceKey: 'SWAP_AGENT_PRICE',
    fallbackPrice: 0.01,
  },
  {
    slug: 'vault',
    name: 'Vault',
    description: 'Multi-protocol yield vaults. Currently: Lunex (testnet, experimental). More providers coming.',
    category: 'DeFi',
    envPriceKey: 'VAULT_AGENT_PRICE',
    fallbackPrice: 0.012,
  },
  {
    slug: 'predmarket',
    name: 'Prediction Markets',
    description:
      'Multi-protocol prediction markets. Currently: AchMarket (testnet, experimental). LMSR pricing, admin-resolved with public proof. More providers coming.',
    category: 'DeFi',
    envPriceKey: 'PREDMARKET_AGENT_PRICE',
    fallbackPrice: 0.012,
  },
  {
    slug: 'bridge',
    name: 'Bridge',
    description: 'Bridges USDC into Arc and streams CCTP progress in real time.',
    category: 'DeFi',
    envPriceKey: 'BRIDGE_AGENT_PRICE',
    fallbackPrice: 0.009,
  },
  {
    slug: 'portfolio',
    name: 'Portfolio',
    description: 'Analyzes Arc wallet balances, positions, transfers, and PnL.',
    category: 'Analytics',
    envPriceKey: 'PORTFOLIO_AGENT_PRICE',
    fallbackPrice: 0.015,
  },
  {
    slug: 'invoice',
    name: 'Invoice',
    description: 'Automates invoice review, approvals, and business settlement flows.',
    category: 'Custom',
    envPriceKey: 'INVOICE_AGENT_PRICE',
    fallbackPrice: 0.025,
  },
  {
    slug: 'vision',
    name: 'Vision',
    description: 'Analyzes screenshots, images, text files, and single-page PDFs with Hermes-first reasoning.',
    category: 'Perception',
    envPriceKey: 'VISION_AGENT_PRICE',
    fallbackPrice: 0.004,
  },
  {
    slug: 'transcribe',
    name: 'Voice Input',
    description: 'Converts short voice notes into chat-ready text with guarded daily caps.',
    category: 'Perception',
    envPriceKey: 'TRANSCRIBE_AGENT_PRICE',
    fallbackPrice: 0,
  },
  {
    slug: 'schedule',
    name: 'Schedule Agent',
    description:
      'Creates and manages recurring USDC payments on Arc. Supports daily, weekly, and monthly automated schedules.',
    category: 'Payments',
    envPriceKey: 'SCHEDULE_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'split',
    name: 'Split Agent',
    description:
      'Splits USDC equally between 2-10 recipients in one command. Executes all transfers automatically on Arc.',
    category: 'Payments',
    envPriceKey: 'SPLIT_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'batch',
    name: 'Batch Agent',
    description:
      'Processes bulk USDC payments from CSV. Perfect for payroll, DAO distributions, and team payments up to 500 recipients.',
    category: 'Payments',
    envPriceKey: 'BATCH_AGENT_PRICE',
    fallbackPrice: 0.01,
  },
];
