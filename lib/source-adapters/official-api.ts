import {
  emptyResult,
  sourceId,
  type AdapterOptions,
  type ContentItem,
  type ExtractedQuery,
  type Source,
  type SourceResult,
} from './types';

const lastFetchBySource = new Map<string, number>();

async function respectRateLimit(source: Source): Promise<void> {
  const key = sourceId(source);
  const windowMs = Math.ceil((source.rate_limit.window_seconds * 1000) / source.rate_limit.calls);
  const lastFetch = lastFetchBySource.get(key) ?? 0;
  const waitMs = Math.max(0, windowMs - (Date.now() - lastFetch));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastFetchBySource.set(key, Date.now());
}

function queryText(query: ExtractedQuery): string {
  return [...(query.entities ?? []), query.text, ...(query.topics ?? [])].filter(Boolean)[0] ?? query.text;
}

function endpointCandidates(source: Source, query: ExtractedQuery): URL[] {
  const q = queryText(query);
  const endpoint = source.endpoint?.includes('{q}')
    ? source.endpoint.replace(/\{q\}/g, encodeURIComponent(q))
    : source.endpoint;
  const base = new URL(endpoint ?? source.baseUrl);
  const candidates: URL[] = [];
  const baseToken = base.hostname
    .replace(/^(api|www|en|export|pro-api|services|data-api)\./, '')
    .split('.')[0];
  const genericHostTokens = new Set(['api', 'data', 'services', 'search', 'query', 'www']);

  if (source.endpoint && base.search) {
    candidates.push(new URL(base.href));
  }

  for (const template of [
    'https://api.coingecko.com/api/v3/search?query={q}',
    'https://api.github.com/search/repositories?q={q}&per_page=10',
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srsearch={q}',
    'https://export.arxiv.org/api/query?search_query=all:{q}&start=0&max_results=10',
    'https://api.stlouisfed.org/fred/series/search?search_text={q}&file_type=json',
    'https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?symbol={q}&limit=10',
    'https://api2.openreview.net/notes/search?term={q}&limit=10',
    'https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={q}&resultsPerPage=10',
    'https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D={q}&per_page=10',
    'https://api.coinpaprika.com/v1/search?q={q}&c=currencies&limit=10',
    'https://min-api.cryptocompare.com/data/pricemultifull?fsyms={q}&tsyms=USD',
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={q}&language=en&format=json&limit=10',
    'https://lookup.dbpedia.org/api/search?query={q}&maxResults=10',
    'https://musicbrainz.org/ws/2/artist/?query={q}&fmt=json&limit=10',
    'https://www.theaudiodb.com/api/v1/json/2/search.php?s={q}',
    'https://api.jikan.moe/v4/anime?q={q}&limit=10',
    'https://world.openbeautyfacts.org/cgi/search.pl?search_terms={q}&search_simple=1&action=process&json=1&page_size=10',
    'https://nominatim.openstreetmap.org/search?q={q}&format=json&limit=10',
    'https://data.humdata.org/api/3/action/package_search?q={q}&rows=10',
    'https://cmr.earthdata.nasa.gov/search/collections.json?keyword={q}&page_size=10',
    'https://api.gbif.org/v1/species/search?q={q}&limit=10',
    'https://api.inaturalist.org/v1/observations?taxon_name={q}&per_page=10',
    'https://openlibrary.org/search.json?q={q}&limit=10',
    'https://archive.org/advancedsearch.php?q=title:{q}&fl[]=identifier&fl[]=title&fl[]=description&rows=10&output=json',
    'https://www.loc.gov/books/?fo=json&q={q}&c=10',
    'https://en.wikisource.org/w/api.php?action=query&list=search&srsearch={q}&format=json&srlimit=10',
    'https://rest.uniprot.org/uniprotkb/search?query={q}&format=json&size=10',
    'https://www.ebi.ac.uk/pdbe/search/pdb/select?q={q}&wt=json&rows=10',
    'https://www.itis.gov/ITISWebService/jsonservice/searchByScientificName?srchKey={q}',
    'https://api.obis.org/v3/occurrence?scientificname={q}&size=10',
    'https://simbad.u-strasbg.fr/simbad/sim-id?Ident={q}&output.format=ASCII',
    'https://ned.ipac.caltech.edu/srs/ObjectLookup?name={q}&of=json',
    'https://api.materialsproject.org/materials/summary/?formula={q}&_fields=material_id,formula_pretty,band_gap,energy_above_hull',
    'https://registry.npmjs.org/-/v1/search?text={q}&size=10',
    'https://pypi.org/pypi/{q}/json',
    'https://search.maven.org/solrsearch/select?q={q}&rows=10&wt=json',
    'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q={q}&site=stackoverflow&pagesize=10',
    'https://api.deps.dev/v3/systems/npm/packages/{q}',
    'https://dev.to/api/articles?tag={q}&per_page=10',
    'https://libraries.io/api/search?q={q}',
    'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name={q}',
    'https://rxnav.nlm.nih.gov/REST/drugs.json?name={q}',
    'https://clinicaltables.nlm.nih.gov/api/conditions/v3/search?terms={q}&maxList=10',
    'https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms={q}&maxList=10',
    'https://api.fda.gov/drug/ndc.json?search=brand_name:{q}&limit=10',
  ]) {
    const url = new URL(template.replace(/\{q\}/g, encodeURIComponent(q)));
    const templateHost = url.hostname.replace(/^(api|www|en|export|pro-api|services|data-api)\./, '');
    const sid = sourceId(source);
    if (
      (sid === 'fred' && url.hostname.includes('stlouisfed.org')) ||
      (sid === 'coinmarketcap' && url.hostname.includes('coinmarketcap.com')) ||
      base.hostname.endsWith(templateHost) ||
      (baseToken.length > 2 && !genericHostTokens.has(baseToken) && url.hostname.includes(baseToken))
    ) {
      candidates.push(url);
    }
  }

  if (!candidates.some((candidate) => candidate.href === base.href)) {
    candidates.push(new URL(base.href));
  }

  for (const param of ['search', 'q', 'query']) {
    const withParam = new URL(base.href);
    withParam.searchParams.set(param, q);
    candidates.push(withParam);
  }

  if (base.hostname.startsWith('www.')) {
    const apiHost = new URL(base.href);
    apiHost.hostname = `api.${base.hostname.slice(4)}`;
    apiHost.searchParams.set('q', q);
    candidates.push(apiHost);
  }

  const apiPath = new URL('/api', base.origin);
  apiPath.searchParams.set('q', q);
  candidates.push(apiPath);

  if (!base.pathname || base.pathname === '/') {
    candidates.push(new URL(`/${encodeURIComponent(q)}`, base.origin));
  }

  return candidates;
}

function apiKeyHeaders(source: Source): Record<string, string> {
  if (!source.requires_key || !source.key_env_var) return {};
  const key = process.env[source.key_env_var];
  if (!key) return {};
  if (source.key_env_var.includes('CMC')) return { 'X-CMC_PRO_API_KEY': key };
  if (source.key_env_var.includes('NASA_ADS')) return { Authorization: `Bearer ${key}` };
  if (source.key_env_var.includes('NOAA_CDO')) return { token: key };
  if (source.key_env_var.includes('EBIRD')) return { 'X-eBirdApiToken': key };
  if (source.key_env_var.includes('MATERIALS_PROJECT')) return { 'X-API-KEY': key };
  if (source.key_env_var.includes('CHEMSPIDER')) return { apikey: key };
  if (source.key_env_var.includes('WTO')) return { 'Ocp-Apim-Subscription-Key': key };
  if (source.key_env_var.includes('UN_COMTRADE')) return { 'Ocp-Apim-Subscription-Key': key };
  if (source.key_env_var.includes('DISCOGS_USER_TOKEN')) return { Authorization: `Discogs token=${key}` };
  return { 'X-API-Key': key };
}

function addApiKeyParam(url: URL, source: Source): URL {
  if (!source.requires_key || !source.key_env_var) return url;
  const key = process.env[source.key_env_var];
  if (!key) return url;
  const next = new URL(url.href);
  // TODO: add per-source auth placement overrides for APIs that expect specific header/query names.
  if (source.key_env_var.includes('FRED')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('BEA')) next.searchParams.set('UserID', key);
  else if (source.key_env_var.includes('EIA')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('OPENWEATHERMAP')) next.searchParams.set('appid', key);
  else if (source.key_env_var.includes('GOVINFO')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('WAQI')) next.searchParams.set('token', key);
  else if (source.key_env_var.includes('LASTFM')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('CONGRESS')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('Finnhub')) next.searchParams.set('token', key);
  else if (source.key_env_var.includes('API_DATA_GOV')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('ANALYTICS_USA_GOV')) next.searchParams.set('api_key', key);
  else if (source.key_env_var.includes('GUARDIAN')) next.searchParams.set('api-key', key);
  else if (source.key_env_var.includes('CENSUS')) next.searchParams.set('key', key);
  else if (source.key_env_var.includes('NASA_ADS')) return next;
  else if (source.key_env_var.includes('NOAA_CDO')) return next;
  else if (source.key_env_var.includes('EBIRD')) return next;
  else if (source.key_env_var.includes('MATERIALS_PROJECT')) return next;
  else if (source.key_env_var.includes('CHEMSPIDER')) return next;
  else if (source.key_env_var.includes('WTO')) return next;
  else if (source.key_env_var.includes('UN_COMTRADE')) return next;
  else if (source.key_env_var.includes('DISCOGS_USER_TOKEN')) return next;
  else if (source.key_env_var.includes('RELIEFWEB_APPNAME')) next.searchParams.set('appname', key);
  else if (source.key_env_var.includes('LIBRARIES_IO')) next.searchParams.set('api_key', key);
  else next.searchParams.set('apikey', key);
  return next;
}

