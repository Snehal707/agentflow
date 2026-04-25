import TelegramBot from 'node-telegram-bot-api';

export function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || null;
}

function getBot(): TelegramBot | null {
  const token = getTelegramBotToken();
  if (!token) {
    return null;
  }
  return new TelegramBot(token, { polling: false });
}

/**
 * Long-lived bot with polling enabled — use only in `lib/telegram-bot.ts` (single process).
 */
export function createTelegramBotForPolling(): TelegramBot {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error('[telegram] TELEGRAM_BOT_TOKEN is not set');
  }
  return new TelegramBot(token, { polling: true });
}

export async function sendTelegramText(chatId: string, text: string): Promise<void> {
  const bot = getBot();
  if (!bot) {
    throw new Error('[telegram] TELEGRAM_BOT_TOKEN is not set');
  }
  await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
}

export async function sendTelegramPdf(
  chatId: string,
  pdf: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  const bot = getBot();
  if (!bot) {
    throw new Error('[telegram] TELEGRAM_BOT_TOKEN is not set');
  }
  await bot.sendDocument(chatId, pdf, caption ? { caption } : {}, { filename });
}
