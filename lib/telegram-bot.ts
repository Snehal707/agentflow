import './loadEnv';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
} from 'viem';
import { adminDb, getRedis } from '../db/client';
import { getOrCreateUserAgentWallet } from './dcw';
import { fetchGatewayBalancesForDepositors, getOrCreateGatewayFundingWallet } from './gateway-balance';
import { createTelegramBotForPolling, getTelegramBotToken } from './telegram-notify';
import type { TelegramIntent } from './telegram-intent-parser';
import { parseSwapTokenSymbols } from './swap-symbols';
import {
  executeTelegramSwap,
  simulateSwapExecution,
  type SwapSimulationExecutionPayload,
} from './runners/telegramSwap';
import { buildPortfolioSnapshot } from '../agents/portfolio/portfolio';
import { ARC } from './arc-config';
import { resolvePayee } from './agentpay-payee';
import { fetchPayHistoryForBrain } from '../api/pay';
import { parseBatchPaymentsFromMessage, parseInlineCsvFromMessage, type BatchPaymentRow } from './csv-batch-parser';
import { buildMemoryContext, callHermesFast } from './hermes';
import {
  buildSemanticMemoryContext,
  rememberSemanticMemory,
} from './semantic-memory';
import { classifyIntent } from './intent-router';
import { dispatchIntent } from './intent-router/dispatcher';
import { AgentFlowDomain, AgentFlowIntentName, type AgentFlowIntent } from './intent-router/types';
import { validateIntent } from './intent-router/validator';
import {
  TELEGRAM_CHAT_SYSTEM_PROMPT,
  buildCurrentDateContext,
  buildWalletProfileLlmContext,
} from './chatPersona';
import { APP_BASE_URL, APP_URLS, appUrl } from './app-urls';
import { redisPendingExists } from './chatSessionRedis';
import telegramLinkCode from './telegram-link-code';
import {
  buildTelegramChatProfile,
  saveCachedTelegramChatProfile,
  type TelegramChatProfile,
} from './telegram-profile';
import { clearPendingAction, executeTool, loadPendingAction } from './tool-executor';
import { extractAgentpayRemark } from './agentpay-remark';
import { generateInvoiceNumber } from './invoice-number';
import { getPreferredAgentpayPaymentLinkHandle } from './agentpay-registry';
import {
  formatNanopaymentRequestLine,
  formatX402NanopaymentFeeLine,
} from './telegramX402SuccessCopy';

const TELEGRAM_LINK_REQUIRED_MESSAGE =
  `⚠️ Please link your wallet first to use AgentFlow.\n\n` +
  `Go to ${APP_URLS.settings} → Connect Telegram\n` +
  `Then open Telegram from the app to finish linking automatically.`;

const TELEGRAM_LINK_SUCCESS_MESSAGE =
  '✅ Wallet linked! You can now use AgentFlow.';
const SCHEDULE_AGENT_BASE_URL = process.env.SCHEDULE_AGENT_URL?.trim() || 'http://127.0.0.1:3018';
const PUBLIC_API_BASE_URL = (
  process.env.BACKEND_URL?.trim() ||
  process.env.AGENTFLOW_API_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT || 4000}`
).replace(/\/+$/, '');
const TELEGRAM_POLL_LOCK_KEY = 'telegram:poll:lock';
const TELEGRAM_POLL_LOCK_TTL_SEC = 90;
const TELEGRAM_POLL_LOCK_HEARTBEAT_SEC = 30;

function extractTelegramProfileFromMessage(msg: {
  chat?: {
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    title?: string | null;
  };
  from?: {
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
}): TelegramChatProfile | null {
  return buildTelegramChatProfile({
    username: msg.chat?.username ?? msg.from?.username,
    first_name: msg.chat?.first_name ?? msg.from?.first_name,
    last_name: msg.chat?.last_name ?? msg.from?.last_name,
    title: msg.chat?.title,
  });
}
const TELEGRAM_MEDIA_TARGET_TTL_SEC = 60 * 30;
const TELEGRAM_MAX_CSV_BYTES = 1 * 1024 * 1024;

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC.alchemyRpc || ARC.rpc] },
  },
});

function arcReadTransport() {
  return http(ARC.alchemyRpc || ARC.rpc);
}

function pendingKey(chatId: number | string): string {
  return `telegram:pending:${chatId}`;
}

const PENDING_TTL_SEC = 300;
const TELEGRAM_ROUTING_LOG_DIR = '.agentflow-telemetry';
const TELEGRAM_ROUTING_LOG_FILE = `${TELEGRAM_ROUTING_LOG_DIR}/telegram-routing-events.jsonl`;
const AGENTPAY_PENDING_PREFIX = 'agentpay:pending:';

type SharedTelegramConfirmation =
  | {
      action: 'schedule' | 'split' | 'invoice' | 'batch' | 'agentpay_send';
      confirmId: string;
      label?: string;
    }
  | {
      action: 'contact_update';
      confirmId: string;
      label?: string;
    };

function telegramSessionId(chatId: number): string {
  return `telegram:${chatId}`;
}

function telegramMediaTargetKey(chatId: number): string {
  return `telegram:media-target:${chatId}`;
}

type TelegramMediaTarget = {
  recipient: string;
  displayRecipient: string;
  qrText: string;
  paymentUrl?: string | null;
  amount?: string | null;
  remark?: string | null;
  storedAt: string;
};

type TelegramPollLock = {
  pid: number;
  startedAt: string;
  cwd: string;
};

let telegramPollLockValue: string | null = null;
let telegramPollLockHeartbeat: NodeJS.Timeout | null = null;

function isProcessLikelyAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function parseTelegramPollLock(raw: string | null): TelegramPollLock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TelegramPollLock>;
    if (
      !parsed ||
      !Number.isInteger(parsed.pid) ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.cwd !== 'string'
    ) {
      return null;
    }
    return {
      pid: Number(parsed.pid),
      startedAt: parsed.startedAt,
      cwd: parsed.cwd,
    };
  } catch {
    return null;
  }
}

function normalizeTelegramPaymentRecipient(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isAddress(trimmed)) {
    return getAddress(trimmed);
  }
  const arcMatch = trimmed.match(/^([a-z0-9._-]+)(?:\.arc)?$/i);
  if (!arcMatch) return null;
  const base = arcMatch[1]?.trim().toLowerCase();
  return base ? `${base}.arc` : null;
}

function extractTelegramQrPaymentTarget(qrText: string): TelegramMediaTarget | null {
  const trimmed = qrText.trim();
  if (!trimmed) return null;

  const direct = normalizeTelegramPaymentRecipient(trimmed);
  if (direct) {
    return {
      recipient: direct,
      displayRecipient: direct,
      qrText: trimmed,
      paymentUrl: null,
      amount: null,
      remark: null,
      storedAt: new Date().toISOString(),
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const payMatch = url.pathname.match(/\/pay\/([^/?#]+)/i);
  if (!payMatch?.[1]) return null;
  const decodedHandle = decodeURIComponent(payMatch[1]);
  const recipient = normalizeTelegramPaymentRecipient(decodedHandle);
  if (!recipient) return null;

  return {
    recipient,
    displayRecipient: recipient,
    qrText: trimmed,
    paymentUrl: url.toString(),
    amount: url.searchParams.get('amount'),
    remark: url.searchParams.get('remark'),
    storedAt: new Date().toISOString(),
  };
}

function messageReferencesTelegramQrTarget(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /\b(?:it|this|that|the)\b(?:\s+(?:qr|code|address|wallet|photo|image|screenshot))?/i.test(
    normalized,
  );
}

function hasExplicitTelegramRecipient(text: string): boolean {
  return /\b0x[a-f0-9]{40}\b/i.test(text) || /\b[a-z0-9._-]+\.arc\b/i.test(text);
}

function rewriteTelegramPaymentTextWithTarget(text: string, target: TelegramMediaTarget): string {
  const trimmed = text.trim();
  if (!trimmed || hasExplicitTelegramRecipient(trimmed)) {
    return trimmed;
  }

  if (!/\b(?:send|pay|transfer|request|invoice|payment)\b/i.test(trimmed)) {
    return trimmed;
  }

  const pronounPattern =
    /\b(?:it|this(?:\s+(?:qr|code|address|wallet|photo|image|screenshot))?|that(?:\s+(?:qr|code|address|wallet|photo|image|screenshot))?|the(?:\s+(?:qr|code|address|wallet|photo|image|screenshot))?)\b/gi;
  let rewritten: string;
  if (pronounPattern.test(trimmed)) {
    rewritten = trimmed.replace(pronounPattern, target.recipient);
  } else {
    const remarkStart = trimmed.search(/\s+\b(?:for|note|remark|reference|memo)\b/i);
    rewritten =
      remarkStart >= 0
        ? `${trimmed.slice(0, remarkStart)} to ${target.recipient}${trimmed.slice(remarkStart)}`
        : `${trimmed} to ${target.recipient}`;
  }

  if (target.remark && !extractAgentpayRemark(rewritten, { maxLength: 100 })) {
    rewritten = `${rewritten} for ${target.remark}`;
  }
  return rewritten;
}

async function getTelegramQrModules(): Promise<{
  sharp: any;
  decodeQR: (image: { width: number; height: number; data: Uint8Array }) => string;
}> {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const sharpModulePath = path.join(repoRoot, 'agentflow-frontend', 'node_modules', 'sharp', 'lib', 'index.js');
  const qrDecodeModulePath = path.join(repoRoot, 'agentflow-frontend', 'node_modules', 'qr', 'decode.js');
  const sharpModule = await import(pathToFileURL(sharpModulePath).href);
  const qrDecodeModule = await import(pathToFileURL(qrDecodeModulePath).href);
  return {
    sharp: sharpModule.default ?? sharpModule,
    decodeQR: qrDecodeModule.default ?? qrDecodeModule.decodeQR,
  };
}

async function decodeTelegramQrFromBuffer(buffer: Buffer): Promise<string> {
  const { sharp, decodeQR } = await getTelegramQrModules();
  const image = sharp(buffer, { failOn: 'none' });
  const { data, info } = await image
    .rotate()
    .normalise()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return decodeQR({
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
  });
}

async function loadTelegramMediaTarget(chatId: number): Promise<TelegramMediaTarget | null> {
  try {
    const raw = await getRedis().get(telegramMediaTargetKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TelegramMediaTarget;
    if (!parsed || typeof parsed.recipient !== 'string' || typeof parsed.qrText !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function storeTelegramMediaTarget(chatId: number, target: TelegramMediaTarget): Promise<void> {
  await getRedis().setex(
    telegramMediaTargetKey(chatId),
    TELEGRAM_MEDIA_TARGET_TTL_SEC,
    JSON.stringify(target),
  );
}

async function maybeDecodeTelegramPaymentTarget(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  msg: any,
): Promise<TelegramMediaTarget | null> {
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const documentFileId =
    msg.document?.file_id && typeof msg.document?.mime_type === 'string' && /^image\//i.test(msg.document.mime_type)
      ? msg.document.file_id
      : null;
  const fileId = photo?.file_id || documentFileId;
  if (!fileId) return null;

  try {
    const fileUrl = await bot.getFileLink(fileId);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Telegram file fetch failed (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const qrText = await decodeTelegramQrFromBuffer(Buffer.from(arrayBuffer));
    const target = extractTelegramQrPaymentTarget(qrText);
    if (!target) return null;
    await storeTelegramMediaTarget(msg.chat.id, target);
    return target;
  } catch (error) {
    console.warn('[telegram-bot] qr decode failed:', error);
    return null;
  }
}

function isTelegramCsvDocument(msg: any): boolean {
  const document = msg.document;
  if (!document?.file_id) return false;
  const fileName = String(document.file_name || '').toLowerCase();
  const mimeType = String(document.mime_type || '').toLowerCase();
  return mimeType === 'text/csv' || fileName.endsWith('.csv');
}

async function maybeReadTelegramCsvDocument(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  msg: any,
): Promise<string | null> {
  if (!isTelegramCsvDocument(msg)) {
    return null;
  }

  const fileSize = Number(msg.document?.file_size ?? 0);
  if (Number.isFinite(fileSize) && fileSize > TELEGRAM_MAX_CSV_BYTES) {
    throw new Error('CSV file is too large. Keep Telegram CSV uploads under 1MB.');
  }

  const fileUrl = await bot.getFileLink(msg.document.file_id);
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Telegram CSV fetch failed (${response.status})`);
  }

  const text = (await response.text()).replace(/^\uFEFF/, '').trim();
  if (!text) {
    throw new Error('CSV file is empty.');
  }
  return text;
}

async function acquireTelegramPollLock(): Promise<boolean> {
  const redis = getRedis();
  const payload: TelegramPollLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
  const value = JSON.stringify(payload);
  const acquired = await redis.set(
    TELEGRAM_POLL_LOCK_KEY,
    value,
    'EX',
    TELEGRAM_POLL_LOCK_TTL_SEC,
    'NX',
  );
  if (acquired !== 'OK') {
    const existing = await redis.get(TELEGRAM_POLL_LOCK_KEY);
    const parsedExisting = parseTelegramPollLock(existing);
    if (parsedExisting && !isProcessLikelyAlive(parsedExisting.pid)) {
      try {
        const current = await redis.get(TELEGRAM_POLL_LOCK_KEY);
        if (current === existing) {
          await redis.del(TELEGRAM_POLL_LOCK_KEY);
          const reacquired = await redis.set(
            TELEGRAM_POLL_LOCK_KEY,
            value,
            'EX',
            TELEGRAM_POLL_LOCK_TTL_SEC,
            'NX',
          );
          if (reacquired === 'OK') {
            telegramPollLockValue = value;
            telegramPollLockHeartbeat = null;
          }
        }
      } catch (error) {
        console.warn('[telegram-bot] failed to reclaim stale polling lock:', error);
      }
      if (telegramPollLockValue === value) {
        console.warn(
          `[telegram-bot] reclaimed stale ${TELEGRAM_POLL_LOCK_KEY} from dead pid ${parsedExisting.pid}.`,
        );
      }
    }
    if (telegramPollLockValue !== value) {
    console.warn(
      `[telegram-bot] another polling instance already holds ${TELEGRAM_POLL_LOCK_KEY}; skipping local polling.`,
      existing ? ` holder=${existing}` : '',
    );
    return false;
    }
  }

  telegramPollLockValue = value;
  telegramPollLockHeartbeat = setInterval(() => {
    void (async () => {
      if (!telegramPollLockValue) return;
      try {
        const current = await redis.get(TELEGRAM_POLL_LOCK_KEY);
        if (current !== telegramPollLockValue) {
          if (telegramPollLockHeartbeat) {
            clearInterval(telegramPollLockHeartbeat);
            telegramPollLockHeartbeat = null;
          }
          telegramPollLockValue = null;
          return;
        }
        await redis.set(
          TELEGRAM_POLL_LOCK_KEY,
          telegramPollLockValue,
          'EX',
          TELEGRAM_POLL_LOCK_TTL_SEC,
          'XX',
        );
      } catch (error) {
        console.warn('[telegram-bot] poll lock heartbeat failed:', error);
      }
    })();
  }, TELEGRAM_POLL_LOCK_HEARTBEAT_SEC * 1000);
  if (telegramPollLockHeartbeat && typeof telegramPollLockHeartbeat.unref === 'function') {
    telegramPollLockHeartbeat.unref();
  }
  return true;
}

