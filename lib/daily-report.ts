import { adminDb } from '../db/client';
import { callHermesFast } from './hermes';
import { getFundPlansTableName } from './fund-plans';
import { fetchLiveData } from './live-data';
import { sendTelegramText } from './telegram-notify';

type DailyTopic = {
  key:
    | 'defi_daily'
    | 'crypto_security'
    | 'macro_markets'
    | 'ai_crypto'
    | 'stablecoin_regulation'
    | 'global_crypto_news'
    | 'circle_arc'
    | 'arc_ecosystem';
  label: string;
  query: string;
};

type GeneratedReport = {
  topicKey: DailyTopic['key'];
  title: string;
  query: string;
  generatedAt: string;
  body: string;
};

const REPORT_PROMPT =
  'You write concise daily intelligence briefings. Use the provided LIVE DATA first. ' +
  'Output plain markdown with a short headline line and 4-8 bullets. Keep it factual and timely.';

export const DAILY_TOPICS: DailyTopic[] = [
  {
    key: 'defi_daily',
    label: 'DeFi & Stablecoin Daily Intelligence',
    query:
      'DeFi market TVL yield rates stablecoin USDC EURC USDT DAI Circle Tether news updates today',
  },
  {
    key: 'crypto_security',
    label: 'Crypto Security Alerts',
    query:
      'crypto hack exploit DeFi vulnerability breach attack stolen phishing scam rug pull smart contract bug today',
  },
  {
    key: 'macro_markets',
    label: 'Macro & Markets Daily',
    query:
      'Federal Reserve inflation interest rates geopolitics oil prices dollar index stablecoin market crypto impact today',
  },
  {
    key: 'ai_crypto',
    label: 'AI & Technology Daily',
    query:
      'artificial intelligence machine learning ChatGPT OpenAI Anthropic Google DeepMind AI regulation AI policy technology news AI startups funding research breakthroughs AI impact economy jobs society 2026',
  },
  {
    key: 'stablecoin_regulation',
    label: 'Stablecoin & Regulation Watch',
    query:
      'stablecoin regulation USDC Circle SEC CFTC crypto law policy government central bank digital currency CBDC today',
  },
  {
    key: 'global_crypto_news',
    label: 'Global Crypto News',
    query:
      'Bitcoin Ethereum crypto market news adoption institutional investment global blockchain today',
  },
  {
    key: 'circle_arc',
    label: 'Circle & Arc Ecosystem',
    query:
      'Circle USDC EURC Arc Network stablecoin L1 blockchain CCTP cross chain payments updates',
  },
  {
    key: 'arc_ecosystem',
    label: 'Arc Ecosystem Weekly',
    query:
      'Arc Network Circle blockchain stablecoin L1 ecosystem DeFi projects builders updates developments',
  },
];

const generatedReports = new Map<DailyTopic['key'], string>();

function getTopicOrDefault(topicKey?: string): DailyTopic {
  const topic = DAILY_TOPICS.find((t) => t.key === topicKey);
  return topic ?? DAILY_TOPICS.find((t) => t.key === 'defi_daily')!;
}

function formatHeader(label: string): string {
  return `📊 *${label}*`;
}

function normalizeReportText(raw: string): string {
  const withoutFences = raw
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const normalizedTimestamp = withoutFences.replace(
    /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z?/g,
    '$1 $2 UTC',
  );

  const lines = normalizedTimestamp
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
  const nonBulletLines = lines.filter((line) => !/^[-*]\s+/.test(line));

  const trimmedBullets = bulletLines.slice(0, 5);
  const outputLines =
    nonBulletLines.length > 0
      ? [nonBulletLines[0], ...trimmedBullets]
      : trimmedBullets;

  return outputLines.join('\n');
}

export async function generateDailyReport(topicKey = 'defi_daily'): Promise<string | null> {
  const topic = getTopicOrDefault(topicKey);
  const generatedAt = new Date().toISOString();

  let liveData = '';
  try {
    liveData = await fetchLiveData(topic.query);
  } catch (error) {
    console.warn('[daily-report] live data fetch failed:', error);
  }

  const modelInput = [
    `AS OF ${generatedAt}`,
    `TOPIC: ${topic.label}`,
    `QUERY: ${topic.query}`,
    liveData ? `LIVE DATA JSON:\n${liveData}` : 'LIVE DATA JSON:\n{}',
    'Write a concise daily intelligence update.',
  ].join('\n\n');

  let report: unknown = '';
  try {
    const raw = await callHermesFast(REPORT_PROMPT, modelInput);
    const data = raw as unknown;
    console.log('[daily-report] raw data type:', typeof data);
    if (data && typeof data === 'object') {
      console.log('[daily-report] data keys:', Object.keys(data as Record<string, unknown>));
    }

    if (typeof data === 'string') {
      report = data;
    } else if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (typeof record.report === 'string') report = record.report;
      else if (typeof record.delta === 'string') report = record.delta;
      else report = data;
    } else {
      report = data;
    }
  } catch (error) {
    console.warn('[daily-report] Hermes generation failed:', error);
    report = '- Live data collection completed, but summary generation failed.\n- Please retry shortly.';
  }

  if (typeof report === 'object' && report !== null) {
    report = JSON.stringify(report);
  }

  if (!report || typeof report !== 'string') {
    console.error('[daily-report] report is not a string:', typeof report);
    return null;
  }

  const reportEnvelope: GeneratedReport = {
    topicKey: topic.key,
    title: topic.label,
    query: topic.query,
    generatedAt,
    body: normalizeReportText(report.trim()),
  };

  generatedReports.set(topic.key, reportEnvelope.body);
  return reportEnvelope.body;
}

export async function sendDailyReportsToPlanUsers(): Promise<void> {
  const defaultTopic = getTopicOrDefault('defi_daily');
  const defaultReport =
    generatedReports.get(defaultTopic.key) ?? (await generateDailyReport(defaultTopic.key));
  if (!defaultReport) {
    console.warn('[daily-report] no default report text generated; skipping send.');
    return;
  }
  const message = `${formatHeader(defaultTopic.label)}\n\n${defaultReport}`.slice(0, 3900);

  const fundPlansTable = await getFundPlansTableName();
  const { data: rows, error } = await adminDb
    .from(fundPlansTable)
    .select('user_wallet, funds!inner(strategy_type)')
    .eq('status', 'active')
    .eq('funds.strategy_type', 'research_monitor');

  if (error) {
    throw new Error(`[daily-report] fund plan query failed: ${error.message}`);
  }

  const wallets = [...new Set((rows ?? []).map((row) => String(row.user_wallet ?? '').trim()).filter(Boolean))];
  if (wallets.length === 0) {
    console.log('[daily-report] no active research_monitor plan users.');
    return;
  }

  const { data: users, error: usersError } = await adminDb
    .from('users')
    .select('wallet_address, telegram_id')
    .in('wallet_address', wallets);

  if (usersError) {
    throw new Error(`[daily-report] users lookup failed: ${usersError.message}`);
  }

  const chatIds = new Set<string>();
  for (const user of users ?? []) {
    const chatId = String(user.telegram_id ?? '').trim();
    if (chatId) {
      chatIds.add(chatId);
    }
  }

  for (const chatId of chatIds) {
    try {
      await sendTelegramText(chatId, message);
    } catch (error) {
      console.warn(`[daily-report] telegram send failed (${chatId}):`, error);
    }
  }

  console.log(`[daily-report] sent default report to ${chatIds.size} plan users.`);
}
