import { readFile } from 'node:fs/promises';
import { loadRecentSemanticMemoryMetricsSnapshots } from './semantic-memory-metric-snapshots';

export type SemanticMemoryMetricsReport = {
  file: string;
  totalEvents: number;
  snapshots: Array<{
    bucketStart: string;
    granularity: string;
    totalEvents: number;
    writesCount: number;
    retrievalsCount: number;
    profileIntentMismatchCount: number;
    zeroResultRecallLikeCount: number;
    averageReturnedCount: number;
  }>;
  history: {
    snapshotCoverage: {
      count: number;
      oldestBucketStart: string | null;
      newestBucketStart: string | null;
      granularity: string | null;
    };
    windows: {
      last24h: SemanticMemoryMetricsWindow;
      previous24h: SemanticMemoryMetricsWindow;
      last7d: SemanticMemoryMetricsWindow;
      previous7d: SemanticMemoryMetricsWindow;
    };
    deltas: {
      writes24h: number | null;
      retrievals24h: number | null;
      mismatches24h: number | null;
      recallMisses24h: number | null;
      writes7d: number | null;
      retrievals7d: number | null;
      mismatches7d: number | null;
      recallMisses7d: number | null;
    };
  };
  health: {
    overall: 'healthy' | 'watch' | 'degraded';
    snapshotFreshness: 'healthy' | 'watch' | 'degraded';
    retrievalQuality: 'healthy' | 'watch' | 'degraded';
    storageReliability: 'healthy' | 'watch' | 'degraded';
    currentRetrievalQuality: 'healthy' | 'watch' | 'degraded';
    historicalRetrievalDrift: 'healthy' | 'watch' | 'degraded';
    currentProfileMismatchRate: number;
    currentRecallMissRate: number;
    historicalProfileMismatchRate: number;
    historicalRecallMissRate: number;
    notes: string[];
  };
  trends: {
    hourly: Array<{
      hour: string;
      writes: number;
      retrievals: number;
      profileIntentMismatches: number;
      zeroResultRecallLike: number;
    }>;
  };
  writes: {
    count: number;
    destinationBreakdown: Record<string, number>;
    byType: Array<{ key: string; count: number }>;
    byCategory: Array<{ key: string; count: number }>;
    topWallets: Array<{ key: string; count: number }>;
  };
  retrievals: {
    count: number;
    sourceBreakdown: Record<string, number>;
    averageReturnedCount: number;
    topReturnedTypes: Array<{ key: string; count: number }>;
    topReturnedCategories: Array<{ key: string; count: number }>;
    zeroResultQueries: Array<{ query: string; returned: number; wallet: string }>;
    profileIntentMismatchCount: number;
    zeroResultRecallLikeCount: number;
  };
};

type WriteEvent = {
  kind: 'write';
  at: string;
  walletAddress: string;
  memoryType: string;
  category?: string | null;
  confidence?: number | null;
  contentPreview: string;
  destination: 'db' | 'local_fallback';
};

