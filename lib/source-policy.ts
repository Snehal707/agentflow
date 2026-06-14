export type SourceLike = {
  domain?: string;
  url: string;
  title?: string;
  summary?: string;
  publisher?: string;
};

export function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isPredictionMarketResearchTask(task: string): boolean {
  return /\bprediction market\b/i.test(task);
}

export function isCreatorAudienceMetricTask(task: string): boolean {
  return (
    /\b(subscribers?|followers?|views?|audience|reach)\b/i.test(task) &&
    /\b(youtube|channel|creator|streamer|influencer|tiktok|instagram|x|twitter|mrbeast)\b/i.test(task)
  );
}

export function asksForCommunityEvidence(task: string): boolean {
  return /\b(reddit|community|sentiment|opinion|discussion|people think)\b/i.test(task);
}

export function isOfficialCreatorPlatformUrl(url: string): boolean {
  return /youtube\.com\/(?:@|channel\/|c\/|user\/)/i.test(url);
}

export function isLowValueSocialSourceUrl(url: string): boolean {
  const normalized = url.toLowerCase();

  if (
    (/^https?:\/\/(?:m\.)?(?:www\.)?facebook\.com\//.test(normalized) ||
      /^https?:\/\/(?:www\.)?fb\.com\//.test(normalized)) &&
    /\/groups\/|\/posts\/|\/permalink\.php|\/story\.php|\/photo\.php/.test(normalized)
  ) {
    return true;
  }

  if (
    /^https?:\/\/(?:www\.)?instagram\.com\//.test(normalized) &&
    /\/(?:p|reel|reels|tv|stories)\//.test(normalized)
  ) {
    return true;
  }

  return false;
}

export function isLowValueVideoUrl(url: string): boolean {
  return /youtube\.com\/watch\?/i.test(url);
}

export function isCircularResearchSourceUrl(task: string, url: string): boolean {
  return isPredictionMarketResearchTask(task) && /prediction\.achswap\.app/i.test(url);
}

export function isAuthoritativeSportsEvidenceUrl(url: string, publisher?: string): boolean {
  const haystack = `${publisher || ''} ${url}`.toLowerCase();
  return /\b(uefa\.com|olympics\.com|opta analyst|theanalyst\.com|givemesport|goal\.com|espn|bbc|sky sports|the athletic)\b/.test(
    haystack,
  );
}

export function isLowValueSourceForTask(task: string, source: SourceLike): boolean {
  const domain = (source.domain || sourceHostname(source.url)).toLowerCase();
  const url = source.url.toLowerCase();
  const haystack = `${source.title || ''} ${source.summary || ''} ${source.publisher || ''} ${source.url}`.toLowerCase();

  if (isCircularResearchSourceUrl(task, url)) return true;
  if (isLowValueSocialSourceUrl(url)) return true;

  if (isCreatorAudienceMetricTask(task)) {
    const allowedCreatorMetricSource =
      /\b(socialcounts\.org|livecounts\.io|socialblade\.com|viewstats\.com|kalshi\.com)\b/.test(haystack) ||
      isOfficialCreatorPlatformUrl(source.url);
    if (!allowedCreatorMetricSource) {
      return true;
    }
  }

  if (/\byoutube\.com\b|\byoutu\.be\b/.test(domain)) {
    if (isCreatorAudienceMetricTask(task) && isOfficialCreatorPlatformUrl(source.url)) {
      return false;
    }
    return true;
  }

  if (!asksForCommunityEvidence(task) && /\breddit\.com\b/.test(domain)) return true;
  if (/\/square\/post\//i.test(url)) return true;
  if (/pdf\.js\/web\/viewer\.html|(?:login|signout).*[?&](?:source|redirect|url)=/i.test(url)) {
    return true;
  }
  if (/\b(xaut|tether[- ]gold)\b/i.test(task)) {
    if (/\btp-link\b/i.test(haystack)) return true;
    if (!/\b(xaut|tether[- ]gold|gold-backed|tokenized gold|gold price)\b/i.test(haystack)) {
      return true;
    }
  }
  // For a price-target prediction market ("will X reach $Y by <date>"), forecast and
  // price-prediction analysis from reputable platforms IS the evidence a bettor needs —
  // do not blanket-drop it (that previously left only CoinGecko). Still drop forecast
  // spam from low-quality domains.
  const isPriceTargetMarket =
    isPredictionMarketResearchTask(task) && /\b(price|market cap|valuation|target|reach|hit)\b/i.test(task);
  const mentionsForecast = /\b(?:kaufen|kurs|price prediction|predictions?|forecast|outlook)\b/i.test(haystack);
  if (
    isPredictionMarketResearchTask(task) &&
    /\b(price|market cap|valuation|target)\b/i.test(task) &&
    /\b(price prediction|forecast|predictions?|outlook)\b/i.test(haystack) &&
    !isReputableForecastSource(domain)
  ) {
    return true;
  }
  if (/\bbitcoin\.de\b|\bbisonapp\.com\b/i.test(domain)) return true;
  if (mentionsForecast) {
    if (isPriceTargetMarket && isReputableForecastSource(domain)) {
      return false;
    }
    return true;
  }

  return false;
}

const REPUTABLE_FORECAST_DOMAINS =
  /\b(?:coinbase|kraken|binance|kucoin|crypto\.com|gemini|bitstamp|okx|bybit|coindesk|cointelegraph|theblock|decrypt|messari|coinmarketcap|coingecko|tradersunion|changelly|weareblox|forbes|bloomberg|reuters|cnbc|wsj|ft\.com|financialtimes|investing\.com|nasdaq|marketwatch|benzinga|yahoo)\b/i;

function isReputableForecastSource(domain: string): boolean {
  return REPUTABLE_FORECAST_DOMAINS.test(domain);
}

export function sourcePriority(url: string, name?: string): number {
  if (/^https?:\/\/news\.google\.com\/rss\/articles\//i.test(url)) return 1;
  const host = sourceHostname(url);
  const haystack = `${name || ''} ${host} ${url}`.toLowerCase();
  let score = 20;

  if (/\b(coingecko|defillama|coinmarketcap)\b/.test(haystack)) score += 45;
  if (/\bmempool\.space\b/.test(haystack)) score += 45;
  if (/\b(reuters|apnews|bbc|cnbc|financialtimes|ft\.com|bloomberg|wsj|coindesk|theblock)\b/.test(haystack)) score += 40;
  if (/\bbitcoin\.org\b|\bethereum\.org\b|\bdocs\./.test(haystack)) score += 25;
  if (host.endsWith('.gov') || host.endsWith('.edu')) score += 35;

  if (/\bwikipedia\.org\b/.test(haystack)) score -= 18;
  if (/\byoutube\.com\b|\byoutu\.be\b/.test(haystack)) {
    score -= isOfficialCreatorPlatformUrl(url) ? 8 : 28;
  }
  if (/\b(?:kaufen|kurs|price prediction|predictions?|forecast|outlook)\b/i.test(haystack)) score -= 12;
  if (/(^|\.)bitcoin\.(de|at|ch)$/.test(host) || /\bbisonapp\.com\b/.test(host)) score -= 18;

  return score;
}
