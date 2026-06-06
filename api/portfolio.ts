import { Router } from 'express';
import { getAddress, isAddress } from 'viem';
import { buildPortfolioSnapshot } from '../agents/portfolio/portfolio';

const router = Router();
const PORTFOLIO_CACHE_TTL_MS = 30_000;
const PORTFOLIO_CACHE_STALE_MS = 5 * 60_000;

type PortfolioSnapshotRecord = Awaited<ReturnType<typeof buildPortfolioSnapshot>>;

const portfolioSnapshotCache = new Map<
  string,
  { snapshot: PortfolioSnapshotRecord; fetchedAt: number }
>();
const portfolioSnapshotInflight = new Map<string, Promise<PortfolioSnapshotRecord>>();

function portfolioCacheKey(walletAddress: string, gatewayDepositors: string[]): string {
  return `${walletAddress.toLowerCase()}::${gatewayDepositors
    .map((value) => value.toLowerCase())
    .sort()
    .join(',')}`;
}

function isRateLimitedPortfolioError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /429|too many requests|rate limit|eth_call/i.test(message);
}

router.get('/snapshot', async (req, res) => {
  try {
    const walletAddress = String(req.query.walletAddress ?? '').trim();
    if (!walletAddress || !isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Valid walletAddress is required' });
    }

    const gatewayDepositors = String(req.query.gatewayDepositors ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => isAddress(value))
      .map((value) => getAddress(value));

    const normalizedWallet = getAddress(walletAddress);
    const cacheKey = portfolioCacheKey(normalizedWallet, gatewayDepositors);
    const cached = portfolioSnapshotCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.fetchedAt <= PORTFOLIO_CACHE_TTL_MS) {
      return res.json(cached.snapshot);
    }

    const inflight = portfolioSnapshotInflight.get(cacheKey);
    const snapshot =
      inflight ??
      (async () => {
        const freshSnapshot = await buildPortfolioSnapshot(normalizedWallet, {
          gatewayDepositors,
        });
        portfolioSnapshotCache.set(cacheKey, {
          snapshot: freshSnapshot,
          fetchedAt: Date.now(),
        });
        return freshSnapshot;
      })();

    if (!inflight) {
      portfolioSnapshotInflight.set(cacheKey, snapshot);
    }

    const resolvedSnapshot = await snapshot.finally(() => {
      if (!inflight) {
        portfolioSnapshotInflight.delete(cacheKey);
      }
    });
    return res.json(resolvedSnapshot);
  } catch (error) {
    const walletAddress = String(req.query.walletAddress ?? '').trim();
    const gatewayDepositors = String(req.query.gatewayDepositors ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => isAddress(value))
      .map((value) => getAddress(value));
    const cacheKey =
      walletAddress && isAddress(walletAddress)
        ? portfolioCacheKey(getAddress(walletAddress), gatewayDepositors)
        : null;
    const cached = cacheKey ? portfolioSnapshotCache.get(cacheKey) : null;
    const now = Date.now();
    if (
      cached &&
      now - cached.fetchedAt <= PORTFOLIO_CACHE_STALE_MS &&
      (isRateLimitedPortfolioError(error) || error instanceof Error)
    ) {
      return res.json(cached.snapshot);
    }
    if (isRateLimitedPortfolioError(error)) {
      return res.status(429).json({
        error: 'Arc portfolio reads are temporarily rate-limited. Please retry in a few seconds.',
      });
    }
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'portfolio snapshot failed',
    });
  }
});

export default router;
