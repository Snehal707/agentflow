import { Router } from 'express';
import { adminDb, getRedis } from '../db/client';
import { authMiddleware, type JWTPayload } from '../lib/auth';
import {
  getFundPlansTableName,
  getFundsPlanCountColumnName,
  readFundPlanCount,
} from '../lib/fund-plans';
import { CANONICAL_FUNDS, CANONICAL_FUND_IDS } from '../lib/funds-defaults';

const router = Router();
const FUNDS_CACHE_KEY = 'funds:list:v3';
const FUNDS_CACHE_TTL_SECONDS = 120;
const FUNDS_VAULT_APY_CACHE_KEY = 'funds:vault:apy';
const FUNDS_VAULT_APY_CACHE_TTL_SECONDS = 300;
const DEFAULT_FUNDS: Array<Record<string, unknown>> = CANONICAL_FUNDS;
const CANONICAL_FUND_ID_SET = new Set(CANONICAL_FUND_IDS);
const CANONICAL_FUND_ORDER = new Map(
  CANONICAL_FUNDS.map((row, index) => [fundDedupKey(row), index]),
);

router.get('/', async (_req, res) => {
  try {
    const cached = await getFundsCache();
    if (cached) {
      try {
        return res.json(JSON.parse(cached));
      } catch {
        await invalidateFundsCache();
      }
    }
    const liveVaultAPY = await getLiveVaultAPY();
    const livePlanStats = await getActivePlanStatsByFundId();

    const { data, error } = await adminDb
      .from('funds')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingFundsTableError(error.message)) {
        const fallback = buildFundResponseRows(DEFAULT_FUNDS, liveVaultAPY, livePlanStats);
        await setFundsCache(fallback);
        return res.json(fallback);
      }
      return res.status(500).json({ error: error.message });
    }

    const rows = buildFundResponseRows(
      (data ?? []).length ? (data ?? []) : DEFAULT_FUNDS,
      liveVaultAPY,
      livePlanStats,
    );
    await setFundsCache(rows);
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'fund list failed' });
  }
});

