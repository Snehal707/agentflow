const MOJIBAKE_MARKERS = [
  'â€',
  'â€™',
  'â€˜',
  'â€œ',
  'â€\x9d',
  'â€"',
  'â€\x90',
  '\u00E2\u20AC\u2011',
  'â€¢',
  'â€¦',
  'â€“',
  'â€”',
  'Ã',
  'Â',
  '�',
];

const LANGUAGE_CHROME_TOKENS = [
  'english',
  'deutsch',
  'español',
  'espanol',
  'français',
  'francais',
  'italiano',
  'português',
  'portugues',
  'nederlands',
  'svenska',
  'dansk',
  'suomi',
  'čeština',
  'cymraeg',
  'filipino',
  'euskara',
  'galego',
  'hrvatski',
  'magyar',
  'latviešu',
  'lietuvių',
  'polski',
  'română',
  'slovenčina',
  'slovenščina',
  'srpski',
  'türkçe',
  'ελληνικά',
  'uk',
  'united kingdom',
  'united states',
  'all languages',
];

const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€œ/g, '"'],
  [/â€\x9d/g, '"'],
  [/â€"/g, '—'],
  [/â€\x90/g, '‐'],
  [/\u00E2\u20AC\u2011/g, '‑'],
  [/â€¢/g, '•'],
  [/â€”/g, '—'],
  [/â€“/g, '–'],
  [/â€¦/g, '…'],
  [/Ã©/g, 'é'],
  [/Ã¨/g, 'è'],
  [/Ã /g, 'à'],
  [/Ã³/g, 'ó'],
  [/Ã­/g, 'í'],
  [/Ãº/g, 'ú'],
  [/Ã±/g, 'ñ'],
  [/Â\u00A0/g, ' '],
  [/\u00A0/g, ' '],
  [/Â(?=[^\p{L}\p{N}\s])/gu, ''],
];

function applyKnownMojibakeReplacements(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function mojibakeScore(text: string): number {
  return MOJIBAKE_MARKERS.reduce((score, marker) => {
    let idx = text.indexOf(marker);
    while (idx !== -1) {
      score += 1;
      idx = text.indexOf(marker, idx + marker.length);
    }
    return score;
  }, 0);
}

function maybeRepairDoubleEncoding(text: string): string {
  try {
    const candidate = Buffer.from(text, 'latin1').toString('utf8');
    if (!candidate || candidate === text) {
      return text;
    }
    return mojibakeScore(candidate) < mojibakeScore(text) ? candidate : text;
  } catch {
    return text;
  }
}

export function repairMojibake(text: string): string {
  if (!text) return text;
  let normalized = text
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '');
  normalized = applyKnownMojibakeReplacements(normalized);
  normalized = maybeRepairDoubleEncoding(normalized);
  normalized = applyKnownMojibakeReplacements(normalized);
  return normalized;
}

function shouldDropChromeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  const languageHits = LANGUAGE_CHROME_TOKENS.filter((token) => lower.includes(token)).length;
  if (languageHits >= 4) return true;

  const countryCodeHits = (trimmed.match(/\b[A-Z]{2}\b/g) ?? []).length;
  if (countryCodeHits >= 5) return true;

  const policyHits = ['cookie', 'privacy policy', 'accept all', 'reject all', 'manage preferences']
    .filter((token) => lower.includes(token)).length;
  if (policyHits >= 2) return true;

  return false;
}

export function stripObviousSourceChrome(text: string): string {
  if (!text) return text;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !shouldDropChromeLine(line));
  return lines.join('\n').trim();
}

export function normalizeSourceText(
  text: string,
  options?: { stripChrome?: boolean; collapseWhitespace?: boolean },
): string {
  if (!text) return text;
  let normalized = repairMojibake(text);
  if (options?.stripChrome) {
    normalized = stripObviousSourceChrome(normalized);
  }
  if (options?.collapseWhitespace) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }
  return normalized;
}

function extractCharset(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset=([^;]+)/i);
  return match?.[1]?.trim().replace(/^"|"$/g, '').toLowerCase() || null;
}

function extractXmlCharset(buffer: Buffer): string | null {
  const prefix = buffer.subarray(0, 512).toString('latin1');
  const match = prefix.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  return match?.[1]?.trim().toLowerCase() || null;
}

function decodeBuffer(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder(label as any, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

export async function decodeTextResponse(response: Response): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  const headerCharset = extractCharset(response.headers.get('content-type'));
  const xmlCharset = extractXmlCharset(buffer);
  const declared = xmlCharset || headerCharset || 'utf-8';

  let text = decodeBuffer(buffer, declared);
  if (!headerCharset || /^(iso-8859-1|latin1|windows-1252)$/i.test(declared)) {
    const utf8Candidate = decodeBuffer(buffer, 'utf-8');
    if (mojibakeScore(utf8Candidate) < mojibakeScore(text)) {
      text = utf8Candidate;
    }
  }
  return repairMojibake(text);
}

export function hasMojibakeMarkers(text: string): boolean {
  return MOJIBAKE_MARKERS.some((marker) => text.includes(marker));
}