async function releaseTelegramPollLock(): Promise<void> {
  if (telegramPollLockHeartbeat) {
    clearInterval(telegramPollLockHeartbeat);
    telegramPollLockHeartbeat = null;
  }
  if (!telegramPollLockValue) return;
  try {
    const redis = getRedis();
    const current = await redis.get(TELEGRAM_POLL_LOCK_KEY);
    if (current === telegramPollLockValue) {
      await redis.del(TELEGRAM_POLL_LOCK_KEY);
    }
  } catch (error) {
    console.warn('[telegram-bot] poll lock release failed:', error);
  } finally {
    telegramPollLockValue = null;
  }
}

function isTelegramAffirmativeReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^(?:yes|y|yeah|yep|confirm|confirmed|proceed|continue|execute|send it|do it|go ahead|yeah go|yes please)$/i.test(
      normalized,
    ) ||
    /\b(?:go ahead|do it|execute it|send it|run it|confirm it|proceed with it)\b/i.test(normalized)
  );
}

function isTelegramNegativeReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^(?:no|n|nope|cancel|stop|abort|nevermind|never mind|dont|don't)$/i.test(normalized) ||
    /\b(?:cancel that|stop that|abort that|never mind|don't do it|do not do it|not now)\b/i.test(
      normalized,
    )
  );
}

function shouldCaptureTelegramSemanticCorrection(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    !/^(?:no|wait|actually|correction|wrong|not quite|that's wrong)\b/i.test(normalized) &&
    !/\b(?:should|shouldn't|do not|don't|instead|not in telegram|use web|dcw|eoa|natural language|semantic|intent|router)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(?:telegram|web|agentpay|vault|swap|bridge|portfolio|balance|predmarket|research|intent|router|dcw|eoa)\b/i.test(
    normalized,
  );
}

async function captureTelegramSemanticCorrection(
  row: TelegramUserRow | null | undefined,
  chatId: number,
  text: string,
): Promise<void> {
  const walletAddress = row?.wallet_address?.trim();
  if (!walletAddress || !shouldCaptureTelegramSemanticCorrection(text)) {
    return;
  }
  await rememberSemanticMemory({
    wallet_address: walletAddress,
    session_id: telegramSessionId(chatId),
    memory_type: 'routing_example',
    category: 'telegram_user_correction',
    content: `Telegram user correction or policy guidance: ${text.replace(/\s+/g, ' ').trim()}`,
    source_user_message: text,
    keywords: ['telegram', 'correction', 'policy', ...text.split(/\s+/)],
    confidence: 0.8,
  });
}

function buildSafeDeterministicFallbackReply(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (
    /\b(?:send|pay|transfer|request|invoice|payment link|history|scheduled|schedule|recurring|split|batch|contact)\b/i.test(
      normalized,
    )
  ) {
    return [
      "I understood this as an AgentPay request, but I couldn't route it safely from chat just yet.",
      'I do not want to guess payment details or invent a preview.',
      'Rephrase it naturally with the recipient, amount, and whether you want to send, request, invoice, split, batch, or schedule the payment, and I will retry.',
    ].join('\n\n');
  }

  if (/\b(?:swap|vault|bridge|portfolio|balance|holdings|positions|funds|wallet)\b/i.test(normalized)) {
    return [
      "I understood this as an AgentFlow wallet or execution request, but I couldn't route it safely from chat just yet.",
      'I do not want to guess balances, vaults, routes, or transaction details.',
      'Ask it again naturally with the asset and amount if relevant, and I will retry through the deterministic path.',
    ].join('\n\n');
  }

  if (/\b(?:predmarket|prediction|bet|market|redeem|refund)\b/i.test(normalized)) {
    return [
      "I understood this as a prediction-market request, but I couldn't route it safely from chat just yet.",
      'I do not want to guess market state, pricing, or execution details.',
      'Ask it again naturally with the market or action you want, and I will retry through the deterministic path.',
    ].join('\n\n');
  }

  return null;
}

function needsGroundedAgentflowResolution(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  if (
    /\b(?:send|pay|transfer|request|invoice|payment|history|scheduled|schedule|recurring|split|batch|contact|swap|vault|bridge|portfolio|balance|holdings|positions|funds|wallet|predmarket|prediction|bet|market|redeem|refund|deposit|withdraw|claim|buy|sell|portfolio agent|research agent|invoice agent)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b0x[a-f0-9]{6,}\b/i.test(normalized) ||
    /\b[a-z0-9._-]+\.arc\b/i.test(normalized) ||
    /\b(?:usdc|eurc|eth|weth|arb|op|matic|btc|wx402|arx|fox)\b/i.test(normalized) ||
    /\b\d+(?:\.\d+)?\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

type TelegramRoutingEvent = {
  at: string;
  chatId: number;
  text: string;
  policy: 'chat' | 'clarify' | 'dispatch';
  reason: string;
  classifiedIntent?: string;
  classifiedDomain?: string;
  confidence?: number;
  validationSeverity?: 'pass' | 'soft' | 'hard';
};

async function logTelegramRoutingEvent(event: TelegramRoutingEvent): Promise<void> {
  try {
    await mkdir(TELEGRAM_ROUTING_LOG_DIR, { recursive: true });
    await appendFile(TELEGRAM_ROUTING_LOG_FILE, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    console.warn('[telegram-bot] routing telemetry write failed:', error);
  }
}

function linkRedisKey(code: string): string {
  return `telegram:link:${code.trim().toUpperCase()}`;
}

function normalizeCommand(text: string): string {
  return text.replace(/@\w+$/i, '').trim();
}

type PendingAction =
  | { kind: 'swap'; payload: SwapSimulationExecutionPayload }
  | {
      kind: 'shared-confirmation';
      action: 'schedule' | 'split' | 'invoice' | 'batch' | 'contact_update' | 'agentpay_send';
      confirmId: string;
      label?: string;
    };

async function getUserByTelegram(chatId: string) {
  const { data, error } = await adminDb
    .from('users')
    .select('wallet_address, telegram_id')
    .eq('telegram_id', chatId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as { wallet_address: string; telegram_id: string | null } | null;
}

async function getLinkedWalletRow(
  chatId: string,
): Promise<{ wallet_address: string } | null> {
  const row = await getUserByTelegram(chatId);
  return row?.wallet_address ? row : null;
}

async function sendTelegramLinkRequired(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
): Promise<void> {
  await send(bot, chatId, TELEGRAM_LINK_REQUIRED_MESSAGE);
}

async function send(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  text: string,
): Promise<void> {
  const chunks = splitTelegramMessage(formatTelegramPlainText(text));
  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk, { disable_web_page_preview: true });
  }
}

const TELEGRAM_MAX_MESSAGE_LENGTH = 3500;

function formatTelegramPlainText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*-\s+(?=[A-Z])/gm, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^_([^_\n]+)_$/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTelegramMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [' '];
  }
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = maxLength;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length ? chunks : [normalized];
}

const TELEGRAM_HELP_TEXT = [
  "I didn't understand that. Try:",
  '/swap 10 USDC EURC',
  'show me vaults',
  '/balance',
  '/portfolio',
].join('\n');

const TELEGRAM_VAULT_EXECUTION_DISABLED =
  'Vault deposits and withdrawals are currently available in the web app only. Telegram can show vaults and balances, but execution is disabled for safety.';

/** Must match the start of `sendLinkCodeForceReply` text — identifies replies to that prompt. */
const LINK_FORCE_REPLY_MARKER = 'Paste your AF- link code below';

function isReplyToLinkPrompt(msg: {
  text?: string;
  reply_to_message?: { from?: { is_bot?: boolean }; text?: string };
}): boolean {
  const r = msg.reply_to_message;
  if (!msg.text?.trim() || !r?.from?.is_bot || !r.text) {
    return false;
  }
  return r.text.startsWith(LINK_FORCE_REPLY_MARKER);
}

/** Keep fallback linking normal: Telegram mobile can leave ForceReply pinned after linking. */
async function sendLinkCodeForceReply(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
): Promise<void> {
  const text = [
    `${LINK_FORCE_REPLY_MARKER} (from ${APP_URLS.settings} → Connect Telegram).`,
    '',
    'Auto-link usually happens from the app or web button first.',
    'If that did not open correctly, send: /link AF-WZ3ZEU',
    '',
    'Example: AF-WZ3ZEU',
  ].join('\n');
  await send(bot, chatId, text);
}

async function applyTelegramLinkCode(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  rawInput: string,
  chatProfile?: TelegramChatProfile | null,
): Promise<void> {
  let raw = rawInput.trim();
  if (!raw) {
    await send(bot, chatId, 'Send a non-empty code.');
    return;
  }
  const linkCmd = raw.match(/^\/link\s+(.+)$/i);
  if (linkCmd) {
    raw = linkCmd[1]!.trim();
  }
  const trimmed = raw.trim();
  const code = trimmed.replace(/^AF-/i, '');
  const fullCode = /^AF-/i.test(trimmed) ? trimmed : `AF-${code}`;

  let resolvedWalletAddress: string | null = null;
  const stateless = telegramLinkCode.parseTelegramLinkCode(fullCode);
  if (stateless.ok && stateless.walletAddress) {
    resolvedWalletAddress = stateless.walletAddress;
  } else {
    try {
      const redis = getRedis();
      const walletFromRedis = await redis.get(linkRedisKey(fullCode));
      if (walletFromRedis?.trim()) {
        resolvedWalletAddress = walletFromRedis.trim();
      }
    } catch {
      // Old Redis-backed link codes are best-effort only now.
    }
  }

  if (!resolvedWalletAddress) {
    await send(
      bot,
      chatId,
      `Code invalid or expired. Generate a new one at ${APP_URLS.settings}`,
    );
    return;
  }

  try {
    const normalized = getAddress(resolvedWalletAddress.trim());
    const chatIdStr = String(chatId);
    await adminDb.from('users').update({ telegram_id: null }).eq('telegram_id', chatIdStr);

    const { data: existing } = await adminDb
      .from('users')
      .select('wallet_address')
      .or(`wallet_address.eq.${normalized},wallet_address.eq.${normalized.toLowerCase()}`)
      .maybeSingle();

    if (existing?.wallet_address) {
      const { error } = await adminDb
        .from('users')
        .update({ telegram_id: chatIdStr })
        .eq('wallet_address', existing.wallet_address);
      if (error) {
        await send(bot, chatId, `Failed: ${error.message}`);
        return;
      }
      await saveCachedTelegramChatProfile(existing.wallet_address, chatProfile);
      await adminDb
        .from('businesses')
        .update({ telegram_id: chatIdStr })
        .eq('wallet_address', existing.wallet_address);
    } else {
      const { error } = await adminDb.from('users').insert({
        wallet_address: normalized,
        telegram_id: chatIdStr,
      });
      if (error) {
        await send(bot, chatId, `Failed: ${error.message}`);
        return;
      }
      await saveCachedTelegramChatProfile(normalized, chatProfile);
      await adminDb
        .from('businesses')
        .update({ telegram_id: chatIdStr })
        .eq('wallet_address', normalized);
    }

    try {
      const redis = getRedis();
      await redis.del(linkRedisKey(fullCode));
    } catch {
      // Ignore Redis cleanup failures for stateless or expired local-dev link codes.
    }
    await send(bot, chatId, `${TELEGRAM_LINK_SUCCESS_MESSAGE}\n${normalized}`);
  } catch (e: any) {
    await send(bot, chatId, e?.message ?? 'Link failed');
  }
}

type TelegramUserRow = { wallet_address: string };

/** Plain text, e.g. "swap 1 usdc to eurc" or "swap 1 usdc to 1 eurc" or "swap 10 USDC EURC". */
function parseNaturalSwapLine(text: string): { amount: number; fromSym: string; toSym: string } | null {
  const t = text.trim().replace(/[!?.…]+$/u, '').trim();
  if (!/^swap\s/i.test(t)) {
    return null;
  }
  const m =
    t.match(/^swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(?:\d+(?:\.\d+)?\s+)?(\w+)\s*$/i) ||
    t.match(/^swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+for\s+(\w+)\s*$/i) ||
    t.match(/^swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\w+)\s*$/i);
  if (!m) {
    return null;
  }
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return { amount, fromSym: m[2], toSym: m[3] };
}

function normalizeTokenSymbol(symbol: string): string {
  return symbol.trim().replace(/[!?.â€¦,;:]+$/u, '').trim().toUpperCase();
}

