import './loadEnv';
import { pathToFileURL } from 'node:url';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
} from 'viem';
import { adminDb, getRedis } from '../db/client';
import { checkRateLimit } from './ratelimit';
import { checkSpendingLimits, getOrCreateUserAgentWallet } from './dcw';
import { fetchGatewayBalancesForDepositors, getOrCreateGatewayFundingWallet } from './gateway-balance';
import { createTelegramBotForPolling, getTelegramBotToken } from './telegram-notify';
import { parseTelegramIntent, type TelegramIntent } from './telegram-intent-parser';
import { parseSwapTokenSymbols } from './swap-symbols';
import {
  executeTelegramSwap,
  simulateSwapExecution,
  type SwapSimulationExecutionPayload,
} from './runners/telegramSwap';
import { checkEntitlement } from './usyc';
import {
  executeTelegramVault,
  simulateTelegramVault,
  simulateTelegramUsyc,
  type VaultExecutionPayload,
} from './runners/telegramVault';
import { formatBridgeReceipt } from './telegramReceipts';
import { getBridgeReceiptDetails, parseSseJsonPayload } from './bridgeRunReceipt';
import {
  BRIDGE_AGENT_PRICE_LABEL,
  ensureSponsoredBridgeLedger,
  executeSponsoredBridgeViaX402,
  SPONSORED_BRIDGE_DAILY_LIMIT_USDC,
  SPONSORED_BRIDGE_USAGE_SCOPE,
} from './paidAgentX402';
import {
  arcscanTxViewUrl,
  feeUsdcStringFromLabel,
  formatNanopaymentRequestLine,
  shortHash,
} from './telegramX402SuccessCopy';
import { incrementDailyUsageAmount, readDailyUsageAmount } from './usageCaps';
import { runPortfolioFollowupAfterTool } from './a2a-followups';
import { PORTFOLIO_AGENT_PRICE_LABEL, PORTFOLIO_AGENT_RUN_URL } from './agentRunConfig';
import {
  bridgeTransferExecute,
  formatBridgeSimulationForTelegram,
  simulateBridgeTransfer,
  type SupportedSourceChain,
} from '../agents/bridge/bridgeKit';
import { buildPortfolioSnapshot } from '../agents/portfolio/portfolio';
import { ARC } from './arc-config';
import { buildMemoryContext, callHermesFast } from './hermes';
import {
  TELEGRAM_CHAT_SYSTEM_PROMPT,
  buildCurrentDateContext,
  buildWalletProfileLlmContext,
} from './chatPersona';
import telegramLinkCode from './telegram-link-code';

const APP_BASE =
  process.env.APP_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  'https://agentflow.one';

const TELEGRAM_LINK_REQUIRED_MESSAGE =
  `⚠️ Please link your wallet first to use AgentFlow.\n\n` +
  `Go to ${APP_BASE}/settings → Connect Telegram\n` +
  `Then open Telegram from the app to finish linking automatically.`;

const TELEGRAM_LINK_SUCCESS_MESSAGE =
  '✅ Wallet linked! You can now use AgentFlow.';

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

const PENDING_TTL_SEC = 120;

function linkRedisKey(code: string): string {
  return `telegram:link:${code.trim().toUpperCase()}`;
}

function normalizeCommand(text: string): string {
  return text.replace(/@\w+$/i, '').trim();
}

type PendingAction =
  | { kind: 'swap'; payload: SwapSimulationExecutionPayload }
  | { kind: 'vault'; payload: VaultExecutionPayload }
  | {
      kind: 'bridge';
      sourceChain: SupportedSourceChain;
      recipientAddress: string;
      amount: string;
      walletAddress: string;
    }
  | {
      kind: 'intent-confirmation';
      intent: TelegramIntent;
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
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk, { disable_web_page_preview: true });
  }
}

const TELEGRAM_MAX_MESSAGE_LENGTH = 3500;

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
  '/vault deposit 5',
  '/bridge 1 ethereum-sepolia',
  '/balance',
  '/portfolio',
].join('\n');

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

