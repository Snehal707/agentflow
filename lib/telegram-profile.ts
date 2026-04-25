export type TelegramChatProfile = {
  username?: string;
  displayName?: string;
};

export function resolveTelegramBotUsername(): string {
  const raw =
    process.env.TELEGRAM_BOT_USERNAME?.trim() ||
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim() ||
    '';
  return raw.replace(/^@/, '');
}

export async function resolveTelegramChatProfile(
  chatId: string | null | undefined,
): Promise<TelegramChatProfile | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const normalizedChatId = String(chatId ?? '').trim();
  if (!token || !normalizedChatId) {
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getChat?chat_id=${encodeURIComponent(normalizedChatId)}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      ok?: boolean;
      result?: {
        username?: string;
        first_name?: string;
        last_name?: string;
        title?: string;
      };
    };

    if (!payload.ok || !payload.result) {
      return null;
    }

    const username = String(payload.result.username ?? '').trim();
    const first = String(payload.result.first_name ?? '').trim();
    const last = String(payload.result.last_name ?? '').trim();
    const title = String(payload.result.title ?? '').trim();
    const displayName = [first, last].filter(Boolean).join(' ') || title || undefined;

    return {
      ...(username ? { username } : {}),
      ...(displayName ? { displayName } : {}),
    };
  } catch {
    return null;
  }
}
