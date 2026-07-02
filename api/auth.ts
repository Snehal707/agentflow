import { Router } from 'express';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { generateJWT, verifyJWT } from '../lib/auth';
import { consumeAuthChallenge, issueAuthChallenge } from '../lib/auth-nonce';
import { sendServerError } from '../lib/http-errors';

const router = Router();

/**
 * Step 1 of login: mint a single-use, wallet-bound nonce and return the exact
 * message the client must sign. This is what defeats signature replay — the
 * client can no longer pick an arbitrary message.
 */
router.post('/nonce', async (req, res) => {
  try {
    const walletAddress = String(req.body?.walletAddress ?? '');
    if (!isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Valid walletAddress is required' });
    }
    const challenge = await issueAuthChallenge('login', getAddress(walletAddress));
    return res.json({
      walletAddress: getAddress(walletAddress),
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      message: challenge.message,
    });
  } catch (error: any) {
    return sendServerError(res, 'auth/nonce', error, 'nonce issuance failed');
  }
});

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

    // Reject before signature verification if the message isn't a live,
    // unconsumed challenge this server issued for this wallet.
    const challengeValid = await consumeAuthChallenge('login', normalized, message);
    if (!challengeValid) {
      return res
        .status(401)
        .json({ error: 'Invalid or expired sign-in challenge. Request a new nonce and retry.' });
    }

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
    return sendServerError(res, 'auth/verify-signature', error, 'verify-signature failed');
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