type RetrieveEvent = {
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

type Event = WriteEvent | RetrieveEvent;

type SemanticMemoryMetricsSnapshot = {
  bucketStart: string;
  granularity: string;
  totalEvents: number;
  writesCount: number;
  retrievalsCount: number;
  profileIntentMismatchCount: number;
  zeroResultRecallLikeCount: number;
  averageReturnedCount: number;
};

type SemanticMemoryMetricsWindow = {
  bucketCount: number;
  writesCount: number;
  retrievalsCount: number;
  profileIntentMismatchCount: number;
  zeroResultRecallLikeCount: number;
  averageReturnedCount: number;
};

const FILE = '.agentflow-telemetry/semantic-memory-events.jsonl';

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topEntries(map: Map<string, number>, limit = 8): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function loadEvents(): Promise<Event[]> {
  const raw = await readFile(FILE, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

function isProfileIntentQuery(query: string): boolean {
  return /\b(?:my name|remember my name|what'?s my name|who am i|call me|preference|prefer|style|how should you answer)\b/i.test(
    query,
  );
}

function isRecallLikeQuery(query: string): boolean {
  return /\b(?:remember|previous|before|last|earlier|left off|what were we talking about|what did i tell you)\b/i.test(
    query,
  );
}

function hourBucketLabel(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:00Z`;
}

function emptyWindow(): SemanticMemoryMetricsWindow {
  return {
    bucketCount: 0,
    writesCount: 0,
    retrievalsCount: 0,
    profileIntentMismatchCount: 0,
    zeroResultRecallLikeCount: 0,
    averageReturnedCount: 0,
  };
}

function aggregateSnapshots(
  snapshots: SemanticMemoryMetricsSnapshot[],
  startMs: number,
  endMs: number,
): SemanticMemoryMetricsWindow {
  const matched = snapshots.filter((snapshot) => {
    const at = new Date(snapshot.bucketStart).getTime();
    return Number.isFinite(at) && at >= startMs && at < endMs;
  });
  if (!matched.length) return emptyWindow();

  const totals = matched.reduce(
    (acc, snapshot) => {
      acc.bucketCount += 1;
      acc.writesCount += snapshot.writesCount;
      acc.retrievalsCount += snapshot.retrievalsCount;
      acc.profileIntentMismatchCount += snapshot.profileIntentMismatchCount;
      acc.zeroResultRecallLikeCount += snapshot.zeroResultRecallLikeCount;
      acc.weightedReturnedSum += snapshot.averageReturnedCount * snapshot.retrievalsCount;
      acc.returnedWeight += snapshot.retrievalsCount;
      return acc;
    },
    {
      bucketCount: 0,
      writesCount: 0,
      retrievalsCount: 0,
      profileIntentMismatchCount: 0,
      zeroResultRecallLikeCount: 0,
      weightedReturnedSum: 0,
      returnedWeight: 0,
    },
  );

  return {
    bucketCount: totals.bucketCount,
    writesCount: totals.writesCount,
    retrievalsCount: totals.retrievalsCount,
    profileIntentMismatchCount: totals.profileIntentMismatchCount,
    zeroResultRecallLikeCount: totals.zeroResultRecallLikeCount,
    averageReturnedCount: totals.returnedWeight
      ? Number((totals.weightedReturnedSum / totals.returnedWeight).toFixed(2))
      : 0,
  };
}

function diff(current: number, previous: number): number | null {
  if (!previous && !current) return 0;
  if (!previous) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function rankHealth(values: Array<'healthy' | 'watch' | 'degraded'>): 'healthy' | 'watch' | 'degraded' {
  if (values.includes('degraded')) return 'degraded';
  if (values.includes('watch')) return 'watch';
  return 'healthy';
}

function pushUniqueNote(notes: string[], note: string): void {
  if (!notes.includes(note)) {
    notes.push(note);
  }
}

function recentRetrieveWindow(
  retrieves: RetrieveEvent[],
  maxItems = 25,
  maxAgeMs = 24 * 60 * 60 * 1000,
): RetrieveEvent[] {
  const cutoff = Date.now() - maxAgeMs;
  const recent = retrieves.filter((event) => {
    const at = Date.parse(event.at);
    return Number.isFinite(at) && at >= cutoff;
  });
  return recent.slice(-maxItems);
}

export async function buildSemanticMemoryMetricsReport(): Promise<SemanticMemoryMetricsReport> {
  const events = await loadEvents();
  const snapshots = await loadRecentSemanticMemoryMetricsSnapshots(28).catch(() => []);
  const writes = events.filter((e): e is WriteEvent => e.kind === 'write');
  const retrieves = events.filter((e): e is RetrieveEvent => e.kind === 'retrieve');

  const writesByType = new Map<string, number>();
  const writesByCategory = new Map<string, number>();
  const writesByWallet = new Map<string, number>();
  const writeDestination = new Map<string, number>();

  for (const event of writes) {
    inc(writesByType, event.memoryType);
    inc(writesByCategory, event.category || '(none)');
    inc(writesByWallet, event.walletAddress);
    inc(writeDestination, event.destination);
  }

  const retrieveSource = new Map<string, number>();
  const retrieveTopTypes = new Map<string, number>();
  const retrieveTopCategories = new Map<string, number>();
  const lowResultQueries: Array<{ query: string; returned: number; wallet: string }> = [];
  let totalReturned = 0;
  let profileIntentMismatchCount = 0;
  let zeroResultRecallLikeCount = 0;
  const now = Date.now();
  const hourlyMap = new Map<
    string,
    { hour: string; writes: number; retrievals: number; profileIntentMismatches: number; zeroResultRecallLike: number }
  >();

  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(now - i * 60 * 60 * 1000);
    const hour = hourBucketLabel(d);
    hourlyMap.set(hour, {
      hour,
      writes: 0,
      retrievals: 0,
      profileIntentMismatches: 0,
      zeroResultRecallLike: 0,
    });
  }

  for (const event of retrieves) {
    inc(retrieveSource, event.source);
    totalReturned += event.returnedCount;
    for (const type of event.topTypes) inc(retrieveTopTypes, type);
    for (const category of event.topCategories) inc(retrieveTopCategories, category || '(none)');
    const topType = event.topTypes[0] ?? null;
    if (isProfileIntentQuery(event.query) && topType && topType !== 'profile') {
      profileIntentMismatchCount += 1;
    }
    const bucket = hourlyMap.get(hourBucketLabel(new Date(event.at)));
    if (bucket) {
      bucket.retrievals += 1;
      if (isProfileIntentQuery(event.query) && topType && topType !== 'profile') {
        bucket.profileIntentMismatches += 1;
      }
    }
    if (event.returnedCount === 0) {
      lowResultQueries.push({
        query: event.query,
        returned: event.returnedCount,
        wallet: event.walletAddress,
      });
      if (isRecallLikeQuery(event.query)) {
        zeroResultRecallLikeCount += 1;
        if (bucket) {
          bucket.zeroResultRecallLike += 1;
        }
      }
    }
  }

  for (const event of writes) {
    const bucket = hourlyMap.get(hourBucketLabel(new Date(event.at)));
    if (bucket) {
      bucket.writes += 1;
    }
  }

  const snapshotCoverage = {
    count: snapshots.length,
    oldestBucketStart: snapshots[0]?.bucketStart ?? null,
    newestBucketStart: snapshots[snapshots.length - 1]?.bucketStart ?? null,
    granularity: snapshots[0]?.granularity ?? null,
  };
  const nowMs = Date.now();
  const last24h = aggregateSnapshots(snapshots, nowMs - 24 * 60 * 60 * 1000, nowMs);
  const previous24h = aggregateSnapshots(snapshots, nowMs - 48 * 60 * 60 * 1000, nowMs - 24 * 60 * 60 * 1000);
  const last7d = aggregateSnapshots(snapshots, nowMs - 7 * 24 * 60 * 60 * 1000, nowMs);
  const previous7d = aggregateSnapshots(
    snapshots,
    nowMs - 14 * 24 * 60 * 60 * 1000,
    nowMs - 7 * 24 * 60 * 60 * 1000,
  );
  const latestSnapshotAgeHours = snapshotCoverage.newestBucketStart
    ? (nowMs - new Date(snapshotCoverage.newestBucketStart).getTime()) / (60 * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  const dbWriteShare = writes.length ? (writeDestination.get('db') ?? 0) / writes.length : 1;
  const dbRetrieveShare = retrieves.length ? (retrieveSource.get('db') ?? 0) / retrieves.length : 1;
  const recentRetrieves = recentRetrieveWindow(retrieves);
  const recentProfileQueries = recentRetrieves.filter((event) => isProfileIntentQuery(event.query));
  const recentRecallQueries = recentRetrieves.filter((event) => isRecallLikeQuery(event.query));
  const recentProfileMismatches = recentProfileQueries.filter((event) => {
    const topType = event.topTypes[0] ?? null;
    return isProfileIntentQuery(event.query) && topType && topType !== 'profile';
  }).length;
  const recentRecallMisses = recentRecallQueries.filter(
    (event) => event.returnedCount === 0,
  ).length;
  const mismatchRate = recentProfileQueries.length ? recentProfileMismatches / recentProfileQueries.length : 0;
  const recallMissRate = recentRecallQueries.length ? recentRecallMisses / recentRecallQueries.length : 0;

  const notes: string[] = [];
  let snapshotFreshness: 'healthy' | 'watch' | 'degraded' = 'healthy';
  if (!snapshotCoverage.count) {
    snapshotFreshness = 'degraded';
    pushUniqueNote(notes, 'No persisted snapshot history yet.');
  } else if (latestSnapshotAgeHours > 18) {
    snapshotFreshness = 'degraded';
    pushUniqueNote(notes, `Latest snapshot is stale (${latestSnapshotAgeHours.toFixed(1)}h old).`);
  } else if (latestSnapshotAgeHours > 8) {
    snapshotFreshness = 'watch';
    pushUniqueNote(notes, `Latest snapshot is aging (${latestSnapshotAgeHours.toFixed(1)}h old).`);
  } else {
    pushUniqueNote(notes, 'Snapshot freshness is healthy.');
  }

  let storageReliability: 'healthy' | 'watch' | 'degraded' = 'healthy';
  if (dbWriteShare < 0.8 || dbRetrieveShare < 0.8) {
    storageReliability = 'degraded';
    pushUniqueNote(notes, 'DB usage dropped below 80% for writes or retrievals.');
  } else if (dbWriteShare < 1 || dbRetrieveShare < 1) {
    storageReliability = 'watch';
    pushUniqueNote(notes, 'Local fallback memory path was used recently.');
  } else {
    pushUniqueNote(notes, 'Storage reliability is healthy and fully DB-backed.');
  }

  let retrievalQuality: 'healthy' | 'watch' | 'degraded' = 'healthy';
  let currentRetrievalQuality: 'healthy' | 'watch' | 'degraded' = 'healthy';
  if (!recentRetrieves.length) {
    retrievalQuality = 'watch';
    currentRetrievalQuality = 'watch';
    pushUniqueNote(notes, 'Not enough recent retrieval traffic yet to score retrieval quality confidently.');
  } else if (mismatchRate > 0.2 || recallMissRate > 0.1) {
    retrievalQuality = 'degraded';
    currentRetrievalQuality = 'degraded';
    pushUniqueNote(notes, 'Retrieval quality is degraded due to high mismatch or recall-miss rates.');
  } else if (mismatchRate > 0.05 || recallMissRate > 0.03) {
    retrievalQuality = 'watch';
    currentRetrievalQuality = 'watch';
    pushUniqueNote(notes, 'Retrieval quality shows mild drift.');
  } else {
    pushUniqueNote(notes, 'Recent retrieval quality looks healthy.');
  }

  const historicalMismatchRate = retrieves.length ? profileIntentMismatchCount / retrieves.length : 0;
  const historicalRecallMissRate = retrieves.length ? zeroResultRecallLikeCount / retrieves.length : 0;
  let historicalRetrievalDrift: 'healthy' | 'watch' | 'degraded' = 'healthy';
  if (historicalMismatchRate > 0.2 || historicalRecallMissRate > 0.1) {
    historicalRetrievalDrift = 'degraded';
    pushUniqueNote(notes, 'Historical retrieval drift is elevated across the stored telemetry window.');
  } else if (historicalMismatchRate > 0.05 || historicalRecallMissRate > 0.03) {
    historicalRetrievalDrift = 'watch';
    pushUniqueNote(notes, 'Historical retrieval drift is still visible in older telemetry.');
  } else {
    pushUniqueNote(notes, 'Historical retrieval drift is healthy.');
  }

  if (historyHasGrowthSignal(last24h, previous24h)) {
    pushUniqueNote(notes, 'Snapshot history is accumulating and can now support 24h comparisons.');
  }

  const overall = rankHealth([snapshotFreshness, storageReliability, retrievalQuality]);
  if (overall === 'healthy') {
    pushUniqueNote(notes, 'Overall memory-system health is stable.');
  } else if (!notes.some((note) => /watch|drift|stale|fallback|degraded|aging|not enough/i.test(note))) {
    pushUniqueNote(
      notes,
      'One or more health signals are in watch state; inspect snapshot freshness, retrieval quality, and storage reliability for the current cause.',
    );
  }

  return {
    file: FILE,
    totalEvents: events.length,
    snapshots,
    history: {
      snapshotCoverage,
      windows: {
        last24h,
        previous24h,
        last7d,
        previous7d,
      },
      deltas: {
        writes24h: diff(last24h.writesCount, previous24h.writesCount),
        retrievals24h: diff(last24h.retrievalsCount, previous24h.retrievalsCount),
        mismatches24h: diff(last24h.profileIntentMismatchCount, previous24h.profileIntentMismatchCount),
        recallMisses24h: diff(last24h.zeroResultRecallLikeCount, previous24h.zeroResultRecallLikeCount),
        writes7d: diff(last7d.writesCount, previous7d.writesCount),
        retrievals7d: diff(last7d.retrievalsCount, previous7d.retrievalsCount),
        mismatches7d: diff(last7d.profileIntentMismatchCount, previous7d.profileIntentMismatchCount),
        recallMisses7d: diff(last7d.zeroResultRecallLikeCount, previous7d.zeroResultRecallLikeCount),
      },
    },
    health: {
      overall,
      snapshotFreshness,
      retrievalQuality,
      storageReliability,
      currentRetrievalQuality,
      historicalRetrievalDrift,
      currentProfileMismatchRate: Number((mismatchRate * 100).toFixed(1)),
      currentRecallMissRate: Number((recallMissRate * 100).toFixed(1)),
      historicalProfileMismatchRate: Number((historicalMismatchRate * 100).toFixed(1)),
      historicalRecallMissRate: Number((historicalRecallMissRate * 100).toFixed(1)),
      notes,
    },
    trends: {
      hourly: [...hourlyMap.values()],
    },
    writes: {
      count: writes.length,
      destinationBreakdown: Object.fromEntries(writeDestination),
      byType: topEntries(writesByType),
      byCategory: topEntries(writesByCategory),
      topWallets: topEntries(writesByWallet, 5),
    },
    retrievals: {
      count: retrieves.length,
      sourceBreakdown: Object.fromEntries(retrieveSource),
      averageReturnedCount: retrieves.length ? Number((totalReturned / retrieves.length).toFixed(2)) : 0,
      topReturnedTypes: topEntries(retrieveTopTypes),
      topReturnedCategories: topEntries(retrieveTopCategories),
      zeroResultQueries: lowResultQueries.slice(-10),
      profileIntentMismatchCount,
      zeroResultRecallLikeCount,
    },
  };
}

function historyHasGrowthSignal(current: SemanticMemoryMetricsWindow, previous: SemanticMemoryMetricsWindow): boolean {
  return current.bucketCount > 0 || previous.bucketCount > 0;
}
