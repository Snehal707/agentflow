import { appendFile, mkdir } from 'node:fs/promises';

const DIR = '.agentflow-telemetry';
const FILE = `${DIR}/semantic-memory-events.jsonl`;

export type SemanticMemoryTelemetryEvent =
  | {
      kind: 'write';
      at: string;
      walletAddress: string;
      memoryType: string;
      category?: string | null;
      confidence?: number | null;
      contentPreview: string;
      destination: 'db' | 'local_fallback';
    }
  | {
      kind: 'retrieve';
      at: string;
      walletAddress: string;
      query: string;
      sessionId?: string;
      requestedLimit: number;
      returnedCount: number;
      topCategories: string[];
      topTypes: string[];
      source: 'db' | 'local_fallback';
    };

export async function logSemanticMemoryTelemetry(
  event: SemanticMemoryTelemetryEvent,
): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await appendFile(FILE, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    console.warn('[semantic-memory-telemetry] write failed:', error);
  }
}
