import dotenv from 'dotenv';
import OpenAI from 'openai';
import type { Response } from 'express';

dotenv.config();

export const hermes = new OpenAI({
  baseURL: process.env.HERMES_BASE_URL ?? 'https://inference-api.nousresearch.com/v1',
  apiKey: process.env.HERMES_API_KEY,
});

/** Route selection per AgentFlow V3. */
export const models = {
  fast: process.env.HERMES_MODEL_FAST ?? process.env.HERMES_MODEL ?? 'nousresearch/hermes-4-70b',
  deep: process.env.HERMES_MODEL_DEEP ?? process.env.HERMES_MODEL ?? 'nousresearch/hermes-4-405b',
  vision: process.env.HERMES_VISION_MODEL ?? 'google/gemma-4-26b-a4b-it',
  fallback: 'gpt-4o-mini',
} as const;

function resolveModel(which: 'fast' | 'deep'): string {
  return which === 'fast' ? models.fast : models.deep;
}

type HermesCallOptions = {
  model?: 'fast' | 'deep';
  memoryContext?: string;
  walletAddress?: string;
  agentSlug?: string;
};

/**
 * Append recent user/agent turns from Supabase (when columns exist and rows are present).
 */
export async function buildMemoryContext(params: {
  walletAddress: string;
  agentSlug: string;
  limit?: number;
}): Promise<string> {
  const limit = params.limit ?? 10;
  const { adminDb } = await import('../db/client');
  const { data, error } = await adminDb
    .from('agent_interactions')
    .select('user_input, agent_output, created_at')
    .eq('wallet_address', params.walletAddress)
    .eq('agent_slug', params.agentSlug)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data?.length) {
    return '';
  }

  const lines = [...data]
    .reverse()
    .map(
      (row) =>
        `User: ${row.user_input ?? ''}\nAgent: ${(row.agent_output ?? '').slice(0, 2000)}`,
    );
  return ['Prior context:', ...lines].join('\n---\n');
}

export async function callHermes(
  systemPrompt: string,
  userMessage: string,
  options?: HermesCallOptions,
): Promise<string> {
  const which = options?.model ?? 'deep';
  const model = resolveModel(which);
  const memory = await resolveMemoryContext(options);
  const userContent = memory ? `${memory}\n\n---\n\n${userMessage}` : userMessage;

  const response = await hermes.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

export async function callHermesFast(
  systemPrompt: string,
  userMessage: string,
  options?: Omit<HermesCallOptions, 'model'>,
): Promise<string> {
  return callHermes(systemPrompt, userMessage, { ...options, model: 'fast' });
}

export async function callHermesDeep(
  systemPrompt: string,
  userMessage: string,
  options?: Omit<HermesCallOptions, 'model'>,
): Promise<string> {
  return callHermes(systemPrompt, userMessage, { ...options, model: 'deep' });
}

/**
 * Token stream for SSE endpoints — yields content deltas.
 */
export async function* streamHermes(
  systemPrompt: string,
  userMessage: string,
  options?: HermesCallOptions,
): AsyncGenerator<string, void, undefined> {
  const which = options?.model ?? 'fast';
  const model = resolveModel(which);
  const memory = await resolveMemoryContext(options);
  const userContent = memory ? `${memory}\n\n---\n\n${userMessage}` : userMessage;

  const stream = await hermes.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

/**
 * Convenience helper for Express SSE endpoints.
 */
export async function streamHermesToSSE(
  res: Response,
  systemPrompt: string,
  userMessage: string,
  options?: HermesCallOptions,
): Promise<void> {
  for await (const delta of streamHermes(systemPrompt, userMessage, options)) {
    res.write(`data: ${JSON.stringify({ delta })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
}

async function resolveMemoryContext(options?: HermesCallOptions): Promise<string> {
  const explicit = options?.memoryContext?.trim();
  if (explicit) {
    return explicit;
  }
  const walletAddress = options?.walletAddress?.trim();
  const agentSlug = options?.agentSlug?.trim();
  if (!walletAddress || !agentSlug) {
    return '';
  }
  return buildMemoryContext({ walletAddress, agentSlug, limit: 10 });
}
