BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fund_subscriptions') IS NOT NULL
     AND to_regclass('public.fund_plans') IS NULL THEN
    EXECUTE 'ALTER TABLE public.fund_subscriptions RENAME TO fund_plans';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funds'
      AND column_name = 'subscriber_count'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funds'
      AND column_name = 'plan_count'
  ) THEN
    EXECUTE 'ALTER TABLE public.funds RENAME COLUMN subscriber_count TO plan_count';
  END IF;
END $$;

ALTER TABLE public.funds ADD COLUMN IF NOT EXISTS plan_count integer DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funds'
      AND column_name = 'subscriber_count'
  ) THEN
    EXECUTE '
      UPDATE public.funds
      SET plan_count = COALESCE(plan_count, subscriber_count, 0)
      WHERE plan_count IS NULL OR plan_count = 0
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'fund_subscriptions'
      AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW public.fund_subscriptions';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.fund_plans') IS NOT NULL
     AND to_regclass('public.fund_subscriptions') IS NULL THEN
    EXECUTE 'CREATE VIEW public.fund_subscriptions AS SELECT * FROM public.fund_plans';
  END IF;
END $$;

COMMIT;
