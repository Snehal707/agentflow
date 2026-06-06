-- Rename the Agent Store persistence surface away from the old store table.
-- Existing deployments can keep reading the legacy table until this migration is applied.

CREATE TABLE IF NOT EXISTS agent_store_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_wallet varchar NOT NULL,
  arc_handle varchar UNIQUE,
  agent_card_url varchar NOT NULL,
  agent_card_json jsonb,
  erc8004_token_id varchar,
  category varchar,
  publish_tx varchar,
  status varchar DEFAULT 'pending',
  created_at timestamp DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.marketplace_agents') IS NOT NULL THEN
    EXECUTE $copy$
      INSERT INTO agent_store_agents (
        id,
        dev_wallet,
        arc_handle,
        agent_card_url,
        agent_card_json,
        erc8004_token_id,
        category,
        status,
        created_at
      )
      SELECT
        id,
        dev_wallet,
        arc_handle,
        agent_card_url,
        agent_card_json,
        erc8004_token_id,
        category,
        status,
        created_at
      FROM marketplace_agents
      ON CONFLICT (id) DO NOTHING
    $copy$;
  END IF;
END $$;
