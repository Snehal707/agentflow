import path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAddress, isAddress } from 'viem';
import { adminDb, getRedis } from '../db/client';
import { fetchPayHistoryForBrain } from '../api/pay';
import { extractAgentpayRemark } from './agentpay-remark';
import { getPreferredAgentpayPaymentLinkHandle } from './agentpay-registry';
import { generateInvoiceNumber } from './invoice-number';
import { resolvePayee } from './agentpay-payee';
import {
  parseBatchPaymentsFromMessage,
  parseInlineCsvFromMessage,
  type BatchPaymentRow,
} from './csv-batch-parser';
import { redisPendingExists } from './chatSessionRedis';
import {
  clearTelegramPendingConfirmation,
  isTelegramAffirmativeReply,
  isTelegramNegativeReply,
  readTelegramPendingConfirmation,
  telegramSessionId,
  type TelegramRouteResult,
  type TelegramSharedConfirmation,
  writeTelegramPendingConfirmation,
} from './telegram-dispatch-state';
import { executeTool } from './tool-executor';

type WalletCtx = {
  walletAddress: string;
  executionWalletId?: string;
  executionWalletAddress?: string;
  executionTarget?: 'EOA' | 'DCW';
};

type TelegramBot = {
  getFileLink(fileId: string): Promise<string>;
};

type TelegramMessage = {
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string }>;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
  };
};

type TelegramAgentpayAction =
  | 'agentpay_send'
  | 'batch'
  | 'contact_update'
  | 'invoice'
  | 'schedule'
  | 'split';

type TelegramAgentpayConfirmation =
  TelegramSharedConfirmation<TelegramAgentpayAction>;

type TelegramAgentpayRouteOptions = {
  bot: TelegramBot;
  chatId: number;
  message: TelegramMessage;
  text: string;
  wallet: WalletCtx;
  send: (text: string) => Promise<void>;
};

type TelegramAgentpayConfirmationOptions = {
  chatId: number;
  text: string;
  wallet: WalletCtx;
};

type TelegramMediaTarget = {
  recipient: string;
  displayRecipient: string;
  qrText: string;
  paymentUrl?: string | null;
  amount?: string | null;
  remark?: string | null;
  storedAt: string;
};

const PUBLIC_API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL?.trim() || `http://127.0.0.1:${process.env.PORT || '4000'}`;
const SCHEDULE_AGENT_BASE_URL = process.env.SCHEDULE_AGENT_URL?.trim() || 'http://127.0.0.1:3018';
const WEB_APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.WEB_APP_URL?.trim() || 'https://agentflow.one';
const NATURAL_CONFIRMATION_PROMPT = 'Reply YES to confirm or NO to cancel.';
const TELEGRAM_MEDIA_TARGET_TTL_SEC = 15 * 60;

