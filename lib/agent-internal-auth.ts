import type { NextFunction, Request, Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { authMiddleware, type JWTPayload } from './auth';
import { matchesBrainInternalKey } from './internal-key';

const PAID_INTERNAL_HEADER = 'x-agentflow-paid-internal';

export function paidInternalOrAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (matchesBrainInternalKey(req.headers[PAID_INTERNAL_HEADER] as string | undefined)) {
    const walletAddress = String(req.body?.walletAddress ?? '').trim();
    if (!isAddress(walletAddress)) {
      res.status(400).json({ error: 'walletAddress is required for internal paid agent calls' });
      return;
    }
    (req as any).auth = {
      walletAddress: getAddress(walletAddress),
      accessModel: 'pay_per_task',
      exp: 0,
    } satisfies JWTPayload;
    next();
    return;
  }

  authMiddleware(req, res, next);
}

