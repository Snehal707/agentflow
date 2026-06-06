import { sourceId, type AdapterOptions, type ExtractedQuery, type Source, type SourceResult } from './types';

function datasetSourceId(source: Source): string {
  return (source as Source & { id?: string }).id ?? sourceId(source);
}

export async function fetch(
  source: Source,
  _query: ExtractedQuery,
  _options?: AdapterOptions,
): Promise<SourceResult> {
  const id = datasetSourceId(source);
  console.warn(`Dataset adapter not implemented for source: ${id} (${source.name})`);

  return {
    source_id: id,
    success: false,
    items: [],
    error: 'not_implemented',
    latency_ms: 0,
    fetched_at: new Date().toISOString(),
  };
}
