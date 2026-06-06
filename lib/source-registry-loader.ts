import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import type { AnySchema } from 'ajv';

export type SourceMethod = 'rss' | 'rss_plus_scrape' | 'scrape' | 'official_api' | 'dataset';
export type SourceTrust = 'high' | 'medium_high' | 'medium' | 'low_medium';
export type SourceType = 'api' | 'rss' | 'publisher' | 'dataset' | 'reference';
export type SourceFreshness = 'live' | 'daily' | 'weekly' | 'monthly' | 'static';
export type SourceResultType =
  | 'article'
  | 'metric'
  | 'dataset'
  | 'paper'
  | 'filing'
  | 'reference'
  | 'mixed';

export interface SourceConfig {
  name: string;
  baseUrl: string;
  topics: string[];
  trust: SourceTrust;
  method: SourceMethod;
  cost: 'low' | 'medium' | 'high';
  speed: 'fast' | 'medium' | 'slow';
  priority: number;
  enabled: boolean;
  type: SourceType;
  freshness: SourceFreshness;
  result_type: SourceResultType;
  authority: number;
  rate_limit: {
    calls: number;
    window_seconds: number;
  };
  requires_key?: boolean;
  key_env_var?: string;
  feed_url?: string;
  rssUrls?: string[];
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..');
const registryPath = path.join(rootDir, 'data', 'source-registry.json');
const schemaPath = path.join(rootDir, 'data', 'source-registry.schema.json');

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

export function loadSourceRegistry(): SourceConfig[] {
  const schema = readJsonFile(schemaPath) as AnySchema;
  const registry = readJsonFile(registryPath);
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  if (!validate(registry)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new Error(`Invalid source registry: ${details}`);
  }

  return registry as SourceConfig[];
}

export const SOURCE_REGISTRY: SourceConfig[] = loadSourceRegistry();
