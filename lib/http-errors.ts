import type { Response } from 'express';

/**
 * Log the real error server-side and return a generic message to the client.
 *
 * Use for UNEXPECTED failures (500s) so internal RPC/DB/Circle details don't
 * leak to callers. Do NOT use this for deliberate 4xx validation/business
 * errors — those messages are user-facing and should stay specific.
 */
export function sendServerError(
  res: Response,
  scope: string,
  err: unknown,
  clientMessage = 'Request failed',
): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[${scope}]`, detail);
  if (!res.headersSent) {
    res.status(500).json({ error: clientMessage });
  }
}

/**
 * Log the real error and return a generic string for embedding in a response
 * body. Use when the response status/shape must be preserved (e.g. agent
 * servers returning `{ action: 'error', message }` or a 502) but the raw error
 * text must not leak to the caller.
 */
export function toClientMessage(scope: string, err: unknown, clientMessage = 'Request failed'): string {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[${scope}]`, detail);
  return clientMessage;
}
