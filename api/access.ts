import { Router } from 'express';
import { getAddress, isAddress } from 'viem';
import { adminDb } from '../db/client';
import { authMiddleware, type JWTPayload } from '../lib/auth';

const router = Router();

function normalizeAuthenticatedWallet(auth: JWTPayload | undefined): `0x${string}` | null {
  if (!auth?.walletAddress || !isAddress(auth.walletAddress)) {
    return null;
  }
  return getAddress(auth.walletAddress) as `0x${string}`;
}

router.post('/claim', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    const walletAddress = normalizeAuthenticatedWallet(auth);
    if (!walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    const { data: existing, error: existingError } = await adminDb
      .from('access_codes')
      .select('id, code, claimed_by, claimed_at, revoked')
      .eq('code', code)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (!existing || existing.revoked) {
      return res.status(404).json({ error: 'Access code not found or revoked.' });
    }

    if (existing.claimed_by && existing.claimed_by !== walletAddress) {
      return res.status(409).json({ error: 'Access code already claimed by another wallet.' });
    }

    if (existing.claimed_by === walletAddress) {
      return res.json({
        ok: true,
        hasAccess: true,
        claimedBy: walletAddress,
        claimedAt: existing.claimed_at,
      });
    }

    const claimedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await adminDb
      .from('access_codes')
      .update({
        claimed_by: walletAddress,
        claimed_at: claimedAt,
      })
      .eq('id', existing.id)
      .is('claimed_by', null)
      .select('claimed_by, claimed_at')
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    if (!updated) {
      const { data: refetched, error: refetchError } = await adminDb
        .from('access_codes')
        .select('claimed_by, claimed_at, revoked')
        .eq('id', existing.id)
        .maybeSingle();

      if (refetchError) {
        return res.status(500).json({ error: refetchError.message });
      }

      if (!refetched || refetched.revoked) {
        return res.status(404).json({ error: 'Access code not found or revoked.' });
      }

      if (refetched.claimed_by !== walletAddress) {
        return res.status(409).json({ error: 'Access code already claimed by another wallet.' });
      }

      return res.json({
        ok: true,
        hasAccess: true,
        claimedBy: walletAddress,
        claimedAt: refetched.claimed_at,
      });
    }

    return res.json({
      ok: true,
      hasAccess: true,
      claimedBy: walletAddress,
      claimedAt: updated.claimed_at,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'access claim failed' });
  }
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    const walletAddress = normalizeAuthenticatedWallet(auth);
    if (!walletAddress) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { count, error } = await adminDb
      .from('access_codes')
      .select('id', { count: 'exact', head: true })
      .eq('claimed_by', walletAddress)
      .eq('revoked', false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      hasAccess: Number(count ?? 0) > 0,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'access status failed' });
  }
});

export default router;
