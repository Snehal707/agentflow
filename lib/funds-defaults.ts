export type CanonicalFundRow = {
  id: string;
  name: string;
  description: string;
  strategy_type: string;
  creator_wallet: string | null;
  min_deposit: number;
  estimated_apy: number;
  risk_level: string;
  is_active: boolean;
  plan_count: number;
  total_value_locked: number;
  created_at: string;
};

export const CANONICAL_FUNDS: CanonicalFundRow[] = [
  {
    id: '00000000-0000-0000-0000-000000000101',
    name: 'Weekly DCA Vault',
    description: 'Automatically deposits USDC into vault every Monday',
    strategy_type: 'dca_vault',
    creator_wallet: null,
    min_deposit: 5,
    estimated_apy: 5.0,
    risk_level: 'low',
    is_active: true,
    plan_count: 0,
    total_value_locked: 0,
    created_at: new Date(0).toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000102',
    name: 'Yield Optimizer',
    description: 'Monitors and auto-compounds vault APY every 6 hours',
    strategy_type: 'auto_compound',
    creator_wallet: null,
    min_deposit: 10,
    estimated_apy: 6.5,
    risk_level: 'low',
    is_active: true,
    plan_count: 0,
    total_value_locked: 0,
    created_at: new Date(0).toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000103',
    name: 'Research Alerts',
    description:
      'Daily intelligence on DeFi, stablecoins, AI crypto, security alerts, macro markets, and Circle ecosystem - delivered to Telegram',
    strategy_type: 'research_monitor',
    creator_wallet: null,
    min_deposit: 1,
    estimated_apy: 0,
    risk_level: 'none',
    is_active: true,
    plan_count: 0,
    total_value_locked: 0,
    created_at: new Date(0).toISOString(),
  },
];

export const CANONICAL_FUND_IDS = CANONICAL_FUNDS.map((f) => f.id);
