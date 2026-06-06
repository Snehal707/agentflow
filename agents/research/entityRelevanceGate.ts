import { SOURCE_REGISTRY, type SourceConfig } from '../../lib/source-registry';
import type { ResearchBrief, Source } from './types';
import {
  deriveAllowedEntities,
  detectComparisonIntent,
  ENTITY_STOP_WORDS,
} from './entityDetection';

const ENTITY_MENTION_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.ENTITY_MENTION_THRESHOLD || '3', 10) || 3,
);

type GateReason =
  | 'domain_match'
  | 'title_match'
  | `content_mentions>=${number}`
  | 'filtered_no_entity_match';

export type EntityGateDecision = {
  source: Source;
  kept: boolean;
  reason: GateReason;
  matchedEntity?: string;
  mentionCount?: number;
};

export type EntityGateMetadata = {
  applied: boolean;
  scope: ResearchBrief['scope'];
  derivedEntities: string[];
  comparisonMode: boolean;
  mentionThreshold: number;
  entityDomainMapSize: number;
};

export function buildEntityDomainMap(registry: SourceConfig[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const source of registry) {
    if (!source.enabled) continue;
    const entity = source.name.trim();
    if (!looksLikeEntityName(entity)) continue;

    let hostname = '';
    try {
      hostname = new URL(source.baseUrl).hostname.toLowerCase();
    } catch {
      continue;
    }

    const existing = map.get(entity) ?? [];
    if (!existing.includes(hostname)) {
      existing.push(hostname);
    }
    map.set(entity, existing);
  }

  return map;
}

export function applyEntityRelevanceGate(
  sources: Source[],
  brief: ResearchBrief,
  registry: SourceConfig[] = SOURCE_REGISTRY,
): {
  keptSources: Source[];
  filteredSources: EntityGateDecision[];
  gateMetadata: EntityGateMetadata;
  decisions: EntityGateDecision[];
} {
  const derivedEntities = deriveAllowedEntities(brief);
  const comparisonMode = detectComparisonIntent(brief);
  const entityDomainMap = buildEntityDomainMap(registry);

  const gateMetadata: EntityGateMetadata = {
    applied: false,
    scope: brief.scope,
    derivedEntities,
    comparisonMode,
    mentionThreshold: ENTITY_MENTION_THRESHOLD,
    entityDomainMapSize: entityDomainMap.size,
  };

  if (brief.scope !== 'narrow' || derivedEntities.length === 0 || derivedEntities.length > 3) {
    return {
      keptSources: sources,
      filteredSources: [],
      gateMetadata,
      decisions: sources.map((source) => ({
        source,
        kept: true,
        reason: `content_mentions>=${ENTITY_MENTION_THRESHOLD}`,
      })),
    };
  }

  gateMetadata.applied = true;
  const decisions: EntityGateDecision[] = sources.map((source) =>
    evaluateSource(source, derivedEntities, entityDomainMap),
  );

  return {
    keptSources: decisions.filter((decision) => decision.kept).map((decision) => decision.source),
    filteredSources: decisions.filter((decision) => !decision.kept),
    gateMetadata,
    decisions,
  };
}

function evaluateSource(
  source: Source,
  entities: string[],
  entityDomainMap: Map<string, string[]>,
): EntityGateDecision {
  const title = source.title || '';
  const content = `${source.title}\n${source.snippet}\n${source.url}`;

  for (const entity of entities) {
    const knownDomains = entityDomainMap.get(entity) ?? [];
    if (knownDomains.some((domain) => domainMatches(source.domain, domain))) {
      return { source, kept: true, reason: 'domain_match', matchedEntity: entity };
    }
    if (containsEntity(title, entity)) {
      return { source, kept: true, reason: 'title_match', matchedEntity: entity };
    }
    const mentionCount = countEntityMentions(content, entity);
    if (mentionCount >= ENTITY_MENTION_THRESHOLD) {
      return {
        source,
        kept: true,
        reason: `content_mentions>=${ENTITY_MENTION_THRESHOLD}`,
        matchedEntity: entity,
        mentionCount,
      };
    }
  }

  return { source, kept: false, reason: 'filtered_no_entity_match' };
}

function looksLikeEntityName(value: string): boolean {
  if (!value) return false;
  if (value.length < 3) return false;
  const normalized = value.trim().toLowerCase();
  if (ENTITY_STOP_WORDS.has(normalized)) return false;
  return /[A-Z]/.test(value[0]);
}

function domainMatches(sourceDomain: string, knownDomain: string): boolean {
  const normalizedSource = sourceDomain.toLowerCase();
  const normalizedKnown = knownDomain.toLowerCase();
  return normalizedSource === normalizedKnown || normalizedSource.endsWith(`.${normalizedKnown}`);
}

function containsEntity(text: string, entity: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'i');
  return pattern.test(text);
}

function countEntityMentions(text: string, entity: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'gi');
  return [...text.matchAll(pattern)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
