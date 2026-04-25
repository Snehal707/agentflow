import type { Request, Response } from 'express';
import { getAddress } from 'viem';
import { adminDb } from '../db/client';
import type { JWTPayload } from './auth';
import telegramLinkCode from './telegram-link-code';
import {
  resolveTelegramBotUsername,
  resolveTelegramChatProfile,
} from './telegram-profile';

const LINK_TTL_SECONDS = 600;

export async function telegramGenerateCodeHandler(req: Request, res: Response) {
  try {
    const auth = (req as any).auth as JWTPayload;
    const walletAddress = getAddress(auth.walletAddress);
    if (typeof telegramLinkCode.createTelegramLinkCode !== 'function') {
      throw new Error('Telegram link code helper is unavailable');
    }
    const code = telegramLinkCode.createTelegramLinkCode(walletAddress, LINK_TTL_SECONDS);
    const botUsername = resolveTelegramBotUsername();
    return res.json({
      code,
      expiresIn: LINK_TTL_SECONDS,
      ...(botUsername ? { botUsername } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'generate-code failed' });
  }
}

export async function telegramUnlinkHandler(req: Request, res: Response) {
  try {
    const auth = (req as any).auth as JWTPayload;
    const { error } = await adminDb
      .from('users')
      .update({ telegram_id: null })
      .eq('wallet_address', auth.walletAddress);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    const { error: businessError } = await adminDb
      .from('businesses')
      .update({ telegram_id: null })
      .eq('wallet_address', auth.walletAddress);
    if (businessError) {
      return res.status(500).json({ error: businessError.message });
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'unlink failed' });
  }
}

export async function telegramStatusHandler(req: Request, res: Response) {
  try {
    const auth = (req as any).auth as JWTPayload;
    const { data, error } = await adminDb
      .from('users')
      .select('telegram_id')
      .eq('wallet_address', auth.walletAddress)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    const tid = data?.telegram_id as string | null | undefined;
    const linked = Boolean(tid && String(tid).trim());
    const botUsername = resolveTelegramBotUsername();
    const telegramProfile = linked ? await resolveTelegramChatProfile(String(tid).trim()) : null;
    return res.json({
      linked,
      telegramId: linked ? String(tid).trim() : undefined,
      telegramUsername: telegramProfile?.username,
      telegramDisplayName: telegramProfile?.displayName,
      ...(botUsername ? { botUsername } : {}),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'status failed' });
  }
}
