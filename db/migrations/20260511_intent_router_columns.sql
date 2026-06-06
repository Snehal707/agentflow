ALTER TABLE brain_events
  ADD COLUMN IF NOT EXISTS llm_intent_json jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validator_passed boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS final_intent text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS layer_used text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fastpath_confidence double precision DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS experiment_variant text DEFAULT NULL;

COMMENT ON COLUMN brain_events.llm_intent_json IS
  'Structured AgentFlowIntent JSON from Tier 2 classifier, null if fastpath or Hermes handled';
COMMENT ON COLUMN brain_events.validator_passed IS
  'True if validator returned ok=true, false if hard fail, null if not classified';
COMMENT ON COLUMN brain_events.final_intent IS
  'Final routed intent string e.g. predmarket.list, or null if Hermes handled';
COMMENT ON COLUMN brain_events.layer_used IS
  'fastpath | intent_router | hermes_agent — which tier handled this message';
COMMENT ON COLUMN brain_events.fastpath_confidence IS
  'Confidence score if Tier 1 fastpath matched, null otherwise';
COMMENT ON COLUMN brain_events.experiment_variant IS
  'A/B variant identifier for routing experiments, null if not in experiment';
