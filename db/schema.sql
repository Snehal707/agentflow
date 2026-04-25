-- AgentFlow V3 — Phase 1 schema
-- Apply in Supabase SQL editor or via `psql`.
-- Requires gen_random_uuid() (pgcrypto).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar UNIQUE NOT NULL,
  arc_handle varchar UNIQUE,
  max_per_transaction numeric, -- optional per-user tx limit in USDC
  max_per_day numeric,         -- optional per-user daily limit in USDC
  training_consent boolean DEFAULT false,
  yield_monitoring boolean DEFAULT false,
  telegram_id varchar,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  wallet_address varchar PRIMARY KEY,
  display_name varchar,
  preferences jsonb DEFAULT '{}'::jsonb,
  memory_notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id varchar UNIQUE NOT NULL,     -- Circle wallet ID
  address varchar UNIQUE NOT NULL,       -- Arc wallet address
  wallet_set_id varchar NOT NULL,
  purpose varchar NOT NULL,              -- owner/validator/user_agent/treasury
  agent_slug varchar,
  user_wallet varchar,
  erc8004_token_id varchar,              -- ERC-8004 IdentityRegistry token id (agent id)
  blockchain varchar DEFAULT 'ARC-TESTNET',
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_daily (
  wallet_address varchar NOT NULL,
  date date NOT NULL,
  agent_slug varchar NOT NULL,
  count integer DEFAULT 0,
  PRIMARY KEY (wallet_address, date, agent_slug)
);

CREATE TABLE IF NOT EXISTS arc_handles (
  handle varchar PRIMARY KEY,
  wallet_address varchar UNIQUE NOT NULL,
  handle_type varchar, -- consumer/business/agent
  verified boolean DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS businesses (
  wallet_address varchar PRIMARY KEY,
  business_name varchar NOT NULL,
  invoice_email varchar UNIQUE,
  telegram_id varchar,
  auto_settle_below numeric DEFAULT 100,
  require_approval_above numeric DEFAULT 500,
  daily_settlement_cap numeric DEFAULT 1000,
  trusted_vendors text[],
  blocked_vendors text[],
  require_dual_approval boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_wallet varchar NOT NULL,
  vendor_name varchar,
  vendor_email varchar,
  vendor_handle varchar,
  amount numeric NOT NULL,
  currency varchar DEFAULT 'USDC',
  invoice_number varchar,
  line_items jsonb,
  status varchar DEFAULT 'pending',
  arc_tx_id varchar,
  created_at timestamp DEFAULT now(),
  settled_at timestamp
);

-- Agent Store listings (published agents; table name retained for compatibility)
CREATE TABLE IF NOT EXISTS marketplace_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_wallet varchar NOT NULL,
  arc_handle varchar UNIQUE,
  agent_card_url varchar NOT NULL,
  agent_card_json jsonb,
  erc8004_token_id varchar,
  category varchar,
  listing_fee_tx varchar,
  status varchar DEFAULT 'pending', -- pending/active/suspended
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet varchar NOT NULL,
  to_wallet varchar NOT NULL,
  amount numeric NOT NULL,
  arc_tx_id varchar UNIQUE,
  agent_slug varchar,
  invoice_id uuid,
  action_type varchar, -- swap/vault_deposit/bridge/dca/withdraw/agent_to_agent_payment
  status varchar DEFAULT 'pending',
  remark text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet varchar NOT NULL,
  to_wallet varchar NOT NULL,
  amount numeric NOT NULL,
  remark text,
  status varchar DEFAULT 'pending',
  initiated_by varchar,
  created_at timestamp DEFAULT now(),
  expires_at timestamp DEFAULT (now() + interval '48 hours'),
  paid_at timestamp,
  arc_tx_id varchar
);

-- Recurring USDC sends (DCW); processed by cron worker (production)
CREATE TABLE IF NOT EXISTS scheduled_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar NOT NULL,
  to_address varchar NOT NULL,
  to_name varchar,
  amount numeric NOT NULL,
  remark text,
  schedule_type varchar NOT NULL,
  schedule_value varchar NOT NULL,
  next_run date NOT NULL,
  last_run date,
  status varchar DEFAULT 'active',
  created_at timestamp DEFAULT now(),
  execution_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reputation_cache (
  agent_address varchar PRIMARY KEY,
  score integer DEFAULT 0,
  total_calls integer DEFAULT 0,
  last_updated timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar NOT NULL,
  agent_slug varchar NOT NULL,
  user_input text,
  agent_output text,
  subagent_trace jsonb,
  wallet_context jsonb,
  execution_ms integer,
  user_feedback smallint,
  was_retried boolean DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extension_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar NOT NULL,
  page_url varchar NOT NULL,
  user_question text NOT NULL,
  fetched_content text,
  wallet_context jsonb,
  analysis_output text,
  user_feedback smallint,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_training_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_type varchar NOT NULL, -- pdf/image/email
  raw_input_url varchar,
  extracted_json jsonb,
  human_corrected jsonb,
  was_correct boolean,
  created_at timestamp DEFAULT now()
);

-- Cron job cursors / metadata (Phase 7)
CREATE TABLE IF NOT EXISTS cron_state (
  job_key text PRIMARY KEY,
  last_run_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Idempotent migration for databases created before erc8004_token_id existed
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS erc8004_token_id varchar;
ALTER TABLE users DROP COLUMN IF EXISTS tier;
ALTER TABLE users ADD COLUMN IF NOT EXISTS yield_monitoring boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_per_transaction numeric;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_per_day numeric;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_name varchar;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS remark text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_rail varchar DEFAULT 'arc_usdc';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_agent varchar;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seller_agent varchar;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_id varchar;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gateway_transfer_id varchar;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_request_id uuid REFERENCES payment_requests(id);

CREATE TABLE IF NOT EXISTS funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  description text,
  strategy_type varchar NOT NULL,
  creator_wallet varchar,
  min_deposit numeric DEFAULT 1,
  estimated_apy numeric DEFAULT 0,
  risk_level varchar DEFAULT 'low',
  is_active boolean DEFAULT true,
  plan_count integer DEFAULT 0,
  total_value_locked numeric DEFAULT 0,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet varchar NOT NULL,
  fund_id uuid NOT NULL REFERENCES funds(id),
  amount numeric NOT NULL,
  status varchar DEFAULT 'active',
  started_at timestamp DEFAULT now(),
  last_run_at timestamp,
  next_run_at timestamp
);

INSERT INTO funds (name, description, strategy_type, min_deposit, estimated_apy, risk_level)
SELECT 'Weekly DCA Vault', 'Automatically deposits USDC into vault every Monday', 'dca_vault', 5, 5.0, 'low'
WHERE NOT EXISTS (SELECT 1 FROM funds WHERE strategy_type = 'dca_vault');

INSERT INTO funds (name, description, strategy_type, min_deposit, estimated_apy, risk_level)
SELECT 'Yield Optimizer', 'Monitors and auto-compounds vault APY every 6 hours', 'auto_compound', 10, 6.5, 'low'
WHERE NOT EXISTS (SELECT 1 FROM funds WHERE strategy_type = 'auto_compound');

INSERT INTO funds (name, description, strategy_type, min_deposit, estimated_apy, risk_level)
SELECT 'Research Alerts', 'Daily intelligence on DeFi, stablecoins, AI crypto, security alerts, macro markets, and Circle ecosystem — delivered to Telegram', 'research_monitor', 1, 0, 'none'
WHERE NOT EXISTS (SELECT 1 FROM funds WHERE strategy_type = 'research_monitor');
