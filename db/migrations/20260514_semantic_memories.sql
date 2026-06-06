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

ALTER TABLE semantic_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS semantic_memories_own_rows ON semantic_memories;
CREATE POLICY semantic_memories_own_rows ON semantic_memories
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());