function parseNaturalVaultLine(text: string): {
  action: 'deposit' | 'withdraw';
  amount: number;
} | null {
  const t = text.trim().replace(/[!?.…]+$/u, '').trim();
  let m = t.match(/^vault\s+(deposit|withdraw)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    const amount = Number(m[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return { action: m[1]!.toLowerCase() as 'deposit' | 'withdraw', amount };
  }
  m = t.match(/^(deposit|withdraw)\s+(\d+(?:\.\d+)?)(?:\s+usdc)?\s*$/i);
  if (m) {
    const amount = Number(m[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return { action: m[1]!.toLowerCase() as 'deposit' | 'withdraw', amount };
  }
  return null;
}

async function queueSwapConfirmation(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  row: TelegramUserRow,
  amount: number,
  fromSym: string,
  toSym: string,
): Promise<void> {
  const chatIdStr = String(chatId);
  const pair = parseSwapTokenSymbols(fromSym, toSym);
  if (!pair) {
    await send(bot, chatId, 'Unknown token pair. Use USDC or EURC symbols.');
    return;
  }
  const sim = await simulateSwapExecution({
    walletAddress: row.wallet_address,
    tokenIn: pair.tokenIn,
    tokenOut: pair.tokenOut,
    amount,
    fromSym,
    toSym,
  });
  if (!sim.ok || !sim.payload) {
    await send(bot, chatId, sim.blockReason ?? 'Simulation failed.');
    return;
  }

  const pending: PendingAction = { kind: 'swap', payload: sim.payload };
  await getRedis().setex(pendingKey(chatIdStr), PENDING_TTL_SEC, JSON.stringify(pending));
  await send(bot, chatId, sim.summaryLines.join('\n'));
}

async function queueVaultConfirmation(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  _row: TelegramUserRow,
  _action: 'deposit' | 'withdraw',
  _amount: number,
): Promise<void> {
  await send(bot, chatId, TELEGRAM_VAULT_EXECUTION_DISABLED);
}

function shortTx(hash: string): string {
  if (!hash || hash.length < 12) return hash;
  return `${hash.slice(0, 10)}...`;
}

const TELEGRAM_HISTORY_TTL = 60 * 30;
const MAX_HISTORY_MESSAGES = 10;
const TELEGRAM_HISTORY_STORE_MAX = 4000;

type TelegramChatTurn = { role: 'user' | 'assistant'; content: string };

function telegramHistoryKey(chatId: number): string {
  return `telegram:history:${chatId}`;
}

async function getTelegramHistory(chatId: number): Promise<TelegramChatTurn[]> {
  try {
    const raw = await getRedis().get(telegramHistoryKey(chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is TelegramChatTurn => {
      if (!m || typeof m !== 'object') return false;
      const r = m as TelegramChatTurn;
      return (
        (r.role === 'user' || r.role === 'assistant') &&
        typeof r.content === 'string'
      );
    });
  } catch {
    return [];
  }
}

function truncateForTelegramHistory(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

async function appendTelegramHistory(
  chatId: number,
  userMessage: string,
  botReply: string,
  walletAddress?: string,
): Promise<void> {
  try {
    const history = await getTelegramHistory(chatId);
    history.push(
      { role: 'user', content: truncateForTelegramHistory(userMessage, TELEGRAM_HISTORY_STORE_MAX) },
      {
        role: 'assistant',
        content: truncateForTelegramHistory(botReply, TELEGRAM_HISTORY_STORE_MAX),
      },
    );
    const trimmed = history.slice(-MAX_HISTORY_MESSAGES * 2);
    await getRedis().set(
      telegramHistoryKey(chatId),
      JSON.stringify(trimmed),
      'EX',
      TELEGRAM_HISTORY_TTL,
    );

    const category = /(?:portfolio|balance|holdings|positions|vault)/i.test(userMessage)
      ? 'portfolio_context'
      : /(?:research|report|analy[sz]e|news)/i.test(userMessage)
        ? 'research_context'
        : /(?:swap|vault|send|pay|request|invoice|schedule|split|batch|agentpay)/i.test(userMessage)
          ? 'workflow_context'
          : /(?:telegram|intent|router|policy|predmarket|dcw|eoa)/i.test(userMessage)
            ? 'product_policy'
            : null;

    if (
      walletAddress &&
      category &&
      userMessage.trim().length >= 8 &&
      botReply.trim().length >= 16 &&
      !/^I could not|^I couldn't|link your wallet first|Reply failed|Balance failed|Portfolio failed/i.test(
        botReply.trim(),
      )
    ) {
      await rememberSemanticMemory({
        wallet_address: walletAddress,
        session_id: telegramSessionId(chatId),
        memory_type: 'episodic',
        category,
        content: `Earlier in this Telegram thread, the user asked: ${userMessage.replace(/\s+/g, ' ').trim()} | AgentFlow replied: ${botReply.replace(/\s+/g, ' ').trim().slice(0, 700)}`,
        source_user_message: userMessage,
        source_assistant_message: botReply.slice(0, 1200),
        confidence: 0.72,
      });
    }
  } catch (e) {
    console.warn('[telegram] history append failed:', e);
  }
}

async function loadTelegramUserProfileContext(walletAddress: string): Promise<string> {
  try {
    const { data, error } = await adminDb
      .from('user_profiles')
      .select('display_name, preferences, memory_notes')
      .eq('wallet_address', walletAddress)
      .maybeSingle();
    if (error || !data) {
      return '';
    }
    return buildWalletProfileLlmContext(data);
  } catch {
    return '';
  }
}

async function runTelegramChatReply(
  question: string,
  row: TelegramUserRow | null | undefined,
  chatId: number,
): Promise<string> {
  const walletAddr = row?.wallet_address ? getAddress(row.wallet_address) : undefined;

  let memoryContext = '';
  if (walletAddr) {
    const profileBlock = await loadTelegramUserProfileContext(walletAddr);
    const prior = await buildMemoryContext({
      walletAddress: walletAddr,
      agentSlug: 'chat',
      limit: 10,
    });
    const semantic = await buildSemanticMemoryContext({
      walletAddress: walletAddr,
      sessionId: telegramSessionId(chatId),
      query: question,
      limit: 4,
    });
    memoryContext = [profileBlock, semantic, prior].filter(Boolean).join('\n\n').trim();
  }

  const history = await getTelegramHistory(chatId);
  const historyContext =
    history.length > 0
      ? history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n')
      : '';
  const messageWithContext = historyContext
    ? `Previous conversation:\n${historyContext}\n\nUser: ${question}`
    : question;

  const compactPrompt = [
    buildCurrentDateContext(),
    row?.wallet_address
      ? `Telegram is linked to wallet ${getAddress(row.wallet_address)}.`
      : 'Telegram is not linked to a wallet yet.',
    'Reply in a natural Telegram chat tone.',
    'Do not default to a command menu unless the user asks for commands or help.',
    'If the user asks for an action that needs a linked account and there is no linked wallet, tell them to link Telegram in settings first.',
    'If a User profile block appears in memory above, follow its rules: do not address the user by name in every reply.',
    '',
    messageWithContext,
  ].join('\n');

  const answerRaw = await callHermesFast(TELEGRAM_CHAT_SYSTEM_PROMPT, compactPrompt, {
    walletAddress: walletAddr,
    agentSlug: 'chat',
    ...(memoryContext ? { memoryContext } : {}),
  });
  return answerRaw.trim() || 'I could not find a good answer just now.';
}

async function executeParsedIntent(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  row: TelegramUserRow,
  intent: TelegramIntent,
): Promise<void> {
  if (intent.action === 'vault_list') {
    const walletCtx = {
      walletAddress: row.wallet_address,
      executionTarget: 'DCW' as const,
    };
    const result = await executeTool(
      'vault_action',
      { action: 'list' },
      walletCtx,
      telegramSessionId(chatId),
      { readonly: true },
    );
    await send(bot, chatId, result);
    return;
  }
  if (intent.action === 'swap') {
    if (intent.amount == null || intent.amount <= 0 || !intent.tokenIn || !intent.tokenOut) {
      await send(bot, chatId, TELEGRAM_HELP_TEXT);
      return;
    }
    await queueSwapConfirmation(bot, chatId, row, intent.amount, intent.tokenIn, intent.tokenOut);
    return;
  }
  if (intent.action === 'vault') {
    if (intent.amount == null || intent.amount <= 0 || !intent.vaultAction) {
      await send(bot, chatId, TELEGRAM_HELP_TEXT);
      return;
    }
    await queueVaultConfirmation(bot, chatId, row, intent.vaultAction, intent.amount);
    return;
  }
  if (intent.action === 'balance') {
    const execBal = await readExecutionUsdcBalance(row.wallet_address);
    const gwFunding = await getOrCreateGatewayFundingWallet(row.wallet_address);
    const userEoa = getAddress(row.wallet_address) as `0x${string}`;
    const gw = await fetchGatewayBalancesForDepositors([
      getAddress(gwFunding.address) as `0x${string}`,
      userEoa,
    ]);
    await send(bot, chatId, `Execution wallet: ${execBal} USDC\nGateway: ${gw.available} USDC`);
    return;
  }
  if (intent.action === 'portfolio') {
    const snap = await buildPortfolioSnapshot(row.wallet_address);
    await send(bot, chatId, formatPortfolioTelegram(snap));
    return;
  }
  if (intent.action === 'help') {
    await send(bot, chatId, TELEGRAM_HELP_TEXT);
    return;
  }
  await send(bot, chatId, TELEGRAM_HELP_TEXT);
}

type SharedTelegramRouteResult = {
  responseText: string;
  confirmation?: SharedTelegramConfirmation;
};

type TelegramRouteDecision =
  | {
      kind: 'dispatch';
      reason: string;
      classified: AgentFlowIntent;
      validationSeverity: 'pass' | 'soft';
      route: SharedTelegramRouteResult;
    }
  | {
      kind: 'clarify';
      reason: string;
      classified: AgentFlowIntent;
      validationSeverity: 'pass' | 'soft' | 'hard';
      responseText: string;
    }
  | {
      kind: 'chat';
      reason: string;
      classified: AgentFlowIntent;
      validationSeverity: 'pass' | 'soft' | 'hard';
    };

function isTelegramSupportedIntent(intent: AgentFlowIntentName): boolean {
  switch (intent) {
    case AgentFlowIntentName.BalanceGet:
    case AgentFlowIntentName.PortfolioReport:
    case AgentFlowIntentName.VaultList:
    case AgentFlowIntentName.VaultPosition:
    case AgentFlowIntentName.VaultDeposit:
    case AgentFlowIntentName.VaultWithdraw:
    case AgentFlowIntentName.SwapExecute:
    case AgentFlowIntentName.ResearchReport:
    case AgentFlowIntentName.AgentpaySend:
    case AgentFlowIntentName.AgentpayRequest:
    case AgentFlowIntentName.AgentpayHistory:
    case AgentFlowIntentName.AgentpayPaymentLink:
    case AgentFlowIntentName.ContactsList:
    case AgentFlowIntentName.ContactsCreate:
    case AgentFlowIntentName.ContactsUpdate:
    case AgentFlowIntentName.ContactsDelete:
    case AgentFlowIntentName.ScheduleCreate:
    case AgentFlowIntentName.ScheduleCancel:
    case AgentFlowIntentName.ScheduleList:
    case AgentFlowIntentName.SplitExecute:
    case AgentFlowIntentName.BatchExecute:
    case AgentFlowIntentName.InvoiceCreate:
    case AgentFlowIntentName.InvoiceStatus:
    case AgentFlowIntentName.GeneralChat:
      return true;
    default:
      return false;
  }
}

function telegramUnsupportedIntentReply(intent: AgentFlowIntent): string {
  if (intent.domain === AgentFlowDomain.Predmarket) {
    return 'Prediction market actions are not supported in Telegram right now. Use the web app for market browsing and trading.';
  }
  if (intent.intent === AgentFlowIntentName.BridgeExecute || intent.intent === AgentFlowIntentName.BridgePrecheck) {
    return 'Bridge flows are web-only right now. Use the AgentFlow web app to prepare and sign a bridge.';
  }
  return 'That workflow is not supported in Telegram right now. Use the web app for the full flow.';
}

function parseSplitRequest(
  message: string,
): { recipients: string[]; totalAmount: string; remark?: string } | null {
  const raw = message.trim();
  if (!raw) return null;
  const amountMatch = raw.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)?/i);
  if (!amountMatch) return null;
  const totalAmount = amountMatch[1];
  const afterKeyword = raw.match(
    /\b(?:between|among|amongst|to|with)\s+(.+?)(?:\s+(?:for|on|at|remark|note)\s+.+)?$/i,
  );
  const recipientsBlob = afterKeyword?.[1] ?? '';
  const recipients = recipientsBlob
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((r) => r.replace(/^(?:me|myself)$/i, '').trim())
    .filter((r) => r.length > 0);
  if (recipients.length < 2 || recipients.length > 10) return null;
  let remark: string | undefined;
  const remarkMatch = raw.match(/\b(?:for|remark|note)\s+([^,]+?)(?:\s+between|\s+among|\s*$)/i);
  if (remarkMatch) {
    const candidate = remarkMatch[1].trim();
    if (candidate && !/^\d/.test(candidate) && candidate.length < 60) {
      remark = candidate;
    }
  }
  return { recipients, totalAmount, remark };
}

function detectTelegramCsvPaymentMode(csvText: string, captionText?: string, fileName?: string): 'split' | 'batch' | 'schedule' | 'invoice' {
  const caption = captionText?.trim().toLowerCase() || '';
  const normalizedFileName = fileName?.trim().toLowerCase() || '';
  if (/\bscheduled?[_-]?payment\b|\bschedule\b|schedule[_-]/.test(normalizedFileName)) return 'schedule';
  if (/\bsplit\b|split[_-]/.test(normalizedFileName)) return 'split';
  if (/\b(?:batch|payroll|bulk)\b|batch[_-]|payroll[_-]/.test(normalizedFileName)) return 'batch';
  if (/\b(schedule|scheduled|recurring)\b/.test(caption)) return 'schedule';
  if (/\bsplit\b/.test(caption)) return 'split';
  if (/\b(?:batch|payroll|bulk)\b/.test(caption)) return 'batch';

  const filenameOrTitle = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!filenameOrTitle) return 'batch';

  const cells = filenameOrTitle
    .split(/\t|,/)
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);
  if (
    cells.includes('frequency') ||
    cells.includes('cadence') ||
    cells.includes('schedule') ||
    cells.includes('schedule_name') ||
    cells.includes('schedule name')
  ) return 'schedule';
  if (cells[0] === 'invoice') return 'invoice';
  if (cells[0] === 'split') return 'split';
  if (cells[0] === 'batch' || cells[0] === 'batch pay' || cells[0] === 'payroll') return 'batch';
  if (cells[0] === 'title' && cells.some((cell) => /\bsplit\b/.test(cell))) return 'split';
  return 'batch';
}

function parseTelegramCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim().replace(/^["']|["']$/g, ''));
  return cells;
}

function parseTelegramSplitCsvPayment(
  csvText: string,
  captionText?: string,
): { recipients: string[]; totalAmount: string; remark?: string } | { error: string } {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length < 3) {
    return { error: 'Split CSV format: first line "split,30,note", then recipient rows.' };
  }

  const firstCells = parseTelegramCsvLine(lines[0]);
  const captionAmount = captionText?.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/i)?.[1];
  const totalAmount = firstCells[0]?.toLowerCase() === 'split' ? firstCells[1] : captionAmount;
  const totalAmountNum = Number(String(totalAmount ?? '').replace(/[$,]/g, ''));
  if (!Number.isFinite(totalAmountNum) || totalAmountNum <= 0) {
    return { error: 'Split CSV needs one total amount to divide, e.g. "split,30,dinner".' };
  }

  const headerIndex = lines.findIndex((line) => {
    const cells = parseTelegramCsvLine(line).map((cell) => cell.toLowerCase().replace(/[_-]+/g, ' '));
    return cells.some((cell) => ['recipient', 'address', 'wallet', 'to'].includes(cell));
  });
  if (headerIndex < 0) return { error: 'Split CSV needs a recipient header.' };

  const headers = parseTelegramCsvLine(lines[headerIndex]).map((cell) =>
    cell.toLowerCase().replace(/[_-]+/g, ' '),
  );
  if (headers.some((cell) => cell === 'amount' || cell.startsWith('amount '))) {
    return { error: 'Do not put per-recipient amounts in split CSV. Use BatchPay for row amounts.' };
  }
  const recipientIndex = headers.findIndex((cell) => ['recipient', 'address', 'wallet', 'to'].includes(cell));
  if (recipientIndex < 0) return { error: 'Split CSV needs a recipient column.' };

  const recipients = lines
    .slice(headerIndex + 1)
    .map(parseTelegramCsvLine)
    .map((cells) => cells[recipientIndex]?.trim())
    .filter((recipient): recipient is string => Boolean(recipient));
  if (recipients.length < 2) return { error: 'Split CSV needs at least two recipients.' };
  if (recipients.length > 10) return { error: 'Split supports up to 10 recipients.' };

  const titleRemark =
    firstCells[0]?.toLowerCase() === 'split' && firstCells.length >= 3
      ? firstCells.slice(2).join(' ').trim()
      : captionText?.match(/\b(?:for|remark|note)\s+(.+)$/i)?.[1]?.trim();
  return {
    recipients,
    totalAmount: totalAmountNum.toString(),
    remark: titleRemark || undefined,
  };
}