async function fetchJson(url: URL, source: Source, timeoutMs: number): Promise<{ data?: unknown; error?: string; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(addApiKeyParam(url, source), {
      headers: {
        Accept: 'application/json, application/xml, text/xml, application/atom+xml, text/plain, */*',
        'User-Agent': 'AgentFlow-Research/1.0',
        ...apiKeyHeaders(source),
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '5');
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter * 1000, 10_000)));
      const retry = await globalThis.fetch(addApiKeyParam(url, source), {
        headers: {
          Accept: 'application/json, application/xml, text/xml, application/atom+xml, text/plain, */*',
          'User-Agent': 'AgentFlow-Research/1.0',
          ...apiKeyHeaders(source),
        },
        signal: controller.signal,
      });
      if (retry.status === 429) return { status: retry.status, error: 'rate_limited' };
      return parseResponse(retry);
    }

    if (response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const retry = await globalThis.fetch(addApiKeyParam(url, source), {
        headers: {
          Accept: 'application/json, application/xml, text/xml, application/atom+xml, text/plain, */*',
          'User-Agent': 'AgentFlow-Research/1.0',
          ...apiKeyHeaders(source),
        },
        signal: controller.signal,
      });
      if (retry.status >= 500) return { status: retry.status, error: 'server_error' };
      return parseResponse(retry);
    }

    return parseResponse(response);
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : `network_error:${error instanceof Error ? error.message : String(error)}`;
    return { status: 0, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchChemSpider(source: Source, query: ExtractedQuery, options?: AdapterOptions): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const key = source.key_env_var ? process.env[source.key_env_var] : undefined;
  if (!key) {
    console.warn(`[source-adapters] missing API key for ${source.name}`);
    return { ...emptyResult(source, startedAt, 'missing_api_key', fetchedAt), latency_ms: 0 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
  try {
    const name = queryText(query);
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'AgentFlow-Research/1.0',
      apikey: key,
    };
    const filter = await globalThis.fetch('https://api.rsc.org/compounds/v1/filter/name', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
      signal: controller.signal,
    });
    const filterData = await parseResponse(filter);
    if (filterData.error || !filterData.data) {
      return emptyResult(source, startedAt, filterData.error ?? `http_${filterData.status}`, fetchedAt);
    }
    const queryId = firstString(filterData.data as Record<string, unknown>, ['queryId']);
    if (!queryId) return emptyResult(source, startedAt, 'missing_query_id', fetchedAt);

    const statusUrl = new URL(`https://api.rsc.org/compounds/v1/filter/${encodeURIComponent(queryId)}/status`);
    const status = await fetchJson(statusUrl, source, options?.timeoutMs ?? 10_000);
    if (status.error || !status.data) return emptyResult(source, startedAt, status.error ?? `http_${status.status}`, fetchedAt);

    const resultsUrl = new URL(`https://api.rsc.org/compounds/v1/filter/${encodeURIComponent(queryId)}/results`);
    const results = await fetchJson(resultsUrl, source, options?.timeoutMs ?? 10_000);
    if (results.error || !results.data) return emptyResult(source, startedAt, results.error ?? `http_${results.status}`, fetchedAt);
    const ids = Array.isArray((results.data as Record<string, unknown>).results)
      ? ((results.data as Record<string, unknown>).results as unknown[]).slice(0, options?.maxItems ?? 5)
      : [];

    const detailResults = await Promise.allSettled(ids.map(async (id) => {
      const detailsUrl = new URL(`https://api.rsc.org/compounds/v1/records/${encodeURIComponent(String(id))}/details?fields=CommonName,Formula,AverageMass,MolecularWeight,InChIKey,SMILES`);
      const detail = await fetchJson(detailsUrl, source, options?.timeoutMs ?? 10_000);
      if (detail.error || !detail.data) return undefined;
      return mapItem(detail.data, source);
    }));
    const items = detailResults
      .map((result) => result.status === 'fulfilled' ? result.value : undefined)
      .filter((item): item is ContentItem => Boolean(item));

    return {
      source_id: sourceId(source),
      success: items.length > 0,
      items,
      ...(items.length === 0 ? { error: 'empty_items' } : {}),
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : `network_error:${error instanceof Error ? error.message : String(error)}`;
    return emptyResult(source, startedAt, message, fetchedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOsv(source: Source, query: ExtractedQuery, options?: AdapterOptions): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
  try {
    const packageName = queryText(query);
    const response = await globalThis.fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentFlow-Research/1.0',
      },
      body: JSON.stringify({ package: { name: packageName, ecosystem: 'npm' } }),
      signal: controller.signal,
    });
    const parsed = await parseResponse(response);
    if (parsed.error || !parsed.data) return emptyResult(source, startedAt, parsed.error ?? `http_${parsed.status}`, fetchedAt);
    const items = extractArray(parsed.data)
      .map((item) => mapItem(item, source))
      .filter((item): item is ContentItem => item !== null)
      .slice(0, options?.maxItems ?? 10);

    return {
      source_id: sourceId(source),
      success: items.length > 0,
      items,
      ...(items.length === 0 ? { error: 'empty_items' } : {}),
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : `network_error:${error instanceof Error ? error.message : String(error)}`;
    return emptyResult(source, startedAt, message, fetchedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAniList(source: Source, query: ExtractedQuery, options?: AdapterOptions): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
  try {
    const search = queryText(query);
    const response = await globalThis.fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentFlow-Research/1.0',
      },
      body: JSON.stringify({
        query: `query ($search: String, $perPage: Int) {
          Page(page: 1, perPage: $perPage) {
            media(search: $search, type: ANIME) {
              title { romaji english native }
              siteUrl
              description
              seasonYear
              format
              status
              averageScore
              genres
            }
          }
        }`,
        variables: { search, perPage: options?.maxItems ?? 5 },
      }),
      signal: controller.signal,
    });
    const parsed = await parseResponse(response);
    if (parsed.error || !parsed.data) return emptyResult(source, startedAt, parsed.error ?? `http_${parsed.status}`, fetchedAt);
    const media = nested(parsed.data, ['data', 'Page', 'media']);
    const items = (Array.isArray(media) ? media : [])
      .map((item) => mapItem(item, source))
      .filter((item): item is ContentItem => item !== null);
    return {
      source_id: sourceId(source),
      success: items.length > 0,
      items,
      ...(items.length === 0 ? { error: 'empty_items' } : {}),
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : `network_error:${error instanceof Error ? error.message : String(error)}`;
    return emptyResult(source, startedAt, message, fetchedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGovInfo(source: Source, query: ExtractedQuery, options?: AdapterOptions): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const key = source.key_env_var ? process.env[source.key_env_var] : undefined;
  if (!key) {
    console.warn(`[source-adapters] missing API key for ${source.name}`);
    return { ...emptyResult(source, startedAt, 'missing_api_key', fetchedAt), latency_ms: 0 };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
  try {
    const response = await globalThis.fetch(`https://api.govinfo.gov/search?api_key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentFlow-Research/1.0',
      },
      body: JSON.stringify({ query: queryText(query), pageSize: options?.maxItems ?? 5, offsetMark: '*' }),
      signal: controller.signal,
    });
    const parsed = await parseResponse(response);
    if (parsed.error || !parsed.data) return emptyResult(source, startedAt, parsed.error ?? `http_${parsed.status}`, fetchedAt);
    const items = extractArray(parsed.data)
      .map((item) => mapItem(item, source))
      .filter((item): item is ContentItem => item !== null)
      .slice(0, options?.maxItems ?? 10);
    return {
      source_id: sourceId(source),
      success: items.length > 0,
      items,
      ...(items.length === 0 ? { error: 'empty_items' } : {}),
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : `network_error:${error instanceof Error ? error.message : String(error)}`;
    return emptyResult(source, startedAt, message, fetchedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponse(response: Response): Promise<{ data?: unknown; error?: string; status: number }> {
  if (response.status === 401 || response.status === 403) return { status: response.status, error: 'auth_failed' };
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    return { status: response.status, error: `http_${response.status}${body ? `:${body.slice(0, 300)}` : ''}` };
  }
  if (/Invalid Key|Missing Key|API_KEY_MISSING|No API key/i.test(body)) {
    return { status: response.status, error: 'auth_failed' };
  }
  const contentType = response.headers.get('content-type') ?? '';
  const trimmed = body.trim();
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { status: response.status, data: JSON.parse(trimmed) };
    } catch {
      return { status: response.status, error: 'json_parse_error' };
    }
  }
  if (contentType.includes('xml') || contentType.includes('atom')) {
    const atom = parseAtom(body);
    if (atom.length > 0) return { status: response.status, data: atom };
    return { status: response.status, data: [{ content: stripMarkup(body).slice(0, 4000) }] };
  }
  if ((contentType.includes('csv') || contentType.includes('text/plain')) && !trimmed.startsWith('<')) {
    return { status: response.status, data: [{ content: trimmed.slice(0, 4000) }] };
  }
  return { status: response.status, error: `non_json:${contentType || 'unknown'}` };
}

function extractArray(data: unknown): unknown[] {
  if (
    Array.isArray(data) &&
    Array.isArray(data[0]) &&
    data[0].some((value) => typeof value === 'string' && value === 'NAME')
  ) {
    return data.slice(1);
  }
  if (Array.isArray(data) && data.length >= 4 && Array.isArray(data[3])) return data[3] as unknown[];
  if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) return data[1] as unknown[];
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [data];
  const object = data as Record<string, unknown>;
  for (const path of [
    ['resultList', 'result'],
    ['hits', 'hits'],
    ['message', 'items'],
    ['result', 'results'],
    ['results', 'artistmatches', 'artist'],
    ['BEAAPI', 'Results', 'Dataset'],
    ['feed', 'entry'],
    ['content', 'results'],
    ['response', 'docs'],
    ['events'],
    ['markets'],
    ['drugGroup', 'conceptGroup'],
    ['data', 'dataflows'],
  ]) {
    const nestedArray = nested(data, path);
    if (Array.isArray(nestedArray)) return nestedArray as unknown[];
  }
  for (const key of ['data', 'results', 'items', 'docs', 'records', 'observations', 'coins', 'objects', 'versions', 'search', 'Search', 'states', 'features', 'scientificNames', 'vulnerabilities', 'objects', 'notes', 'series', 'Dataset', 'collection', 'messages', 'studies', 'reports', 'products', 'artists', 'PC_Compounds', 'hits', 'peggedAssets', 'articles']) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  for (const key of ['query', 'response', 'payload', 'result', 'feed']) {
    if (object[key] && typeof object[key] === 'object') {
      const nested = extractArray(object[key]);
      if (nested.length > 0 && nested[0] !== object[key]) return nested;
    }
  }
  const firstObjectArray = Object.values(object).find(
    (value) => Array.isArray(value) && value.some((item) => item && typeof item === 'object'),
  );
  if (Array.isArray(firstObjectArray)) return firstObjectArray;
  return [data];
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(entry: string, name: string): string | undefined {
  const match = entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ')) : undefined;
}

function parseAtom(xml: string): unknown[] {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const entry = match[0];
    const linkMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    return {
      title: tag(entry, 'title'),
      url: linkMatch?.[1],
      summary: tag(entry, 'summary') ?? tag(entry, 'description'),
      published_at: tag(entry, 'published') ?? tag(entry, 'updated'),
    };
  });
}

function firstString(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function nested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    const object = asRecord(current);
    if (!object) return undefined;
    current = object[key];
  }
  return current;
}

function nestedString(value: unknown, path: string[]): string | undefined {
  const found = nested(value, path);
  if (typeof found === 'string' && found.trim()) return found;
  if (typeof found === 'number') return String(found);
  return undefined;
}

function normalizeUrl(value: string | undefined, source: Source): string {
  if (!value) return source.baseUrl;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return new URL(value, source.baseUrl).href;
  return value;
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function parseMaybeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function relevanceTerms(query: ExtractedQuery): string[] {
  const genericTerms = new Set(['prediction', 'predictions', 'market', 'markets', 'forecast', 'forecasting']);
  return [...(query.entities ?? []), query.text, ...(query.topics ?? [])]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((value) => value.length > 2 && !/^\d{4}$/.test(value) && !genericTerms.has(value));
}

function rankByQuery(rawItems: unknown[], query: ExtractedQuery, options?: { requireMatch?: boolean }): unknown[] {
  const terms = relevanceTerms(query);
  if (terms.length === 0) return rawItems;
  const scored = rawItems.map((item, index) => {
    const text = JSON.stringify(item).toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
    return { item, index, score };
  });
  return scored.some((entry) => entry.score > 0)
    ? scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.item)
    : options?.requireMatch ? [] : rawItems;
}

function fixedNumber(value: unknown, digits = 2): string | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: digits }) : undefined;
}

function authorsList(value: unknown, limit = 4): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.map((entry) => {
    const object = asRecord(entry);
    return firstString(object ?? {}, ['name'])
      ?? nestedString(object, ['author', 'display_name'])
      ?? nestedString(object, ['author', 'name']);
  }).filter(Boolean).slice(0, limit);
  return names.length ? names.join(', ') : undefined;
}

function openAlexAbstract(value: unknown): string | undefined {
  const index = asRecord(value);
  if (!index) return undefined;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === 'number') words.push([position, word]);
    }
  }
  return words.sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(' ').slice(0, 2000) || undefined;
}

function mappedItem(raw: unknown, source: Source): ContentItem | null {
  const id = sourceId(source);

  if (id === 'us-census' && Array.isArray(raw)) {
    const [name, population, geography] = raw;
    if (typeof name !== 'string' || name === 'NAME') return null;
    return {
      title: `US Census: ${name}`,
      url: source.baseUrl,
      content: [
        typeof population === 'string' ? `Population estimate: ${population}` : undefined,
        typeof geography === 'string' ? `Geography code: ${geography}` : undefined,
      ].filter(Boolean).join('\n'),
      metadata: { row: raw },
    };
  }

  if (id === 'opensky-network' && Array.isArray(raw)) {
    const [icao24, callsign, originCountry, , lastContact, longitude, latitude, baroAltitude, onGround, velocity] = raw;
    return {
      title: typeof callsign === 'string' && callsign.trim() ? `Aircraft ${callsign.trim()}` : `Aircraft ${icao24 ?? 'state'}`,
      url: source.baseUrl,
      content: [
        originCountry ? `Origin country: ${originCountry}` : undefined,
        latitude !== null && longitude !== null ? `Position: ${latitude}, ${longitude}` : undefined,
        baroAltitude !== null ? `Barometric altitude: ${baroAltitude} m` : undefined,
        velocity !== null ? `Velocity: ${velocity} m/s` : undefined,
        typeof onGround === 'boolean' ? `On ground: ${onGround}` : undefined,
        lastContact ? `Last contact unix time: ${lastContact}` : undefined,
      ].filter(Boolean).join('\n'),
      metadata: { row: raw },
    };
  }

  if (id === 'nasa-jpl-fireball-data-api' && Array.isArray(raw)) {
    const [date, energy, impactEnergy, lat, latDir, lon, lonDir, altitude, velocity] = raw;
    return {
      title: `Fireball event ${date ?? ''}`.trim(),
      url: source.baseUrl,
      content: [
        date ? `Date: ${date}` : undefined,
        energy ? `Radiated energy: ${energy}` : undefined,
        impactEnergy ? `Estimated impact energy: ${impactEnergy} kt` : undefined,
        lat && lon ? `Location: ${lat}${latDir ?? ''}, ${lon}${lonDir ?? ''}` : undefined,
        altitude ? `Altitude: ${altitude} km` : undefined,
        velocity ? `Velocity: ${velocity} km/s` : undefined,
      ].filter(Boolean).join('\n'),
      metadata: { row: raw },
    };
  }

  if ((id === 'nlm-clinical-tables-conditions' || id === 'nlm-clinical-tables-rxterms') && Array.isArray(raw)) {
    const label = raw.map((value) => Array.isArray(value) ? value.join(' ') : String(value)).join(' ').trim();
    return {
      title: label || 'NLM Clinical Tables result',
      url: source.baseUrl,
      content: label,
      metadata: { row: raw },
    };
  }

  const object = asRecord(raw);
  if (!object) return null;

  if (id === 'waqi') {
    const payload = asRecord(object.data) ?? object;
    const city = asRecord(payload.city);
    const time = asRecord(payload.time);
    const iaqi = asRecord(payload.iaqi);
    const pollutants = Object.entries(iaqi ?? {})
      .slice(0, 8)
      .map(([name, value]) => {
        const row = asRecord(value);
        return row?.v !== undefined ? `${name}: ${row.v}` : undefined;
      })
      .filter(Boolean);
    return {
      title: `WAQI air quality${firstString(city ?? {}, ['name']) ? ` - ${firstString(city ?? {}, ['name'])}` : ''}`,
      url: firstString(city ?? {}, ['url']) ?? source.baseUrl,
      content: [
        firstString(payload, ['aqi']) ? `AQI: ${firstString(payload, ['aqi'])}` : undefined,
        firstString(payload, ['dominentpol']) ? `Dominant pollutant: ${firstString(payload, ['dominentpol'])}` : undefined,
        firstString(time ?? {}, ['s']) ? `Observed: ${firstString(time ?? {}, ['s'])}` : undefined,
        pollutants.length ? `Pollutants: ${pollutants.join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(payload).slice(0, 4000),
      ...(firstString(time ?? {}, ['s']) ? { published_at: firstString(time ?? {}, ['s']) } : {}),
      metadata: payload,
    };
  }

  if (id === 'openweathermap') {
    const main = asRecord(object.main);
    const wind = asRecord(object.wind);
    const weather = Array.isArray(object.weather) ? asRecord(object.weather[0]) : undefined;
    const sys = asRecord(object.sys);
    const observedAt = typeof object.dt === 'number' ? new Date(object.dt * 1000).toISOString() : undefined;
    return {
      title: `OpenWeatherMap${firstString(object, ['name']) ? ` - ${firstString(object, ['name'])}` : ''}`,
      url: source.baseUrl,
      content: [
        firstString(weather ?? {}, ['description']) ? `Conditions: ${firstString(weather ?? {}, ['description'])}` : undefined,
        main?.temp !== undefined ? `Temperature: ${main.temp} C` : undefined,
        main?.feels_like !== undefined ? `Feels like: ${main.feels_like} C` : undefined,
        main?.humidity !== undefined ? `Humidity: ${main.humidity}%` : undefined,
        main?.pressure !== undefined ? `Pressure: ${main.pressure} hPa` : undefined,
        wind?.speed !== undefined ? `Wind speed: ${wind.speed} m/s` : undefined,
        firstString(sys ?? {}, ['country']) ? `Country: ${firstString(sys ?? {}, ['country'])}` : undefined,
        observedAt ? `Observed: ${observedAt}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(observedAt ? { published_at: observedAt } : {}),
      metadata: object,
    };
  }

  if (id === 'omdb') {
    const title = firstString(object, ['Title', 'title']);
    const imdbId = firstString(object, ['imdbID']);
    return {
      ...(title ? { title } : {}),
      url: imdbId ? `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/` : source.baseUrl,
      content: [
        firstString(object, ['Year']) ? `Year: ${firstString(object, ['Year'])}` : undefined,
        firstString(object, ['Type']) ? `Type: ${firstString(object, ['Type'])}` : undefined,
        imdbId ? `IMDb ID: ${imdbId}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'tvmaze') {
    const show = asRecord(object.show) ?? object;
    const title = firstString(show, ['name']);
    return {
      ...(title ? { title } : {}),
      url: firstString(show, ['url']) ?? source.baseUrl,
      content: [
        firstString(show, ['type']) ? `Type: ${firstString(show, ['type'])}` : undefined,
        firstString(show, ['language']) ? `Language: ${firstString(show, ['language'])}` : undefined,
        Array.isArray(show.genres) ? `Genres: ${show.genres.join(', ')}` : undefined,
        firstString(show, ['premiered']) ? `Premiered: ${firstString(show, ['premiered'])}` : undefined,
        firstString(show, ['summary']) ? stripMarkup(firstString(show, ['summary'])!) : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'lastfm' || id === 'last-fm') {
    const title = firstString(object, ['name']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['url']) ?? source.baseUrl,
      content: [
        firstString(object, ['listeners']) ? `Listeners: ${firstString(object, ['listeners'])}` : undefined,
        firstString(object, ['mbid']) ? `MusicBrainz ID: ${firstString(object, ['mbid'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'discogs') {
    const title = firstString(object, ['title']);
    const resourceUrl = firstString(object, ['resource_url']);
    const uri = firstString(object, ['uri']);
    return {
      ...(title ? { title } : {}),
      url: uri ? new URL(uri, 'https://www.discogs.com').href : resourceUrl ?? source.baseUrl,
      content: [
        firstString(object, ['type']) ? `Type: ${firstString(object, ['type'])}` : undefined,
        firstString(object, ['year']) ? `Year: ${firstString(object, ['year'])}` : undefined,
        Array.isArray(object.genre) ? `Genres: ${object.genre.join(', ')}` : undefined,
        Array.isArray(object.style) ? `Styles: ${object.style.join(', ')}` : undefined,
        firstString(object, ['country']) ? `Country: ${firstString(object, ['country'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'polymarket-gamma') {
    const question = firstString(object, ['question', 'title', 'ticker']);
    const slug = firstString(object, ['slug']);
    const isEvent = !firstString(object, ['conditionId']);
    const outcomes = parseMaybeJsonArray(object.outcomes);
    const prices = parseMaybeJsonArray(object.outcomePrices);
    const clobTokenIds = parseMaybeJsonArray(object.clobTokenIds);
    return {
      ...(question ? { title: question } : {}),
      url: slug ? `https://polymarket.com/${isEvent ? 'event' : 'market'}/${slug}` : source.baseUrl,
      content: [
        outcomes.length ? `Outcomes: ${outcomes.join(', ')}` : undefined,
        prices.length ? `Outcome prices: ${prices.join(', ')}` : undefined,
        firstString(object, ['volume']) ? `Volume: ${firstString(object, ['volume'])}` : undefined,
        firstString(object, ['liquidity']) ? `Liquidity: ${firstString(object, ['liquidity'])}` : undefined,
        firstString(object, ['endDate', 'endDateIso']) ? `Close/end date: ${firstString(object, ['endDate', 'endDateIso'])}` : undefined,
        firstString(object, ['category']) ? `Category: ${firstString(object, ['category'])}` : undefined,
        firstString(object, ['resolutionSource']) ? `Resolution source: ${firstString(object, ['resolutionSource'])}` : undefined,
        firstString(object, ['description']) ? stripMarkup(firstString(object, ['description'])!) : undefined,
        clobTokenIds.length ? `CLOB token IDs: ${clobTokenIds.slice(0, 4).join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['endDate', 'endDateIso']) ? { published_at: firstString(object, ['endDate', 'endDateIso']) } : {}),
      metadata: object,
    };
  }

  if (id === 'kalshi') {
    const title = firstString(object, ['title', 'event_title', 'subtitle', 'ticker']);
    const ticker = firstString(object, ['ticker']);
    return {
      ...(title ? { title } : {}),
      url: ticker ? `https://kalshi.com/markets/${encodeURIComponent(ticker)}` : source.baseUrl,
      content: [
        ticker ? `Ticker: ${ticker}` : undefined,
        firstString(object, ['category']) ? `Category: ${firstString(object, ['category'])}` : undefined,
        firstString(object, ['yes_bid']) ? `Yes bid: ${firstString(object, ['yes_bid'])}` : undefined,
        firstString(object, ['yes_ask']) ? `Yes ask: ${firstString(object, ['yes_ask'])}` : undefined,
        firstString(object, ['last_price']) ? `Last price: ${firstString(object, ['last_price'])}` : undefined,
        firstString(object, ['volume']) ? `Volume: ${firstString(object, ['volume'])}` : undefined,
        firstString(object, ['liquidity']) ? `Liquidity: ${firstString(object, ['liquidity'])}` : undefined,
        firstString(object, ['close_time']) ? `Close time: ${firstString(object, ['close_time'])}` : undefined,
        firstString(object, ['expiration_time']) ? `Expiration time: ${firstString(object, ['expiration_time'])}` : undefined,
        firstString(object, ['rules_primary']) ? `Rules: ${stripMarkup(firstString(object, ['rules_primary'])!)}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['close_time', 'expiration_time']) ? { published_at: firstString(object, ['close_time', 'expiration_time']) } : {}),
      metadata: object,
    };
  }

  if (id === 'manifold-markets') {
    const question = firstString(object, ['question', 'text', 'slug']);
    const slug = firstString(object, ['slug']);
    return {
      ...(question ? { title: question } : {}),
      url: firstString(object, ['url']) ?? (slug ? `https://manifold.markets/${slug}` : source.baseUrl),
      content: [
        firstString(object, ['probability']) ? `Probability: ${firstString(object, ['probability'])}` : undefined,
        firstString(object, ['totalLiquidity']) ? `Liquidity: ${firstString(object, ['totalLiquidity'])}` : undefined,
        firstString(object, ['volume']) ? `Volume: ${firstString(object, ['volume'])}` : undefined,
        firstString(object, ['closeTime']) ? `Close time: ${firstString(object, ['closeTime'])}` : undefined,
        firstString(object, ['resolution']) ? `Resolution: ${firstString(object, ['resolution'])}` : undefined,
        firstString(object, ['description']) ? stripMarkup(firstString(object, ['description'])!) : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'courtlistener') {
    const caseName = firstString(object, ['caseName', 'caseNameFull']);
    const absoluteUrl = firstString(object, ['absolute_url']);
    const citation = Array.isArray(object.citation) ? object.citation.filter((value) => typeof value === 'string').join(', ') : undefined;
    const opinionSnippets = Array.isArray(object.opinions)
      ? (object.opinions as unknown[])
          .map((opinion) => firstString(asRecord(opinion) ?? {}, ['snippet']))
          .filter((snippet): snippet is string => Boolean(snippet))
          .map((snippet) => stripMarkup(snippet))
          .join('\n')
      : undefined;
    const content = [
      citation ? `Citation: ${citation}` : undefined,
      firstString(object, ['court']) ? `Court: ${firstString(object, ['court'])}` : undefined,
      firstString(object, ['docketNumber']) ? `Docket: ${firstString(object, ['docketNumber'])}` : undefined,
      firstString(object, ['status']) ? `Status: ${firstString(object, ['status'])}` : undefined,
      opinionSnippets,
    ].filter(Boolean).join('\n');
    return {
      ...(caseName ? { title: caseName } : {}),
      url: absoluteUrl ? new URL(absoluteUrl, source.baseUrl).href : source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['dateFiled']) ? { published_at: firstString(object, ['dateFiled']) } : {}),
      metadata: object,
    };
  }

  if (id === 'cftc-commitments-of-traders') {
    const market = firstString(object, ['market_and_exchange_names']);
    const reportDate = firstString(object, ['report_date_as_yyyy_mm_dd']);
    const content = [
      market ? `Market and exchange: ${market}` : undefined,
      reportDate ? `Report date: ${reportDate}` : undefined,
      firstString(object, ['cftc_contract_market_code']) ? `CFTC market code: ${firstString(object, ['cftc_contract_market_code'])}` : undefined,
      firstString(object, ['open_interest_all']) ? `Open interest: ${firstString(object, ['open_interest_all'])}` : undefined,
      firstString(object, ['noncomm_positions_long_all']) ? `Non-commercial long: ${firstString(object, ['noncomm_positions_long_all'])}` : undefined,
      firstString(object, ['noncomm_positions_short_all']) ? `Non-commercial short: ${firstString(object, ['noncomm_positions_short_all'])}` : undefined,
      firstString(object, ['comm_positions_long_all']) ? `Commercial long: ${firstString(object, ['comm_positions_long_all'])}` : undefined,
      firstString(object, ['comm_positions_short_all']) ? `Commercial short: ${firstString(object, ['comm_positions_short_all'])}` : undefined,
    ].filter(Boolean).join('\n');
    return {
      title: market ? `CFTC COT: ${market}` : 'CFTC Commitments of Traders',
      url: source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(reportDate ? { published_at: reportDate } : {}),
      metadata: object,
    };
  }

  if (id === 'hacker-news-api') {
    const title = firstString(object, ['title', 'story_title']);
    const url = firstString(object, ['url', 'story_url']) ?? (firstString(object, ['objectID'])
      ? `https://news.ycombinator.com/item?id=${firstString(object, ['objectID'])}`
      : source.baseUrl);
    return {
      ...(title ? { title } : {}),
      url,
      content: [
        firstString(object, ['author']) ? `Author: ${firstString(object, ['author'])}` : undefined,
        firstString(object, ['points']) ? `Points: ${firstString(object, ['points'])}` : undefined,
        firstString(object, ['num_comments']) ? `Comments: ${firstString(object, ['num_comments'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['created_at']) ? { published_at: firstString(object, ['created_at']) } : {}),
      metadata: object,
    };
  }

  if (id === 'deribit-public-api') {
    const instrument = firstString(object, ['instrument_name']);
    return {
      ...(instrument ? { title: `Deribit ${instrument}` } : {}),
      url: source.baseUrl,
      content: [
        firstString(object, ['last']) ? `Last: ${firstString(object, ['last'])}` : undefined,
        firstString(object, ['bid_price']) && firstString(object, ['ask_price'])
          ? `Bid/ask: ${firstString(object, ['bid_price'])} / ${firstString(object, ['ask_price'])}`
          : undefined,
        firstString(object, ['open_interest']) ? `Open interest: ${firstString(object, ['open_interest'])}` : undefined,
        firstString(object, ['volume_usd']) ? `Volume USD: ${firstString(object, ['volume_usd'])}` : undefined,
        firstString(object, ['price_change']) ? `Price change: ${firstString(object, ['price_change'])}%` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'defillama-stablecoins') {
    const symbol = firstString(object, ['symbol']);
    const circulating = nestedString(object, ['circulating', 'peggedUSD']);
    return {
      title: [firstString(object, ['name']), symbol].filter(Boolean).join(' ') || 'Stablecoin',
      url: 'https://stablecoins.llama.fi',
      content: [
        symbol ? `Symbol: ${symbol}` : undefined,
        firstString(object, ['pegType']) ? `Peg type: ${firstString(object, ['pegType'])}` : undefined,
        firstString(object, ['pegMechanism']) ? `Peg mechanism: ${firstString(object, ['pegMechanism'])}` : undefined,
        firstString(object, ['price']) ? `Price: ${firstString(object, ['price'])}` : undefined,
        circulating ? `Circulating pegged USD: ${circulating}` : undefined,
        Array.isArray(object.chains) ? `Chains: ${(object.chains as unknown[]).slice(0, 8).join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'dydx-public-api') {
    const markets = asRecord(object.markets);
    if (markets) {
      const lines = Object.entries(markets).slice(0, 8).map(([ticker, market]) => {
        const row = asRecord(market) ?? {};
        return [
          ticker,
          firstString(row, ['status']) ? `status ${firstString(row, ['status'])}` : undefined,
          firstString(row, ['oraclePrice']) ? `oracle ${firstString(row, ['oraclePrice'])}` : undefined,
          firstString(row, ['volume24H']) ? `24h volume ${firstString(row, ['volume24H'])}` : undefined,
        ].filter(Boolean).join(' - ');
      });
      return {
        title: 'dYdX perpetual markets',
        url: source.baseUrl,
        content: lines.join('\n'),
        metadata: object,
      };
    }
  }

  if (id === 'hal') {
    const label = firstString(object, ['label_s']);
    return {
      ...(label ? { title: stripMarkup(label).slice(0, 180) } : {}),
      url: firstString(object, ['uri_s']) ?? source.baseUrl,
      content: label ? stripMarkup(label) : JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'ecfr') {
    const number = firstString(object, ['number']);
    const name = firstString(object, ['name']);
    return {
      title: number && name ? `eCFR Title ${number}: ${name}` : name ?? 'eCFR title',
      url: number ? `https://www.ecfr.gov/current/title-${encodeURIComponent(number)}` : source.baseUrl,
      content: [
        firstString(object, ['latest_amended_on']) ? `Latest amended: ${firstString(object, ['latest_amended_on'])}` : undefined,
        firstString(object, ['latest_issue_date']) ? `Latest issue date: ${firstString(object, ['latest_issue_date'])}` : undefined,
        firstString(object, ['up_to_date_as_of']) ? `Up to date as of: ${firstString(object, ['up_to_date_as_of'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'frankfurter-fx' || id === 'ecb-euro-exchange-rates') {
    const rates = asRecord(object.rates);
    const samples = Object.entries(rates ?? {}).slice(0, 12).map(([currency, rate]) => `${currency}: ${rate}`);
    return {
      title: `FX rates ${firstString(object, ['base']) ?? ''}`.trim(),
      url: source.baseUrl,
      content: [
        firstString(object, ['date']) ? `Date: ${firstString(object, ['date'])}` : undefined,
        firstString(object, ['base']) ? `Base: ${firstString(object, ['base'])}` : undefined,
        samples.length ? `Rates: ${samples.join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['date']) ? { published_at: firstString(object, ['date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'mlb-stats-api') {
    const games = Array.isArray(object.games) ? object.games as Array<Record<string, unknown>> : [];
    const lines = games.slice(0, 6).map((game) => {
      const away = nestedString(game, ['teams', 'away', 'team', 'name']);
      const home = nestedString(game, ['teams', 'home', 'team', 'name']);
      const status = nestedString(game, ['status', 'detailedState']);
      const awayScore = nestedString(game, ['teams', 'away', 'score']);
      const homeScore = nestedString(game, ['teams', 'home', 'score']);
      return [away && home ? `${away} at ${home}` : undefined, status, awayScore && homeScore ? `${awayScore}-${homeScore}` : undefined].filter(Boolean).join(' - ');
    });
    return {
      title: `MLB schedule ${firstString(object, ['date']) ?? ''}`.trim(),
      url: source.baseUrl,
      content: lines.length ? lines.join('\n') : JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['date']) ? { published_at: firstString(object, ['date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'nhl-api') {
    const teamName = asRecord(object.teamName);
    const defaultName = firstString(teamName ?? {}, ['default']);
    return {
      title: defaultName ? `NHL standings: ${defaultName}` : 'NHL standings',
      url: source.baseUrl,
      content: [
        defaultName ? `Team: ${defaultName}` : undefined,
        firstString(object, ['conferenceName']) ? `Conference: ${firstString(object, ['conferenceName'])}` : undefined,
        firstString(object, ['divisionName']) ? `Division: ${firstString(object, ['divisionName'])}` : undefined,
        firstString(object, ['gamesPlayed']) ? `Games played: ${firstString(object, ['gamesPlayed'])}` : undefined,
        firstString(object, ['points']) ? `Points: ${firstString(object, ['points'])}` : undefined,
        firstString(object, ['wins']) && firstString(object, ['losses'])
          ? `Record: ${firstString(object, ['wins'])}-${firstString(object, ['losses'])}-${firstString(object, ['otLosses']) ?? '0'}`
          : undefined,
        firstString(object, ['goalDifferential']) ? `Goal differential: ${firstString(object, ['goalDifferential'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['date']) ? { published_at: firstString(object, ['date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'jolpica-f1-api') {
    const races = nested(object, ['MRData', 'RaceTable', 'Races']);
    const race = Array.isArray(races) ? asRecord(races[0]) : undefined;
    const results = Array.isArray(race?.Results) ? race.Results as Array<Record<string, unknown>> : [];
    const lines = results.slice(0, 8).map((result) => {
      const driver = asRecord(result.Driver);
      const constructor = asRecord(result.Constructor);
      const name = [firstString(driver ?? {}, ['givenName']), firstString(driver ?? {}, ['familyName'])].filter(Boolean).join(' ');
      return [
        firstString(result, ['position']) ? `P${firstString(result, ['position'])}` : undefined,
        name || undefined,
        firstString(constructor ?? {}, ['name']),
        firstString(result, ['status']),
      ].filter(Boolean).join(' - ');
    });
    return {
      title: firstString(race ?? {}, ['raceName']) ?? 'Formula 1 results',
      url: firstString(race ?? {}, ['url']) ?? source.baseUrl,
      content: lines.length ? lines.join('\n') : JSON.stringify(raw).slice(0, 4000),
      ...(firstString(race ?? {}, ['date']) ? { published_at: firstString(race ?? {}, ['date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'regulations-gov-documents') {
    const attributes = asRecord(object.attributes) ?? object;
    const title = firstString(attributes, ['title', 'documentType']);
    const docketId = firstString(attributes, ['docketId']);
    const documentId = firstString(object, ['id']) ?? firstString(attributes, ['documentId']);
    const content = [
      firstString(attributes, ['documentType']) ? `Document type: ${firstString(attributes, ['documentType'])}` : undefined,
      docketId ? `Docket: ${docketId}` : undefined,
      firstString(attributes, ['agencyId']) ? `Agency: ${firstString(attributes, ['agencyId'])}` : undefined,
      firstString(attributes, ['postedDate']) ? `Posted date: ${firstString(attributes, ['postedDate'])}` : undefined,
      firstString(attributes, ['commentEndDate']) ? `Comment end date: ${firstString(attributes, ['commentEndDate'])}` : undefined,
      firstString(attributes, ['summary']) ? stripMarkup(firstString(attributes, ['summary']) ?? '') : undefined,
    ].filter(Boolean).join('\n');
    return {
      ...(title ? { title } : {}),
      url: documentId ? `https://www.regulations.gov/document/${encodeURIComponent(documentId)}` : source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(attributes, ['postedDate']) ? { published_at: firstString(attributes, ['postedDate']) } : {}),
      metadata: object,
    };
  }

  if (id === 'fbi-wanted-api') {
    const title = firstString(object, ['title']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['url']) ?? source.baseUrl,
      content: [
        Array.isArray(object.subjects) ? `Subjects: ${(object.subjects as unknown[]).slice(0, 5).join(', ')}` : undefined,
        Array.isArray(object.field_offices) ? `Field offices: ${(object.field_offices as unknown[]).slice(0, 5).join(', ')}` : undefined,
        firstString(object, ['description']) ? stripMarkup(firstString(object, ['description']) ?? '') : undefined,
        firstString(object, ['warning_message']) ? `Warning: ${firstString(object, ['warning_message'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['publication']) ? { published_at: firstString(object, ['publication']) } : {}),
      metadata: object,
    };
  }

  if (id === 'anilist') {
    const titleObject = asRecord(object.title);
    const title = firstString(titleObject ?? {}, ['english', 'romaji', 'native']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['siteUrl']) ?? source.baseUrl,
      content: [
        firstString(object, ['description']) ? stripMarkup(firstString(object, ['description']) ?? '') : undefined,
        firstString(object, ['seasonYear']) ? `Year: ${firstString(object, ['seasonYear'])}` : undefined,
        firstString(object, ['format']) ? `Format: ${firstString(object, ['format'])}` : undefined,
        firstString(object, ['status']) ? `Status: ${firstString(object, ['status'])}` : undefined,
        firstString(object, ['averageScore']) ? `Average score: ${firstString(object, ['averageScore'])}` : undefined,
        Array.isArray(object.genres) ? `Genres: ${(object.genres as unknown[]).slice(0, 8).join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'gdelt') {
    const title = firstString(object, ['title']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['url']) ?? source.baseUrl,
      content: [
        firstString(object, ['seendate']) ? `Seen date: ${firstString(object, ['seendate'])}` : undefined,
        firstString(object, ['sourceCountry']) ? `Source country: ${firstString(object, ['sourceCountry'])}` : undefined,
        firstString(object, ['domain']) ? `Domain: ${firstString(object, ['domain'])}` : undefined,
        firstString(object, ['language']) ? `Language: ${firstString(object, ['language'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['seendate']) ? { published_at: firstString(object, ['seendate']) } : {}),
      metadata: object,
    };
  }

  if (id === 'bea') {
    const dataset = firstString(object, ['DatasetName']);
    return {
      title: dataset ? `BEA dataset: ${dataset}` : 'BEA dataset',
      url: source.baseUrl,
      content: [
        dataset ? `Dataset: ${dataset}` : undefined,
        firstString(object, ['DatasetDescription']),
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'alpha-vantage') {
    const quote = asRecord(object['Global Quote']) ?? object;
    const symbol = firstString(quote, ['01. symbol', 'symbol']);
    return {
      title: symbol ? `Alpha Vantage quote: ${symbol}` : 'Alpha Vantage quote',
      url: source.baseUrl,
      content: [
        firstString(quote, ['05. price']) ? `Price: ${firstString(quote, ['05. price'])}` : undefined,
        firstString(quote, ['02. open']) ? `Open: ${firstString(quote, ['02. open'])}` : undefined,
        firstString(quote, ['03. high']) ? `High: ${firstString(quote, ['03. high'])}` : undefined,
        firstString(quote, ['04. low']) ? `Low: ${firstString(quote, ['04. low'])}` : undefined,
        firstString(quote, ['06. volume']) ? `Volume: ${firstString(quote, ['06. volume'])}` : undefined,
        firstString(quote, ['10. change percent']) ? `Change: ${firstString(quote, ['09. change']) ?? ''} (${firstString(quote, ['10. change percent'])})` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(quote, ['07. latest trading day']) ? { published_at: firstString(quote, ['07. latest trading day']) } : {}),
      metadata: object,
    };
  }

  if (id === 'finnhub') {
    return {
      title: 'Finnhub quote',
      url: source.baseUrl,
      content: [
        firstString(object, ['c']) ? `Current: ${firstString(object, ['c'])}` : undefined,
        firstString(object, ['o']) ? `Open: ${firstString(object, ['o'])}` : undefined,
        firstString(object, ['h']) ? `High: ${firstString(object, ['h'])}` : undefined,
        firstString(object, ['l']) ? `Low: ${firstString(object, ['l'])}` : undefined,
        firstString(object, ['pc']) ? `Previous close: ${firstString(object, ['pc'])}` : undefined,
        firstString(object, ['d']) ? `Change: ${firstString(object, ['d'])} (${firstString(object, ['dp']) ?? ''}%)` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'twelve-data') {
    const symbol = firstString(object, ['symbol']);
    return {
      title: symbol ? `Twelve Data quote: ${symbol}` : 'Twelve Data quote',
      url: source.baseUrl,
      content: [
        firstString(object, ['name']),
        firstString(object, ['exchange']) ? `Exchange: ${firstString(object, ['exchange'])}` : undefined,
        firstString(object, ['currency']) ? `Currency: ${firstString(object, ['currency'])}` : undefined,
        firstString(object, ['close']) ? `Close: ${firstString(object, ['close'])}` : undefined,
        firstString(object, ['open']) ? `Open: ${firstString(object, ['open'])}` : undefined,
        firstString(object, ['high']) ? `High: ${firstString(object, ['high'])}` : undefined,
        firstString(object, ['low']) ? `Low: ${firstString(object, ['low'])}` : undefined,
        firstString(object, ['percent_change']) ? `Percent change: ${firstString(object, ['percent_change'])}%` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['datetime']) ? { published_at: firstString(object, ['datetime']) } : {}),
      metadata: object,
    };
  }

  if (id === 'financial-modeling-prep') {
    const symbol = firstString(object, ['symbol']);
    return {
      title: firstString(object, ['companyName']) ?? (symbol ? `FMP profile: ${symbol}` : 'FMP profile'),
      url: firstString(object, ['website']) ?? source.baseUrl,
      content: [
        symbol ? `Symbol: ${symbol}` : undefined,
        firstString(object, ['price']) ? `Price: ${firstString(object, ['price'])}` : undefined,
        firstString(object, ['marketCap']) ? `Market cap: ${firstString(object, ['marketCap'])}` : undefined,
        firstString(object, ['exchangeFullName']) ? `Exchange: ${firstString(object, ['exchangeFullName'])}` : undefined,
        firstString(object, ['industry']) ? `Industry: ${firstString(object, ['industry'])}` : undefined,
        firstString(object, ['sector']) ? `Sector: ${firstString(object, ['sector'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'un-comtrade') {
    const content = [
      firstString(object, ['lastUpdated']) ? `Last updated: ${firstString(object, ['lastUpdated'])}` : undefined,
      firstString(object, ['reporterDesc']) ? `Reporter: ${firstString(object, ['reporterDesc'])}` : undefined,
      firstString(object, ['freqCode']) ? `Frequency: ${firstString(object, ['freqCode'])}` : undefined,
      firstString(object, ['typeCode']) ? `Type: ${firstString(object, ['typeCode'])}` : undefined,
      firstString(object, ['classificationCode']) ? `Classification: ${firstString(object, ['classificationCode'])}` : undefined,
      firstString(object, ['period']) ? `Period: ${firstString(object, ['period'])}` : undefined,
      firstString(object, ['releaseStatus']) ? `Release status: ${firstString(object, ['releaseStatus'])}` : undefined,
    ].filter(Boolean).join('\n');
    return {
      title: firstString(object, ['reporterDesc']) ? `UN Comtrade update: ${firstString(object, ['reporterDesc'])}` : 'UN Comtrade update',
      url: source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'govinfo') {
    const title = firstString(object, ['title', 'packageId']);
    const packageId = firstString(object, ['packageId']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['packageLink']) ?? (packageId ? `https://www.govinfo.gov/app/details/${encodeURIComponent(packageId)}` : source.baseUrl),
      content: [
        packageId ? `Package: ${packageId}` : undefined,
        firstString(object, ['granuleId']) ? `Granule: ${firstString(object, ['granuleId'])}` : undefined,
        firstString(object, ['dateIssued']) ? `Date issued: ${firstString(object, ['dateIssued'])}` : undefined,
        Array.isArray(object.governmentAuthor) ? `Government author: ${(object.governmentAuthor as unknown[]).slice(0, 4).join(', ')}` : undefined,
        firstString(object, ['collectionCode']) ? `Collection: ${firstString(object, ['collectionCode'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['dateIssued']) ? { published_at: firstString(object, ['dateIssued']) } : {}),
      metadata: object,
    };
  }

  if (id === 'cisa-kev') {
    const cve = firstString(object, ['cveID']);
    const title = [cve, firstString(object, ['vulnerabilityName'])].filter(Boolean).join(' - ');
    const content = [
      firstString(object, ['shortDescription']),
      firstString(object, ['requiredAction']) ? `Required action: ${firstString(object, ['requiredAction'])}` : undefined,
      firstString(object, ['dueDate']) ? `Due date: ${firstString(object, ['dueDate'])}` : undefined,
      firstString(object, ['vendorProject']) && firstString(object, ['product'])
        ? `Affected product: ${firstString(object, ['vendorProject'])} ${firstString(object, ['product'])}`
        : undefined,
      firstString(object, ['knownRansomwareCampaignUse'])
        ? `Known ransomware campaign use: ${firstString(object, ['knownRansomwareCampaignUse'])}`
        : undefined,
    ].filter(Boolean).join('\n');
    return {
      ...(title ? { title } : {}),
      url: cve ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}` : source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['dateAdded']) ? { published_at: firstString(object, ['dateAdded']) } : {}),
      metadata: object,
    };
  }

  if (id === 'nvd') {
    const cve = asRecord(object.cve);
    const cveId = firstString(cve ?? {}, ['id']);
    const descriptions = Array.isArray(cve?.descriptions) ? cve.descriptions as Array<Record<string, unknown>> : [];
    const english = descriptions.find((entry) => entry.lang === 'en')?.value;
    const metrics = asRecord(cve?.metrics);
    const cvss = firstArrayItem(metrics?.cvssMetricV31) ?? firstArrayItem(metrics?.cvssMetricV30) ?? firstArrayItem(metrics?.cvssMetricV2);
    const cvssData = nested(cvss, ['cvssData']);
    const severity = firstString(asRecord(cvss) ?? {}, ['baseSeverity']) ?? nestedString(cvssData, ['baseSeverity']);
    const score = nestedString(cvssData, ['baseScore']);
    const content = [
      typeof english === 'string' ? english : undefined,
      severity || score ? `Severity: ${severity ?? 'unknown'}${score ? `, CVSS ${score}` : ''}` : undefined,
      firstString(cve ?? {}, ['published']) ? `Published: ${firstString(cve ?? {}, ['published'])}` : undefined,
    ].filter(Boolean).join('\n');
    return {
      ...(cveId ? { title: cveId } : {}),
      url: cveId ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}` : source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(cve ?? {}, ['published']) ? { published_at: firstString(cve ?? {}, ['published']) } : {}),
      metadata: object,
    };
  }

  if (id === 'fred') {
    const title = firstString(object, ['title']) ?? firstString(object, ['id']);
    const content = [
      firstString(object, ['id']) ? `Series: ${firstString(object, ['id'])}` : undefined,
      firstString(object, ['title']),
      firstString(object, ['observation_start']) && firstString(object, ['observation_end'])
        ? `Observation range: ${firstString(object, ['observation_start'])} to ${firstString(object, ['observation_end'])}`
        : undefined,
      firstString(object, ['frequency']) ? `Frequency: ${firstString(object, ['frequency'])}` : undefined,
      firstString(object, ['units']) ? `Units: ${firstString(object, ['units'])}` : undefined,
      firstString(object, ['notes']),
    ].filter(Boolean).join('\n');
    return { ...(title ? { title } : {}), url: source.baseUrl, content, metadata: object };
  }

  if (id === 'federal-register') {
    const title = firstString(object, ['title', 'document_number']);
    const content = [
      firstString(object, ['abstract']),
      firstString(object, ['type']) ? `Type: ${firstString(object, ['type'])}` : undefined,
      firstString(object, ['document_number']) ? `Document number: ${firstString(object, ['document_number'])}` : undefined,
      firstString(object, ['publication_date']) ? `Publication date: ${firstString(object, ['publication_date'])}` : undefined,
      Array.isArray(object.agencies)
        ? `Agencies: ${(object.agencies as Array<Record<string, unknown>>).map((agency) => firstString(agency, ['name'])).filter(Boolean).join(', ')}`
        : undefined,
      firstString(object, ['excerpts']),
    ].filter(Boolean).join('\n');
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['html_url', 'pdf_url']) ?? source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['publication_date']) ? { published_at: firstString(object, ['publication_date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'the-guardian') {
    const title = firstString(object, ['webTitle', 'id']);
    const trailText = nestedString(object, ['fields', 'trailText']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['webUrl', 'apiUrl']) ?? source.baseUrl,
      content: [
        trailText ? stripMarkup(trailText) : undefined,
        firstString(object, ['sectionName']) ? `Section: ${firstString(object, ['sectionName'])}` : undefined,
        firstString(object, ['type']) ? `Type: ${firstString(object, ['type'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['webPublicationDate']) ? { published_at: firstString(object, ['webPublicationDate']) } : {}),
      metadata: object,
    };
  }

  if (id === 'congress-gov') {
    const bill = asRecord(object.bill);
    const title = firstString(object, ['title']) ?? firstString(bill ?? {}, ['title']) ?? 'Congress.gov item';
    const latestAction = asRecord(object.latestAction) ?? asRecord(bill?.latestAction);
    const summaryText = firstString(object, ['text']);
    const content = [
      summaryText ? stripMarkup(summaryText) : undefined,
      firstString(latestAction ?? {}, ['text']) ? `Latest action: ${firstString(latestAction ?? {}, ['text'])}` : undefined,
      firstString(latestAction ?? {}, ['actionDate']) ? `Action date: ${firstString(latestAction ?? {}, ['actionDate'])}` : undefined,
      firstString(object, ['congress']) ?? firstString(bill ?? {}, ['congress'])
        ? `Congress: ${firstString(object, ['congress']) ?? firstString(bill ?? {}, ['congress'])}`
        : undefined,
      firstString(object, ['type']) && firstString(object, ['number'])
        ? `Bill: ${firstString(object, ['type'])} ${firstString(object, ['number'])}`
        : undefined,
    ].filter(Boolean).join('\n');
    return {
      title,
      url: firstString(object, ['url']) ?? firstString(bill ?? {}, ['url']) ?? source.baseUrl,
      content: content || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['updateDate']) ? { published_at: firstString(object, ['updateDate']) } : {}),
      metadata: object,
    };
  }

  if (id === 'sec-company-tickers') {
    const entries = Object.values(object).map((entry) => asRecord(entry)).filter(Boolean).slice(0, 10);
    return {
      title: 'SEC company tickers',
      url: source.baseUrl,
      content: entries.map((entry) => {
        const cik = firstString(entry ?? {}, ['cik_str']);
        const ticker = firstString(entry ?? {}, ['ticker']);
        const title = firstString(entry ?? {}, ['title']);
        return [ticker, title, cik ? `CIK ${cik}` : undefined].filter(Boolean).join(' - ');
      }).filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'sec-edgar') {
    const facts = asRecord(object.facts);
    const namespaces = Object.keys(facts ?? {});
    const sampleFacts = namespaces.flatMap((namespace) => {
      const group = asRecord(facts?.[namespace]);
      return Object.entries(group ?? {}).slice(0, 3).map(([key, value]) => {
        const fact = asRecord(value);
        return [firstString(fact ?? {}, ['label']) ?? key, namespace].filter(Boolean).join(' - ');
      });
    }).slice(0, 8);
    return {
      title: firstString(object, ['entityName']) ?? 'SEC company facts',
      url: source.baseUrl,
      content: [
        firstString(object, ['cik']) ? `CIK: ${firstString(object, ['cik'])}` : undefined,
        namespaces.length ? `Fact namespaces: ${namespaces.join(', ')}` : undefined,
        sampleFacts.length ? `Sample facts:\n${sampleFacts.join('\n')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'federal-reserve') {
    const title = firstString(object, ['t']) ?? 'Federal Reserve release';
    const href = firstString(object, ['l']);
    return {
      title,
      url: href ? new URL(href, source.baseUrl).href : source.baseUrl,
      content: [
        firstString(object, ['pt']) ? `Type: ${firstString(object, ['pt'])}` : undefined,
        firstString(object, ['d']) ? `Date: ${firstString(object, ['d'])}` : undefined,
        title,
      ].filter(Boolean).join('\n'),
      ...(firstString(object, ['d']) ? { published_at: firstString(object, ['d']) } : {}),
      metadata: object,
    };
  }

  if (id === 'openfda') {
    const patient = asRecord(object.patient);
    const drugs = Array.isArray(patient?.drug) ? patient.drug as Array<Record<string, unknown>> : [];
    const reactions = Array.isArray(patient?.reaction) ? patient.reaction as Array<Record<string, unknown>> : [];
    return {
      title: firstString(object, ['safetyreportid']) ? `FDA adverse event ${firstString(object, ['safetyreportid'])}` : 'FDA adverse event',
      url: source.baseUrl,
      content: [
        firstString(object, ['receivedate']) ? `Received: ${firstString(object, ['receivedate'])}` : undefined,
        firstString(object, ['serious']) ? `Serious: ${firstString(object, ['serious'])}` : undefined,
        drugs.length ? `Drugs: ${drugs.map((drug) => firstString(drug, ['medicinalproduct'])).filter(Boolean).slice(0, 5).join(', ')}` : undefined,
        reactions.length ? `Reactions: ${reactions.map((reaction) => firstString(reaction, ['reactionmeddrapt'])).filter(Boolean).slice(0, 5).join(', ')}` : undefined,
        firstString(object, ['primarysourcecountry']) ? `Source country: ${firstString(object, ['primarysourcecountry'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'fdic-bankfind') {
    const data = asRecord(object.data) ?? object;
    const name = firstString(data, ['NAME']);
    const cert = firstString(data, ['CERT', 'ID']);
    return {
      title: name ?? 'FDIC institution',
      url: source.baseUrl,
      content: [
        cert ? `FDIC certificate: ${cert}` : undefined,
        firstString(data, ['CITY']) && firstString(data, ['STNAME'])
          ? `Location: ${firstString(data, ['CITY'])}, ${firstString(data, ['STNAME'])}`
          : undefined,
        firstString(data, ['ACTIVE']) ? `Active: ${firstString(data, ['ACTIVE'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'coingecko' || id === 'coinpaprika') {
    const title = firstString(object, ['name']) ?? firstString(object, ['symbol']) ?? firstString(object, ['id']);
    const content = [
      firstString(object, ['symbol']) ? `Symbol: ${firstString(object, ['symbol'])}` : undefined,
      firstString(object, ['id']) ? `ID: ${firstString(object, ['id'])}` : undefined,
      firstString(object, ['market_cap_rank']) ?? firstString(object, ['rank']) ? `Rank: ${firstString(object, ['market_cap_rank']) ?? firstString(object, ['rank'])}` : undefined,
      firstString(object, ['is_active']) ? `Active: ${firstString(object, ['is_active'])}` : undefined,
    ].filter(Boolean).join('\n');
    return { ...(title ? { title } : {}), url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), metadata: object };
  }

  if (id === 'cryptocompare') {
    const usd = nested(raw, ['RAW', 'BTC', 'USD']);
    const display = nested(raw, ['DISPLAY', 'BTC', 'USD']);
    const price = nestedString(display, ['PRICE']) ?? fixedNumber(nested(usd, ['PRICE']));
    const change = nestedString(display, ['CHANGEPCT24HOUR']) ?? fixedNumber(nested(usd, ['CHANGEPCT24HOUR']));
    const market = nestedString(usd, ['LASTMARKET']);
    const content = [
      price ? `BTC/USD price: ${price}` : undefined,
      change ? `24h change: ${change}%` : undefined,
      market ? `Last market: ${market}` : undefined,
      nestedString(display, ['MKTCAP']) ? `Market cap: ${nestedString(display, ['MKTCAP'])}` : undefined,
    ].filter(Boolean).join('\n');
    return { title: 'BTC/USD market data', url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), metadata: object };
  }

  if (id === 'coinmarketcap') {
    const btc = nested(raw, ['data', 'BTC']);
    const usd = nested(btc, ['quote', 'USD']);
    const title = nestedString(btc, ['name']) ?? 'CoinMarketCap BTC quote';
    const content = [
      nestedString(btc, ['symbol']) ? `Symbol: ${nestedString(btc, ['symbol'])}` : undefined,
      fixedNumber(nested(usd, ['price'])) ? `Price USD: ${fixedNumber(nested(usd, ['price']))}` : undefined,
      fixedNumber(nested(usd, ['percent_change_24h'])) ? `24h change: ${fixedNumber(nested(usd, ['percent_change_24h']))}%` : undefined,
      fixedNumber(nested(usd, ['market_cap']), 0) ? `Market cap USD: ${fixedNumber(nested(usd, ['market_cap']), 0)}` : undefined,
      nestedString(usd, ['last_updated']) ? `Updated: ${nestedString(usd, ['last_updated'])}` : undefined,
    ].filter(Boolean).join('\n');
    return { title, url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), ...(nestedString(usd, ['last_updated']) ? { published_at: nestedString(usd, ['last_updated']) } : {}), metadata: object };
  }

  if (id === 'binance-public-api') {
    const symbol = firstString(object, ['symbol']) ?? 'BTCUSDT';
    const content = [
      firstString(object, ['lastPrice']) ? `Last price: ${firstString(object, ['lastPrice'])}` : undefined,
      firstString(object, ['priceChangePercent']) ? `24h change: ${firstString(object, ['priceChangePercent'])}%` : undefined,
      firstString(object, ['volume']) ? `Volume: ${firstString(object, ['volume'])}` : undefined,
    ].filter(Boolean).join('\n');
    return { title: `${symbol} Binance ticker`, url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), metadata: object };
  }

  if (id === 'kraken-api') {
    const result = asRecord(object.result);
    const pair = result ? Object.keys(result)[0] : undefined;
    const ticker = pair ? asRecord(result?.[pair]) : undefined;
    const price = Array.isArray(ticker?.c) ? ticker.c[0] : undefined;
    const volume = Array.isArray(ticker?.v) ? ticker.v[1] : undefined;
    const content = [
      price ? `Last price: ${price}` : undefined,
      volume ? `24h volume: ${volume}` : undefined,
    ].filter(Boolean).join('\n');
    return { title: `${pair ?? 'XBTUSD'} Kraken ticker`, url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), metadata: object };
  }

  if (id === 'coinbase-api') {
    const data = asRecord(object.data);
    const base = firstString(data ?? {}, ['base']) ?? 'BTC';
    const currency = firstString(data ?? {}, ['currency']) ?? 'USD';
    const amount = firstString(data ?? {}, ['amount']);
    return {
      title: `${base}/${currency} Coinbase spot price`,
      url: source.baseUrl,
      content: amount ? `Spot price: ${amount} ${currency}` : JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'ebird-api') {
    const common = firstString(object, ['comName']);
    const scientific = firstString(object, ['sciName']);
    const location = firstString(object, ['locName']);
    const observed = firstString(object, ['obsDt']);
    const count = firstString(object, ['howMany']);
    return {
      title: common ?? scientific ?? 'eBird observation',
      url: source.baseUrl,
      content: [
        scientific ? `Scientific name: ${scientific}` : undefined,
        location ? `Location: ${location}` : undefined,
        observed ? `Observed: ${observed}` : undefined,
        count ? `Count: ${count}` : undefined,
        firstString(object, ['lat']) && firstString(object, ['lng'])
          ? `Coordinates: ${firstString(object, ['lat'])}, ${firstString(object, ['lng'])}`
          : undefined,
        firstString(object, ['obsValid']) ? `Valid observation: ${firstString(object, ['obsValid'])}` : undefined,
      ].filter(Boolean).join('\n'),
      ...(observed ? { published_at: observed } : {}),
      metadata: object,
    };
  }

  if (id === 'uniprot') {
    const accession = firstString(object, ['primaryAccession']);
    const protein = nestedString(object, ['proteinDescription', 'recommendedName', 'fullName', 'value']);
    const organism = nestedString(object, ['organism', 'scientificName']);
    const gene = Array.isArray(object.genes) ? nestedString(object.genes[0], ['geneName', 'value']) : undefined;
    const sequence = nestedString(object, ['sequence', 'value']);
    return {
      title: protein ?? firstString(object, ['uniProtkbId']) ?? accession ?? 'UniProt entry',
      url: accession ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry` : source.baseUrl,
      content: [
        accession ? `Accession: ${accession}` : undefined,
        gene ? `Gene: ${gene}` : undefined,
        organism ? `Organism: ${organism}` : undefined,
        firstString(object, ['entryType']),
        sequence ? `Sequence length: ${sequence.length} aa` : undefined,
      ].filter(Boolean).join('\n'),
      metadata: object,
    };
  }

  if (id === 'itis') {
    const name = firstString(object, ['combinedName']);
    const tsn = firstString(object, ['tsn']);
    return {
      title: name ?? 'ITIS taxon',
      url: tsn ? `https://www.itis.gov/servlet/SingleRpt/SingleRpt?search_topic=TSN&search_value=${encodeURIComponent(tsn)}` : source.baseUrl,
      content: [
        name ? `Scientific name: ${name}` : undefined,
        tsn ? `TSN: ${tsn}` : undefined,
        firstString(object, ['kingdom']) ? `Kingdom: ${firstString(object, ['kingdom'])}` : undefined,
        firstString(object, ['author']) ? `Author: ${firstString(object, ['author'])}` : undefined,
      ].filter(Boolean).join('\n'),
      metadata: object,
    };
  }

  if (id === 'obis') {
    const scientificName = firstString(object, ['scientificName']);
    const dataset = firstString(object, ['datasetName']);
    const eventDate = firstString(object, ['eventDate']);
    return {
      title: scientificName ?? firstString(object, ['species']) ?? 'OBIS occurrence',
      url: source.baseUrl,
      content: [
        dataset ? `Dataset: ${dataset}` : undefined,
        eventDate ? `Event date: ${eventDate}` : undefined,
        firstString(object, ['decimalLatitude']) && firstString(object, ['decimalLongitude'])
          ? `Coordinates: ${firstString(object, ['decimalLatitude'])}, ${firstString(object, ['decimalLongitude'])}`
          : undefined,
        firstString(object, ['basisOfRecord']) ? `Basis of record: ${firstString(object, ['basisOfRecord'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'nasa-ipac-ned') {
    const preferred = asRecord(object.Preferred);
    const name = nestedString(preferred, ['Name']) ?? nestedString(object, ['Interpreted', 'Name']);
    const position = asRecord(preferred?.Position);
    const redshift = asRecord(preferred?.Redshift);
    return {
      title: name ?? 'NASA/IPAC NED object',
      url: source.baseUrl,
      content: [
        name ? `Object: ${name}` : undefined,
        nestedString(preferred, ['ObjType', 'Value']) ? `Object type: ${nestedString(preferred, ['ObjType', 'Value'])}` : undefined,
        position ? `RA/Dec: ${position.RA}, ${position.Dec}` : undefined,
        redshift?.Value !== undefined ? `Redshift: ${redshift.Value}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'materials-project') {
    const materialId = firstString(object, ['material_id']);
    return {
      title: [firstString(object, ['formula_pretty']), materialId].filter(Boolean).join(' - ') || 'Materials Project entry',
      url: materialId ? `https://materialsproject.org/materials/${encodeURIComponent(materialId)}` : source.baseUrl,
      content: [
        materialId ? `Material ID: ${materialId}` : undefined,
        firstString(object, ['formula_pretty']) ? `Formula: ${firstString(object, ['formula_pretty'])}` : undefined,
        firstString(object, ['band_gap']) ? `Band gap: ${firstString(object, ['band_gap'])} eV` : undefined,
        firstString(object, ['energy_above_hull']) ? `Energy above hull: ${firstString(object, ['energy_above_hull'])} eV/atom` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'chemspider') {
    const recordId = firstString(object, ['id']);
    return {
      title: firstString(object, ['commonName']) ?? (recordId ? `ChemSpider ${recordId}` : 'ChemSpider record'),
      url: recordId ? `https://www.chemspider.com/Chemical-Structure.${encodeURIComponent(recordId)}.html` : source.baseUrl,
      content: [
        recordId ? `Record ID: ${recordId}` : undefined,
        firstString(object, ['formula']) ? `Formula: ${firstString(object, ['formula'])}` : undefined,
        firstString(object, ['molecularWeight']) ? `Molecular weight: ${firstString(object, ['molecularWeight'])}` : undefined,
        firstString(object, ['averageMass']) ? `Average mass: ${firstString(object, ['averageMass'])}` : undefined,
        firstString(object, ['smiles']) ? `SMILES: ${firstString(object, ['smiles'])}` : undefined,
        firstString(object, ['inchiKey']) ? `InChIKey: ${firstString(object, ['inchiKey'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'npm-registry') {
    const pkg = asRecord(object.package) ?? object;
    const name = firstString(pkg, ['name']);
    return {
      title: name ?? 'npm package',
      url: nestedString(pkg, ['links', 'npm']) ?? source.baseUrl,
      content: [
        firstString(pkg, ['version']) ? `Version: ${firstString(pkg, ['version'])}` : undefined,
        firstString(pkg, ['description']),
        firstString(object, ['downloads']) ? `Downloads: ${firstString(object, ['downloads'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(pkg, ['date']) ? { published_at: firstString(pkg, ['date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'pypi') {
    const info = asRecord(object.info) ?? object;
    const name = firstString(info, ['name']);
    return {
      title: name ?? 'PyPI package',
      url: firstString(info, ['package_url', 'project_url']) ?? source.baseUrl,
      content: [
        firstString(info, ['version']) ? `Version: ${firstString(info, ['version'])}` : undefined,
        firstString(info, ['summary']),
        firstString(info, ['license']) ? `License: ${firstString(info, ['license'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'maven-central') {
    const group = firstString(object, ['g']);
    const artifact = firstString(object, ['a']);
    return {
      title: [group, artifact].filter(Boolean).join(':') || 'Maven artifact',
      url: source.baseUrl,
      content: [
        firstString(object, ['latestVersion']) ? `Latest version: ${firstString(object, ['latestVersion'])}` : undefined,
        firstString(object, ['p']) ? `Packaging: ${firstString(object, ['p'])}` : undefined,
        firstString(object, ['versionCount']) ? `Version count: ${firstString(object, ['versionCount'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'stack-exchange') {
    return {
      title: firstString(object, ['title']) ?? 'Stack Overflow question',
      url: firstString(object, ['link']) ?? source.baseUrl,
      content: [
        firstString(object, ['score']) ? `Score: ${firstString(object, ['score'])}` : undefined,
        firstString(object, ['answer_count']) ? `Answers: ${firstString(object, ['answer_count'])}` : undefined,
        firstString(object, ['is_answered']) ? `Answered: ${firstString(object, ['is_answered'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'osv') {
    return {
      title: firstString(object, ['id']) ?? 'OSV vulnerability',
      url: firstString(object, ['id']) ? `https://osv.dev/vulnerability/${encodeURIComponent(firstString(object, ['id'])!)}` : source.baseUrl,
      content: [
        firstString(object, ['summary']),
        firstString(object, ['details']),
      ].filter(Boolean).join('\n').slice(0, 4000) || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['published']) ? { published_at: firstString(object, ['published']) } : {}),
      metadata: object,
    };
  }

  if (id === 'deps-dev') {
    const version = nestedString(object, ['versionKey', 'version']);
    return {
      title: version ? `deps.dev ${version}` : 'deps.dev package',
      url: source.baseUrl,
      content: [
        version ? `Version: ${version}` : undefined,
        firstString(object, ['publishedAt']) ? `Published: ${firstString(object, ['publishedAt'])}` : undefined,
        firstString(object, ['isDeprecated']) ? `Deprecated: ${firstString(object, ['isDeprecated'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['publishedAt']) ? { published_at: firstString(object, ['publishedAt']) } : {}),
      metadata: object,
    };
  }

  if (id === 'libraries-io') {
    const name = firstString(object, ['name']);
    const platform = firstString(object, ['platform']);
    return {
      title: [platform, name].filter(Boolean).join(': ') || 'Libraries.io project',
      url: firstString(object, ['repository_url', 'homepage']) ?? source.baseUrl,
      content: [
        firstString(object, ['latest_stable_release_number'])
          ? `Latest stable release: ${firstString(object, ['latest_stable_release_number'])}`
          : firstString(object, ['latest_release_number'])
            ? `Latest release: ${firstString(object, ['latest_release_number'])}`
            : undefined,
        firstString(object, ['description']),
        firstString(object, ['dependent_repos_count']) ? `Dependent repos: ${firstString(object, ['dependent_repos_count'])}` : undefined,
        firstString(object, ['dependents_count']) ? `Dependents: ${firstString(object, ['dependents_count'])}` : undefined,
        firstString(object, ['language']) ? `Language: ${firstString(object, ['language'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['latest_release_published_at']) ? { published_at: firstString(object, ['latest_release_published_at']) } : {}),
      metadata: object,
    };
  }

  if (id === 'dailymed') {
    const setid = firstString(object, ['setid']);
    return {
      title: firstString(object, ['title']) ?? 'DailyMed label',
      url: setid ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setid)}` : source.baseUrl,
      content: [
        firstString(object, ['published_date']) ? `Published: ${firstString(object, ['published_date'])}` : undefined,
        firstString(object, ['spl_version']) ? `SPL version: ${firstString(object, ['spl_version'])}` : undefined,
        setid ? `Set ID: ${setid}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'rxnorm') {
    const properties = Array.isArray(object.conceptProperties)
      ? asRecord(object.conceptProperties[0])
      : undefined;
    const concept = properties ?? object;
    const rxcui = firstString(concept, ['rxcui']);
    return {
      title: firstString(concept, ['name', 'synonym']) ?? 'RxNorm concept',
      url: rxcui ? `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(rxcui)}` : source.baseUrl,
      content: [
        rxcui ? `RxCUI: ${rxcui}` : undefined,
        firstString(concept, ['synonym']) ? `Synonym: ${firstString(concept, ['synonym'])}` : undefined,
        firstString(concept, ['tty']) ? `Term type: ${firstString(concept, ['tty'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'fda-ndc-directory') {
    const ndc = firstString(object, ['product_ndc']);
    return {
      title: firstString(object, ['brand_name']) ?? firstString(object, ['generic_name']) ?? 'FDA NDC product',
      url: source.baseUrl,
      content: [
        ndc ? `Product NDC: ${ndc}` : undefined,
        firstString(object, ['generic_name']) ? `Generic name: ${firstString(object, ['generic_name'])}` : undefined,
        firstString(object, ['labeler_name']) ? `Labeler: ${firstString(object, ['labeler_name'])}` : undefined,
        firstString(object, ['dosage_form']) ? `Dosage form: ${firstString(object, ['dosage_form'])}` : undefined,
        firstString(object, ['marketing_category']) ? `Marketing category: ${firstString(object, ['marketing_category'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'world-bank') {
    const title = firstString(object, ['name']) ?? firstString(object, ['id']);
    const content = [
      firstString(object, ['id']) ? `Country code: ${firstString(object, ['id'])}` : undefined,
      nestedString(object, ['region', 'value']) ? `Region: ${nestedString(object, ['region', 'value'])}` : undefined,
      nestedString(object, ['incomeLevel', 'value']) ? `Income level: ${nestedString(object, ['incomeLevel', 'value'])}` : undefined,
      nestedString(object, ['capitalCity']) ? `Capital: ${nestedString(object, ['capitalCity'])}` : undefined,
    ].filter(Boolean).join('\n');
    return { ...(title ? { title } : {}), url: source.baseUrl, content: content || JSON.stringify(raw).slice(0, 4000), metadata: object };
  }

  if (id === 'treasury-fiscaldata' || id === 'treasurydirect') {
    const date = firstString(object, ['record_date']);
    const security = firstString(object, ['security_desc', 'security_type_desc']);
    const rate = firstString(object, ['avg_interest_rate_amt', 'interest_rate_pct', 'rate']);
    return {
      title: [security, date].filter(Boolean).join(' - ') || 'Treasury data',
      url: source.baseUrl,
      content: [
        date ? `Record date: ${date}` : undefined,
        security ? `Security: ${security}` : undefined,
        rate ? `Rate: ${rate}` : undefined,
        firstString(object, ['record_fiscal_year']) ? `Fiscal year: ${firstString(object, ['record_fiscal_year'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(date ? { published_at: date } : {}),
      metadata: object,
    };
  }

  if (id === 'eurostat') {
    const values = asRecord(object.value);
    const samples = Object.entries(values ?? {}).slice(0, 6).map(([index, value]) => `${index}: ${value}`);
    return {
      title: firstString(object, ['label']) ?? 'Eurostat dataset',
      url: source.baseUrl,
      content: [
        firstString(object, ['label']),
        firstString(object, ['source']) ? `Source: ${firstString(object, ['source'])}` : undefined,
        firstString(object, ['updated']) ? `Updated: ${firstString(object, ['updated'])}` : undefined,
        samples.length ? `Sample values: ${samples.join(', ')}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['updated']) ? { published_at: firstString(object, ['updated']) } : {}),
      metadata: object,
    };
  }

  if (id === 'bis') {
    const title = firstString(object, ['name', 'id']) ?? nestedString(object, ['names', 'en']);
    return {
      title: title ?? 'BIS dataflow',
      url: source.baseUrl,
      content: [
        firstString(object, ['id']) ? `Dataflow ID: ${firstString(object, ['id'])}` : undefined,
        nestedString(object, ['names', 'en']) ?? firstString(object, ['name']),
        firstString(object, ['version']) ? `Version: ${firstString(object, ['version'])}` : undefined,
        firstString(object, ['agencyID']) ? `Agency: ${firstString(object, ['agencyID'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'ilostat') {
    const area = firstString(object, ['ref_area']);
    const indicator = firstString(object, ['indicator']);
    const time = firstString(object, ['time']);
    const value = firstString(object, ['obs_value']);
    return {
      title: [indicator, area, time].filter(Boolean).join(' - ') || 'ILOSTAT observation',
      url: source.baseUrl,
      content: [
        area ? `Reference area: ${area}` : undefined,
        indicator ? `Indicator: ${indicator}` : undefined,
        firstString(object, ['sex']) ? `Sex: ${firstString(object, ['sex'])}` : undefined,
        firstString(object, ['classif1']) ? `Classification: ${firstString(object, ['classif1'])}` : undefined,
        time ? `Time: ${time}` : undefined,
        value ? `Observed value: ${value}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'wto') {
    const indicator = firstString(object, ['Indicator']);
    const reporter = firstString(object, ['ReportingEconomy']);
    const partner = firstString(object, ['PartnerEconomy']);
    const year = firstString(object, ['Year']);
    const value = firstString(object, ['Value']);
    const unit = firstString(object, ['Unit']);
    const product = firstString(object, ['ProductOrSector']);
    return {
      title: [indicator, reporter, year].filter(Boolean).join(' - ') || 'WTO timeseries observation',
      url: source.baseUrl,
      content: [
        indicator ? `Indicator: ${indicator}` : undefined,
        reporter ? `Reporting economy: ${reporter}` : undefined,
        partner ? `Partner economy: ${partner}` : undefined,
        product ? `Product/sector: ${product}` : undefined,
        year ? `Year: ${year}` : undefined,
        value ? `Value: ${value}${unit ? ` ${unit}` : ''}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'openalex') {
    const title = firstString(object, ['display_name', 'title']);
    const authors = authorsList(object.authorships);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['doi', 'id']) ?? source.baseUrl,
      content: [
        authors ? `Authors: ${authors}` : undefined,
        firstString(object, ['publication_year']) ? `Publication year: ${firstString(object, ['publication_year'])}` : undefined,
        firstString(object, ['type']) ? `Type: ${firstString(object, ['type'])}` : undefined,
        firstString(object, ['cited_by_count']) ? `Cited by: ${firstString(object, ['cited_by_count'])}` : undefined,
        openAlexAbstract(object.abstract_inverted_index),
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['publication_date']) ? { published_at: firstString(object, ['publication_date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'crossref') {
    const title = Array.isArray(object.title) ? String(object.title[0] ?? '') : firstString(object, ['title']);
    const container = Array.isArray(object['container-title']) ? String(object['container-title'][0] ?? '') : undefined;
    const year = nestedString(object, ['published-print', 'date-parts']) ?? nestedString(object, ['published-online', 'date-parts']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['URL']) ?? (firstString(object, ['DOI']) ? `https://doi.org/${firstString(object, ['DOI'])}` : source.baseUrl),
      content: [
        container ? `Container: ${container}` : undefined,
        firstString(object, ['publisher']) ? `Publisher: ${firstString(object, ['publisher'])}` : undefined,
        firstString(object, ['DOI']) ? `DOI: ${firstString(object, ['DOI'])}` : undefined,
        year ? `Published: ${year}` : undefined,
        firstString(object, ['abstract']) ? stripMarkup(firstString(object, ['abstract'])!) : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'semantic-scholar') {
    const title = firstString(object, ['title', 'paperId']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['url']) ?? source.baseUrl,
      content: [
        authorsList(object.authors) ? `Authors: ${authorsList(object.authors)}` : undefined,
        firstString(object, ['venue']) ? `Venue: ${firstString(object, ['venue'])}` : undefined,
        firstString(object, ['year']) ? `Year: ${firstString(object, ['year'])}` : undefined,
        firstString(object, ['citationCount']) ? `Citations: ${firstString(object, ['citationCount'])}` : undefined,
        firstString(object, ['abstract']),
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['publicationDate']) ? { published_at: firstString(object, ['publicationDate']) } : {}),
      metadata: object,
    };
  }

  if (id === 'core') {
    const title = firstString(object, ['title', 'id']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['downloadUrl']) ?? (firstString(object, ['doi']) ? `https://doi.org/${firstString(object, ['doi'])}` : source.baseUrl),
      content: [
        authorsList(object.authors) ? `Authors: ${authorsList(object.authors)}` : undefined,
        firstString(object, ['doi']) ? `DOI: ${firstString(object, ['doi'])}` : undefined,
        firstString(object, ['publishedDate']) ? `Published: ${firstString(object, ['publishedDate'])}` : undefined,
        firstString(object, ['abstract']),
      ].filter(Boolean).join('\n').slice(0, 4000) || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'europe-pmc') {
    const title = firstString(object, ['title', 'id']);
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['doi']) ? `https://doi.org/${firstString(object, ['doi'])}` : firstString(object, ['pmid']) ? `https://pubmed.ncbi.nlm.nih.gov/${firstString(object, ['pmid'])}/` : source.baseUrl,
      content: [
        firstString(object, ['authorString']) ? `Authors: ${firstString(object, ['authorString'])}` : undefined,
        firstString(object, ['journalTitle']) ? `Journal: ${firstString(object, ['journalTitle'])}` : undefined,
        firstString(object, ['pubYear']) ? `Year: ${firstString(object, ['pubYear'])}` : undefined,
        firstString(object, ['doi']) ? `DOI: ${firstString(object, ['doi'])}` : undefined,
        firstString(object, ['abstractText']),
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'doaj') {
    const bibjson = asRecord(object.bibjson) ?? object;
    const title = firstString(bibjson, ['title']);
    const journal = nestedString(bibjson, ['journal', 'title']);
    return {
      ...(title ? { title } : {}),
      url: firstString(bibjson, ['link']) ?? source.baseUrl,
      content: [
        journal ? `Journal: ${journal}` : undefined,
        firstString(bibjson, ['year']) ? `Year: ${firstString(bibjson, ['year'])}` : undefined,
        Array.isArray(bibjson.identifier) ? `Identifiers: ${(bibjson.identifier as Array<Record<string, unknown>>).map((entry) => firstString(entry, ['id'])).filter(Boolean).join(', ')}` : undefined,
        firstString(bibjson, ['abstract']),
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      ...(firstString(object, ['created_date']) ? { published_at: firstString(object, ['created_date']) } : {}),
      metadata: object,
    };
  }

  if (id === 'pubmed') {
    const result = asRecord(object.esearchresult);
    const ids = Array.isArray(result?.idlist) ? result.idlist.join(', ') : undefined;
    return {
      title: 'PubMed search results',
      url: source.baseUrl,
      content: [
        firstString(result ?? {}, ['count']) ? `Result count: ${firstString(result ?? {}, ['count'])}` : undefined,
        ids ? `Top PubMed IDs: ${ids}` : undefined,
        firstString(result ?? {}, ['querytranslation']) ? `Query translation: ${firstString(result ?? {}, ['querytranslation'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'orcid') {
    const identifier = asRecord(object['orcid-identifier']);
    const uri = firstString(identifier ?? {}, ['uri']);
    return {
      title: firstString(identifier ?? {}, ['path']) ?? 'ORCID record',
      url: uri ?? source.baseUrl,
      content: [
        uri ? `ORCID: ${uri}` : undefined,
        firstString(identifier ?? {}, ['host']) ? `Host: ${firstString(identifier ?? {}, ['host'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'ror') {
    const names = Array.isArray(object.names) ? object.names as Array<Record<string, unknown>> : [];
    const label = names.find((name) => name.types === undefined || JSON.stringify(name.types).includes('ror_display')) ?? names[0];
    const title = firstString(label ?? {}, ['value']) ?? firstString(object, ['name', 'id']);
    const location = Array.isArray(object.locations) ? asRecord(object.locations[0]) : undefined;
    return {
      ...(title ? { title } : {}),
      url: firstString(object, ['id']) ?? source.baseUrl,
      content: [
        firstString(object, ['id']) ? `ROR ID: ${firstString(object, ['id'])}` : undefined,
        firstString(object, ['established']) ? `Established: ${firstString(object, ['established'])}` : undefined,
        Array.isArray(object.types) ? `Types: ${object.types.join(', ')}` : undefined,
        nestedString(location, ['geonames_details', 'country_name']) ? `Country: ${nestedString(location, ['geonames_details', 'country_name'])}` : undefined,
      ].filter(Boolean).join('\n') || JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'imf') {
    const indicator = Object.keys(asRecord(object.values) ?? {})[0];
    const countries = asRecord(indicator ? nested(object, ['values', indicator]) : undefined);
    const samples = Object.entries(countries ?? {}).slice(0, 5).map(([country, series]) => {
      const values = asRecord(series);
      const latestYear = Object.keys(values ?? {}).sort().at(-1);
      return latestYear ? `${country} ${latestYear}: ${values?.[latestYear]}` : undefined;
    }).filter(Boolean);
    return {
      title: indicator ? `IMF ${indicator}` : 'IMF data',
      url: source.baseUrl,
      content: samples.length ? samples.join('\n') : JSON.stringify(raw).slice(0, 4000),
      metadata: object,
    };
  }

  if (id === 'bls') {
    const rootSeries = Array.isArray(nested(object, ['Results', 'series']))
      ? nested(object, ['Results', 'series']) as Array<Record<string, unknown>>
      : undefined;
    if (rootSeries?.[0]) return mappedItem(rootSeries[0], source);
    const seriesId = firstString(object, ['seriesID']) ?? 'BLS series';
    const data = Array.isArray(object.data) ? object.data as Array<Record<string, unknown>> : [];
    const latest = data[0];
    const content = latest
      ? [`Latest ${seriesId}: ${latest.value}`, `Period: ${latest.periodName ?? latest.period} ${latest.year}`].join('\n')
      : JSON.stringify(raw).slice(0, 4000);
    return { title: seriesId, url: source.baseUrl, content, metadata: object };
  }

  return null;
}

function mapItem(raw: unknown, source: Source): ContentItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const mapped = mappedItem(raw, source);
  if (mapped) return mapped;
  const object = raw as Record<string, unknown>;
  const title = firstString(object, ['title', 'name', 'headline', 'subject']);
  const url = normalizeUrl(firstString(object, ['url', 'link', 'html_url', 'permalink']), source);
  const rawContent =
    firstString(object, ['description', 'summary', 'abstract', 'body', 'content', 'text', 'snippet']) ??
    JSON.stringify(raw).slice(0, 4000);
  const content = rawContent.includes('<') && rawContent.includes('>') ? stripMarkup(rawContent) : rawContent;
  const published_at = firstString(object, ['published_at', 'date', 'created_at', 'timestamp', 'publishedAt']);

  return {
    ...(title ? { title } : {}),
    url,
    content,
    ...(published_at ? { published_at } : {}),
    // TODO: add per-source response mappers for unusual shapes such as price metrics and series APIs.
    metadata: object,
  };
}

export async function fetch(
  source: Source,
  query: ExtractedQuery,
  options?: AdapterOptions,
): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();

  if (source.requires_key && (!source.key_env_var || !process.env[source.key_env_var])) {
    console.warn(`[source-adapters] missing API key for ${source.name}`);
    return { ...emptyResult(source, startedAt, 'missing_api_key', fetchedAt), latency_ms: 0 };
  }

  await respectRateLimit(source);

  if (sourceId(source) === 'chemspider') {
    return fetchChemSpider(source, query, options);
  }
  if (sourceId(source) === 'osv') {
    return fetchOsv(source, query, options);
  }
  if (sourceId(source) === 'anilist') {
    return fetchAniList(source, query, options);
  }
  if (sourceId(source) === 'govinfo') {
    return fetchGovInfo(source, query, options);
  }

  let lastError = 'no_endpoint_attempted';
  for (const endpoint of endpointCandidates(source, query)) {
    const result = await fetchJson(endpoint, source, options?.timeoutMs ?? 10_000);
    if (result.data !== undefined) {
      const rawItems = sourceId(source) === 'pypi' || sourceId(source) === 'openweathermap'
        ? [result.data]
        : extractArray(result.data);
      const sid = sourceId(source);
      const rankedItems = ['polymarket-gamma', 'kalshi', 'manifold-markets'].includes(sid)
        ? rankByQuery(rawItems, query, { requireMatch: sid === 'kalshi' })
        : rawItems;
      const items = rankedItems
        .map((item) => mapItem(item, source))
        .filter((item): item is ContentItem => item !== null)
        .slice(0, options?.maxItems ?? 10);

      return {
        source_id: sourceId(source),
        success: items.length > 0,
        items,
        ...(items.length === 0 ? { error: 'empty_items' } : {}),
        latency_ms: Date.now() - startedAt,
        fetched_at: fetchedAt,
      };
    }
    lastError = result.error ?? `http_${result.status}`;
    if (['auth_failed', 'rate_limited', 'server_error'].includes(lastError)) {
      break;
    }
  }

  return emptyResult(source, startedAt, lastError, fetchedAt);
}
