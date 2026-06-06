CREATE TABLE IF NOT EXISTS agent_economy_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id varchar UNIQUE,
  buyer_wallet varchar NOT NULL,
  seller_wallet varchar NOT NULL,
  buyer_agent varchar NOT NULL,
  seller_agent varchar NOT NULL,
  amount numeric NOT NULL,
  currency varchar DEFAULT 'USDC',
  payment_rail varchar DEFAULT 'x402/gateway',
  x402_transaction_ref varchar,
  settlement_tx_hash varchar,
  arc_tx_id varchar,
  chain_id integer DEFAULT 5042002,
  status varchar DEFAULT 'complete',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_economy_ledger_created_at
  ON agent_economy_ledger (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_economy_ledger_agents
  ON agent_economy_ledger (buyer_agent, seller_agent);

CREATE INDEX IF NOT EXISTS idx_agent_economy_ledger_seller_agent
  ON agent_economy_ledger (seller_agent);
