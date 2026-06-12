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
  allowed_recipients text[],
  blocked_recipients text[],
  require_confirmation_above numeric,
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

CREATE TABLE IF NOT EXISTS semantic_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar NOT NULL,
  session_id varchar,
  memory_type varchar NOT NULL,
  category varchar,
  content text NOT NULL,
  structured jsonb DEFAULT '{}'::jsonb,
  keywords text[] DEFAULT '{}'::text[],
  source_user_message text,
  source_assistant_message text,
  confidence numeric DEFAULT 0.7,
  supersedes_id uuid,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_wallet_updated
  ON semantic_memories (wallet_address, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_wallet_type
  ON semantic_memories (wallet_address, memory_type);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_session
  ON semantic_memories (session_id);

CREATE TABLE IF NOT EXISTS semantic_memory_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_start timestamptz NOT NULL UNIQUE,
  granularity varchar NOT NULL DEFAULT '6h',
  total_events integer NOT NULL DEFAULT 0,
  writes_count integer NOT NULL DEFAULT 0,
  retrievals_count integer NOT NULL DEFAULT 0,
  profile_intent_mismatch_count integer NOT NULL DEFAULT 0,
  zero_result_recall_like_count integer NOT NULL DEFAULT 0,
  average_returned_count numeric DEFAULT 0,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_memory_metric_snapshots_bucket
  ON semantic_memory_metric_snapshots (bucket_start DESC);

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

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_unique_idx
ON invoices (invoice_number)
WHERE invoice_number IS NOT NULL;

-- Agent Store published agents
CREATE TABLE IF NOT EXISTS agent_store_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_wallet varchar NOT NULL,
  arc_handle varchar UNIQUE,
  agent_card_url varchar NOT NULL,
  agent_card_json jsonb,
  erc8004_token_id varchar,
  category varchar,
  publish_tx varchar,
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
  blocked_reason text,
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

