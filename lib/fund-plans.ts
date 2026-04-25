import { adminDb } from '../db/client';

export type FundPlansTableName = 'fund_plans' | 'fund_subscriptions';
export type FundsPlanCountColumnName = 'plan_count' | 'subscriber_count';

let cachedFundPlansTableName: FundPlansTableName | null = null;
let cachedFundsPlanCountColumnName: FundsPlanCountColumnName | null = null;

export async function getFundPlansTableName(): Promise<FundPlansTableName> {
  if (cachedFundPlansTableName) {
    return cachedFundPlansTableName;
  }

  if (await tableExists('fund_plans')) {
    cachedFundPlansTableName = 'fund_plans';
    return cachedFundPlansTableName;
  }

  cachedFundPlansTableName = 'fund_subscriptions';
  return cachedFundPlansTableName;
}

export async function getFundsPlanCountColumnName(): Promise<FundsPlanCountColumnName> {
  if (cachedFundsPlanCountColumnName) {
    return cachedFundsPlanCountColumnName;
  }

  const { error } = await adminDb.from('funds').select('plan_count').limit(1);
  if (!error) {
    cachedFundsPlanCountColumnName = 'plan_count';
    return cachedFundsPlanCountColumnName;
  }

  if (isMissingFundsPlanCountColumnError(error.message)) {
    cachedFundsPlanCountColumnName = 'subscriber_count';
    return cachedFundsPlanCountColumnName;
  }

  throw new Error(error.message);
}

export function readFundPlanCount(row: Record<string, unknown>): number {
  return Number(row.plan_count ?? row.subscriber_count ?? 0);
}

async function tableExists(tableName: FundPlansTableName): Promise<boolean> {
  const { error } = await adminDb.from(tableName).select('id').limit(1);
  if (!error) {
    return true;
  }

  if (isMissingFundPlansTableError(error.message)) {
    return false;
  }

  throw new Error(error.message);
}

function isMissingFundsPlanCountColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the 'plan_count' column") ||
    normalized.includes("column funds.plan_count does not exist") ||
    normalized.includes('column "plan_count" does not exist')
  );
}

function isMissingFundPlansTableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table 'public.fund_plans'") ||
    normalized.includes('relation "fund_plans" does not exist')
  );
}
