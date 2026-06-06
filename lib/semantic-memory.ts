import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Address } from 'viem';
import { adminDb } from '../db/client';
import { logSemanticMemoryTelemetry } from './semantic-memory-telemetry';

export type SemanticMemoryType =
  | 'profile'
  | 'episodic'
  | 'routing_example'
  | 'session_summary';

export type SemanticMemoryRow = {
  id?: string;
  wallet_address: string;
  session_id?: string | null;
  memory_type: SemanticMemoryType;
  category?: string | null;
  content: string;
  structured?: Record<string, unknown>;
  keywords?: string[];
  source_user_message?: string | null;
  source_assistant_message?: string | null;
  confidence?: number | null;
  supersedes_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type RetrieveSemanticMemoriesParams = {
  walletAddress: Address;
  sessionId?: string;
  query: string;
  limit?: number;
  types?: SemanticMemoryType[];
};

const LOCAL_MEMORY_DIR = path.join(process.cwd(), '.agentflow-memory');
const LOCAL_SEMANTIC_MEMORY_FILE = path.join(LOCAL_MEMORY_DIR, 'semantic-memories.json');
const LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED =
  (process.env.AGENTFLOW_LOCAL_MEMORY_FALLBACK ?? '1').trim() !== '0';

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'do',
  'for',
  'from',
  'go',
  'hey',
  'hi',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'this',
  'to',
  'uh',
  'up',
  'us',
  'was',
  'we',
  'what',
  'you',
  'your',
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9._-]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !STOPWORDS.has(part));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

type SemanticQueryIntent = 'profile_name' | 'profile_preference' | 'routing_policy' | 'episodic_recall' | 'general';

function detectSemanticQueryIntent(query: string): SemanticQueryIntent {
  if (
    /\b(?:my name|remember my name|do you remember my name|what'?s my name|who am i|call me)\b/i.test(
      query,
    )
  ) {
    return 'profile_name';
  }
  if (
    /\b(?:prefer|preference|style|answer me|reply style|how should you answer|short direct answers)\b/i.test(
      query,
    )
  ) {
    return 'profile_preference';
  }
  if (
    /\b(?:telegram|policy|intent|router|routing|chat mode|fallback|bot policy)\b/i.test(query)
  ) {
    return 'routing_policy';
  }
  if (
    /\b(?:previous|before|last|earlier|remember|talking|left off|happened|what were we talking about|what did we do)\b/i.test(
      query,
    )
  ) {
    return 'episodic_recall';
  }
  return 'general';
}

