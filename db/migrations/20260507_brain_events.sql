CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.agentflow_auth_wallet()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(coalesce(
    auth.jwt() ->> 'wallet_address',
    auth.jwt() ->> 'walletAddress'
  ));
$$;

CREATE TABLE IF NOT EXISTS brain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  wallet_address text NOT NULL,
  created_at timestamp DEFAULT now(),
  user_input text,
  intent_label text,
  intent_source text CHECK (intent_source IN ('fastpath', 'hermes', 'unclear') OR intent_source IS NULL),
  tools_called jsonb DEFAULT '[]'::jsonb,
  hermes_model text CHECK (hermes_model IN ('fast', 'deep') OR hermes_model IS NULL),
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10, 6),
  total_latency_ms int,
  final_response_summary text,
  outcome text CHECK (
    outcome IN (
      'success',
      'hallucination_detected',
      'timeout',
      'tool_error',
      'validation_error',
      'user_cancel',
      'guard_blocked',
      'gibberish_rejected',
      'turn_cap_hit',
      'stale_state_blocked',
      'low_confidence_clarify'
    )
    OR outcome IS NULL
  ),
  failure_reason text,
  user_feedback text CHECK (user_feedback IN ('positive', 'negative') OR user_feedback IS NULL),
  feedback_note text,
  user_correction text,
  research_trajectory jsonb
);

ALTER TABLE brain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_events_own_rows ON brain_events;
CREATE POLICY brain_events_own_rows ON brain_events
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

CREATE INDEX IF NOT EXISTS brain_events_wallet_created_idx
  ON brain_events (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS brain_events_outcome_idx
  ON brain_events (outcome);

CREATE INDEX IF NOT EXISTS brain_events_intent_label_idx
  ON brain_events (intent_label);
