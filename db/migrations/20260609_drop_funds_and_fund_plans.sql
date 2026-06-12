-- Remove the Funds / DCA feature (recurring fund plans).
-- The product is pay-per-task only; the Funds UI, API (api/funds.ts),
-- fund-plans/funds-defaults libs, and the research_monitor daily-report path
-- were all removed. This drops the now-orphaned tables and the backward-compat
-- view in the correct dependency order. Idempotent and safe to re-run.

BEGIN;

-- 1) Backward-compat view created by 20260421_rename_fund_subscriptions_to_fund_plans.sql
DROP VIEW IF EXISTS public.fund_subscriptions;

-- 2) Child table (has a FK to funds) before the parent.
DROP TABLE IF EXISTS public.fund_plans;

-- 3) Parent table.
DROP TABLE IF EXISTS public.funds;

COMMIT;
