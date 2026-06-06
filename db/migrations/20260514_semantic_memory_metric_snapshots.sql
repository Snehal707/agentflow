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
