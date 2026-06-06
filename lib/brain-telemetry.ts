import { adminDb } from '../db/client';
import { randomUUID } from 'node:crypto';

export type BrainEventOutcome =
  | 'success'
  | 'hallucination_detected'
  | 'timeout'
  | 'tool_error'
  | 'validation_error'
  | 'user_cancel'
  | 'guard_blocked'
  | 'gibberish_rejected'
  | 'turn_cap_hit'
  | 'stale_state_blocked'
  | 'unexpected_tool_blocked'
  | 'low_confidence_clarify';

export type BrainToolTelemetry = {
  name: string;
  provider?: string | null;
  params_summary?: string | null;
  result_summary?: string | null;
  latency_ms?: number | null;
  success: boolean;
};

export type BrainEvent = {
  id: string;
  session_id: string;
  wallet_address: string;
  created_at: string;
  user_input: string | null;
  intent_label: string | null;
  intent_source: 'fastpath' | 'hermes' | 'unclear' | null;
  tools_called: BrainToolTelemetry[];
  hermes_model: 'fast' | 'deep' | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  total_latency_ms: number | null;
  final_response_summary: string | null;
  outcome: BrainEventOutcome | null;
  failure_reason: string | null;
  user_feedback: 'positive' | 'negative' | null;
  feedback_note: string | null;
  user_correction: string | null;
  research_trajectory: Record<string, unknown> | null;
  llm_intent_json: Record<string, unknown> | null;
  validator_passed: boolean | null;
  final_intent: string | null;
  layer_used: 'fastpath' | 'intent_router' | 'hermes_agent' | null;
  fastpath_confidence: number | null;
  experiment_variant: string | null;
};

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd();
}

function stripObviousPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone]')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, '[wallet]');
}

function normalizeEvent(partialEvent: Partial<BrainEvent>): Record<string, unknown> {
  const event: Record<string, unknown> = { ...partialEvent };
  if (typeof event.user_input === 'string') {
    event.user_input = truncate(stripObviousPii(event.user_input), 500);
  }
  if (typeof event.final_response_summary === 'string') {
    event.final_response_summary = truncate(event.final_response_summary, 200);
  }
  if (typeof event.failure_reason === 'string') {
    event.failure_reason = truncate(event.failure_reason, 500);
  }
  if (typeof event.user_correction === 'string') {
    event.user_correction = truncate(stripObviousPii(event.user_correction), 500);
  }
  if (typeof event.feedback_note === 'string') {
    event.feedback_note = truncate(stripObviousPii(event.feedback_note), 500);
  }
  return event;
}

export async function logBrainEvent(partialEvent: Partial<BrainEvent>): Promise<string> {
  const payload = normalizeEvent(partialEvent);
  console.info('[BRAIN_TELEMETRY]', JSON.stringify({ action: 'insert', ...payload }));
  try {
    const { data, error } = await adminDb
      .from('brain_events')
      .insert(payload)
      .select('id')
      .single();
    if (error) {
      throw new Error(error.message);
    }
    return String(data?.id || '');
  } catch (error) {
    const fallbackId = randomUUID();
    console.warn('[BRAIN_TELEMETRY]', JSON.stringify({
      action: 'insert_fallback',
      fallback_id: fallbackId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return fallbackId;
  }
}

export async function updateBrainEvent(
  eventId: string,
  updates: Partial<BrainEvent>,
): Promise<void> {
  const id = eventId.trim();
  if (!id) return;
  const payload = normalizeEvent(updates);
  console.info('[BRAIN_TELEMETRY]', JSON.stringify({ action: 'update', id, ...payload }));
  try {
    const { error } = await adminDb.from('brain_events').update(payload).eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.warn('[BRAIN_TELEMETRY]', JSON.stringify({
      action: 'update_fallback',
      id,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
