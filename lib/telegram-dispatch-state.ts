const DEFAULT_PENDING_TTL_SECONDS = 300;
const DEFAULT_PENDING_KEY_PREFIX = 'telegram:pending:';

export type TelegramSharedConfirmation<TAction extends string> = {
  action: TAction;
  confirmId: string;
  label?: string;
};

export type TelegramRouteResult<TAction extends string> = {
  responseText: string;
  confirmation?: TelegramSharedConfirmation<TAction>;
};

export type TelegramPendingConfirmationStore = {
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
};

export function telegramSessionId(chatId: number | string): string {
  return `telegram:${String(chatId)}`;
}

export function telegramPendingConfirmationKey(
  chatId: number | string,
  keyPrefix = DEFAULT_PENDING_KEY_PREFIX,
): string {
  return `${keyPrefix}${String(chatId)}`;
}

export async function readTelegramPendingConfirmation<TAction extends string>(
  store: TelegramPendingConfirmationStore,
  chatId: number | string,
  keyPrefix = DEFAULT_PENDING_KEY_PREFIX,
): Promise<TelegramSharedConfirmation<TAction> | null> {
  const key = telegramPendingConfirmationKey(chatId, keyPrefix);
  const raw = await store.get(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TelegramSharedConfirmation<TAction>>;
    if (
      typeof parsed.action !== 'string' ||
      typeof parsed.confirmId !== 'string' ||
      !parsed.action.trim() ||
      !parsed.confirmId.trim()
    ) {
      return null;
    }
    return {
      action: parsed.action as TAction,
      confirmId: parsed.confirmId,
      ...(typeof parsed.label === 'string' && parsed.label.trim()
        ? { label: parsed.label }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function writeTelegramPendingConfirmation<TAction extends string>(
  store: TelegramPendingConfirmationStore,
  chatId: number | string,
  confirmation: TelegramSharedConfirmation<TAction>,
  options: {
    keyPrefix?: string;
    ttlSeconds?: number;
  } = {},
): Promise<void> {
  const key = telegramPendingConfirmationKey(
    chatId,
    options.keyPrefix ?? DEFAULT_PENDING_KEY_PREFIX,
  );
  await store.setex(
    key,
    options.ttlSeconds ?? DEFAULT_PENDING_TTL_SECONDS,
    JSON.stringify(confirmation),
  );
}

export async function clearTelegramPendingConfirmation(
  store: TelegramPendingConfirmationStore,
  chatId: number | string,
  keyPrefix = DEFAULT_PENDING_KEY_PREFIX,
): Promise<void> {
  await store.del(telegramPendingConfirmationKey(chatId, keyPrefix));
}

export function isTelegramAffirmativeReply(text: string): boolean {
  return /^(?:yes|y|yeah|yep|confirm|confirmed|approve|approved|execute|send|go|go ahead|yeah go|ok|okay|sure|proceed)$/i.test(
    text.trim(),
  );
}

export function isTelegramNegativeReply(text: string): boolean {
  return /^(?:no|n|nope|cancel|cancelled|canceled|stop|abort|reject|decline|never mind|nevermind)$/i.test(
    text.trim(),
  );
}

export function formatTelegramConfirmationPrompt<TAction extends string>(
  confirmation?: TelegramSharedConfirmation<TAction>,
): string {
  const action = confirmation?.label?.trim() || confirmation?.action?.trim();
  return action
    ? `${action}. Reply YES to confirm or NO to cancel.`
    : 'Reply YES to confirm or NO to cancel.';
}