function telegramMediaTargetKey(chatId: number): string {
  return `telegram:media-target:${chatId}`;
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

function extractTelegramQrPaymentTarget(value: string): TelegramMediaTarget | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = normalizeTelegramPaymentRecipient(trimmed);
  if (direct) {
    return { recipient: direct, displayRecipient: direct, qrText: trimmed, paymentUrl: null, amount: null, remark: null, storedAt: new Date().toISOString() };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const payMatch = url.pathname.match(/\/pay\/([^/?#]+)/i);
  if (!payMatch?.[1]) return null;
  const recipient = normalizeTelegramPaymentRecipient(decodeURIComponent(payMatch[1]));
  return recipient
    ? { recipient, displayRecipient: recipient, qrText: trimmed, paymentUrl: url.toString(), amount: url.searchParams.get('amount'), remark: url.searchParams.get('remark'), storedAt: new Date().toISOString() }
    : null;
}

function messageReferencesTelegramQrTarget(text: string): boolean {
  return /\b(?:it|this|that|them|him|her|qr|code|recipient|address)\b/i.test(text);
}

function hasExplicitTelegramRecipient(text: string): boolean {
  return /(?:0x[a-fA-F0-9]{40}|\b[a-z0-9][a-z0-9-]*\.arc\b)/i.test(text);
}

function rewriteTelegramPaymentTextWithTarget(
  text: string,
  target: TelegramMediaTarget,
): string {
  const remark = extractAgentpayRemark(text) || target.remark;
  const withRecipient = hasExplicitTelegramRecipient(text)
    ? text
    : `${text.trim()} to ${target.recipient}`;
  if (!remark || extractAgentpayRemark(withRecipient)) return withRecipient;
  return `${withRecipient} for ${remark}`;
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
  const redis = getRedis();
  const raw = await redis.get(telegramMediaTargetKey(chatId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramMediaTarget;
  } catch {
    return null;
  }
}

async function storeTelegramMediaTarget(
  chatId: number,
  target: TelegramMediaTarget,
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    telegramMediaTargetKey(chatId),
    JSON.stringify(target),
    'EX',
    TELEGRAM_MEDIA_TARGET_TTL_SEC,
  );
}

export async function maybeDecodeTelegramPaymentTarget(
  bot: TelegramBot,
  message: TelegramMessage,
): Promise<TelegramMediaTarget | null> {
  const photo = message.photo?.[message.photo.length - 1];
  const documentFileId =
    message.document?.file_id && typeof message.document?.mime_type === 'string' && /^image\//i.test(message.document.mime_type)
      ? message.document.file_id
      : null;
  const fileId = photo?.file_id || documentFileId;
  if (!fileId) return null;
  try {
    const fileUrl = await bot.getFileLink(fileId);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Telegram file fetch failed (${response.status})`);
    const target = extractTelegramQrPaymentTarget(await decodeTelegramQrFromBuffer(Buffer.from(await response.arrayBuffer())));
    if (!target) return null;
    await storeTelegramMediaTarget(message.chat.id, target);
    return target;
  } catch (error) {
    console.warn('[telegram-agentpay] qr decode failed:', error);
    return null;
  }
}

function isTelegramCsvDocument(message: TelegramMessage): boolean {
  const fileName = message.document?.file_name?.toLowerCase() ?? '';
  const mimeType = message.document?.mime_type?.toLowerCase() ?? '';
  return fileName.endsWith('.csv') || mimeType.includes('csv');
}

export async function maybeReadTelegramCsvDocument(
  bot: TelegramBot,
  message: TelegramMessage,
): Promise<string | null> {
  if (!message.document || !isTelegramCsvDocument(message)) return null;
  const fileUrl = await bot.getFileLink(message.document.file_id);
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Telegram CSV fetch failed (${response.status})`);
  return (await response.text()).replace(/^\uFEFF/, '').trim();
}

export async function rewriteTelegramPaymentTextWithRememberedTarget(
  chatId: number,
  text: string,
): Promise<string> {
  if (!text.trim() || hasExplicitTelegramRecipient(text) || !messageReferencesTelegramQrTarget(text)) {
    return text;
  }
  const target = await loadTelegramMediaTarget(chatId);
  return target ? rewriteTelegramPaymentTextWithTarget(text, target) : text;
}

function formatTelegramSharedRouteReply(
  result: TelegramRouteResult<TelegramAgentpayAction>,
): string {
  return result.confirmation ? `${result.responseText}\n\n${NATURAL_CONFIRMATION_PROMPT}` : result.responseText;
}

async function storeTelegramAgentpayConfirmation(
  chatId: number,
  confirmation: TelegramAgentpayConfirmation,
): Promise<void> {
  await writeTelegramPendingConfirmation(getRedis(), chatId, confirmation);
}

function parsePaymentLinkRequest(text: string): { handle: string; amount?: string; remark?: string } | null {
  if (!/\b(?:payment|pay)\s+link\b/i.test(text)) return null;
  const handle =
    text.match(/\b(?:for|to)\s+((?:0x[a-fA-F0-9]{40})|(?:[a-z0-9][a-z0-9-]*\.arc))\b/i)?.[1] ??
    text.match(/\b((?:0x[a-fA-F0-9]{40})|(?:[a-z0-9][a-z0-9-]*\.arc))\b/i)?.[1];
  if (!handle) return null;
  const amount = text.match(/\b(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?\b/i)?.[1];
  return { handle, amount, remark: extractAgentpayRemark(text) || undefined };
}

function parseInvoiceRequest(text: string): { recipient: string; amount: string; remark?: string } | null {
  const match = text.match(
    /\b(?:create|send|make)\s+(?:an?\s+)?invoice(?:\s+for)?\s+((?:0x[a-fA-F0-9]{40})|(?:[a-z0-9][a-z0-9-]*\.arc))\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?/i,
  );
  if (!match) return null;
  return { recipient: match[1], amount: match[2], remark: extractAgentpayRemark(text) || undefined };
}

function parseSplitRequest(text: string): { amount: string; recipients: string[]; remark?: string } | null {
  if (!/\bsplit\b/i.test(text)) return null;
  const amount = text.match(/\b(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?\b/i)?.[1];
  const recipients = [...text.matchAll(/(?:0x[a-fA-F0-9]{40}|\b[a-z0-9][a-z0-9-]*\.arc\b)/gi)].map(
    ([recipient]) => recipient,
  );
  if (!amount || recipients.length < 2) return null;
  return { amount, recipients, remark: extractAgentpayRemark(text) || undefined };
}

function detectTelegramCsvPaymentMode(csvText: string, caption: string): 'batch' | 'split' | 'schedule' | 'invoice' {
  const header = csvText.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  const prompt = caption.toLowerCase();
  if (/\binvoice\b/.test(prompt) || header.includes('invoice')) return 'invoice';
  if (/\bschedule|scheduled|weekly|monthly\b/.test(prompt) || header.includes('frequency')) return 'schedule';
  if (/\bsplit\b/.test(prompt) || header.includes('share')) return 'split';
  return 'batch';
}

function parseTelegramCsvLine(line: string): string[] {
  return line.split(',').map((cell) => cell.trim());
}

function parseTelegramSplitCsvPayment(csvText: string): { recipients: Array<{ recipient: string; amount: string; remark?: string }> } {
  const rows = parseInlineCsvFromMessage(csvText);
  if ('error' in rows) throw new Error(rows.error);
  return {
    recipients: rows.map((row) => ({
      recipient: row.to,
      amount: String(row.amount),
      remark: row.remark,
    })),
  };
}

function parseTelegramScheduleCsvPrompt(csvText: string): Record<string, string> {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseTelegramCsvLine(lines[0] ?? '');
  const values = parseTelegramCsvLine(lines[1] ?? '');
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  const recipient = row.recipient || row.to || '';
  const amount = row.amount || row.amount_usdc || '';
  const currency = row.currency || 'USDC';
  const frequency = row.frequency || row.cadence || '';
  const day = row.day || '';
  const remark = row.remark || row.note || '';
  return { prompt: `schedule ${amount} ${currency} to ${recipient} ${frequency}${day ? ` ${day}` : ''}${remark ? ` for ${remark}` : ''}` };
}

function parseTelegramInvoiceCsvPrompt(csvText: string): Record<string, string> {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseTelegramCsvLine(lines[0] ?? '');
  const values = parseTelegramCsvLine(lines[1] ?? '');
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  const recipient = row.recipient || row.to || '';
  const amount = row.amount || row.amount_usdc || '';
  const description = row.description || row.remark || row.note || '';
  return { prompt: `create invoice for ${recipient} ${amount} USDC${description ? ` for ${description}` : ''}` };
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

async function runTelegramBatchPreview(
  wallet: WalletCtx,
  rows: BatchPaymentRow[],
  sessionId: string,
): Promise<TelegramRouteResult<TelegramAgentpayAction>> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const payload = await fetchJson(`${PUBLIC_API_BASE_URL}/api/batch/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({ sessionId, walletAddress: wallet.walletAddress, payments: rows }),
  });
  return {
    responseText: payload.preview ?? payload.message ?? 'Batch payment preview ready.',
    confirmation: payload.confirmId
      ? { action: 'batch', confirmId: payload.confirmId, label: payload.confirmLabel || 'Send batch' }
      : undefined,
  };
}

async function runTelegramSplitPreview(
  wallet: WalletCtx,
  amount: string,
  recipients: Array<{ recipient: string; amount?: string; remark?: string }>,
  remark?: string,
  sessionId = telegramSessionId(wallet.walletAddress),
): Promise<TelegramRouteResult<TelegramAgentpayAction>> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const payload = await fetchJson(`${PUBLIC_API_BASE_URL}/api/split/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({
      sessionId,
      walletAddress: wallet.walletAddress,
      recipients: recipients.map((recipient) => recipient.recipient),
      totalAmount: amount,
      remark: remark || '',
    }),
  });
  return {
    responseText: payload.preview ?? payload.message ?? 'Split payment preview ready.',
    confirmation: payload.confirmId
      ? { action: 'split', confirmId: payload.confirmId, label: payload.confirmLabel || 'Confirm split' }
      : undefined,
  };
}

async function runTelegramSchedulePreviewFromTask(
  wallet: WalletCtx,
  task: Record<string, string>,
): Promise<TelegramRouteResult<TelegramAgentpayAction>> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
  const payload = await fetchJson(`${SCHEDULE_AGENT_BASE_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
    },
    body: JSON.stringify({ task: task.prompt, walletAddress: wallet.walletAddress }),
  });
  return {
    responseText: payload.preview ?? payload.message ?? 'Scheduled payment preview ready.',
    confirmation: payload.confirmId
      ? { action: 'schedule', confirmId: payload.confirmId, label: payload.confirmLabel || 'Confirm schedule' }
      : undefined,
  };
}

async function runTelegramInvoicePreviewFromPrompt(
  wallet: WalletCtx,
  prompt: Record<string, string>,
): Promise<TelegramRouteResult<TelegramAgentpayAction>> {
  const parsed = parseInvoiceRequest(prompt.prompt || '');
  if (!parsed) return { responseText: 'I read the invoice CSV, but could not prepare an invoice preview.' };
  const sessionId = telegramSessionId(wallet.walletAddress);
  const invoiceNumber = generateInvoiceNumber();
  await getRedis().set(`invoice:pending:${sessionId}`, JSON.stringify({
    tool: 'create_invoice',
    walletAddress: wallet.walletAddress,
    vendorHandle: parsed.recipient,
    amount: parsed.amount,
    description: parsed.remark || 'Services rendered',
    invoiceNumber,
    createdAt: new Date().toISOString(),
  }), 'EX', 900);
  return {
    responseText: [
      `Create invoice ${invoiceNumber}?`,
      '',
      `To: ${parsed.recipient}`,
      `Amount: ${parsed.amount} USDC`,
      `For: ${parsed.remark || 'Services rendered'}`,
    ].join('\n'),
    confirmation: { action: 'invoice', confirmId: `invoice-${sessionId}`, label: `Create Invoice - ${parsed.amount} USDC` },
  };
}

async function resolveAgentpayPaymentLinkHandle(handle: string): Promise<string> {
  if (!isAddress(handle)) return handle;
  return await getPreferredAgentpayPaymentLinkHandle(handle, handle);
}

async function createTelegramPaymentLink(text: string): Promise<string | null> {
  const request = parsePaymentLinkRequest(text);
  if (!request) return null;
  const handle = await resolveAgentpayPaymentLinkHandle(request.handle);
  const search = new URLSearchParams();
  if (request.amount) search.set('amount', request.amount);
  if (request.remark) search.set('remark', request.remark);
  const query = search.toString();
  return `Payment link:\n${WEB_APP_BASE_URL}/pay/${encodeURIComponent(handle)}${query ? `?${query}` : ''}`;
}

async function routeDirectAgentpayMessage(
  options: TelegramAgentpayRouteOptions,
): Promise<TelegramRouteResult<TelegramAgentpayAction> | null> {
  const { bot, message, text, wallet } = options;
  const csvText = await maybeReadTelegramCsvDocument(bot, message);
  if (csvText) {
    const mode = detectTelegramCsvPaymentMode(
      csvText,
      `${message.document?.file_name ?? ''} ${message.caption ?? ''}`,
    );
    if (mode === 'split') {
      const split = parseTelegramSplitCsvPayment(csvText);
      const total = split.recipients.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return await runTelegramSplitPreview(wallet, String(total), split.recipients, undefined, telegramSessionId(message.chat.id));
    }
    if (mode === 'schedule') return await runTelegramSchedulePreviewFromTask(wallet, parseTelegramScheduleCsvPrompt(csvText));
    if (mode === 'invoice') return await runTelegramInvoicePreviewFromPrompt(wallet, parseTelegramInvoiceCsvPrompt(csvText));
    const rows = parseBatchPaymentsFromMessage(csvText);
    if ('error' in rows) throw new Error(rows.error);
    return await runTelegramBatchPreview(wallet, rows, telegramSessionId(message.chat.id));
  }

  const paymentLink = await createTelegramPaymentLink(text);
  if (paymentLink) return { responseText: paymentLink };

  const split = parseSplitRequest(text);
  if (split) {
    return await runTelegramSplitPreview(
      wallet,
      split.amount,
      split.recipients.map((recipient) => ({ recipient })),
      split.remark,
      telegramSessionId(message.chat.id),
    );
  }

  const invoice = parseInvoiceRequest(text);
  if (invoice) return await runTelegramInvoicePreviewFromPrompt(wallet, { prompt: text });

  if (/\b(?:schedule|scheduled|recurring)\b/i.test(text)) {
    return await runTelegramSchedulePreviewFromTask(wallet, { prompt: text });
  }

  if (/\b(?:batch\s*pay(?:ment)?|payroll|bulk\s+pay|pay\s+multiple|pay\s+everyone)\b/i.test(text)) {
    const rows = parseBatchPaymentsFromMessage(text);
    if ('error' in rows) return { responseText: `I see you want to run a batch payment, but I could not parse the recipients.\n${rows.error}` };
    return await runTelegramBatchPreview(wallet, rows, telegramSessionId(message.chat.id));
  }

  if (/\b(?:payment\s+)?history\b/i.test(text)) {
    const history = await fetchPayHistoryForBrain(wallet.walletAddress, 20);
    return { responseText: history.length ? history.map((item: any) => `${item.direction}: ${item.amount} USDC ${item.counterparty}`).join('\n') : 'No AgentPay history found.' };
  }

  if (/\b(?:list|show)\s+contacts?\b/i.test(text)) {
    const { data, error } = await adminDb
      .from('contacts')
      .select('name,address')
      .eq('wallet_address', getAddress(wallet.walletAddress))
      .order('name');
    if (error) throw error;
    return { responseText: data?.length ? data.map((row: any) => `${row.name}: ${row.address}`).join('\n') : 'No contacts saved.' };
  }

  const saveContact = text.match(/\bsave\s+contact\s+(\S+)\s+as\s+([a-z0-9][a-z0-9_-]{0,63})\b/i);
  if (saveContact) {
    const resolved = getAddress(await resolvePayee(saveContact[1], wallet.walletAddress));
    const { error } = await adminDb.from('contacts').insert({
      wallet_address: getAddress(wallet.walletAddress),
      name: saveContact[2].toLowerCase(),
      address: resolved,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { responseText: error ? `Failed to save contact: ${error.message}` : `Saved contact "${saveContact[2]}" -> ${resolved}.` };
  }

  const updateContact = text.match(/\bupdate\s+contact\s+([a-z0-9][a-z0-9_-]{0,63})\s+(?:to|as)\s+(\S+)\b/i);
  if (updateContact) {
    const walletAddress = getAddress(wallet.walletAddress);
    const { data: existing } = await adminDb
      .from('contacts')
      .select('address')
      .eq('wallet_address', walletAddress)
      .ilike('name', updateContact[1])
      .maybeSingle();
    if (!existing?.address) return { responseText: `Contact "${updateContact[1]}" not found.` };
    const confirmId = telegramSessionId(message.chat.id);
    await getRedis().set(
      `contact:update:${confirmId}`,
      JSON.stringify({ name: updateContact[1], newAddress: updateContact[2], oldAddress: String(existing.address) }),
      'EX',
      300,
    );
    return {
      responseText: [`Update contact "${updateContact[1]}"?`, '', `From: ${String(existing.address)}`, `To: ${updateContact[2]}`].join('\n'),
      confirmation: { action: 'contact_update', confirmId, label: 'Confirm contact update' },
    };
  }

  const deleteContact = text.match(/\b(?:delete|remove)\s+contact\s+([a-z0-9][a-z0-9_-]{0,63})\b/i);
  if (deleteContact) {
    const { data, error } = await adminDb
      .from('contacts')
      .delete()
      .eq('wallet_address', getAddress(wallet.walletAddress))
      .ilike('name', deleteContact[1])
      .select('id');
    if (error) return { responseText: `Failed to remove contact: ${error.message}` };
    return { responseText: data?.length ? `Contact "${deleteContact[1]}" removed.` : `No contact named "${deleteContact[1]}" found.` };
  }

  if (/\b(?:invoice|invoices)\s+(?:status|list|history)\b/i.test(text)) {
    const { data, error } = await adminDb
      .from('invoices')
      .select('invoice_number,status,amount,vendor_handle')
      .eq('business_wallet', getAddress(wallet.walletAddress))
      .order('created_at', { ascending: false })
      .limit(8);
    if (error) return { responseText: `Could not load invoices: ${error.message}` };
    return {
      responseText: data?.length
        ? data.map((row: any) => `${row.invoice_number}: ${row.amount} USDC - ${row.status}`).join('\n')
        : 'No invoices found.',
    };
  }

  const sendMatch = text.match(
    /\b(?:send|pay|transfer)\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?\s+(?:to\s+)?((?:0x[a-fA-F0-9]{40})|(?:[a-z0-9][a-z0-9-]*\.arc))\b/i,
  );
  if (sendMatch) {
    const result = await executeTool(
      'agentpay_send',
      { to: sendMatch[2], amount: sendMatch[1], remark: extractAgentpayRemark(text) || undefined },
      wallet,
      telegramSessionId(message.chat.id),
      { rawUserMessage: text },
    );
    return { responseText: result };
  }

  const requestMatch = text.match(
    /\brequest\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?\s+(?:from\s+)?((?:0x[a-fA-F0-9]{40})|(?:[a-z0-9][a-z0-9-]*\.arc))\b/i,
  );
  if (requestMatch) {
    const result = await executeTool(
      'agentpay_request',
      { from: requestMatch[2], amount: requestMatch[1], remark: extractAgentpayRemark(text) || undefined },
      wallet,
      telegramSessionId(message.chat.id),
      { rawUserMessage: text },
    );
    return { responseText: result };
  }

  return null;
}

export async function tryRouteTelegramAgentpayMessage(
  options: TelegramAgentpayRouteOptions,
): Promise<boolean> {
  const route = await routeDirectAgentpayMessage(options);
  if (!route) return false;
  if (route.confirmation) await storeTelegramAgentpayConfirmation(options.chatId, route.confirmation);
  await options.send(formatTelegramSharedRouteReply(route));
  return true;
}

async function executeTelegramAgentpayConfirmation(
  wallet: WalletCtx,
  confirmation: TelegramAgentpayConfirmation,
): Promise<string> {
  if (confirmation.action === 'contact_update') {
    const redis = getRedis();
    const key = `contact:update:${confirmation.confirmId}`;
    const raw = await redis.get(key);
    if (!raw) return 'No pending contact update found. Ask me to preview it again.';
    const parsed = JSON.parse(raw) as { name?: string; newAddress?: string };
    const name = String(parsed.name || '').trim().toLowerCase();
    const newAddress = String(parsed.newAddress || '').trim();
    if (!name || !newAddress) return 'The pending contact update is incomplete. Ask me to preview it again.';
    const resolved = getAddress(newAddress.startsWith('0x') ? newAddress : await resolvePayee(newAddress, wallet.walletAddress));
    const { error } = await adminDb
      .from('contacts')
      .update({ address: resolved, updated_at: new Date().toISOString() })
      .eq('wallet_address', getAddress(wallet.walletAddress))
      .ilike('name', name);
    await redis.del(key).catch(() => {});
    return error ? `Contact update failed: ${error.message}` : `Updated contact "${name}" -> ${resolved}.`;
  }
  if (confirmation.action === 'agentpay_send') {
    const result = await executeTool(
      'agentpay_send',
      { confirmed: true },
      wallet,
      confirmation.confirmId,
      { rawUserMessage: 'yes' },
    );
    return result;
  }
  if (confirmation.action === 'batch') {
    const result = await fetchJson(`${PUBLIC_API_BASE_URL}/api/batch/confirm/${encodeURIComponent(confirmation.confirmId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet.walletAddress, suppressPortfolioFollowup: true }),
    });
    return result.message ?? result.receipt ?? 'Batch payment complete.';
  }
  if (confirmation.action === 'split') {
    const result = await fetchJson(`${PUBLIC_API_BASE_URL}/api/split/confirm/${encodeURIComponent(confirmation.confirmId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet.walletAddress, suppressPortfolioFollowup: true }),
    });
    return result.message ?? result.receipt ?? 'Split payment complete.';
  }
  if (confirmation.action === 'schedule') {
    const result = await fetchJson(`${PUBLIC_API_BASE_URL}/api/schedule/confirm/${encodeURIComponent(confirmation.confirmId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet.walletAddress, suppressPortfolioFollowup: true }),
    });
    return result.message ?? result.receipt ?? 'Scheduled payment created.';
  }
  if (confirmation.action === 'invoice') {
    const result = await fetchJson(`${PUBLIC_API_BASE_URL}/api/invoice/confirm/${encodeURIComponent(confirmation.confirmId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet.walletAddress, suppressPortfolioFollowup: true }),
    });
    return result.message ?? result.receipt ?? 'Invoice created.';
  }
  return 'Cancelled.';
}

async function findTelegramFallbackConfirmation(
  chatId: number,
): Promise<TelegramAgentpayConfirmation | null> {
  const sessionId = telegramSessionId(chatId);
  if (!(await redisPendingExists((key) => getRedis().get(key), 'agentpay:pending', sessionId))) return null;
  return { action: 'agentpay_send', confirmId: sessionId, label: 'Send payment' };
}

export async function tryResolveTelegramAgentpayConfirmation(
  options: TelegramAgentpayConfirmationOptions,
): Promise<string | null> {
  if (!isTelegramAffirmativeReply(options.text) && !isTelegramNegativeReply(options.text)) return null;
  const confirmation =
    (await readTelegramPendingConfirmation<TelegramAgentpayAction>(getRedis(), options.chatId)) ??
    (await findTelegramFallbackConfirmation(options.chatId));
  if (!confirmation) return null;
  await clearTelegramPendingConfirmation(getRedis(), options.chatId);
  if (isTelegramNegativeReply(options.text)) return 'Cancelled.';
  return await executeTelegramAgentpayConfirmation(options.wallet, confirmation);
}
