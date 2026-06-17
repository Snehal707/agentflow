import { adminDb } from '../db/client';

export type TelegramChatProfile = {
  username?: string;
  displayName?: string;
};

function normalizeTelegramChatProfile(profile: TelegramChatProfile | null | undefined): TelegramChatProfile | null {
  if (!profile) {
    return null;
  }

  const username = String(profile.username ?? '').trim().replace(/^@/, '');
  const displayName = String(profile.displayName ?? '').trim();
  if (!username && !displayName) {
    return null;
  }

  return {
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

export function buildTelegramChatProfile(input: {
  username?: string | null | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  title?: string | null | undefined;
}): TelegramChatProfile | null {
  const username = String(input.username ?? '').trim().replace(/^@/, '');
  const first = String(input.first_name ?? '').trim();
  const last = String(input.last_name ?? '').trim();
  const title = String(input.title ?? '').trim();
  const displayName = [first, last].filter(Boolean).join(' ') || title || undefined;

  return normalizeTelegramChatProfile({
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
  });
}

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

    return buildTelegramChatProfile(payload.result);
  } catch {
    return null;
  }
}

export async function loadCachedTelegramChatProfile(
  walletAddress: string | null | undefined,
): Promise<TelegramChatProfile | null> {
  const normalizedWalletAddress = String(walletAddress ?? '').trim();
  if (!normalizedWalletAddress) {
    return null;
  }

  try {
    const { data, error } = await adminDb
      .from('user_profiles')
      .select('display_name, preferences')
      .eq('wallet_address', normalizedWalletAddress)
      .maybeSingle();

    if (error) {
      return null;
    }

    const preferences =
      data && typeof data === 'object' && 'preferences' in data
        ? (data.preferences as Record<string, unknown> | null | undefined)
        : null;
    const cached =
      preferences &&
      typeof preferences === 'object' &&
      preferences.telegram_profile &&
      typeof preferences.telegram_profile === 'object'
        ? (preferences.telegram_profile as Record<string, unknown>)
        : null;

    const cachedProfile = normalizeTelegramChatProfile({
      username: typeof cached?.username === 'string' ? cached.username : undefined,
      displayName: typeof cached?.displayName === 'string' ? cached.displayName : undefined,
    });
    if (cachedProfile) {
      return cachedProfile;
    }

    return normalizeTelegramChatProfile({
      displayName:
        data && typeof data === 'object' && 'display_name' in data && typeof data.display_name === 'string'
          ? data.display_name
          : undefined,
    });
  } catch {
    return null;
  }
}

export async function saveCachedTelegramChatProfile(
  walletAddress: string | null | undefined,
  profile: TelegramChatProfile | null | undefined,
): Promise<void> {
  const normalizedWalletAddress = String(walletAddress ?? '').trim();
  const normalizedProfile = normalizeTelegramChatProfile(profile);
  if (!normalizedWalletAddress || !normalizedProfile) {
    return;
  }

  try {
    const { data } = await adminDb
      .from('user_profiles')
      .select('preferences')
      .eq('wallet_address', normalizedWalletAddress)
      .maybeSingle();

    const existingPreferences =
      data && typeof data === 'object' && 'preferences' in data && data.preferences && typeof data.preferences === 'object'
        ? (data.preferences as Record<string, unknown>)
        : {};

    const nextPreferences: Record<string, unknown> = {
      ...existingPreferences,
      telegram_profile: {
        ...(normalizedProfile.username ? { username: normalizedProfile.username } : {}),
        ...(normalizedProfile.displayName ? { displayName: normalizedProfile.displayName } : {}),
        cachedAt: new Date().toISOString(),
      },
    };

    await adminDb.from('user_profiles').upsert(
      {
        wallet_address: normalizedWalletAddress,
        preferences: nextPreferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' },
    );
  } catch {
    // Ignore cache write failures; live link still works.
  }
}
