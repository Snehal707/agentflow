CREATE TABLE IF NOT EXISTS agent_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id varchar NOT NULL UNIQUE,
  request_id varchar NOT NULL,
  wallet_address varchar NOT NULL,
  agent_slug varchar NOT NULL,
  erc8004_agent_id varchar NOT NULL,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  score smallint NOT NULL CHECK (score BETWEEN 20 AND 100 AND score = stars * 20),
  settlement_ref varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed')),
  reputation_tx varchar,
  failure_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  feedback_hash varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_ratings_agent_status
  ON agent_ratings (agent_slug, status);

CREATE INDEX IF NOT EXISTS idx_agent_ratings_wallet_created
  ON agent_ratings (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_ratings_request_id
  ON agent_ratings (request_id);

ALTER TABLE agent_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_ratings_own_rows ON agent_ratings;
CREATE POLICY agent_ratings_own_rows ON agent_ratings
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());
