import dotenv from 'dotenv';
import { adminDb } from '../db/client';
import { readVaultApyPercent, resolveVaultAddress } from '../lib/vault-apy';
import { sendTelegramText } from '../lib/telegram-notify';

dotenv.config();

/**
 * Compare configured vault APY to a benchmark or alternate vault.
 * Alert via Telegram when benchmark improves current by >= 10% relative.
 */
export async function runYieldMonitor(): Promise<void> {
  const vault = resolveVaultAddress();
  if (!vault) {
    console.warn('[yield-monitor] VAULT_CONTRACT_ADDRESS not set; skip.');
    return;
  }

  const currentApy = await readVaultApyPercent(vault);

  const alt = process.env.ALTERNATE_VAULT_ADDRESS?.trim() as `0x${string}` | undefined;
  let bestApy: number;
  if (alt && /^0x[a-fA-F0-9]{40}$/.test(alt)) {
    bestApy = await readVaultApyPercent(alt);
  } else {
    bestApy = Number(process.env.BENCHMARK_VAULT_APY ?? '12');
  }

  if (!Number.isFinite(bestApy) || !Number.isFinite(currentApy) || currentApy <= 0) {
    console.warn('[yield-monitor] Invalid APY numbers; skip alerts.');
    return;
  }

  const relativeImprovement = (bestApy - currentApy) / currentApy;
  if (relativeImprovement < 0.1) {
    console.log(
      `[yield-monitor] No alert: current=${currentApy.toFixed(2)}% best=${bestApy.toFixed(2)}%`,
    );
    return;
  }

  const { data: users, error } = await adminDb
    .from('users')
    .select('wallet_address, telegram_id')
    .eq('yield_monitoring', true);

  if (error) {
    throw new Error(`[yield-monitor] users query: ${error.message}`);
  }

  const fallbackChat = process.env.TELEGRAM_YIELD_CHAT_ID?.trim();
  const msg = [
    `Yield alert: a better rate is available (~${(relativeImprovement * 100).toFixed(1)}% relative improvement).`,
    `Current vault APY: ${currentApy.toFixed(2)}%`,
    `Benchmark / best APY: ${bestApy.toFixed(2)}%`,
    `Vault: ${vault}`,
  ].join('\n');

  for (const row of users ?? []) {
    const chatId = (row.telegram_id as string | null)?.trim() || fallbackChat;
    if (!chatId) {
      continue;
    }
    try {
      await sendTelegramText(
        chatId,
        `${msg}\nWallet (monitoring): ${row.wallet_address as string}`,
      );
    } catch (e) {
      console.warn('[yield-monitor] telegram send failed:', e);
    }
  }

  if (!(users ?? []).length && fallbackChat) {
    await sendTelegramText(fallbackChat, msg);
  }
}

async function main(): Promise<void> {
  await runYieldMonitor();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[yield-monitor] failed:', err);
    process.exit(1);
  });
}