/** Telegram ForceReply: client shows reply UI so user can paste AF- code (see Bot API ForceReply). */
async function sendLinkCodeForceReply(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
): Promise<void> {
  const text = [
    `${LINK_FORCE_REPLY_MARKER} (from ${APP_BASE}/settings → Connect Telegram).`,
    '',
    'Auto-link usually happens from the app or web button first.',
    'If that did not open correctly, use the reply field above or send: /link AF-WZ3ZEU',
    '',
    'Example: AF-WZ3ZEU',
  ].join('\n');
  await bot.sendMessage(chatId, text, {
    disable_web_page_preview: true,
    reply_markup: {
      force_reply: true,
      input_field_placeholder: 'AF-XXXXXX',
    },
  });
}

async function applyTelegramLinkCode(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  rawInput: string,
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
      `Code invalid or expired. Generate a new one at ${APP_BASE}/settings`,
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

function getUsycVaultActionForSymbols(
  fromSym: string,
  toSym: string,
): 'usyc_deposit' | 'usyc_withdraw' | null {
  const from = normalizeTokenSymbol(fromSym);
  const to = normalizeTokenSymbol(toSym);
  if (from === 'USDC' && to === 'USYC') {
    return 'usyc_deposit';
  }
  if (from === 'USYC' && to === 'USDC') {
    return 'usyc_withdraw';
  }
  return null;
}

function parseNaturalVaultLine(text: string): {
  action: 'deposit' | 'withdraw' | 'usyc_deposit' | 'usyc_withdraw';
  amount: number;
} | null {
  const t = text.trim().replace(/[!?.…]+$/u, '').trim();
  let m = t.match(/^vault\s+usyc\s+(deposit|withdraw)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    const amount = Number(m[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    const sub = m[1]!.toLowerCase();
    return {
      action: sub === 'deposit' ? 'usyc_deposit' : 'usyc_withdraw',
      amount,
    };
  }
  m = t.match(/^vault\s+(deposit|withdraw)\s+(\d+(?:\.\d+)?)\s*$/i);
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

function parseNaturalBridgeLine(text: string): {
  amount: number;
  sourceChain: SupportedSourceChain;
} | null {
  const t = text.trim().replace(/[!?.…]+$/u, '').trim();
  const m = t.match(/^bridge\s+(\d+(?:\.\d+)?)\s+(ethereum-sepolia|base-sepolia)\s*$/i);
  if (!m) {
    return null;
  }
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const sourceChain = m[2]!.toLowerCase() as SupportedSourceChain;
  if (sourceChain !== 'ethereum-sepolia' && sourceChain !== 'base-sepolia') {
    return null;
  }
  return { amount, sourceChain };
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
  const usycAction = getUsycVaultActionForSymbols(fromSym, toSym);
  if (usycAction) {
    await queueUsycVaultConfirmation(bot, chatId, row, usycAction, amount);
    return;
  }
  const pair = parseSwapTokenSymbols(fromSym, toSym);
  if (!pair) {
    await send(bot, chatId, 'Unknown token pair. Use USDC, EURC, or USYC symbols.');
    return;
  }
  try {
    const rateLimit = await checkRateLimit({
      walletAddress: row.wallet_address,
      agentSlug: 'swap',
      actionType: 'swap',
      amountUsd: amount,
    });
    if (!rateLimit.allowed) {
      throw new Error(`Rate limited: ${rateLimit.reason}`);
    }
    await checkSpendingLimits(row.wallet_address, amount);
  } catch (e: any) {
    await send(bot, chatId, e?.message ?? 'Not allowed');
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
  row: TelegramUserRow,
  action: 'deposit' | 'withdraw',
  amount: number,
): Promise<void> {
  const chatIdStr = String(chatId);
  try {
    const rateLimit = await checkRateLimit({
      walletAddress: row.wallet_address,
      agentSlug: 'vault',
      actionType: `vault_${action}`,
      amountUsd: amount,
    });
    if (!rateLimit.allowed) {
      throw new Error(`Rate limited: ${rateLimit.reason}`);
    }
    await checkSpendingLimits(row.wallet_address, amount);
  } catch (e: any) {
    await send(bot, chatId, e?.message ?? 'Not allowed');
    return;
  }

  const sim = await simulateTelegramVault({
    walletAddress: row.wallet_address,
    action,
    amount,
  });
  if (!sim.ok || !sim.payload) {
    await send(bot, chatId, sim.blockReason ?? 'Vault simulation failed.');
    return;
  }

  const pending: PendingAction = { kind: 'vault', payload: sim.payload };
  await getRedis().setex(pendingKey(chatIdStr), PENDING_TTL_SEC, JSON.stringify(pending));
  await send(bot, chatId, sim.summaryLines.join('\n'));
}

async function queueUsycVaultConfirmation(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  row: TelegramUserRow,
  action: 'usyc_deposit' | 'usyc_withdraw',
  amount: number,
): Promise<void> {
  const chatIdStr = String(chatId);
  const execWallet = await getOrCreateUserAgentWallet(row.wallet_address);
  const entitled = await checkEntitlement(execWallet.address);
  if (!entitled) {
    await send(
      bot,
      chatId,
      [
        '⚠️ USYC requires whitelist approval.',
        'Apply at the Arc hackathon form to get access.',
        'Meanwhile you can use /vault deposit [amount] for our 5% APY vault.',
      ].join('\n'),
    );
    return;
  }

  try {
    const rateLimit = await checkRateLimit({
      walletAddress: row.wallet_address,
      agentSlug: 'vault',
      actionType: `vault_${action}`,
      amountUsd: amount,
    });
    if (!rateLimit.allowed) {
      throw new Error(`Rate limited: ${rateLimit.reason}`);
    }
    await checkSpendingLimits(row.wallet_address, amount);
  } catch (e: any) {
    await send(bot, chatId, e?.message ?? 'Not allowed');
    return;
  }

  const sim = await simulateTelegramUsyc({
    walletAddress: row.wallet_address,
    action,
    amount,
  });
  if (!sim.ok || !sim.payload) {
    await send(bot, chatId, sim.blockReason ?? 'USYC simulation failed.');
    return;
  }

  const pending: PendingAction = { kind: 'vault', payload: sim.payload };
  await getRedis().setex(pendingKey(chatIdStr), PENDING_TTL_SEC, JSON.stringify(pending));
  await send(bot, chatId, sim.summaryLines.join('\n'));
}

async function queueBridgeConfirmation(
  bot: ReturnType<typeof createTelegramBotForPolling>,
  chatId: number,
  row: TelegramUserRow,
  amount: number,
  sourceChain: SupportedSourceChain,
): Promise<void> {
  const chatIdStr = String(chatId);
  try {
    const rateLimit = await checkRateLimit({
      walletAddress: row.wallet_address,
      agentSlug: 'bridge',
      actionType: 'bridge',
      amountUsd: amount,
    });
    if (!rateLimit.allowed) {
      throw new Error(`Rate limited: ${rateLimit.reason}`);
    }
    await checkSpendingLimits(row.wallet_address, amount);
  } catch (e: any) {
    await send(bot, chatId, e?.message ?? 'Not allowed');
    return;
  }

  const amountStr = amount.toString();
  const sim = await simulateBridgeTransfer({
    sourceChain,
    recipientAddress: row.wallet_address,
    amount: amountStr,
  });
  if (!sim.ok) {
    await send(bot, chatId, sim.reason ?? 'Bridge simulation failed.');
    return;
  }

  const pending: PendingAction = {
    kind: 'bridge',
    sourceChain,
    recipientAddress: row.wallet_address,
    amount: amountStr,
    walletAddress: row.wallet_address,
  };
  await getRedis().setex(pendingKey(chatIdStr), PENDING_TTL_SEC, JSON.stringify(pending));
  await send(bot, chatId, formatBridgeSimulationForTelegram(sim, amountStr));
}

function shortTx(hash: string): string {
  if (!hash || hash.length < 12) return hash;
  return `${hash.slice(0, 10)}...`;
}

function bridgeSourceLabel(source: SupportedSourceChain): string {
  if (source === 'ethereum-sepolia') return 'Ethereum Sepolia';
  if (source === 'base-sepolia') return 'Base Sepolia';
  return source;
}

function looksLikeActionRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(swap|vault|bridge|deposit|withdraw|redeem|stake|unstake|balance|portfolio|help)\b/.test(
    normalized,
  );
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

function formatIntentConfirmation(intent: TelegramIntent): string | null {
  if (intent.action === 'swap' && intent.amount != null && intent.tokenIn && intent.tokenOut) {
    return `You want to swap ${intent.amount.toFixed(2)} ${intent.tokenIn} → ${intent.tokenOut}\nIs that right? YES/NO`;
  }
  if (intent.action === 'vault' && intent.amount != null && intent.vaultAction) {
    if (intent.vaultAction === 'usyc_deposit') {
      return `You want to subscribe with ${intent.amount.toFixed(2)} USDC (USYC)\nIs that right? YES/NO`;
    }
    if (intent.vaultAction === 'usyc_withdraw') {
      return `You want to redeem ${intent.amount.toFixed(2)} USYC\nIs that right? YES/NO`;
    }
    return `You want to ${intent.vaultAction} ${intent.amount.toFixed(2)} USDC ${intent.vaultAction === 'deposit' ? 'into' : 'from'} the vault\nIs that right? YES/NO`;
  }
  if (intent.action === 'bridge' && intent.amount != null && intent.sourceChain) {
    return `You want to bridge ${intent.amount.toFixed(2)} USDC from ${bridgeSourceLabel(intent.sourceChain)} to Arc Testnet\nIs that right? YES/NO`;
  }
  return null;
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
    memoryContext = [profileBlock, prior].filter(Boolean).join('\n\n').trim();
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
    if (intent.vaultAction === 'usyc_deposit' || intent.vaultAction === 'usyc_withdraw') {
      await queueUsycVaultConfirmation(bot, chatId, row, intent.vaultAction, intent.amount);
      return;
    }
    await queueVaultConfirmation(bot, chatId, row, intent.vaultAction, intent.amount);
    return;
  }
  if (intent.action === 'bridge') {
    if (intent.amount == null || intent.amount <= 0 || !intent.sourceChain) {
      await send(bot, chatId, TELEGRAM_HELP_TEXT);
      return;
    }
    await queueBridgeConfirmation(bot, chatId, row, intent.amount, intent.sourceChain);
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
  const bot = createTelegramBotForPolling();

  bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match?.[1]?.trim();
    const chatIdStr = String(chatId);
    void getRedis()
      .del(telegramHistoryKey(chatId))
      .catch(() => {});

    if (arg && telegramLinkCode.parseTelegramLinkCode(arg).ok) {
      await applyTelegramLinkCode(bot, chatId, arg);
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
            `Wallet not found. Connect your wallet at ${APP_BASE} first.`,
          );
          return;
        }
        await adminDb
          .from('businesses')
          .update({ telegram_id: chatIdStr })
          .eq('wallet_address', addr);
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
          '1) Open ' + APP_BASE + '/settings → Connect Telegram',
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
        '/swap, /vault, /bridge, /portfolio',
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
        'Or plain text: swap 1 USDC to EURC, vault deposit 5, bridge 10 ethereum-sepolia',
        '/vault deposit|withdraw AMOUNT — e.g. /vault deposit 5',
        '/vault usyc deposit|withdraw AMOUNT — Circle USYC (whitelist)',
        '/bridge AMOUNT CHAIN — ethereum-sepolia | base-sepolia',
        '/portfolio — snapshot',
        '/unlink — disconnect Telegram',
        '',
        'Primary linking flow: app settings → Connect Telegram → Open app/Open web.',
        'Use /link only if the automatic deep link does not open correctly.',
        'After simulation, reply YES to execute or NO to cancel (2 min window).',
      ].join('\n'),
    );
  });

  bot.onText(/^\/link(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match?.[1]?.trim() ?? '';
    if (!raw) {
      await sendLinkCodeForceReply(bot, chatId);
      return;
    }
    await applyTelegramLinkCode(bot, chatId, raw);
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

  bot.onText(/^\/vault(?:@\w+)?\s+usyc\s+(deposit|withdraw)\s+(\S+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const chatIdStr = String(chatId);
    const row = await getLinkedWalletRow(chatIdStr);
    if (!row) {
      await sendTelegramLinkRequired(bot, chatId);
      return;
    }
    const sub = (match?.[1] ?? '').toLowerCase();
    const amount = Number(match?.[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      await send(bot, chatId, 'Usage: /vault usyc deposit|withdraw AMOUNT');
      return;
    }
    const action = sub === 'deposit' ? 'usyc_deposit' : 'usyc_withdraw';
    await queueUsycVaultConfirmation(bot, chatId, row, action, amount);
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

  bot.onText(/^\/bridge(?:@\w+)?\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const chatIdStr = String(chatId);
    const row = await getLinkedWalletRow(chatIdStr);
    if (!row) {
      await sendTelegramLinkRequired(bot, chatId);
      return;
    }
    const amount = Number(match?.[1]);
    const chainRaw = (match?.[2] ?? '').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      await send(bot, chatId, 'Usage: /bridge AMOUNT CHAIN');
      return;
    }
    const sourceChain = chainRaw as SupportedSourceChain;
    if (sourceChain !== 'ethereum-sepolia' && sourceChain !== 'base-sepolia') {
      await send(bot, chatId, 'Supported chains: ethereum-sepolia, base-sepolia');
      return;
    }
    await queueBridgeConfirmation(bot, chatId, row, amount, sourceChain);
  });

  bot.on('message', async (msg) => {
    const plain = msg.text?.trim() ?? '';
    if (plain && isReplyToLinkPrompt(msg) && !plain.startsWith('/')) {
      await applyTelegramLinkCode(bot, msg.chat.id, plain);
      return;
    }

    if (
      plain &&
      !plain.startsWith('/') &&
      /^(swap|vault|bridge|deposit|withdraw)\b/i.test(plain)
    ) {
      const swapNl = parseNaturalSwapLine(plain);
      const vaultNl = parseNaturalVaultLine(plain);
      const bridgeNl = parseNaturalBridgeLine(plain);
      if (swapNl || vaultNl || bridgeNl) {
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
          if (vaultNl.action === 'usyc_deposit' || vaultNl.action === 'usyc_withdraw') {
            await queueUsycVaultConfirmation(bot, msg.chat.id, row, vaultNl.action, vaultNl.amount);
          } else {
            await queueVaultConfirmation(bot, msg.chat.id, row, vaultNl.action, vaultNl.amount);
          }
          return;
        }
        if (bridgeNl) {
          await queueBridgeConfirmation(
            bot,
            msg.chat.id,
            row,
            bridgeNl.amount,
            bridgeNl.sourceChain,
          );
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
      }
    }

    const text = normalizeCommand(msg.text ?? '');
    if (!text || text.startsWith('/')) {
      return;
    }

    const chatId = String(msg.chat.id);
    if (!(await getLinkedWalletRow(chatId))) {
      await sendTelegramLinkRequired(bot, msg.chat.id);
      return;
    }

    const redis = getRedis();

    if (text.trim().toUpperCase() === 'NO') {
      const rawNo = await redis.get(pendingKey(chatId));
      if (rawNo) {
        await redis.del(pendingKey(chatId));
        await send(bot, msg.chat.id, 'Cancelled.');
      }
      return;
    }

    if (text.trim().toUpperCase() !== 'YES') {
      const row = await getUserByTelegram(chatId);
      if (!row) {
        await sendTelegramLinkRequired(bot, msg.chat.id);
        return;
      }

      if (!looksLikeActionRequest(text)) {
        try {
          const answer = await runTelegramChatReply(text, row, msg.chat.id);
          await send(bot, msg.chat.id, answer);
          await appendTelegramHistory(msg.chat.id, text, answer);
        } catch (e: any) {
          console.error('[telegram-bot] chat reply failed', e);
          await send(bot, msg.chat.id, e?.message ?? 'Reply failed');
        }
        return;
      }

      const parsedIntent = await parseTelegramIntent(text);
      if (!parsedIntent || parsedIntent.action === 'unknown') {
        try {
          const answer = await runTelegramChatReply(text, row, msg.chat.id);
          await send(bot, msg.chat.id, answer);
          await appendTelegramHistory(msg.chat.id, text, answer);
        } catch (e: any) {
          console.error('[telegram-bot] fallback reply failed', e);
          await send(bot, msg.chat.id, e?.message ?? 'Reply failed');
        }
        return;
      }

      if (parsedIntent.confidence === 'low') {
        try {
          const answer = await runTelegramChatReply(text, row, msg.chat.id);
          await send(bot, msg.chat.id, answer);
          await appendTelegramHistory(msg.chat.id, text, answer);
        } catch (e: any) {
          console.error('[telegram-bot] low-confidence reply failed', e);
          await send(bot, msg.chat.id, e?.message ?? 'Reply failed');
        }
        return;
      }

      if (parsedIntent.action === 'balance' || parsedIntent.action === 'portfolio' || parsedIntent.action === 'help') {
        try {
          if (parsedIntent.action === 'help') {
            await send(bot, msg.chat.id, TELEGRAM_HELP_TEXT);
          } else {
            await executeParsedIntent(bot, msg.chat.id, row, parsedIntent);
          }
        } catch (e: any) {
          await send(bot, msg.chat.id, e?.message ?? 'Request failed');
        }
        return;
      }

      const confirmation = formatIntentConfirmation(parsedIntent);
      if (!confirmation) {
        await send(bot, msg.chat.id, TELEGRAM_HELP_TEXT);
        return;
      }
      const pendingIntent: PendingAction = { kind: 'intent-confirmation', intent: parsedIntent };
      await redis.setex(pendingKey(chatId), PENDING_TTL_SEC, JSON.stringify(pendingIntent));
      await send(bot, msg.chat.id, confirmation);
      return;
    }

    const raw = await redis.get(pendingKey(chatId));
    if (!raw) {
      await send(bot, msg.chat.id, 'No pending confirmation (or it expired). Run the command again.');
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

    if (pending.kind === 'intent-confirmation') {
      const row = await getLinkedWalletRow(chatId);
      if (!row) {
        await sendTelegramLinkRequired(bot, msg.chat.id);
        return;
      }
      try {
        await executeParsedIntent(bot, msg.chat.id, row, pending.intent);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Request failed');
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

    if (pending.kind === 'vault') {
      try {
        const result = await executeTelegramVault({
          payload: pending.payload,
          onStatus: async (m) => {
            await send(bot, msg.chat.id, `⏳ ${m}`);
          },
        });
        const p = pending.payload as VaultExecutionPayload;
        const isUsyc = 'kind' in p && p.kind === 'usyc';
        const body =
          result.receiptMessage ??
          (isUsyc
            ? [
                p.action === 'usyc_deposit' ? 'USYC subscribe complete.' : 'USYC redeem complete.',
                result.usycSideAmount ? `Amount: ${result.usycSideAmount}` : '',
                result.txHash ? `Tx: ${shortTx(result.txHash)}` : '',
              ]
                .filter(Boolean)
                .join('\n')
            : [
                `${p.action === 'deposit' ? 'Deposited' : 'Withdrew'} ${p.amount} USDC`,
                result.walletSharesFormatted != null && p.action === 'deposit'
                  ? `Shares received: ${result.walletSharesFormatted}`
                  : result.walletSharesFormatted != null
                    ? `Vault shares: ${result.walletSharesFormatted}`
                    : '',
                result.apyPercent != null ? `Current APY: ${result.apyPercent}%` : '',
                result.txHash ? `Tx: ${shortTx(result.txHash)}` : '',
              ]
                .filter(Boolean)
                .join('\n'));
        await send(bot, msg.chat.id, body);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Vault failed');
      }
      return;
    }

    if (pending.kind === 'bridge') {
      const rowBridge = await getLinkedWalletRow(chatId);
      if (!rowBridge) {
        await sendTelegramLinkRequired(bot, msg.chat.id);
        return;
      }
      const userAddr = getAddress(rowBridge.wallet_address) as `0x${string}`;
      const pendingAmt = Number(pending.amount);
      const label = bridgeSourceLabel(pending.sourceChain);
      let sponsoredOk = false;

      try {
        const sponsoredUsage = await readDailyUsageAmount({
          scope: SPONSORED_BRIDGE_USAGE_SCOPE,
          walletAddress: rowBridge.wallet_address,
          limit: SPONSORED_BRIDGE_DAILY_LIMIT_USDC,
        });
        if (
          !Number.isFinite(pendingAmt) ||
          pendingAmt <= 0 ||
          pendingAmt > sponsoredUsage.remaining
        ) {
          await send(
            bot,
            msg.chat.id,
            `AgentFlow sponsors up to ${SPONSORED_BRIDGE_DAILY_LIMIT_USDC.toFixed(0)} USDC of bridging per user per day. You have ${Number(
              sponsoredUsage.remaining,
            ).toFixed(2)} USDC remaining today. Try a smaller amount or wait until tomorrow.`,
          );
          return;
        }

        const transfer = await executeSponsoredBridgeViaX402({
          userWalletAddress: userAddr,
          sourceChain: pending.sourceChain,
          amount: pending.amount,
        });
        await incrementDailyUsageAmount({
          scope: SPONSORED_BRIDGE_USAGE_SCOPE,
          walletAddress: rowBridge.wallet_address,
          amount: pendingAmt,
          limit: SPONSORED_BRIDGE_DAILY_LIMIT_USDC,
        });
        await ensureSponsoredBridgeLedger({
          settlement: transfer.transaction,
          transactionRef: transfer.transactionRef,
          recipientAddress: getAddress(pending.recipientAddress) as `0x${string}`,
        });

        const transferData =
          typeof transfer.data === 'string'
            ? (() => {
                const parsed = parseSseJsonPayload(transfer.data);
                if (parsed.done) return parsed.done;
                if (parsed.error) return { success: false, error: parsed.error };
                return {};
              })()
            : transfer.data && typeof transfer.data === 'object'
              ? (transfer.data as Record<string, unknown>)
              : {};

        if (transferData && (transferData as { success?: boolean }).success) {
          const receipt = getBridgeReceiptDetails(
            (transferData as { result?: unknown }).result &&
              typeof (transferData as { result?: unknown }).result === 'object'
              ? ((transferData as { result: Record<string, unknown> }).result as Record<string, unknown>)
              : transferData,
          );
          const bodyLines = [
            '✅ Bridge complete · Sponsored',
            '',
            `${pending.amount} USDC bridged to Arc`,
          ];
          if (receipt.txHash) {
            bodyLines.push(`Tx: ${shortHash(receipt.txHash)}`, arcscanTxViewUrl(receipt.txHash), '');
          } else {
            bodyLines.push('Bridge submitted.', '');
          }
          bodyLines.push(
            `Sponsored by AgentFlow · ${feeUsdcStringFromLabel(BRIDGE_AGENT_PRICE_LABEL)} USDC`,
            formatNanopaymentRequestLine(transfer.requestId),
          );
          const body = bodyLines.join('\n');
          void runPortfolioFollowupAfterTool({
            buyerAgentSlug: 'bridge',
            userWalletAddress: userAddr,
            portfolioRunUrl: PORTFOLIO_AGENT_RUN_URL,
            portfolioPriceLabel: PORTFOLIO_AGENT_PRICE_LABEL,
            trigger: 'post_bridge',
            details: body,
          }).catch((e) => console.warn('[telegram/bridge] A2A follow-up failed:', e));
          await send(bot, msg.chat.id, body);
          sponsoredOk = true;
        }
      } catch (e) {
        console.warn('[telegram-bot] sponsored bridge failed, trying direct kit:', e);
      }

      if (sponsoredOk) {
        return;
      }

      let mintedTxHash = '';
      try {
        await send(
          bot,
          msg.chat.id,
          '⚠️ Sponsored agent route unavailable — continuing with direct bridge…',
        );
        const kit = await bridgeTransferExecute({
          sourceChain: pending.sourceChain,
          recipientAddress: pending.recipientAddress,
          amount: pending.amount,
          onEvent: async ({ event, data }) => {
            if (event === 'approved') {
              await send(bot, msg.chat.id, `\u23f3 Approving USDC on ${label}...`);
            } else if (event === 'burned') {
              await send(bot, msg.chat.id, '🔥 Burning USDC...');
            } else if (event === 'attested') {
              await send(bot, msg.chat.id, '\u23f3 Waiting for Circle attestation...');
            } else if (event === 'minted') {
              mintedTxHash = findTxHashDeep(data) ?? mintedTxHash;
              await send(bot, msg.chat.id, '\u2705 Minted on Arc Testnet!');
            }
          },
        });
        if (!kit.ok) {
          await send(bot, msg.chat.id, `Bridge failed: ${kit.reason ?? 'unknown'}`);
          return;
        }
        const txHash = mintedTxHash || findTxHashDeep(kit.result) || '';
        const receiptText = formatBridgeReceipt({
          amount: pending.amount,
          sourceChain: pending.sourceChain,
          destinationChain: 'arc-testnet',
          txHash,
          recipientAddress: pending.recipientAddress,
        });
        const kitBody = `Bridge complete (direct path)\n\n${receiptText}`;
        void runPortfolioFollowupAfterTool({
          buyerAgentSlug: 'bridge',
          userWalletAddress: userAddr,
          portfolioRunUrl: PORTFOLIO_AGENT_RUN_URL,
          portfolioPriceLabel: PORTFOLIO_AGENT_PRICE_LABEL,
          trigger: 'post_bridge',
          details: kitBody,
        }).catch((e) => console.warn('[telegram/bridge] A2A follow-up failed:', e));
        await send(bot, msg.chat.id, kitBody);
      } catch (e: any) {
        await send(bot, msg.chat.id, e?.message ?? 'Bridge failed');
      }
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
