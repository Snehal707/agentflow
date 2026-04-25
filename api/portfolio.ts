import { Router } from 'express';
import { getAddress, isAddress } from 'viem';
import { buildPortfolioSnapshot } from '../agents/portfolio/portfolio';

const router = Router();

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

    const snapshot = await buildPortfolioSnapshot(getAddress(walletAddress), {
      gatewayDepositors,
    });
    return res.json(snapshot);
  } catch (error) {
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