function parseTelegramScheduleCsvPrompt(csvText: string): string | { error: string } {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length < 2) {
    return { error: 'Schedule CSV needs a header row and one schedule row.' };
  }

  const headerIndex = lines.findIndex((line) => {
    const cells = parseTelegramCsvLine(line).map((cell) => cell.toLowerCase().replace(/[_-]+/g, ' '));
    return (
      cells.some((cell) => ['recipient', 'address', 'wallet', 'to'].includes(cell)) &&
      cells.some((cell) => cell === 'amount' || cell.startsWith('amount ')) &&
      cells.some((cell) => ['frequency', 'cadence', 'schedule'].includes(cell))
    );
  });
  if (headerIndex < 0) {
    return {
      error:
        'Schedule CSV columns should include recipient, amount, currency, frequency, day, remark.',
    };
  }

  const headers = parseTelegramCsvLine(lines[headerIndex]).map((cell) =>
    cell.toLowerCase().replace(/[_-]+/g, ' '),
  );
  const recipientIndex = headers.findIndex((cell) => ['recipient', 'address', 'wallet', 'to'].includes(cell));
  const amountIndex = headers.findIndex((cell) => cell === 'amount' || cell.startsWith('amount '));
  const currencyIndex = headers.findIndex((cell) => ['currency', 'token', 'asset'].includes(cell));
  const frequencyIndex = headers.findIndex((cell) => ['frequency', 'cadence', 'schedule'].includes(cell));
  const dayIndex = headers.findIndex((cell) => ['day', 'weekday', 'day of week', 'day of month'].includes(cell));
  const noteIndex = headers.findIndex((cell) => ['note', 'remark', 'memo', 'description'].includes(cell));
  if (recipientIndex < 0 || amountIndex < 0 || frequencyIndex < 0) {
    return { error: 'Schedule CSV is missing recipient, amount, or frequency.' };
  }

  const rows = lines
    .slice(headerIndex + 1)
    .map(parseTelegramCsvLine)
    .filter((cells) => cells.length > Math.max(recipientIndex, amountIndex, frequencyIndex));
  if (rows.length !== 1) {
    return { error: 'Schedule CSV supports one scheduled payment row per upload.' };
  }

  const row = rows[0];
  const recipient = row[recipientIndex]?.trim();
  const amount = Number((row[amountIndex] ?? '').replace(/[$,]/g, ''));
  const currency = (currencyIndex >= 0 ? row[currencyIndex] : 'USDC')?.trim().toUpperCase() || 'USDC';
  const frequency = (row[frequencyIndex] ?? '').trim().toLowerCase();
  const day = dayIndex >= 0 ? (row[dayIndex] ?? '').trim() : '';
  const remark = noteIndex >= 0 ? (row[noteIndex] ?? '').trim() : '';
  if (!recipient || !Number.isFinite(amount) || amount <= 0 || !frequency) {
    return { error: 'Schedule CSV row has invalid recipient, amount, or frequency.' };
  }

  let cadence = frequency;
  if (/weekly|week/.test(frequency)) {
    cadence = day ? `every ${day.toLowerCase()}` : 'weekly';
  } else if (/monthly|month/.test(frequency)) {
    cadence = day ? `every ${day.toLowerCase()}` : 'monthly';
  } else if (/daily|day/.test(frequency)) {
    cadence = 'daily';
  }

  return `schedule ${amount} ${currency} to ${recipient} ${cadence}${remark ? ` for ${remark}` : ''}`;
}

function parseTelegramInvoiceCsvPrompt(csvText: string): string | { error: string } {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length < 3) {
    return { error: 'Invoice CSV needs an "invoice" marker, a header row, and one invoice row.' };
  }

  const marker = parseTelegramCsvLine(lines[0])[0]?.trim().toLowerCase();
  if (marker !== 'invoice') {
    return { error: 'Invoice CSV must start with a first row containing: invoice' };
  }

  const headers = parseTelegramCsvLine(lines[1]).map((cell) =>
    cell.toLowerCase().replace(/[_-]+/g, ' '),
  );
  const recipientIndex = headers.findIndex((cell) =>
    ['recipient', 'address', 'wallet', 'to', 'vendor', 'vendor handle'].includes(cell),
  );
  const amountIndex = headers.findIndex((cell) => cell === 'amount' || cell.startsWith('amount '));
  const currencyIndex = headers.findIndex((cell) => ['currency', 'token', 'asset'].includes(cell));
  const descriptionIndex = headers.findIndex((cell) =>
    ['description', 'remark', 'note', 'memo', 'for'].includes(cell),
  );
  if (recipientIndex < 0 || amountIndex < 0) {
    return { error: 'Invoice CSV columns should include recipient, amount, currency, description.' };
  }

  const rows = lines
    .slice(2)
    .map(parseTelegramCsvLine)
    .filter((cells) => cells.length > Math.max(recipientIndex, amountIndex));
  if (rows.length !== 1) {
    return { error: 'Invoice CSV supports one invoice row per upload.' };
  }

  const row = rows[0];
  const recipient = row[recipientIndex]?.trim();
  const amount = Number((row[amountIndex] ?? '').replace(/[$,]/g, ''));
  const currency = (currencyIndex >= 0 ? row[currencyIndex] : 'USDC')?.trim().toUpperCase() || 'USDC';
  const description = descriptionIndex >= 0 ? (row[descriptionIndex] ?? '').trim() : '';
  if (!recipient || !Number.isFinite(amount) || amount <= 0) {
    return { error: 'Invoice CSV row has invalid recipient or amount.' };
  }
  if (currency !== 'USDC') {
    return { error: 'Invoice CSV currently supports USDC invoices only.' };
  }

  return `create invoice for ${recipient} ${amount} USDC${description ? ` for ${description}` : ''}`;
}

function buildTelegramScheduleIntentFromPrompt(prompt: string): AgentFlowIntent | null {
  const match = prompt.match(
    /^schedule\s+(\d+(?:\.\d+)?)\s+([A-Z]+)\s+to\s+(\S+)\s+(.+?)(?:\s+for\s+(.+))?$/i,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const rawCurrency = match[2]?.toUpperCase() || 'USDC';
  const currency = rawCurrency === 'EURC' ? 'EURC' : 'USDC';
  const recipient = match[3]?.trim();
  const cadence = match[4]?.trim();
  const remark = match[5]?.trim();
  if (!recipient || !Number.isFinite(amount) || amount <= 0 || !cadence) return null;
  return {
    domain: AgentFlowDomain.Schedule,
    intent: AgentFlowIntentName.ScheduleCreate,
    slots: {
      recipient: recipientSlotFromTelegramText(recipient),
      amount: { value: amount, currency },
      schedule: { cadence },
      ...(remark ? { remark } : {}),
    },
    confidence: 0.98,
    source: 'fastpath',
    raw_message: prompt,
  };
}

async function runTelegramSchedulePreviewFromTask(input: {
  task: string;
  walletAddress: string;
}): Promise<SharedTelegramRouteResult> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const scheduleAgentRes = await fetch(`${SCHEDULE_AGENT_BASE_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({ task: input.task, walletAddress: input.walletAddress }),
  });
  const scheduleData = await scheduleAgentRes.json().catch(() => ({
    action: 'error',
    message: 'Schedule agent error',
  })) as {
    message?: string;
    confirmId?: string;
    confirmLabel?: string;
    choices?: Array<{ id: string; label: string; confirmId: string }>;
  };
  return {
    responseText: typeof scheduleData.message === 'string' ? scheduleData.message : 'Schedule agent error',
    confirmation:
      scheduleData.confirmId
        ? {
            action: 'schedule',
            confirmId: scheduleData.confirmId,
            label: scheduleData.confirmLabel || 'Confirm',
          }
        : undefined,
  };
}

async function runTelegramInvoicePreviewFromPrompt(input: {
  prompt: string;
  walletAddress: string;
  sessionId: string;
}): Promise<SharedTelegramRouteResult> {
  const parsed = parseInvoiceRequest(input.prompt);
  if (!parsed) {
    return {
      responseText: 'I read the invoice CSV, but could not prepare an invoice preview.',
    };
  }
  const invoiceNumber = generateInvoiceNumber();
  await getRedis().set(`invoice:pending:${input.sessionId}`, JSON.stringify({
    tool: 'create_invoice',
    walletAddress: input.walletAddress,
    vendorHandle: parsed.vendorHandle,
    amount: parsed.amount,
    description: parsed.description,
    invoiceNumber,
    createdAt: new Date().toISOString(),
  }), 'EX', 900);
  return {
    responseText: [
      `Create invoice ${invoiceNumber}?`,
      '',
      `To: ${parsed.vendorHandle}`,
      `Amount: ${parsed.amount} USDC`,
      `For: ${parsed.description}`,
    ].join('\n'),
    confirmation: {
      action: 'invoice',
      confirmId: `invoice-${input.sessionId}`,
      label: `Create Invoice - ${parsed.amount} USDC`,
    },
  };
}

function recipientSlotFromTelegramText(recipient: string): { handle?: string; address?: `0x${string}` } {
  const cleaned = recipient.trim().replace(/[.,;:!?]+$/g, '');
  if (isAddress(cleaned)) {
    return { address: getAddress(cleaned) as `0x${string}` };
  }
  return { handle: cleaned.toLowerCase() };
}

function buildTelegramSplitIntent(message: string): AgentFlowIntent | null {
  if (!/\b(?:split|divide)\b/i.test(message)) {
    return null;
  }
  const parsed = parseSplitRequest(message);
  if (!parsed) {
    return null;
  }
  const totalAmount = Number(parsed.totalAmount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return null;
  }
  return {
    domain: AgentFlowDomain.Split,
    intent: AgentFlowIntentName.SplitExecute,
    slots: {
      total_amount: { value: totalAmount, currency: 'USDC' },
      recipients: parsed.recipients.map(recipientSlotFromTelegramText),
      ...(parsed.remark ? { remark: parsed.remark } : {}),
      confirmed: false,
    },
    confidence: 0.99,
    source: 'fastpath',
    raw_message: message,
  };
}

function parsePaymentLinkRequest(
  message: string,
): { handle: string; amount?: string; remark?: string } | null {
  const raw = message.trim();
  if (!raw) return null;
  const handleRe = /\b([a-z0-9][a-z0-9-]*\.arc|0x[a-fA-F0-9]{40})\b/i;
  const handleMatch = raw.match(handleRe);
  if (!handleMatch || handleMatch.index === undefined) return null;
  const rawHandle = handleMatch[1];
  const handle = rawHandle.toLowerCase().startsWith('0x')
    ? rawHandle
    : rawHandle.replace(/\.arc$/i, '').toLowerCase();
  const tail = raw.slice(handleMatch.index + handleMatch[0].length);
  let amount: string | undefined;
  const amtMatch = tail.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)?/i);
  if (amtMatch) amount = amtMatch[1];
  const remark = extractAgentpayRemark(tail, { maxLength: 80 });
  return { handle, amount, remark };
}

function parseInvoiceRequest(
  message: string,
): { vendorHandle: string; amount: string; description: string } | null {
  const handleMatch = message.match(
    /(?:for|to)\s+([a-z0-9]+\.arc|0x[a-fA-F0-9]{40}|[a-z0-9][a-z0-9_-]{0,63})/i,
  );
  const amountMatch =
    message.match(/(\d+(?:\.\d+)?)\s*USDC/i) ||
    message.match(/USDC\s*(\d+(?:\.\d+)?)/i) ||
    message.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!handleMatch || !amountMatch) return null;
  const descMatch =
    message.match(/\d+\s*USDC\s+for\s+(.+)$/i) ||
    message.match(/invoice\s+for\s+[a-z0-9.]+\s+\d+\s*(?:USDC)?\s+(?:for\s+)?(.+)$/i);
  return {
    vendorHandle: handleMatch[1].toLowerCase(),
    amount: amountMatch[1],
    description: descMatch?.[1]?.trim() || 'Services rendered',
  };
}

function buildTelegramConfirmationPrompt(action?: SharedTelegramConfirmation): string {
  if (!action) {
    return '';
  }

  const label = action.label?.trim();
  if (label) {
    return `${label}. Reply YES to confirm or NO to cancel.`;
  }

  switch (action.action) {
    case 'schedule':
      return 'Reply YES to create this schedule or NO to cancel.';
    case 'split':
      return 'Reply YES to send this split payment or NO to cancel.';
    case 'invoice':
      return 'Reply YES to create this invoice or NO to cancel.';
    case 'batch':
      return 'Reply YES to run this batch payment or NO to cancel.';
    case 'agentpay_send':
      return 'Reply YES to send this payment or NO to cancel.';
    case 'contact_update':
      return 'Reply YES to update this contact or NO to cancel.';
    default:
      return 'Reply YES to confirm or NO to cancel.';
  }
}

function formatTelegramSharedRouteReply(result: SharedTelegramRouteResult): string {
  let text = result.responseText.trim();
  if (!text) {
    return text;
  }

  if (!result.confirmation) {
    return text;
  }

  const normalizedPrompt = buildTelegramConfirmationPrompt(result.confirmation);
  if (!normalizedPrompt) {
    return text;
  }

  text = text.replace(
    /(?:^|\n)\s*(?:reply\s+)?yes\s+to\s+confirm(?:[^\n]*)?/im,
    '',
  );
  text = text.replace(
    /(?:^|\n)\s*(?:reply\s+)?(?:yes\s+to\s+execute|yes\/no|yes\s+or\s+no|reply\s+yes\s+or\s+no)(?:[^\n]*)?/im,
    '',
  );
  text = text.replace(
    /(?:^|\n)\s*reply\s+"yeah go",\s*"go ahead",\s*or\s*"cancel that"\.?/im,
    '',
  );
  text = text.replace(
    /(?:^|\n)\s*reply\s+"yeah go",\s*"go ahead",\s*or\s*"cancel that"\s+to\s+[^\n]*/im,
    '',
  );
  text = text.trim();

  if (new RegExp(normalizedPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    return text;
  }

  return `${text}\n\n${normalizedPrompt}`;
}

async function runTelegramBatchPreview(input: {
  payments: Array<{ to: string; amount: string; remark?: string }>;
  walletAddress: string;
  sessionId: string;
}): Promise<SharedTelegramRouteResult> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const batchAgentRes = await fetch(`${PUBLIC_API_BASE_URL}/api/batch/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      walletAddress: input.walletAddress,
      payments: input.payments,
    }),
  });
  const batchData = (await batchAgentRes.json().catch(() => ({
    action: 'error',
    message: 'Batch agent error',
  }))) as {
    message?: string;
    confirmId?: string;
    confirmLabel?: string;
    action?: string;
  };
  return {
    responseText: typeof batchData.message === 'string' ? batchData.message : 'Batch agent error',
    confirmation:
      batchData.action === 'preview' && batchData.confirmId
        ? {
            action: 'batch',
            confirmId: batchData.confirmId,
            label: batchData.confirmLabel || 'Send batch',
          }
        : undefined,
  };
}

