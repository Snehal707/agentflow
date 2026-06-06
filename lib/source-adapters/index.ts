import { fetch as datasetFetch } from './dataset';
import { fetch as officialApiFetch } from './official-api';
import { fetch as rssPlusScrapeFetch } from './rss-plus-scrape';
import { fetch as rssFetch } from './rss';
import { fetch as scrapeFetch } from './scrape';
import type { AdapterFunction, Method } from './types';

export type {
  AdapterFunction,
  AdapterOptions,
  ContentItem,
  ExtractedQuery,
  Method,
  Source,
  SourceResult,
} from './types';

export function getAdapter(method: Method): AdapterFunction {
  if (method === 'dataset') return datasetFetch;
  if (method === 'official_api') return officialApiFetch;
  if (method === 'rss_plus_scrape') return rssPlusScrapeFetch;
  if (method === 'rss') return rssFetch;
  if (method === 'scrape') return scrapeFetch;

  throw new Error(`No adapter implemented for method: ${method}`);
}