async function readLocalSemanticMemories(): Promise<SemanticMemoryRow[]> {
  try {
    const raw = await readFile(LOCAL_SEMANTIC_MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SemanticMemoryRow[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalSemanticMemories(rows: SemanticMemoryRow[]): Promise<void> {
  await mkdir(LOCAL_MEMORY_DIR, { recursive: true });
  await writeFile(LOCAL_SEMANTIC_MEMORY_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

async function appendLocalSemanticMemory(row: SemanticMemoryRow): Promise<void> {
  if (!LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED) {
    return;
  }
  const existing = await readLocalSemanticMemories();
  existing.push(row);
  await writeLocalSemanticMemories(existing.slice(-500));
}

function scoreMemory(row: SemanticMemoryRow, query: string, sessionId?: string): number {
  const queryTokens = unique(tokenize(query));
  const contentTokens = unique(
    tokenize(
      [row.content, ...(row.keywords ?? []), row.category ?? '', row.source_user_message ?? ''].join(' '),
    ),
  );

  let score = 0;
  const overlap = queryTokens.filter((token) => contentTokens.includes(token));
  score += overlap.length * 4;

  const normalizedQuery = normalizeText(query).toLowerCase();
  const normalizedContent = normalizeText(row.content).toLowerCase();
  const queryIntent = detectSemanticQueryIntent(query);
  const asksName = queryIntent === 'profile_name';
  const asksPreference = queryIntent === 'profile_preference';
  const asksPriorThread = queryIntent === 'episodic_recall';
  const asksRoutingPolicy = queryIntent === 'routing_policy';

  if (normalizedQuery && normalizedContent.includes(normalizedQuery)) {
    score += 10;
  }

  if (row.session_id && sessionId && row.session_id === sessionId) {
    score += 6;
  }

  if (row.memory_type === 'profile') {
    score += asksName || asksPreference ? 24 : /\b(name|prefer|remember|call me|style|tone)\b/i.test(query) ? 5 : 1;
    if (asksName && /\bdisplay name\b|\bmy name\b/i.test(normalizedContent)) {
      score += 20;
    }
    if (asksPreference && /\bpreference\b|\breply_style\b|\bshort direct answers\b/i.test(normalizedContent)) {
      score += 18;
    }
  } else if (row.memory_type === 'routing_example') {
    score += asksRoutingPolicy || /\b(route|intent|telegram|chat|bot|vault|swap|agentpay|balance|portfolio)\b/i.test(query)
      ? 12
      : 0;
    if (asksName || asksPreference) {
      score -= 18;
    }
  } else if (row.memory_type === 'episodic') {
    score += asksPriorThread ? 10 : 1;
    if (asksName || asksPreference) {
      score -= 16;
    }
    if (asksRoutingPolicy) {
      score -= 8;
    }
  } else if (row.memory_type === 'session_summary') {
    score += asksPriorThread ? 8 : 2;
  }

  if (queryIntent === 'profile_name' || queryIntent === 'profile_preference') {
    if (row.memory_type !== 'profile') {
      score -= 12;
    }
  }
  if (queryIntent === 'routing_policy' && row.memory_type !== 'routing_example') {
    score -= 6;
  }
  if (queryIntent === 'episodic_recall' && row.memory_type === 'profile') {
    score -= 4;
  }

  const updatedAtMs = row.updated_at ? Date.parse(row.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAtMs)) {
    const ageHours = Math.max(0, (Date.now() - updatedAtMs) / 36e5);
    score += Math.max(0, 6 - Math.min(ageHours / 24, 6));
  }

  score += Math.max(0, Math.min(1, row.confidence ?? 0.5)) * 2;
  return score;
}

export async function rememberSemanticMemory(input: SemanticMemoryRow): Promise<void> {
  const row: SemanticMemoryRow = {
    ...input,
    content: normalizeText(input.content).slice(0, 1200),
    category: input.category?.trim() || null,
    session_id: input.session_id?.trim() || null,
    structured: input.structured ?? {},
    keywords: unique([
      ...(input.keywords ?? []),
      ...tokenize(input.content),
      ...(input.category ? tokenize(input.category) : []),
    ]).slice(0, 24),
    confidence: input.confidence ?? 0.7,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await adminDb.from('semantic_memories').insert(row);
    if (error) {
      throw error;
    }
    await logSemanticMemoryTelemetry({
      kind: 'write',
      at: new Date().toISOString(),
      walletAddress: row.wallet_address,
      memoryType: row.memory_type,
      category: row.category ?? null,
      confidence: row.confidence ?? null,
      contentPreview: row.content.slice(0, 180),
      destination: 'db',
    });
  } catch (error) {
    console.warn('[semantic-memory] db write failed:', error);
  }

  await appendLocalSemanticMemory(row).catch((error) => {
    console.warn('[semantic-memory] local write failed:', error);
  });
}

export async function retrieveSemanticMemories(
  params: RetrieveSemanticMemoriesParams,
): Promise<SemanticMemoryRow[]> {
  const { walletAddress, sessionId, query } = params;
  const limit = Math.max(1, Math.min(params.limit ?? 5, 10));
  const types = params.types?.length ? new Set(params.types) : null;
  let rows: SemanticMemoryRow[] = [];
  let source: 'db' | 'local_fallback' = 'db';

  try {
    const { data, error } = await adminDb
      .from('semantic_memories')
      .select(
        'id,wallet_address,session_id,memory_type,category,content,structured,keywords,source_user_message,source_assistant_message,confidence,supersedes_id,updated_at,created_at',
      )
      .eq('wallet_address', walletAddress)
      .is('supersedes_id', null)
      .order('updated_at', { ascending: false })
      .limit(120);

    if (error) {
      throw error;
    }
    rows = (data as SemanticMemoryRow[] | null) ?? [];
  } catch (error) {
    console.warn('[semantic-memory] db read failed:', error);
  }

  if ((!rows || rows.length === 0) && LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED) {
    source = 'local_fallback';
    rows = (await readLocalSemanticMemories()).filter(
      (row) =>
        row.wallet_address.toLowerCase() === walletAddress.toLowerCase() &&
        !row.supersedes_id,
    );
  }

  const result = rows
    .filter((row) => (types ? types.has(row.memory_type) : true))
    .map((row) => ({ row, score: scoreMemory(row, query, sessionId) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);

  await logSemanticMemoryTelemetry({
    kind: 'retrieve',
    at: new Date().toISOString(),
    walletAddress: walletAddress,
    query,
    sessionId,
    requestedLimit: limit,
    returnedCount: result.length,
    topCategories: result.map((row) => row.category ?? '').filter(Boolean).slice(0, 5),
    topTypes: result.map((row) => row.memory_type).slice(0, 5),
    source,
  });

  return result;
}

export async function buildSemanticMemoryContext(params: RetrieveSemanticMemoriesParams): Promise<string> {
  const memories = await retrieveSemanticMemories(params);
  if (!memories.length) {
    return '';
  }

  const lines = memories.map((memory, index) => {
    const label = memory.memory_type === 'profile'
      ? 'Profile memory'
      : memory.memory_type === 'routing_example'
        ? 'Routing reminder'
        : memory.memory_type === 'session_summary'
          ? 'Session memory'
          : 'Prior thread memory';
    const category = memory.category ? ` (${memory.category})` : '';
    return `${index + 1}. ${label}${category}: ${memory.content}`;
  });

  return [
    'Relevant wallet-scoped semantic memories:',
    ...lines,
    'Use these only when they are directly relevant.',
    'Do not use them as a substitute for live balances, portfolio state, payment history, transaction status, or tool capability claims.',
  ].join('\n');
}
