import { adminDb } from '../db/client';

export type ChatFeedbackEntry = {
  id: string;
  at: string;
  sessionId: string | null;
  walletAddress: string | null;
  feedback: 'positive' | 'negative';
  note: string | null;
  query: string;
  responseSummary: string | null;
  outcome: string | null;
  failureReason: string | null;
  intentLabel: string | null;
  finalIntent: string | null;
  layerUsed: string | null;
};

function normalizeText(value: string | null | undefined, fallback = ''): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

function shortText(value: string | null | undefined, max = 280): string | null {
  const clean = normalizeText(value);
  if (!clean) return null;
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}...`;
}

export async function loadChatFeedbackEntries(limit = 80): Promise<ChatFeedbackEntry[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 80;
  const { data, error } = await adminDb
    .from('brain_events')
    .select(
      'id, created_at, session_id, wallet_address, user_feedback, feedback_note, user_input, final_response_summary, outcome, failure_reason, intent_label, final_intent, layer_used',
    )
    .not('user_feedback', 'is', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`[chat-feedback-review] brain_events read failed: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => ({
      id: String(row.id ?? ''),
      at: String(row.created_at ?? ''),
      sessionId: row.session_id ? String(row.session_id) : null,
      walletAddress: row.wallet_address ? String(row.wallet_address) : null,
      feedback:
        row.user_feedback === 'positive' || row.user_feedback === 'negative'
          ? row.user_feedback
          : 'negative',
      note: shortText(row.feedback_note, 500),
      query: normalizeText(row.user_input, '(missing prompt)'),
      responseSummary: shortText(row.final_response_summary, 360),
      outcome: row.outcome ? String(row.outcome) : null,
      failureReason: shortText(row.failure_reason, 360),
      intentLabel: row.intent_label ? String(row.intent_label) : null,
      finalIntent: row.final_intent ? String(row.final_intent) : null,
      layerUsed: row.layer_used ? String(row.layer_used) : null,
    }))
    .filter((item) => item.id && item.at);
}