async function runTelegramSplitPreview(input: {
  recipients: string[];
  totalAmount: string;
  remark?: string;
  walletAddress: string;
  sessionId: string;
}): Promise<SharedTelegramRouteResult> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const splitAgentRes = await fetch(`${PUBLIC_API_BASE_URL}/api/split/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      walletAddress: input.walletAddress,
      recipients: input.recipients,
      totalAmount: input.totalAmount,
      remark: input.remark || '',
    }),
  });
  const splitData = (await splitAgentRes.json().catch(() => ({
    action: 'error',
    message: 'Split agent error',
  }))) as {
    message?: string;
    confirmId?: string;
    confirmLabel?: string;
    action?: string;
  };
  return {
    responseText: typeof splitData.message === 'string' ? splitData.message : 'Split agent error',
    confirmation:
      splitData.action === 'preview' && splitData.confirmId
        ? {
            action: 'split',
            confirmId: splitData.confirmId,
            label: splitData.confirmLabel || 'Confirm split',
          }
        : undefined,
  };
}

async function tryRunSharedTelegramIntentRouter(
  validatedIntent: AgentFlowIntent,
  row: TelegramUserRow,
  chatId: number,
): Promise<SharedTelegramRouteResult | null> {
  try {
    const executionWallet = await getOrCreateUserAgentWallet(row.wallet_address);
    const walletCtx = {
      walletAddress: row.wallet_address,
      executionWalletAddress: executionWallet.address,
      executionTarget: 'DCW' as const,
    };
    const routed = await dispatchIntent({
      intent: validatedIntent,
      walletCtx,
      sessionId: telegramSessionId(chatId),
      deps: {
      executeTool,
      runResearchReport: async (researchTask, options) => ({
        handled: true,
        responseText: await executeTool(
          'research',
          {
            query: researchTask,
            mode: 'fast',
          },
          walletCtx,
          telegramSessionId(chatId),
        ),
        toolCalled: 'research',
      }),
      runSchedule: async (intentValue, walletAddress) => {
        const scheduleSlots = (intentValue.slots ?? {}) as Record<string, any>;
        const recipient =
          typeof scheduleSlots.recipient?.handle === 'string' && scheduleSlots.recipient.handle.trim()
            ? scheduleSlots.recipient.handle.trim()
            : typeof scheduleSlots.recipient?.address === 'string' && scheduleSlots.recipient.address.trim()
              ? scheduleSlots.recipient.address.trim()
              : '';
        const amount =
          typeof scheduleSlots.amount?.value === 'number'
            ? String(scheduleSlots.amount.value)
            : typeof scheduleSlots.amount?.value === 'string' && scheduleSlots.amount.value.trim()
              ? scheduleSlots.amount.value.trim()
              : '';
        const currency =
          typeof scheduleSlots.amount?.currency === 'string' && scheduleSlots.amount.currency.trim()
            ? scheduleSlots.amount.currency.trim().toUpperCase()
            : 'USDC';
        const cadence =
          typeof scheduleSlots.schedule?.cadence === 'string' && scheduleSlots.schedule.cadence.trim()
            ? scheduleSlots.schedule.cadence.trim()
            : '';
        const remark =
          typeof scheduleSlots.remark === 'string' && scheduleSlots.remark.trim()
            ? scheduleSlots.remark.trim()
            : '';
        const task =
          typeof intentValue.raw_message === 'string' && intentValue.raw_message.trim()
            ? intentValue.raw_message.trim()
            : recipient && amount && cadence
              ? `schedule ${amount} ${currency} to ${recipient} ${cadence}${remark ? ` for ${remark}` : ''}`
              : '';
        const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
        const scheduleAgentRes = await fetch(`${SCHEDULE_AGENT_BASE_URL}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
          },
          body: JSON.stringify({ task, walletAddress }),
        });
        const scheduleData = await scheduleAgentRes.json().catch(() => ({
          action: 'error',
          message: 'Schedule agent error',
        })) as {
          message?: string;
          confirmId?: string;
          confirmLabel?: string;
          choices?: Array<{ id: string; label: string; confirmId: string }>;
        };
        return {
          handled: true,
          responseText: typeof scheduleData.message === 'string' ? scheduleData.message : 'Schedule agent error',
          toolCalled: null,
          meta:
            scheduleData.confirmId || scheduleData.choices?.length
              ? {
                  confirmation: {
                    required: true,
                    action: 'schedule',
                    confirmId: scheduleData.confirmId,
                    confirmLabel: scheduleData.confirmLabel || 'Confirm',
                    choices: scheduleData.choices,
                  },
                }
              : undefined,
        };
      },
      listContacts: async (walletAddress) => {
        const w = getAddress(walletAddress);
        const { data: contacts, error } = await adminDb
          .from('contacts')
          .select('*')
          .eq('wallet_address', w)
          .order('name', { ascending: true });
        if (error) {
          return { handled: true, responseText: `Could not load contacts: ${error.message}`, toolCalled: null };
        }
        const rows = Array.isArray(contacts) ? contacts : [];
        return {
          handled: true,
          responseText: rows.length
            ? `Saved contacts:\n\n${rows.map((contact) => `- ${String(contact.name)} -> ${String(contact.address)}`).join('\n')}`
            : 'No saved contacts yet.',
          toolCalled: null,
        };
      },
      createContact: async (walletAddress, name, recipient) => {
        const addressText =
          typeof recipient.handle === 'string' && recipient.handle.trim()
            ? recipient.handle.trim()
            : typeof recipient.address === 'string'
              ? recipient.address.trim()
              : '';
        if (!name || !addressText) {
          return { handled: true, responseText: 'Tell me the contact name and address or .arc handle to save.', toolCalled: null };
        }
        const w = getAddress(walletAddress);
        const resolved = getAddress(await resolvePayee(addressText, w));
        const { error } = await adminDb.from('contacts').insert({
          wallet_address: w,
          name,
          address: resolved,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return {
          handled: true,
          responseText: error ? `Failed to save contact: ${error.message}` : `Saved contact "${name}" -> ${resolved}.`,
          toolCalled: null,
        };
      },
      updateContact: async (walletAddress, name, recipient) => {
        const addressText =
          typeof recipient.handle === 'string' && recipient.handle.trim()
            ? recipient.handle.trim()
            : typeof recipient.address === 'string'
              ? recipient.address.trim()
              : '';
        if (!name || !addressText) {
          return { handled: true, responseText: 'Tell me which contact to update and the new address or .arc handle.', toolCalled: null };
        }
        const w = getAddress(walletAddress);
        const { data: existing } = await adminDb
          .from('contacts')
          .select('address')
          .eq('wallet_address', w)
          .ilike('name', name)
          .maybeSingle();
        if (!existing?.address) {
          return { handled: true, responseText: `Contact "${name}" not found.`, toolCalled: null };
        }
        await getRedis().set(
          `contact:update:${telegramSessionId(chatId)}`,
          JSON.stringify({ name, newAddress: addressText, oldAddress: String(existing.address) }),
          'EX',
          300,
        );
        return {
          handled: true,
          responseText: [`Update contact "${name}"?`, '', `From: ${String(existing.address)}`, `To: ${addressText}`, '', 'Reply YES to confirm.'].join('\n'),
          toolCalled: null,
        };
      },
      deleteContact: async (walletAddress, name) => {
        const w = getAddress(walletAddress);
        const { data: deletedRows, error } = await adminDb
          .from('contacts')
          .delete()
          .eq('wallet_address', w)
          .ilike('name', name)
          .select('id');
        if (error) {
          return { handled: true, responseText: `Failed to remove contact: ${error.message}`, toolCalled: null };
        }
        return {
          handled: true,
          responseText: deletedRows?.length ? `Contact "${name}" removed.` : `No contact named "${name}" found.`,
          toolCalled: null,
        };
      },
      getAgentPayHistory: async (walletAddress) => {
        const rows = await fetchPayHistoryForBrain(walletAddress, 20);
        const lines = Array.isArray(rows) && rows.length
          ? rows.slice(0, 8).map((row: any) => `- ${String(row.direction || row.type || 'payment')}: ${String(row.amount || row.amount_usdc || '?')} USDC ${row.counterparty ? `with ${row.counterparty}` : ''}`.trim()).join('\n')
          : '';
        return {
          handled: true,
          responseText: lines ? `Recent AgentPay activity:\n\n${lines}` : 'No AgentPay payment history found yet.',
          toolCalled: null,
        };
      },
      buildPaymentLink: async (recipient, amount, remark) => {
        const preferredRecipient =
          recipient.registeredNameOwner && recipient.address
            ? await getPreferredAgentpayPaymentLinkHandle(
                recipient.address,
                recipient.registeredNameOwner,
              )
            : recipient.handle || recipient.address || '';
        const parsed = parsePaymentLinkRequest(
          `${preferredRecipient}${amount != null ? ` ${amount} USDC` : ''}${remark ? ` for ${remark}` : ''}`,
        );
        if (!parsed) {
          return {
            handled: true,
            responseText: ['I can build a payment link, but I need a recipient.', '', 'Try: "payment link for jack.arc 5 USDC for coffee"'].join('\n'),
            toolCalled: null,
          };
        }
        const params = new URLSearchParams();
        if (parsed.amount) params.set('amount', parsed.amount);
        if (parsed.remark) params.set('remark', parsed.remark);
        const query = params.toString();
        const handlePath = parsed.handle.startsWith('0x') ? parsed.handle : `${parsed.handle}.arc`;
        const url = `${appUrl(`/pay/${encodeURIComponent(handlePath)}`)}${query ? `?${query}` : ''}`;
        return {
          handled: true,
          responseText: [`Payment link ready:`, url, '', 'Share that link or QR from the web pay page.'].join('\n'),
          toolCalled: null,
        };
      },
      runBatch: async (intentValue, walletAddress, sessionId) => {
        const parsedBatch = parseBatchPaymentsFromMessage(intentValue.raw_message);
        if ('error' in parsedBatch) {
          return {
            handled: true,
            responseText: `I see you want to run a batch payment, but I could not parse the recipients.\n${parsedBatch.error}`,
            toolCalled: null,
          };
        }
        const batchRoute = await runTelegramBatchPreview({
          payments: parsedBatch,
          walletAddress,
          sessionId,
        });
        return {
          handled: true,
          responseText: batchRoute.responseText,
          toolCalled: null,
          meta: batchRoute.confirmation ? { confirmation: { required: true, action: 'batch', confirmId: batchRoute.confirmation.confirmId, confirmLabel: batchRoute.confirmation.label || 'Send batch' } } : undefined,
        };
      },
      runSplit: async (intentValue, walletAddress, sessionId) => {
        const parsed = parseSplitRequest(intentValue.raw_message);
        if (!parsed) {
          return {
            handled: true,
            responseText: 'I see you want to split a payment, but I could not extract the amount and recipients. Try: "split 30 USDC between alice.arc, bob.arc and charlie.arc".',
            toolCalled: null,
          };
        }
        const splitRoute = await runTelegramSplitPreview({
          recipients: parsed.recipients,
          totalAmount: parsed.totalAmount,
          remark: parsed.remark,
          walletAddress,
          sessionId,
        });
        return {
          handled: true,
          responseText: splitRoute.responseText,
          toolCalled: null,
          meta: splitRoute.confirmation ? { confirmation: { required: true, action: 'split', confirmId: splitRoute.confirmation.confirmId, confirmLabel: splitRoute.confirmation.label || 'Confirm split' } } : undefined,
        };
      },
      createInvoice: async (intentValue, walletAddress, sessionId) => {
        const parsed = parseInvoiceRequest(intentValue.raw_message);
        if (!parsed) {
          return {
            handled: true,
            responseText: ['Could not parse invoice details.', '', 'Try: "create invoice for alice.arc 50 USDC for website work"'].join('\n'),
            toolCalled: null,
          };
        }
        const invoiceNumber = generateInvoiceNumber();
        await getRedis().set(`invoice:pending:${sessionId}`, JSON.stringify({
          tool: 'create_invoice',
          walletAddress,
          vendorHandle: parsed.vendorHandle,
          amount: parsed.amount,
          description: parsed.description,
          invoiceNumber,
          createdAt: new Date().toISOString(),
        }), 'EX', 900);
        return {
          handled: true,
          responseText: [
            `Create invoice ${invoiceNumber}?`,
            '',
            `To: ${parsed.vendorHandle}`,
            `Amount: ${parsed.amount} USDC`,
            `For: ${parsed.description}`,
            '',
            'Reply "yeah go", "go ahead", or "cancel that".',
          ].join('\n'),
          toolCalled: null,
          meta: {
            confirmation: {
              required: true,
              action: 'invoice',
              confirmId: `invoice-${sessionId}`,
              confirmLabel: `Create Invoice - ${parsed.amount} USDC`,
            },
          },
        };
      },
      getInvoiceStatus: async (walletAddress) => {
        const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
        const url = new URL('http://127.0.0.1:4000/api/invoice/status');
        url.searchParams.set('walletAddress', walletAddress);
        const response = await fetch(url.toString(), {
          headers: internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {},
        });
        const data = (await response.json().catch(() => ({}))) as { invoices?: Array<Record<string, unknown>>; error?: string };
        if (!response.ok) {
          return { handled: true, responseText: `Failed to fetch invoices: ${data.error || `HTTP ${response.status}`}`, toolCalled: null };
        }
        const invoices = Array.isArray(data.invoices) ? data.invoices : [];
        return {
          handled: true,
          responseText: invoices.length
            ? `Invoices:\n\n${invoices.slice(0, 8).map((invoice) => `- ${String(invoice.invoiceNumber || invoice.id || 'Invoice')} · ${String(invoice.amount || invoice.amountUsdc || '?')} USDC · ${String(invoice.status || 'unknown')}`).join('\n')}`
            : 'No invoices found.',
          toolCalled: null,
        };
      },
    },
  });

    if (!routed.handled || routed.responseAlreadyStreamed) {
      return null;
    }

    const responseText = routed.responseText?.trim() || '';
    if (!responseText) {
      return null;
    }

    if (routed.meta?.confirmation?.required && routed.meta.confirmation.confirmId) {
      return {
        responseText,
        confirmation: {
          action: routed.meta.confirmation.action,
          confirmId: routed.meta.confirmation.confirmId,
          label: routed.meta.confirmation.confirmLabel,
        },
      };
    }

    if (
      validatedIntent.intent === AgentFlowIntentName.ContactsUpdate &&
      (/reply yes to confirm/i.test(responseText) || /^Update contact /i.test(responseText))
    ) {
      return {
        responseText,
        confirmation: {
          action: 'contact_update',
          confirmId: telegramSessionId(chatId),
          label: 'Confirm contact update',
        },
      };
    }

    if (
      validatedIntent.intent === AgentFlowIntentName.AgentpaySend &&
      /reply\s+(?:"yeah go",\s*"go ahead",\s*or\s*"cancel that"|yes\s+to\s+confirm|yes\s+to\s+send|yes\s+to\s+execute)/i.test(
        responseText,
      )
    ) {
      return {
        responseText,
        confirmation: {
          action: 'agentpay_send',
          confirmId: telegramSessionId(chatId),
          label: 'Send payment',
        },
      };
    }

    return { responseText };
  } catch (error) {
    console.warn('[telegram-bot] shared intent router dispatch failed:', error);
    return null;
  }
}