const startFundPlan = async (req: any, res: any) => {
  try {
    const auth = req.auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fundId = String(req.body?.fundId ?? '').trim();
    const amount = String(req.body?.amount ?? '').trim();
    if (!fundId) {
      return res.status(400).json({ error: 'fundId is required' });
    }
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ error: 'amount must be greater than 0' });
    }

    const { data: fundRow, error: fundError } = await adminDb
      .from('funds')
      .select('*')
      .eq('id', fundId)
      .eq('is_active', true)
      .maybeSingle();

    if (fundError) {
      return res.status(500).json({ error: fundError.message });
    }
    if (!fundRow) {
      return res.status(404).json({ error: 'Fund not found' });
    }

    const minDeposit = Number(fundRow.min_deposit ?? 0);
    if (Number.isFinite(minDeposit) && amountNumber < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit is ${minDeposit}` });
    }

    const relatedFunds = await findRelatedActiveFunds(fundRow);
    const relatedFundIds = relatedFunds.map((row) => String(row.id ?? '')).filter(Boolean);
    const targetFundRow = chooseRepresentativeFundRow(
      relatedFunds.length > 0 ? relatedFunds : [fundRow],
    );
    const fundPlansTable = await getFundPlansTableName();
    const planCountColumn = await getFundsPlanCountColumnName();

    const { data: existingPlan, error: existingError } = await adminDb
      .from(fundPlansTable)
      .select('*')
      .eq('user_wallet', auth.walletAddress)
      .eq('status', 'active')
      .in('fund_id', relatedFundIds.length > 0 ? relatedFundIds : [fundId])
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }
    if (existingPlan) {
      return res.status(409).json({ error: 'A plan is already active for this fund' });
    }

    const { data: insertedPlan, error: insertError } = await adminDb
      .from(fundPlansTable)
      .insert({
        user_wallet: auth.walletAddress,
        fund_id: String(targetFundRow.id ?? fundId),
        amount: amountNumber,
        status: 'active',
      })
      .select('*')
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    const nextPlanCount = readFundPlanCount(targetFundRow) + 1;
    const nextTvl = Number(targetFundRow.total_value_locked ?? 0) + amountNumber;
    const { error: updateError } = await adminDb
      .from('funds')
      .update({
        [planCountColumn]: nextPlanCount,
        total_value_locked: nextTvl,
      })
      .eq('id', String(targetFundRow.id ?? fundId));

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await invalidateFundsCache();

    return res.json({
      planId: insertedPlan.id,
      fund: normalizeFundRow({
        ...targetFundRow,
        plan_count: nextPlanCount,
        total_value_locked: nextTvl,
      }),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'fund plan start failed' });
  }
};

router.post('/plans/start', authMiddleware, startFundPlan);

const stopFundPlan = async (req: any, res: any) => {
  try {
    const auth = req.auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const planId = String(req.body?.planId ?? '').trim();
    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const fundPlansTable = await getFundPlansTableName();
    const planCountColumn = await getFundsPlanCountColumnName();

    const { data: fundPlan, error: fundPlanError } = await adminDb
      .from(fundPlansTable)
      .select('*')
      .eq('id', planId)
      .eq('user_wallet', auth.walletAddress)
      .eq('status', 'active')
      .maybeSingle();

    if (fundPlanError) {
      return res.status(500).json({ error: fundPlanError.message });
    }
    if (!fundPlan) {
      return res.status(404).json({ error: 'Active plan not found' });
    }

    const { error: cancelError } = await adminDb
      .from(fundPlansTable)
      .update({ status: 'cancelled' })
      .eq('id', planId);

    if (cancelError) {
      return res.status(500).json({ error: cancelError.message });
    }

    const { data: fundRow, error: fundError } = await adminDb
      .from('funds')
      .select('*')
      .eq('id', fundPlan.fund_id)
      .maybeSingle();

    if (fundError) {
      return res.status(500).json({ error: fundError.message });
    }

    if (fundRow) {
      const nextPlanCount = Math.max(0, readFundPlanCount(fundRow) - 1);
      const nextTvl = Math.max(0, Number(fundRow.total_value_locked ?? 0) - Number(fundPlan.amount ?? 0));

      const { error: updateError } = await adminDb
        .from('funds')
        .update({
          [planCountColumn]: nextPlanCount,
          total_value_locked: nextTvl,
        })
        .eq('id', fundPlan.fund_id);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }
    }

    await invalidateFundsCache();

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'fund plan stop failed' });
  }
};

router.post('/plans/stop', authMiddleware, stopFundPlan);

const listFundPlans = async (req: any, res: any) => {
  try {
    const auth = req.auth as JWTPayload | undefined;
    if (!auth?.walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fundPlansTable = await getFundPlansTableName();
    const { data: fundPlans, error: fundPlansError } = await adminDb
      .from(fundPlansTable)
      .select('*')
      .eq('user_wallet', auth.walletAddress)
      .eq('status', 'active')
      .order('started_at', { ascending: false });

    if (fundPlansError) {
      return res.status(500).json({ error: fundPlansError.message });
    }

    const fundIds = Array.from(
      new Set((fundPlans ?? []).map((row) => String(row.fund_id ?? '')).filter(Boolean)),
    );

    let fundsById = new Map<string, Record<string, unknown>>();
    if (fundIds.length > 0) {
      const { data: funds, error: fundsError } = await adminDb
        .from('funds')
        .select('*')
        .in('id', fundIds);

      if (fundsError) {
        return res.status(500).json({ error: fundsError.message });
      }

      const liveVaultAPY = await getLiveVaultAPY();
      const livePlanStats = await getActivePlanStatsByFundId();
      const rawFunds = (funds ?? []) as Array<Record<string, unknown>>;
      const rawFundsById = new Map(rawFunds.map((fund) => [String(fund.id), fund]));
      const strategyTypes = Array.from(
        new Set(
          rawFunds
            .map((fund) => String(fund.strategy_type ?? '').trim())
            .filter(Boolean),
        ),
      );

      let relatedFunds = rawFunds;
      if (strategyTypes.length > 0) {
        const { data: relatedData, error: relatedError } = await adminDb
          .from('funds')
          .select('*')
          .eq('is_active', true)
          .in('strategy_type', strategyTypes);

        if (relatedError) {
          return res.status(500).json({ error: relatedError.message });
        }

        if ((relatedData ?? []).length > 0) {
          relatedFunds = relatedData as Array<Record<string, unknown>>;
        }
      }

      const representativeByKey = new Map(
        dedupeFundRows(
          relatedFunds.map((row) =>
            applyLiveFundApy(withLivePlanStats(row, livePlanStats), liveVaultAPY),
          ),
        ).map((row) => [fundDedupKey(row), normalizeFundRow(row)]),
      );

      fundsById = new Map(
        Array.from(rawFundsById.entries()).map(([id, fund]) => {
          const key = fundDedupKey(fund);
          return [
            id,
            representativeByKey.get(key) ??
              normalizeFundRow(applyLiveFundApy(withLivePlanStats(fund, livePlanStats), liveVaultAPY)),
          ];
        }),
      );
    }

    return res.json(
      (fundPlans ?? []).map((fundPlan) => ({
        id: fundPlan.id,
        userWallet: fundPlan.user_wallet,
        fundId: fundsById.get(String(fundPlan.fund_id))?.id ?? fundPlan.fund_id,
        amount: Number(fundPlan.amount ?? 0),
        status: fundPlan.status,
        startedAt: fundPlan.started_at,
        lastRunAt: fundPlan.last_run_at,
        nextRunAt: fundPlan.next_run_at,
        fund: fundsById.get(String(fundPlan.fund_id)) ?? null,
      })),
    );
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'fund plans failed' });
  }
};

router.get('/plans', authMiddleware, listFundPlans);

export default router;

function normalizeFundRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Fund'),
    description: row.description ? String(row.description) : '',
    strategyType: String(row.strategy_type ?? ''),
    creatorWallet: row.creator_wallet ? String(row.creator_wallet) : null,
    minDeposit: Number(row.min_deposit ?? 0),
    estimatedApy: Number(row.estimated_apy ?? 0),
    riskLevel: String(row.risk_level ?? 'low'),
    isActive: Boolean(row.is_active ?? true),
    planCount: readFundPlanCount(row),
    totalValueLocked: Number(row.total_value_locked ?? 0),
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

function buildFundResponseRows(
  rows: Array<Record<string, unknown>>,
  liveVaultAPY: number,
  planStatsByFundId: Map<string, { planCount: number; totalValueLocked: number }>,
) {
  return dedupeFundRows(
    rows.map((row) => applyLiveFundApy(withLivePlanStats(row, planStatsByFundId), liveVaultAPY)),
  ).map((row) => normalizeFundRow(row));
}

function fundDedupKey(row: Record<string, unknown>): string {
  const strategyType = String(row.strategy_type ?? '').trim().toLowerCase();
  if (strategyType) {
    return `strategy:${strategyType}`;
  }

  const normalizedName = String(row.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `name:${normalizedName}`;
}

function chooseRepresentativeFundRow(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return [...rows].sort(compareFundRows)[0] ?? rows[0] ?? {};
}

function compareFundRows(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aCanonical = CANONICAL_FUND_ID_SET.has(String(a.id ?? ''));
  const bCanonical = CANONICAL_FUND_ID_SET.has(String(b.id ?? ''));
  if (aCanonical !== bCanonical) {
    return aCanonical ? -1 : 1;
  }

  const aActivity = Number(a.total_value_locked ?? 0) + readFundPlanCount(a);
  const bActivity = Number(b.total_value_locked ?? 0) + readFundPlanCount(b);
  if (aActivity !== bActivity) {
    return bActivity - aActivity;
  }

  const aCreated = Date.parse(String(a.created_at ?? '')) || 0;
  const bCreated = Date.parse(String(b.created_at ?? '')) || 0;
  return aCreated - bCreated;
}

function dedupeFundRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const key = fundDedupKey(row);
    const current = groups.get(key);
    if (current) {
      current.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return Array.from(groups.entries())
    .map(([key, groupedRows]) => {
      const representative = chooseRepresentativeFundRow(groupedRows);
      const earliestCreatedAt = groupedRows.reduce((earliest, row) => {
        const parsed = Date.parse(String(row.created_at ?? ''));
        if (!Number.isFinite(parsed)) {
          return earliest;
        }
        return earliest == null ? parsed : Math.min(earliest, parsed);
      }, null as number | null);

      return {
        ...representative,
        plan_count: groupedRows.reduce((sum, row) => sum + readFundPlanCount(row), 0),
        total_value_locked: groupedRows.reduce(
          (sum, row) => sum + Number(row.total_value_locked ?? 0),
          0,
        ),
        created_at:
          earliestCreatedAt == null
            ? representative.created_at
            : new Date(earliestCreatedAt).toISOString(),
        __dedupeKey: key,
      };
    })
    .sort((a, b) => {
      const aIndex = CANONICAL_FUND_ORDER.get(String(a.__dedupeKey ?? ''));
      const bIndex = CANONICAL_FUND_ORDER.get(String(b.__dedupeKey ?? ''));
      if (aIndex != null || bIndex != null) {
        return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
      }
      return compareFundRows(a, b);
    })
    .map(({ __dedupeKey, ...row }) => row);
}

async function findRelatedActiveFunds(fundRow: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const strategyType = String(fundRow.strategy_type ?? '').trim();
  const name = String(fundRow.name ?? '').trim();

  let query = adminDb.from('funds').select('*').eq('is_active', true);
  if (strategyType) {
    query = query.eq('strategy_type', strategyType);
  } else if (name) {
    query = query.eq('name', name);
  } else {
    return [fundRow];
  }

  const { data, error } = await query;
  if (error || !(data ?? []).length) {
    return [fundRow];
  }
  return data as Array<Record<string, unknown>>;
}

function withLivePlanStats(
  row: Record<string, unknown>,
  planStatsByFundId: Map<string, { planCount: number; totalValueLocked: number }>,
): Record<string, unknown> {
  const stats = planStatsByFundId.get(String(row.id ?? ''));
  if (!stats) {
    return row;
  }

  return {
    ...row,
    plan_count: stats.planCount,
    total_value_locked: stats.totalValueLocked,
  };
}

async function getActivePlanStatsByFundId(): Promise<
  Map<string, { planCount: number; totalValueLocked: number }>
> {
  const fundPlansTable = await getFundPlansTableName();
  const { data, error } = await adminDb
    .from(fundPlansTable)
    .select('fund_id, amount')
    .eq('status', 'active');

  if (error || !(data ?? []).length) {
    return new Map();
  }

  const stats = new Map<string, { planCount: number; totalValueLocked: number }>();
  for (const row of data ?? []) {
    const fundId = String(row.fund_id ?? '').trim();
    if (!fundId) {
      continue;
    }
    const current = stats.get(fundId) ?? { planCount: 0, totalValueLocked: 0 };
    current.planCount += 1;
    current.totalValueLocked += Number(row.amount ?? 0);
    stats.set(fundId, current);
  }
  return stats;
}

async function invalidateFundsCache(): Promise<void> {
  try {
    await getRedis().del(FUNDS_CACHE_KEY);
  } catch {
    // Redis cache is optional for the funds surface.
  }
}

function isMissingFundsTableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table 'public.funds'") ||
    normalized.includes('relation "funds" does not exist')
  );
}

async function getFundsCache(): Promise<string | null> {
  try {
    return await getRedis().get(FUNDS_CACHE_KEY);
  } catch {
    return null;
  }
}

async function setFundsCache(payload: unknown): Promise<void> {
  try {
    await getRedis().set(FUNDS_CACHE_KEY, JSON.stringify(payload), 'EX', FUNDS_CACHE_TTL_SECONDS);
  } catch {
    // Redis cache is optional for the funds surface.
  }
}

async function getLiveVaultAPY(): Promise<number> {
  try {
    const cached = await getRedis().get(FUNDS_VAULT_APY_CACHE_KEY);
    if (cached) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Redis cache is optional for the funds surface.
  }

  const liveVaultAPY = await readLiveVaultApyPercent().catch(() => 5.0);
  const normalized = Number.isFinite(liveVaultAPY) ? Math.round(liveVaultAPY * 100) / 100 : 5.0;

  try {
    await getRedis().set(
      FUNDS_VAULT_APY_CACHE_KEY,
      String(normalized),
      'EX',
      FUNDS_VAULT_APY_CACHE_TTL_SECONDS,
    );
  } catch {
    // Redis cache is optional for the funds surface.
  }

  return normalized;
}

function applyLiveFundApy(row: Record<string, unknown>, liveVaultAPY: number): Record<string, unknown> {
  const strategyType = String(row.strategy_type ?? '');
  if (strategyType === 'dca_vault') {
    return {
      ...row,
      estimated_apy: liveVaultAPY,
    };
  }
  if (strategyType === 'auto_compound') {
    return {
      ...row,
      estimated_apy: Math.round((liveVaultAPY + 1.5) * 100) / 100,
    };
  }
  return row;
}

async function readLiveVaultApyPercent(): Promise<number> {
  const mod = (await import('../lib/vault-apy')) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const readVaultApyPercent =
    (mod.readVaultApyPercent as ((address: `0x${string}`) => Promise<number>) | undefined) ??
    (mod.default?.readVaultApyPercent as ((address: `0x${string}`) => Promise<number>) | undefined);
  const resolveVaultAddress =
    (mod.resolveVaultAddress as (() => `0x${string}` | null) | undefined) ??
    (mod.default?.resolveVaultAddress as (() => `0x${string}` | null) | undefined);

  if (!readVaultApyPercent || !resolveVaultAddress) {
    return 5.0;
  }

  const vaultAddress = resolveVaultAddress();
  if (!vaultAddress) {
    return 5.0;
  }

  return readVaultApyPercent(vaultAddress);
}
