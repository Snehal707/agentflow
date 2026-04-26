import cron from 'node-cron';
import dotenv from 'dotenv';
import { runMonthlyDigest } from './monthly-digest';
import { runTrainingExport } from './training-export';
import { runYieldMonitor } from './yield-monitor';
import { generateDailyReport, sendDailyReportsToPlanUsers } from '../lib/daily-report';
import { processDuePayments } from '../lib/scheduled-payments';
import { runTreasuryTopUp } from '../lib/agent-treasury';

dotenv.config();

if (process.env.NODE_ENV !== 'production') {
  console.log('[crons] NODE_ENV is not production; scheduler not started.');
  process.exit(0);
}

const tz = 'Etc/UTC';

cron.schedule(
  '0 */6 * * *',
  () => {
    void runYieldMonitor().catch((e) => console.error('[cron] yield-monitor', e));
  },
  { timezone: tz },
);

// Agent treasury top-up - every hour
cron.schedule(
  '0 * * * *',
  async () => {
    console.log('[cron] running treasury top-up check');
    try {
      await runTreasuryTopUp();
    } catch (e) {
      console.error('[cron] treasury top-up failed:', e);
    }
  },
  { timezone: 'UTC' },
);

cron.schedule(
  '0 9 1 * *',
  () => {
    void runMonthlyDigest().catch((e) => console.error('[cron] monthly-digest', e));
  },
  { timezone: tz },
);

cron.schedule(
  '0 3 * * *',
  () => {
    void runTrainingExport().catch((e) => console.error('[cron] training-export', e));
  },
  { timezone: tz },
);

// Daily reports - 9am UTC
cron.schedule(
  '0 9 * * *',
  async () => {
    console.log('[cron] generating daily reports');
    const dailyTopics = [
      'defi_daily',
      'crypto_security',
      'macro_markets',
      'ai_crypto',
      'stablecoin_regulation',
      'global_crypto_news',
      'circle_arc',
    ] as const;
    await Promise.allSettled(dailyTopics.map((topic) => generateDailyReport(topic)));
    await sendDailyReportsToPlanUsers();
    await processDuePayments().catch((e) => console.error('[cron] scheduled-payments', e));
    console.log('[cron] daily reports + scheduled payments done');
  },
  { timezone: 'UTC' },
);

// Arc ecosystem weekly - every Monday 9am UTC
cron.schedule(
  '0 9 * * 1',
  async () => {
    console.log('[cron] generating weekly Arc report');
    await generateDailyReport('arc_ecosystem');
  },
  { timezone: 'UTC' },
);

console.log(
  '[crons] Scheduler started (production): yield-monitor (6h), treasury top-up (hourly), monthly (09:00 1st), training (03:00), daily reports + scheduled USDC payments (09:00).',
);
