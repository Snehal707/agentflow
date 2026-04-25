import { Router } from 'express';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { generateJWT, verifyJWT } from '../lib/auth';

const router = Router();

router.post('/verify-signature', async (req, res) => {
  try {
    const walletAddress = String(req.body?.walletAddress ?? '');
    const message = String(req.body?.message ?? '');
    const signature = String(req.body?.signature ?? '');

    if (!isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Valid walletAddress is required' });
    }
    if (!message || !signature) {
      return res.status(400).json({ error: 'message and signature are required' });
    }

    const normalized = getAddress(walletAddress);
    const valid = await verifyMessage({
      address: normalized,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const token = generateJWT(normalized);
    return res.json({
      token,
      walletAddress: normalized,
      accessModel: 'pay_per_task',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'verify-signature failed' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const rawToken = String(req.body?.token ?? '');
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    const token = rawToken || bearer;
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    const payload = verifyJWT(token);
    const nextToken = generateJWT(payload.walletAddress);

    return res.json({
      token: nextToken,
      walletAddress: payload.walletAddress,
      accessModel: 'pay_per_task',
    });
  } catch (error: any) {
    return res.status(401).json({ error: error?.message ?? 'refresh failed' });
  }
});

export default router;