function buildFallbackGeneralChatIntent(text: string): AgentFlowIntent {
  return {
    domain: AgentFlowDomain.General,
    intent: AgentFlowIntentName.GeneralChat,
    slots: { topic_hint: 'fallback' },
    confidence: 0,
    source: 'llm_router',
    raw_message: text,
  };
}

function buildTelegramClarificationReply(text: string, validationClarification?: string): string {
  if (validationClarification?.trim()) {
    return validationClarification.trim();
  }

  const safeFallbackReply = buildSafeDeterministicFallbackReply(text);
  if (safeFallbackReply) {
    return safeFallbackReply;
  }

  return "I understood this as something that may need live AgentFlow context, but I couldn't ground it safely yet.\n\nTell me the asset, amount, recipient, market, or workflow you want, and I'll continue from there.";
}

function extractTelegramResearchTask(text: string): string | null {
  const trimmed = text.trim();
  if (!/\b(?:research|report|analy[sz]e|news|look\s+into|investigate)\b/i.test(trimmed)) {
    return null;
  }
  const cleaned = trimmed
    .replace(/^(?:make|create|generate|write|prepare|run|do|give\s+me)\s+(?:a\s+)?/i, '')
    .replace(/^(?:research\s+report|report|research|analysis|analy[sz]is|news)\s+(?:on|about|for)?\s*/i, '')
    .replace(/\b(?:research\s+report|report|research|analysis|analy[sz]e|look\s+into|investigate)\b/gi, ' ')
    .replace(/\b(?:on|about|for)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || trimmed;
}

async function decideTelegramRoute(
  text: string,
  row: TelegramUserRow,
  chatId: number,
): Promise<TelegramRouteDecision> {
  const deterministicSplit = buildTelegramSplitIntent(text);
  if (deterministicSplit) {
    const validation = validateIntent(deterministicSplit);
    if (validation.severity !== 'hard') {
      const route = await tryRunSharedTelegramIntentRouter(validation.intent, row, chatId);
      if (route) {
        return {
          kind: 'dispatch',
          reason: 'telegram_split_fastpath',
          classified: validation.intent,
          validationSeverity: validation.severity,
          route,
        };
      }
    }
  }

  try {
    const history = await getTelegramHistory(chatId);
    const classified = await classifyIntent(text, history.slice(-6));
    const validation = validateIntent(classified);
    const grounded = needsGroundedAgentflowResolution(text);

    if (!isTelegramSupportedIntent(validation.intent.intent)) {
      return {
        kind: 'clarify',
        reason: 'intent_not_supported_in_telegram',
        classified: validation.intent,
        validationSeverity: validation.severity,
        responseText: telegramUnsupportedIntentReply(validation.intent),
      };
    }

    if (validation.severity === 'hard') {
      return {
        kind: 'clarify',
        reason: 'validator_hard_fail',
        classified: validation.intent,
        validationSeverity: validation.severity,
        responseText: buildTelegramClarificationReply(text, validation.clarification),
      };
    }

    if (validation.intent.intent === AgentFlowIntentName.GeneralChat) {
      if (grounded && validation.intent.confidence < 0.85) {
        return {
          kind: 'clarify',
          reason: 'general_chat_with_grounding_signals',
          classified: validation.intent,
          validationSeverity: validation.severity,
          responseText: buildTelegramClarificationReply(text, validation.clarification),
        };
      }
      return {
        kind: 'chat',
        reason: 'general_chat',
        classified: validation.intent,
        validationSeverity: validation.severity,
      };
    }

    if (validation.intent.confidence < 0.7) {
      if (grounded) {
        return {
          kind: 'clarify',
          reason: 'low_confidence_grounded_request',
          classified: validation.intent,
          validationSeverity: validation.severity,
          responseText: buildTelegramClarificationReply(text, validation.clarification),
        };
      }
      return {
        kind: 'chat',
        reason: 'low_confidence_non_grounded_request',
        classified: validation.intent,
        validationSeverity: validation.severity,
      };
    }

    const route = await tryRunSharedTelegramIntentRouter(validation.intent, row, chatId);
    if (route) {
      return {
        kind: 'dispatch',
        reason: 'shared_router_dispatch',
        classified: validation.intent,
        validationSeverity: validation.severity,
        route,
      };
    }

    if (grounded) {
      return {
        kind: 'clarify',
        reason: 'dispatch_fallthrough_grounded_request',
        classified: validation.intent,
        validationSeverity: validation.severity,
        responseText: buildTelegramClarificationReply(text, validation.clarification),
      };
    }

    return {
      kind: 'chat',
      reason: 'dispatch_fallthrough_non_grounded_request',
      classified: validation.intent,
      validationSeverity: validation.severity,
    };
  } catch (error) {
    console.warn('[telegram-bot] route decision failed:', error);
    const grounded = needsGroundedAgentflowResolution(text);
    return grounded
      ? {
          kind: 'clarify',
          reason: 'route_decision_error_grounded_request',
          classified: buildFallbackGeneralChatIntent(text),
          validationSeverity: 'hard',
          responseText: buildTelegramClarificationReply(text),
        }
      : {
          kind: 'chat',
          reason: 'route_decision_error_non_grounded_request',
          classified: buildFallbackGeneralChatIntent(text),
          validationSeverity: 'hard',
        };
  }
}

async function tryResolveSharedPendingReply(
  text: string,
  row: TelegramUserRow,
  chatId: number,
): Promise<string | null> {
  if (!isTelegramAffirmativeReply(text) && !isTelegramNegativeReply(text)) {
    return null;
  }

  const sessionId = telegramSessionId(chatId);
  const pending = await loadPendingAction(sessionId);
  if (!pending) {
    return null;
  }

  if (isTelegramNegativeReply(text)) {
    await clearPendingAction(sessionId);
    return 'Cancelled.';
  }

  const walletCtx = {
    walletAddress: row.wallet_address,
    executionTarget: 'DCW' as const,
  };

  switch (pending.tool) {
    case 'swap_tokens':
      return executeTool('swap_tokens', { ...pending.args, confirmed: true }, walletCtx, sessionId);
    case 'vault_action':
      return executeTool('vault_action', { ...pending.args, confirmed: true }, walletCtx, sessionId);
    case 'predict_action':
      await clearPendingAction(sessionId);
      return 'Prediction market actions are not supported in Telegram right now. Use the web app for market browsing and trading.';
    default:
      return null;
  }
}

async function executeSharedTelegramConfirmation(
  pending: Extract<PendingAction, { kind: 'shared-confirmation' }>,
  row: TelegramUserRow,
): Promise<string> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (internalKey) {
    headers['X-Agentflow-Brain-Internal'] = internalKey;
  }

  if (pending.action === 'contact_update') {
    const redis = getRedis();
    const key = `contact:update:${pending.confirmId}`;
    const raw = await redis.get(key);
    if (!raw) {
      return 'No pending contact update found. Ask me to preview it again.';
    }
    const parsed = JSON.parse(raw) as { name?: string; newAddress?: string; oldAddress?: string };
    const name = String(parsed.name || '').trim().toLowerCase();
    const newAddress = String(parsed.newAddress || '').trim();
    if (!name || !newAddress) {
      return 'The pending contact update is incomplete. Ask me to preview it again.';
    }
    const wallet = getAddress(row.wallet_address);
    const resolved = getAddress(newAddress.startsWith('0x') ? newAddress : await resolvePayee(newAddress, wallet));
    const { error } = await adminDb
      .from('contacts')
      .update({ address: resolved, updated_at: new Date().toISOString() })
      .eq('wallet_address', wallet)
      .ilike('name', name);
    await redis.del(key).catch(() => {});
    if (error) {
      return `Contact update failed: ${error.message}`;
    }
    return `Updated contact "${name}" -> ${resolved}.`;
  }

  if (pending.action === 'agentpay_send') {
    const toolPending = (await loadPendingAction(pending.confirmId)) as
      | { tool?: string; args?: Record<string, unknown> }
      | null;
    const originalArgs =
      toolPending?.tool === 'agentpay_send' && toolPending.args && typeof toolPending.args === 'object'
        ? toolPending.args
        : {};
    return executeTool(
      'agentpay_send',
      { ...originalArgs, confirmed: true },
      {
        walletAddress: row.wallet_address,
        executionTarget: 'DCW',
      },
      pending.confirmId,
    );
  }

  let endpoint = '';
  switch (pending.action) {
    case 'schedule':
      endpoint = `${PUBLIC_API_BASE_URL}/api/schedule/confirm/${encodeURIComponent(pending.confirmId)}`;
      break;
    case 'split':
      endpoint = `${PUBLIC_API_BASE_URL}/api/split/confirm/${encodeURIComponent(pending.confirmId)}`;
      break;
    case 'batch':
      endpoint = `${PUBLIC_API_BASE_URL}/api/batch/confirm/${encodeURIComponent(pending.confirmId)}`;
      break;
    case 'invoice':
      endpoint = `${PUBLIC_API_BASE_URL}/api/invoice/confirm/${encodeURIComponent(pending.confirmId)}`;
      break;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      walletAddress: row.wallet_address,
      suppressPortfolioFollowup: true,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    payment?: unknown;
    results?: unknown;
  };
  if (!response.ok) {
    return data.error || data.message || `Confirmation failed for ${pending.action}.`;
  }
  const message = data.message || `${pending.label || pending.action} confirmed.`;
  const payment = data.payment as
    | {
        mode?: string;
        agent?: string;
        price?: string;
        requestId?: string;
        transaction?: string | null;
        settlement?: unknown;
      }
    | undefined;
  if (
    payment?.mode !== 'DCW' ||
    !payment.agent?.trim() ||
    !payment.price?.trim() ||
    (!payment.transaction && !payment.settlement)
  ) {
    return message;
  }
  return [
    message,
    '',
    formatX402NanopaymentFeeLine(payment.price),
    `Agent: ${payment.agent}`,
    formatNanopaymentRequestLine(payment.requestId),
  ].join('\n');
}

