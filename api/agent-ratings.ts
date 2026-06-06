import { Router, type Request, type Response } from 'express';
import { createPublicClient, getAddress, http, parseUnits } from 'viem';
import { adminDb } from '../db/client';
import { authMiddleware, type JWTPayload } from '../lib/auth';
import { ARC } from '../lib/arc-config';
import { getOrCreateUserAgentWallet } from '../lib/dcw';
import {
  buildReputationFeedbackHash,
  submitReputationFeedback,
} from '../lib/reputation';

const router = Router();

const INTERNAL_PIPELINE_AGENTS = new Set(['analyst', 'writer']);
const LEDGER_BACKOFF_MS = [0, 250, 500, 1000, 1750, 2500];
const MIN_VALIDATOR_GAS_RAW = parseUnits(
  process.env.RATING_VALIDATOR_MIN_NATIVE_USDC?.trim() || '0.001',
  18,
);

const arcClient = createPublicClient({
  transport: http(ARC.rpc),
});

type RatingBody = {
  taskId?: unknown;
  requestId?: unknown;
  agentSlug?: unknown;
  settlementRef?: unknown;
  stars?: unknown;
  surface?: unknown;
};

router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const auth = (req as any).auth as JWTPayload | undefined;
  const body = req.body as RatingBody;

  try {
    if (body.surface !== 'web') {
      return res.status(400).json({ error: 'Ratings are web-chat only in v1.' });
    }

    const walletAddress = getAddress(String(auth?.walletAddress ?? ''));
    const taskId = cleanRequiredString(body.taskId, 'taskId');
    const requestId = cleanRequiredString(body.requestId, 'requestId');
    const agentSlug = cleanAgentSlug(body.agentSlug);
    const settlementRef = cleanRequiredString(body.settlementRef, 'settlementRef');
    const stars = parseStars(body.stars);
    const score = stars * 20;

    if (INTERNAL_PIPELINE_AGENTS.has(agentSlug)) {
      return res.status(400).json({ error: 'Internal pipeline agents are not user-rated.' });
    }

    const existing = await getRatingByTaskId(taskId);
    if (existing?.status === 'confirmed') {
      return res.status(409).json({
        error: 'This paid task has already been rated.',
        status: 'confirmed',
        reputationTx: existing.reputation_tx ?? null,
      });
    }
    if (existing?.status === 'pending') {
      return res.status(409).json({
        error: 'This rating is already pending confirmation.',
        status: 'pending',
      });
    }

    const ledger = await waitForEligibleLedger(requestId);
    if (!ledger) {
      return res.status(404).json({ error: 'settlement not yet recorded' });
    }

    assertLedgerEligible(ledger, {
      agentSlug,
      settlementRef,
    });

    const executionWallet = await getOrCreateUserAgentWallet(walletAddress);
    if (
      String(ledger.buyer_wallet ?? '').toLowerCase() !==
      String(executionWallet.address ?? '').toLowerCase()
    ) {
      return res.status(403).json({ error: 'Paid task does not belong to this wallet.' });
    }

    const ownerWallet = await loadAgentWallet(agentSlug, 'owner');
    const validatorWallet = await loadAgentWallet(agentSlug, 'validator');
    const erc8004AgentId = String(ownerWallet.erc8004_token_id ?? '').trim();
    if (!erc8004AgentId) {
      return res.status(400).json({ error: `Agent ${agentSlug} is not ERC-8004 registered.` });
    }

    const feedbackHash = buildReputationFeedbackHash({
      agentId: erc8004AgentId,
      score: String(score),
      tag: 'user_star_rating',
      taskId,
      requestId,
      walletAddress,
    });

    const ratingRow = await upsertPendingRating({
      existingId: existing?.id ? String(existing.id) : null,
      existingRetryCount: Number(existing?.retry_count ?? 0),
      taskId,
      requestId,
      walletAddress,
      agentSlug,
      erc8004AgentId,
      stars,
      score,
      settlementRef,
      feedbackHash,
    });

    try {
      await assertValidatorHasGas(validatorWallet.address);
      const feedback = await submitReputationFeedback({
        agentId: erc8004AgentId,
        score,
        tag: 'user_star_rating',
        tag2: `${stars}_stars`,
        validatorWallet: validatorWallet.address,
        feedbackHash,
      });

      if (!feedback.success) {
        throw new Error('Arc reputation transaction did not reach COMPLETE state.');
      }

      const { error: confirmedError } = await adminDb
        .from('agent_ratings')
        .update({
          status: 'confirmed',
          reputation_tx: feedback.txHash ?? null,
          failure_reason: null,
          updated_at: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', ratingRow.id);

      if (confirmedError) {
        throw new Error(confirmedError.message);
      }

      return res.json({
        ok: true,
        status: 'confirmed',
        taskId,
        requestId,
        agentSlug,
        stars,
        score,
        reputationTx: feedback.txHash ?? null,
      });
    } catch (submissionError) {
      const failureReason = errorMessage(submissionError);
      await adminDb
        .from('agent_ratings')
        .update({
          status: 'failed',
          failure_reason: failureReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ratingRow.id);

      return res.status(502).json({
        error: failureReason,
        status: 'failed',
        retryAllowed: true,
      });
    }
  } catch (error) {
    return res.status(400).json({ error: errorMessage(error) });
  }
});

async function waitForEligibleLedger(requestId: string): Promise<Record<string, any> | null> {
  for (const delayMs of LEDGER_BACKOFF_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const { data, error } = await adminDb
      .from('agent_economy_ledger')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle();

    if (error) {
      throw new Error(`[rating] ledger lookup failed: ${error.message}`);
    }
    if (data) {
      return data as Record<string, any>;
    }
  }
  return null;
}

function assertLedgerEligible(
  ledger: Record<string, any>,
  input: { agentSlug: string; settlementRef: string },
): void {
  if (String(ledger.status ?? '') !== 'complete') {
    throw new Error('Paid task is not complete.');
  }
  if (String(ledger.payment_rail ?? '') !== 'x402/gateway') {
    throw new Error('Only x402/gateway paid tasks can be rated.');
  }
  if (!ledger.x402_transaction_ref) {
    throw new Error('Settlement reference is missing from the paid task.');
  }
  if (String(ledger.buyer_agent ?? '') !== 'user_dcw') {
    throw new Error('Only user-paid tasks can be rated.');
  }
  if (String(ledger.seller_agent ?? '') !== input.agentSlug) {
    throw new Error('Rating agent does not match the settled task.');
  }

  const validSettlementRefs = new Set(
    [ledger.x402_transaction_ref, ledger.settlement_tx_hash, ledger.arc_tx_id]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  );
  if (!validSettlementRefs.has(input.settlementRef)) {
    throw new Error('Rating settlement reference does not match the paid task.');
  }
}

async function loadAgentWallet(agentSlug: string, purpose: 'owner' | 'validator') {
  const { data, error } = await adminDb
    .from('wallets')
    .select('wallet_id,address,erc8004_token_id')
    .eq('agent_slug', agentSlug)
    .eq('purpose', purpose)
    .maybeSingle();

  if (error) {
    throw new Error(`[rating] ${purpose} wallet lookup failed: ${error.message}`);
  }
  if (!data?.address || !data?.wallet_id) {
    throw new Error(`[rating] ${purpose} wallet missing for ${agentSlug}`);
  }
  return data as { wallet_id: string; address: string; erc8004_token_id?: string | null };
}

async function assertValidatorHasGas(address: string): Promise<void> {
  const balance = await arcClient.getBalance({ address: getAddress(address) as `0x${string}` });
  if (balance < MIN_VALIDATOR_GAS_RAW) {
    throw new Error(
      `Validator wallet needs Arc native USDC gas before submitting reputation feedback.`,
    );
  }
}

async function getRatingByTaskId(taskId: string): Promise<Record<string, any> | null> {
  const { data, error } = await adminDb
    .from('agent_ratings')
    .select('*')
    .eq('task_id', taskId)
    .maybeSingle();

  if (error) {
    throw new Error(`[rating] existing rating lookup failed: ${error.message}`);
  }
  return (data as Record<string, any> | null) ?? null;
}

async function upsertPendingRating(input: {
  existingId: string | null;
  existingRetryCount: number;
  taskId: string;
  requestId: string;
  walletAddress: string;
  agentSlug: string;
  erc8004AgentId: string;
  stars: number;
  score: number;
  settlementRef: string;
  feedbackHash: string;
}): Promise<Record<string, any>> {
  const row = {
    task_id: input.taskId,
    request_id: input.requestId,
    wallet_address: input.walletAddress,
    agent_slug: input.agentSlug,
    erc8004_agent_id: input.erc8004AgentId,
    stars: input.stars,
    score: input.score,
    settlement_ref: input.settlementRef,
    status: 'pending',
    reputation_tx: null,
    failure_reason: null,
    feedback_hash: input.feedbackHash,
    updated_at: new Date().toISOString(),
  };

  if (input.existingId) {
    const { data, error } = await adminDb
      .from('agent_ratings')
      .update({
        ...row,
        retry_count: input.existingRetryCount + 1,
      })
      .eq('id', input.existingId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`[rating] retry update failed: ${error.message}`);
    }
    return data as Record<string, any>;
  }

  const { data, error } = await adminDb
    .from('agent_ratings')
    .insert({
      ...row,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`[rating] insert failed: ${error.message}`);
  }
  return data as Record<string, any>;
}

function cleanRequiredString(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function cleanAgentSlug(value: unknown): string {
  const slug = cleanRequiredString(value, 'agentSlug').toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(slug)) {
    throw new Error('Invalid agentSlug.');
  }
  return slug;
}

function parseStars(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error('stars must be an integer from 1 to 5.');
  }
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default router;
