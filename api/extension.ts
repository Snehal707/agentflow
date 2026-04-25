import { Router } from 'express';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';
import { adminDb, getRedis } from '../db/client';
import { authMiddleware, type JWTPayload } from '../lib/auth';
import { buildMemoryContext, streamHermes } from '../lib/hermes';
import { ARC } from '../lib/arc-config';
import { fetchUrlViaFirecrawl } from '../lib/firecrawl';

const router = Router();

const DAILY_LIMIT = 10;
const MINUTE_LIMIT = 3;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

router.post('/analyze', authMiddleware, async (req, res) => {
  const auth = (req as any).auth as JWTPayload | undefined;
  if (!auth?.walletAddress) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = String(req.body?.url ?? '').trim();
  const question = String(req.body?.question ?? '').trim();
  if (!url || !question) {
    return res.status(400).json({ error: 'url and question are required' });
  }

  try {
    const allowed = await checkExtensionRateLimit(auth.walletAddress);
    if (!allowed.allowed) {
      return res.status(429).json({
        error: 'Extension rate limit exceeded',
        reason: allowed.reason,
        dailyUsed: allowed.dailyUsed,
        dailyLimit: DAILY_LIMIT,
        minuteUsed: allowed.minuteUsed,
        minuteLimit: MINUTE_LIMIT,
      });
    }

    const walletContext = await fetchWalletContext(auth.walletAddress);
    const fetchedContent = await fetchUrlViaFirecrawl(url);
    const memory = await buildMemoryContext({
      walletAddress: auth.walletAddress,
      agentSlug: 'extension',
      limit: 10,
    });

    const systemPrompt = [
      'You are the AgentFlow extension analyst.',
      'Use the wallet context and fetched page content to answer accurately.',
      'Prioritize concrete, actionable output.',
      'Keep responses concise and structured.',
    ].join('\n');

    const userMessage = [
      `URL: ${url}`,
      `QUESTION: ${question}`,
      `WALLET_CONTEXT_JSON: ${JSON.stringify(walletContext)}`,
      `PAGE_CONTENT:\n${fetchedContent}`,
    ].join('\n\n');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // @ts-ignore
    res.flushHeaders?.();

    let output = '';
    for await (const delta of streamHermes(systemPrompt, userMessage, {
      model: 'fast',
      memoryContext: memory,
      walletAddress: auth.walletAddress,
      agentSlug: 'extension',
    })) {
      output += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();

    await adminDb.from('extension_analyses').insert({
      wallet_address: auth.walletAddress,
      page_url: url,
      user_question: question,
      fetched_content: fetchedContent.slice(0, 200000),
      wallet_context: walletContext,
      analysis_output: output,
      created_at: new Date().toISOString(),
    });
  } catch (error: any) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error?.message ?? 'extension analyze failed' });
    }
    res.write(`data: ${JSON.stringify({ error: error?.message ?? 'extension analyze failed' })}\n\n`);
    res.end();
  }
});

export default router;

async function checkExtensionRateLimit(walletAddress: string): Promise<{
  allowed: boolean;
  reason?: 'DAILY' | 'MINUTE';
  dailyUsed: number;
  minuteUsed: number;
}> {
  const redis = getRedis();
  const now = new Date();
  const date = formatDateUTC(now);
  const minute = formatMinuteUTC(now);
  const dailyKey = `rate:extension:daily:${walletAddress}:${date}`;
  const minuteKey = `rate:extension:minute:${walletAddress}:${minute}`;

  const [dailyRaw, minuteRaw] = await Promise.all([redis.get(dailyKey), redis.get(minuteKey)]);
  const dailyUsed = Number(dailyRaw ?? '0');
  const minuteUsed = Number(minuteRaw ?? '0');

  if (dailyUsed >= DAILY_LIMIT) {
    return { allowed: false, reason: 'DAILY', dailyUsed, minuteUsed };
  }
  if (minuteUsed >= MINUTE_LIMIT) {
    return { allowed: false, reason: 'MINUTE', dailyUsed, minuteUsed };
  }

  const tx = redis.multi();
  tx.incr(dailyKey);
  tx.expire(dailyKey, 24 * 60 * 60);
  tx.incr(minuteKey);
  tx.expire(minuteKey, 60);
  const results = await tx.exec();

  return {
    allowed: true,
    dailyUsed: Number(results?.[0]?.[1] ?? dailyUsed + 1),
    minuteUsed: Number(results?.[2]?.[1] ?? minuteUsed + 1),
  };
}

async function fetchWalletContext(walletAddress: string): Promise<Record<string, unknown>> {
  const [userRes, walletRes, holdings] = await Promise.all([
    adminDb
      .from('users')
      .select('arc_handle, training_consent')
      .eq('wallet_address', walletAddress)
      .maybeSingle(),
    adminDb
      .from('wallets')
      .select('address, purpose, wallet_id')
      .eq('user_wallet', walletAddress),
    fetchArcWalletSnapshot(walletAddress),
  ]);

  return {
    walletAddress,
    arcChainId: ARC.chainId,
    accessModel: 'pay_per_task',
    user: userRes.data ?? null,
    linkedWallets: walletRes.data ?? [],
    holdings,
  };
}

async function fetchArcWalletSnapshot(walletAddress: string): Promise<unknown> {
  try {
    const client = createPublicClient({
      transport: http(ARC.alchemyRpc || ARC.rpc),
    });
    const address = getAddress(walletAddress) as `0x${string}`;
    const [nativeUsdcGas, usdc, eurc] = await Promise.all([
      client.getBalance({ address }),
      client.readContract({
        address: ARC_USDC,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address],
      }),
      client.readContract({
        address: ARC_EURC,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address],
      }),
    ]);

    return {
      source: 'arc_rpc',
      tokenApiUsed: false,
      note: 'Arc Testnet balances are read with standard JSON-RPC and ERC-20 balanceOf calls.',
      balances: {
        nativeUsdcGas: formatUnits(nativeUsdcGas, 18),
        usdc: formatUnits(usdc, 6),
        eurc: formatUnits(eurc, 6),
      },
    };
  } catch (error: any) {
    return { error: error?.message ?? 'Arc wallet snapshot failed' };
  }
}

function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMinuteUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  const h = `${d.getUTCHours()}`.padStart(2, '0');
  const min = `${d.getUTCMinutes()}`.padStart(2, '0');
  return `${y}${m}${day}${h}${min}`;
}