async function findTelegramFallbackConfirmation(
  text: string,
  row: TelegramUserRow,
  chatId: number,
): Promise<Extract<PendingAction, { kind: 'shared-confirmation' }> | null> {
  if (!isTelegramAffirmativeReply(text) && !isTelegramNegativeReply(text)) {
    return null;
  }

  const sessionId = telegramSessionId(chatId);
  const pending = await loadPendingAction(sessionId);
  if (pending) {
    return null;
  }

  const hasPendingAgentPay = await redisPendingExists(
    (key) => getRedis().get(key),
    AGENTPAY_PENDING_PREFIX,
    sessionId,
  );
  if (!hasPendingAgentPay) {
    return null;
  }

  return {
    kind: 'shared-confirmation',
    action: 'agentpay_send',
    confirmId: sessionId,
    label: 'Send payment',
  };
}

function findTxHashDeep(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const f = findTxHashDeep(item);
      if (f) return f;
    }
    return undefined;
  }
  const o = obj as Record<string, unknown>;
  for (const k of ['txHash', 'transactionHash', 'hash']) {
    const v = o[k];
    if (typeof v === 'string' && /^0x[a-fA-F0-9]{64}$/.test(v)) {
      return v;
    }
  }
  for (const v of Object.values(o)) {
    const f = findTxHashDeep(v);
    if (f) return f;
  }
  return undefined;
}

async function readExecutionUsdcBalance(walletAddress: string): Promise<string> {
  const wallet = await getOrCreateUserAgentWallet(walletAddress);
  const client = createPublicClient({ chain, transport: arcReadTransport() });
  const addr = getAddress(wallet.address) as `0x${string}`;
  const raw = (await client.readContract({
    address: ARC_USDC,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [addr],
  })) as bigint;
  return Number(formatUnits(raw, 6)).toFixed(2);
}

function formatPortfolioTelegram(snapshot: Awaited<ReturnType<typeof buildPortfolioSnapshot>>): string {
  let usdc = '0.00';
  let eurc = '0.00';
  let vaultShares = '0';
  let vaultSym = 'afvUSDC';
  for (const h of snapshot.holdings) {
    if (h.symbol === 'USDC' && h.kind !== 'vault_share') {
      usdc = Number(h.balanceFormatted).toFixed(2);
    }
    if (h.symbol === 'EURC') {
      eurc = Number(h.balanceFormatted).toFixed(2);
    }
    if (h.kind === 'vault_share') {
      vaultShares = Number(h.balanceFormatted).toFixed(0);
      vaultSym = h.symbol || 'afvUSDC';
    }
  }
  const total = snapshot.pnlSummary.currentValueUsd;
  const pnl = snapshot.pnlSummary.pnlUsd;
  const pnlPct = snapshot.pnlSummary.pnlPct;
  const sign = pnl >= 0 ? '+' : '';
  return [
    'Portfolio Summary',
    `USDC: ${usdc}`,
    `EURC: ${eurc}`,
    `Vault shares: ${vaultShares} (${vaultSym})`,
    `Total: ~$${total.toFixed(2)}`,
    `P&L: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`,
  ].join('\n');
}

export async function startTelegramBot(): Promise<void> {
  if (!(await acquireTelegramPollLock())) {
    return;
  }

  const bot = createTelegramBotForPolling();

  const releaseAndStop = async () => {
    try {
      await bot.stopPolling();
    } catch {
      /* ignore */
    }
    await releaseTelegramPollLock();
  };

  process.once('SIGINT', () => {
    void releaseAndStop();
  });
  process.once('SIGTERM', () => {
    void releaseAndStop();
  });
  process.once('exit', () => {
    void releaseTelegramPollLock();
  });

  bot.on('polling_error', async (error: any) => {
    const message = String(error?.message ?? '');
    if (/409 Conflict/i.test(message)) {
      console.error(
        '[telegram-bot] polling conflict detected; another Telegram poller is active for this bot token. Stopping local polling.',
      );
      await releaseAndStop();
      return;
    }
    console.error('[telegram-bot] polling_error', error);
  });

  bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match?.[1]?.trim();
    const chatIdStr = String(chatId);
    void getRedis()
      .del(telegramHistoryKey(chatId))
      .catch(() => {});

    if (arg && telegramLinkCode.parseTelegramLinkCode(arg).ok) {
      await applyTelegramLinkCode(bot, chatId, arg, extractTelegramProfileFromMessage(msg));
      return;
    }

    if (arg && isAddress(arg)) {
      try {
        const addr = getAddress(arg);
        await adminDb.from('users').update({ telegram_id: null }).eq('telegram_id', chatIdStr);
        const { data, error } = await adminDb
          .from('users')
          .update({ telegram_id: chatIdStr })
          .eq('wallet_address', addr)
          .select('wallet_address');
        if (error) {
          await send(bot, chatId, `Could not link: ${error.message}`);
          return;
        }
        if (!data?.length) {
          await send(
            bot,
            chatId,
            `Wallet not found. Connect your wallet at ${APP_BASE_URL} first.`,
          );
          return;
        }
        await adminDb
          .from('businesses')
          .update({ telegram_id: chatIdStr })
          .eq('wallet_address', addr);
        await saveCachedTelegramChatProfile(addr, extractTelegramProfileFromMessage(msg));
        await send(bot, chatId, `${TELEGRAM_LINK_SUCCESS_MESSAGE}\n${addr}`);
        return;
      } catch (e: any) {
        await send(bot, chatId, e?.message ?? 'Link failed');
        return;
      }
    }

    const row = await getUserByTelegram(chatIdStr);
    if (!row) {
      await send(
        bot,
        chatId,
        [
          'AgentFlow — account not linked.',
          '',
          'To link:',
          '1) Open ' + APP_URLS.settings + ' → Connect Telegram',
          '2) Tap Open app or Open web to launch Telegram and link automatically',
          '3) Wait for the bot to confirm your wallet is linked',
          '',
          'Fallback only: send /link and paste your AF-… code, or use /start 0xYourWallet if you use that flow.',
        ].join('\n'),
      );
      return;
    }

    let greetingLine = 'Welcome back!';
    try {
      const linkedAddr = getAddress(row.wallet_address);
      const { data: profile } = await adminDb
        .from('user_profiles')
        .select('display_name')
        .eq('wallet_address', linkedAddr)
        .maybeSingle();
      const name = (profile as { display_name?: string | null } | null)?.display_name?.trim();
      if (name) {
        greetingLine = `Welcome back, ${name}!`;
      }
    } catch {
      /* keep default */
    }

    await send(
      bot,
      chatId,
      [
        greetingLine,
        '/balance — execution + Gateway USDC',
        '/swap, /portfolio',
        'Vaults are read-only in Telegram: say "show me vaults"',
        '/help — full list',
      ].join('\n'),
    );
  });

  bot.onText(/^\/help(?:@\w+)?$/i, async (msg) => {
    const chatIdStr = String(msg.chat.id);
    if (!(await getLinkedWalletRow(chatIdStr))) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }
    await send(
      bot,
      msg.chat.id,
      [
        'Commands:',
        '/link — fallback manual linking with your AF-… code',
        '/balance — execution wallet + Gateway USDC',
        '/swap AMOUNT FROM TO — e.g. /swap 10 USDC EURC',
        'Or plain text: swap 1 USDC to EURC',
        'Vaults: say "show me vaults" for read-only vault info',
        '/portfolio - snapshot',
        '/unlink — disconnect Telegram',
        '',
        'Primary linking flow: app settings → Connect Telegram → Open app/Open web.',
        'Use /link only if the automatic deep link does not open correctly.',
        'After a preview, reply YES to confirm or NO to cancel (5 min window).',
      ].join('\n'),
    );
  });

  bot.onText(/^\/link(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match?.[1]?.trim() ?? '';
    if (!raw) {
      const row = await getLinkedWalletRow(String(chatId));
      if (row) {
        await send(
          bot,
          chatId,
          [
            'Telegram is already linked to your AgentFlow wallet.',
            row.wallet_address,
            '',
            'You can send payments or use /help. Use /unlink only if you want to connect a different wallet.',
          ].join('\n'),
        );
        return;
      }
      await sendLinkCodeForceReply(bot, chatId);
      return;
    }
    await applyTelegramLinkCode(bot, chatId, raw, extractTelegramProfileFromMessage(msg));
  });

  bot.onText(/^\/unlink(?:@\w+)?$/i, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!(await getLinkedWalletRow(chatId))) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }
    const { error } = await adminDb.from('users').update({ telegram_id: null }).eq('telegram_id', chatId);
    if (error) {
      await send(bot, msg.chat.id, error.message);
      return;
    }
    await adminDb.from('businesses').update({ telegram_id: null }).eq('telegram_id', chatId);
    await send(bot, msg.chat.id, 'Telegram unlinked');
  });

  bot.onText(/^\/balance(?:@\w+)?$/i, async (msg) => {
    const chatId = String(msg.chat.id);
    const row = await getLinkedWalletRow(chatId);
    if (!row) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }
    try {
      const execBal = await readExecutionUsdcBalance(row.wallet_address);
      const gwFunding = await getOrCreateGatewayFundingWallet(row.wallet_address);
      const userEoa = getAddress(row.wallet_address) as `0x${string}`;
      const gw = await fetchGatewayBalancesForDepositors([
        getAddress(gwFunding.address) as `0x${string}`,
        userEoa,
      ]);
      await send(
        bot,
        msg.chat.id,
        `Execution wallet: ${execBal} USDC\nGateway: ${gw.available} USDC`,
      );
    } catch (e: any) {
      await send(bot, msg.chat.id, e?.message ?? 'Balance failed');
    }
  });

  bot.onText(/^\/portfolio(?:@\w+)?$/i, async (msg) => {
    const chatId = String(msg.chat.id);
    const row = await getLinkedWalletRow(chatId);
    if (!row) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }
    try {
      const snap = await buildPortfolioSnapshot(row.wallet_address);
      await send(bot, msg.chat.id, formatPortfolioTelegram(snap));
    } catch (e: any) {
      await send(bot, msg.chat.id, e?.message ?? 'Portfolio failed');
    }
  });

  bot.onText(/^\/swap(?:@\w+)?\s+(\S+)\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const chatIdStr = String(chatId);
    const row = await getLinkedWalletRow(chatIdStr);
    if (!row) {
      await sendTelegramLinkRequired(bot, chatId);
      return;
    }
    const amount = Number(match?.[1]);
    const fromSym = match?.[2] ?? '';
    const toSym = match?.[3] ?? '';
    if (!Number.isFinite(amount) || amount <= 0) {
      await send(bot, chatId, 'Usage: /swap AMOUNT FROM TO — e.g. /swap 10 USDC EURC');
      return;
    }
    await queueSwapConfirmation(bot, chatId, row, amount, fromSym, toSym);
  });

  bot.onText(/^\/vault(?:@\w+)?\s+(deposit|withdraw)\s+(\S+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const chatIdStr = String(chatId);
    const row = await getLinkedWalletRow(chatIdStr);
    if (!row) {
      await sendTelegramLinkRequired(bot, chatId);
      return;
    }
    const action = (match?.[1] ?? '').toLowerCase() as 'deposit' | 'withdraw';
    const amount = Number(match?.[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      await send(bot, chatId, 'Usage: /vault deposit|withdraw AMOUNT');
      return;
    }
    await queueVaultConfirmation(bot, chatId, row, action, amount);
  });

  bot.on('message', async (msg) => {
    const plain = (msg.text ?? msg.caption ?? '').trim();
    const extractedTelegramProfile = extractTelegramProfileFromMessage(msg);
    if (extractedTelegramProfile) {
      const linkedRow = await getLinkedWalletRow(String(msg.chat.id));
      if (linkedRow?.wallet_address) {
        void saveCachedTelegramChatProfile(linkedRow.wallet_address, extractedTelegramProfile);
      }
    }

    if (plain && isReplyToLinkPrompt(msg) && !plain.startsWith('/')) {
      const linked = await getLinkedWalletRow(String(msg.chat.id));
      if (linked) {
        const promptMessageId = msg.reply_to_message?.message_id;
        if (promptMessageId) {
          await bot.deleteMessage(msg.chat.id, promptMessageId).catch(() => {});
        }
        await send(
          bot,
          msg.chat.id,
          [
            'Telegram is already linked to your AgentFlow wallet.',
            linked.wallet_address,
            '',
            'The old mobile link prompt has been cleared. Please send your command again.',
          ].join('\n'),
        );
        return;
      }
      await applyTelegramLinkCode(bot, msg.chat.id, plain, extractTelegramProfileFromMessage(msg));
      return;
    }

    if (
      plain &&
      !plain.startsWith('/') &&
      /^(swap|vault|deposit|withdraw)\b/i.test(plain)
    ) {
      const swapNl = parseNaturalSwapLine(plain);
      const vaultNl = parseNaturalVaultLine(plain);
      if (swapNl || vaultNl) {
        const chatIdStr = String(msg.chat.id);
        const row = await getLinkedWalletRow(chatIdStr);
        if (!row) {
          await sendTelegramLinkRequired(bot, msg.chat.id);
          return;
        }
        if (swapNl) {
          await queueSwapConfirmation(
            bot,
            msg.chat.id,
            row,
            swapNl.amount,
            swapNl.fromSym,
            swapNl.toSym,
          );
          return;
        }
        if (vaultNl) {
          await queueVaultConfirmation(bot, msg.chat.id, row, vaultNl.action, vaultNl.amount);
          return;
        }
      } else if (/^swap\s/i.test(plain)) {
        const chatIdStr = String(msg.chat.id);
        if (!(await getLinkedWalletRow(chatIdStr))) {
          await sendTelegramLinkRequired(bot, msg.chat.id);
          return;
        }
        await send(
          bot,
          msg.chat.id,
          'Could not parse that swap. Try: swap 1 USDC EURC or swap 1 USDC to EURC',
        );
        return;
      } else if (/^(vault|deposit|withdraw)\b/i.test(plain)) {
        const chatIdStr = String(msg.chat.id);
        if (!(await getLinkedWalletRow(chatIdStr))) {
          await sendTelegramLinkRequired(bot, msg.chat.id);
          return;
        }
        await send(bot, msg.chat.id, TELEGRAM_VAULT_EXECUTION_DISABLED);
        return;
      }
    }

    const mediaTarget = await maybeDecodeTelegramPaymentTarget(bot, msg);
    let csvDocumentText: string | null = null;
    try {
      csvDocumentText = await maybeReadTelegramCsvDocument(bot, msg);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read CSV file.';
      await send(bot, msg.chat.id, message);
      return;
    }

    const rawCaptionOrText = normalizeCommand(msg.text ?? msg.caption ?? '');
    const rawText = csvDocumentText
      ? `${rawCaptionOrText || 'batch pay'}\n${csvDocumentText}`
      : rawCaptionOrText;
    if (!rawText || rawText.startsWith('/')) {
      if (mediaTarget) {
        const prompt = [
          `I decoded a payment QR for ${mediaTarget.displayRecipient}.`,
          mediaTarget.amount ? `QR amount: ${mediaTarget.amount} USDC.` : '',
          mediaTarget.remark ? `QR remark: ${mediaTarget.remark}.` : '',
          '',
          `Now say something like: "pay 1 usdc to it" or "request 5 usdc from ${mediaTarget.displayRecipient}".`,
        ]
          .filter(Boolean)
          .join('\n');
        await send(bot, msg.chat.id, prompt);
      }
      return;
    }

    const rememberedTarget =
      mediaTarget || (messageReferencesTelegramQrTarget(rawText) ? await loadTelegramMediaTarget(msg.chat.id) : null);
    const text = rememberedTarget
      ? rewriteTelegramPaymentTextWithTarget(rawText, rememberedTarget)
      : rawText;

    const chatId = String(msg.chat.id);
    if (!(await getLinkedWalletRow(chatId))) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }

    const redis = getRedis();
    const row = await getUserByTelegram(chatId);
    if (!row) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }

    if (csvDocumentText) {
      const csvMode = detectTelegramCsvPaymentMode(
        csvDocumentText,
        rawCaptionOrText,
        String(msg.document?.file_name || ''),
      );
      let route: SharedTelegramRouteResult;
      if (csvMode === 'invoice') {
        const invoicePrompt = parseTelegramInvoiceCsvPrompt(csvDocumentText);
        if (typeof invoicePrompt !== 'string') {
          const reply = [
            'I read this as an invoice CSV, but could not prepare the invoice.',
            invoicePrompt.error,
          ].join('\n');
          await send(bot, msg.chat.id, reply);
          await appendTelegramHistory(msg.chat.id, '[csv invoice upload]', reply, row.wallet_address);
          return;
        }
        console.info('[telegram-bot] invoice csv parsed', {
          fileName: String(msg.document?.file_name || ''),
          invoicePrompt,
        });
        route = await runTelegramInvoicePreviewFromPrompt({
          prompt: invoicePrompt,
          walletAddress: row.wallet_address,
          sessionId: telegramSessionId(msg.chat.id),
        });
      } else if (csvMode === 'schedule') {
        const schedulePrompt = parseTelegramScheduleCsvPrompt(csvDocumentText);
        if (typeof schedulePrompt !== 'string') {
          const reply = [
            'I read this as a schedule CSV, but could not prepare the schedule.',
            schedulePrompt.error,
          ].join('\n');
          await send(bot, msg.chat.id, reply);
          await appendTelegramHistory(msg.chat.id, '[csv schedule upload]', reply, row.wallet_address);
          return;
        }
        console.info('[telegram-bot] schedule csv parsed', {
          fileName: String(msg.document?.file_name || ''),
          schedulePrompt,
        });
        route = await runTelegramSchedulePreviewFromTask({
          task: schedulePrompt,
          walletAddress: row.wallet_address,
        });
      } else if (csvMode === 'split') {
        const splitInput = parseTelegramSplitCsvPayment(csvDocumentText, rawCaptionOrText);
        if ('error' in splitInput) {
          const reply = [
            'I read this as a split CSV, but could not prepare the split.',
            splitInput.error,
          ].join('\n');
          await send(bot, msg.chat.id, reply);
          await appendTelegramHistory(msg.chat.id, '[csv split upload]', reply, row.wallet_address);
          return;
        }
        route = await runTelegramSplitPreview({
          ...splitInput,
          walletAddress: row.wallet_address,
          sessionId: telegramSessionId(msg.chat.id),
        });
      } else {
        const parsedRows = parseInlineCsvFromMessage(rawText);
        if ('error' in parsedRows) {
          const reply = [
            'I read the CSV file, but could not parse the batch rows.',
            parsedRows.error,
            '',
            'Use columns like: recipient,amount_usdc,note',
          ].join('\n');
          await send(bot, msg.chat.id, reply);
          await appendTelegramHistory(msg.chat.id, '[csv upload]', reply, row.wallet_address);
          return;
        }
        route = await runTelegramBatchPreview({
          payments: parsedRows,
          walletAddress: row.wallet_address,
          sessionId: telegramSessionId(msg.chat.id),
        });
      }
      if (route.confirmation) {
        const pendingConfirmation: PendingAction = {
          kind: 'shared-confirmation',
          action: route.confirmation.action,
          confirmId: route.confirmation.confirmId,
          label: route.confirmation.label,
        };
        await redis.setex(pendingKey(chatId), PENDING_TTL_SEC, JSON.stringify(pendingConfirmation));
      }
      const formattedReply = formatTelegramSharedRouteReply(route);
      await send(bot, msg.chat.id, formattedReply);
      await appendTelegramHistory(msg.chat.id, '[csv upload]', formattedReply, row.wallet_address);
      return;
    }

    if (/\b(?:show|list|view|see)\b[\s\S]*\bvaults?\b|\bvaults?\b[\s\S]*\b(?:options|list)\b/i.test(text)) {
      const walletCtx = {
        walletAddress: row.wallet_address,
        executionTarget: 'DCW' as const,
      };
      const result = await executeTool(
        'vault_action',
        { action: 'list' },
        walletCtx,
        telegramSessionId(msg.chat.id),
        { readonly: true },
      );
      await send(bot, msg.chat.id, result);
      await appendTelegramHistory(msg.chat.id, text, result, row.wallet_address);
      return;
    }

    const researchTask = extractTelegramResearchTask(text);
    if (researchTask) {
      const walletCtx = {
        walletAddress: row.wallet_address,
        executionTarget: 'DCW' as const,
      };
      await send(
        bot,
        msg.chat.id,
        `Running research pipeline for: ${researchTask}\nx402 nanopayments will settle Research -> Analyst -> Writer. This can take 1-2 minutes.`,
      );
      const result = await executeTool(
        'research',
        { query: researchTask, mode: /\bdeep\b/i.test(text) ? 'deep' : 'fast' },
        walletCtx,
        telegramSessionId(msg.chat.id),
        { maxLength: 12000 },
      );
      await send(bot, msg.chat.id, result);
      await appendTelegramHistory(msg.chat.id, text, result, row.wallet_address);
      return;
    }

    await captureTelegramSemanticCorrection(row, msg.chat.id, text).catch((error) => {
      console.warn('[telegram-bot] semantic correction capture failed:', error);
    });

    const sharedPendingReply = await tryResolveSharedPendingReply(text, row, msg.chat.id);
    if (sharedPendingReply) {
      await send(bot, msg.chat.id, sharedPendingReply);
      await appendTelegramHistory(msg.chat.id, text, sharedPendingReply, row.wallet_address);
      return;
    }

    if (isTelegramNegativeReply(text)) {
      const rawNo = await redis.get(pendingKey(chatId));
      if (rawNo) {
        await redis.del(pendingKey(chatId));
        await send(bot, msg.chat.id, 'Cancelled.');
        await appendTelegramHistory(msg.chat.id, text, 'Cancelled.', row.wallet_address);
        return;
      }
    }

    if (!isTelegramAffirmativeReply(text)) {
      const routeDecision = await decideTelegramRoute(text, row, msg.chat.id);
      await logTelegramRoutingEvent({
        at: new Date().toISOString(),
        chatId: msg.chat.id,
        text,
        policy: routeDecision.kind,
        reason: routeDecision.reason,
        classifiedIntent: routeDecision.classified.intent,
        classifiedDomain: routeDecision.classified.domain,
        confidence: routeDecision.classified.confidence,
        validationSeverity: routeDecision.validationSeverity,
      });

      if (routeDecision.kind === 'dispatch') {
        if (routeDecision.route.confirmation) {
          const pendingConfirmation: PendingAction = {
            kind: 'shared-confirmation',
            action: routeDecision.route.confirmation.action,
            confirmId: routeDecision.route.confirmation.confirmId,
            label: routeDecision.route.confirmation.label,
          };
          await redis.setex(pendingKey(chatId), PENDING_TTL_SEC, JSON.stringify(pendingConfirmation));
        }
        const formattedReply = formatTelegramSharedRouteReply(routeDecision.route);
        await send(bot, msg.chat.id, formattedReply);
        await appendTelegramHistory(msg.chat.id, text, formattedReply, row.wallet_address);
        return;
      }

      if (routeDecision.kind === 'clarify') {
        await send(bot, msg.chat.id, routeDecision.responseText);
        await appendTelegramHistory(msg.chat.id, text, routeDecision.responseText, row.wallet_address);
        return;
      }

      try {
        const answer = await runTelegramChatReply(text, row, msg.chat.id);
        await send(bot, msg.chat.id, answer);
        await appendTelegramHistory(msg.chat.id, text, answer, row.wallet_address);
      } catch (e: any) {
        console.error('[telegram-bot] fallback reply failed', e);
        await send(bot, msg.chat.id, e?.message ?? 'Reply failed');
      }
      return;
    }

    const raw = await redis.get(pendingKey(chatId));
    if (!raw) {
      const fallbackPending = await findTelegramFallbackConfirmation(text, row, msg.chat.id);
      if (!fallbackPending) {
        const expiredReply =
          'No pending confirmation found. The previous quote likely expired. Please run the swap again to get a fresh quote.';
        await send(bot, msg.chat.id, expiredReply);
        await appendTelegramHistory(msg.chat.id, text, expiredReply, row.wallet_address);
        return;
      }

      try {
        const result = await executeSharedTelegramConfirmation(fallbackPending, row);
        await send(bot, msg.chat.id, result);
        await appendTelegramHistory(msg.chat.id, text, result, row.wallet_address);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Confirmation failed');
      }
      return;
    }

    let pending: PendingAction;
    try {
      pending = JSON.parse(raw) as PendingAction;
    } catch {
      await redis.del(pendingKey(chatId));
      return;
    }
    await redis.del(pendingKey(chatId));

    if (pending.kind === 'shared-confirmation') {
      try {
        const result = await executeSharedTelegramConfirmation(pending, row);
        await send(bot, msg.chat.id, result);
        await appendTelegramHistory(msg.chat.id, text, result, row.wallet_address);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Confirmation failed');
      }
      return;
    }

    if (pending.kind === 'swap') {
      try {
        const result = await executeTelegramSwap({
          payload: pending.payload,
          onStatus: async (m) => {
            await send(bot, msg.chat.id, `⏳ ${m}`);
          },
        });
        const txShort = shortTx(result.txHash);
        const explorer = `https://testnet.arcscan.app/tx/${result.txHash}`;
        const body =
          result.receiptMessage ??
          [
            `\u2705 Swapped ${result.amountIn} ${pending.payload.fromSym} \u2192 ${Number(result.amountOutFormatted).toFixed(2)} ${pending.payload.toSym}`,
            `Tx: ${txShort}`,
            `View: ${explorer}`,
          ].join('\n');
        await send(bot, msg.chat.id, body);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Swap failed');
      }
      return;
    }
  });

  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Welcome and how to link' },
      { command: 'link', description: 'Paste AF- code (opens reply field)' },
      { command: 'help', description: 'All commands' },
      { command: 'balance', description: 'Execution wallet + Gateway USDC' },
      { command: 'portfolio', description: 'Portfolio summary' },
      { command: 'unlink', description: 'Disconnect Telegram from wallet' },
    ]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[telegram-bot] setMyCommands failed', e);
  }

  // eslint-disable-next-line no-console
  console.log('[telegram-bot] polling started');
}

function isRunDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isRunDirectly()) {
  if (process.env.SKIP_TELEGRAM_BOT === '1' || process.env.SKIP_TELEGRAM_BOT === 'true') {
    // eslint-disable-next-line no-console
    console.log(
      '[telegram-bot] SKIP_TELEGRAM_BOT=1 — not starting polling (avoids 409 if another bot instance uses the same token).',
    );
    process.exit(0);
  }
  if (!getTelegramBotToken()) {
    // eslint-disable-next-line no-console
    console.warn('[telegram-bot] TELEGRAM_BOT_TOKEN not set; skipping bot (set token to enable).');
    process.exit(0);
  } else {
    startTelegramBot().catch((err) => {
      console.error('[telegram-bot]', err);
      process.exit(1);
    });
  }
}
