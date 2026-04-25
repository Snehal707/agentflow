type Obj = Record<string, unknown>;

export type NormalizedReportSource = {
  id: string;
  name: string;
  url: string;
  usedFor?: string;
  canonical: boolean;
};

export type NormalizedClaim = {
  topic: string;
  claim_id: string;
  section:
    | 'current_status'
    | 'reported_developments'
    | 'data_and_statistics'
    | 'analysis'
    | 'risks'
    | 'conclusion';
  entity: string;
  geography?: string;
  route?: 'hormuz' | 'red_sea' | 'suez';
  status: string;
  status_type:
    | 'broader_conflict_status'
    | 'route_status'
    | 'shipping_strike_status'
    | 'diplomatic_status'
    | 'metric'
    | 'development'
    | 'risk'
    | 'general';
  confidence: 'high' | 'medium' | 'low';
  time_ref?: string;
  summary: string;
  evidence_source_ids: string[];
  canonical_url?: string;
  disputed: boolean;
  notes: string[];
};

type FramingSignals = {
  broader_conflict_status?: 'reported_active_war' | 'unclear';
  hormuz_route_status?:
    | 'severely_constrained_with_limited_passage'
    | 'severely_constrained'
    | 'elevated_risk_routes_still_operating'
    | 'unclear';
  red_sea_route_status?:
    | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed'
    | 'direct_shipping_attacks_reported'
    | 'unclear';
  notes?: string[];
  support?: Array<{
    title?: string;
    source_name?: string;
    source_url?: string;
    date_or_period?: string;
  }>;
};

type FinalizeParams = {
  task: string;
  writerMarkdown: string;
  research: Obj | null;
  analysis: Obj | null;
  liveData: Obj | null;
};

type RawClaimState = {
  topic: string;
  sources: ReturnType<typeof createSourceRegistry>;
  rawClaims: NormalizedClaim[];
  issues: string[];
};

type FinalClaimState = {
  topic: string;
  sources: NormalizedReportSource[];
  claims: NormalizedClaim[];
  issues: string[];
};

const asString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const asObject = (value: unknown) =>
  value && typeof value === 'object' ? (value as Obj) : null;
const asArray = <T = unknown>(value: unknown) =>
  Array.isArray(value) ? (value as T[]) : [];

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function asDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : value;
}

function isFutureDateValue(value: string, now = new Date()): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const iso = trimmed.match(/\b(20\d{2})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = iso[3] ? Number(iso[3]) : 1;
    const candidate = Date.UTC(year, month, day);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Number.isFinite(candidate) && candidate > today;
  }

  const monthYear = trimmed.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i,
  );
  if (monthYear) {
    const month = MONTH_INDEX[monthYear[1].toLowerCase()];
    const year = Number(monthYear[2]);
    const candidate = Date.UTC(year, month, 1);
    const currentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return Number.isFinite(candidate) && candidate > currentMonth;
  }

  return false;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isGoogleNewsRssUrl(url: string): boolean {
  return /^https?:\/\/news\.google\.com\/rss\/articles\//i.test(url);
}

function sourcePriority(url: string): number {
  return isGoogleNewsRssUrl(url) ? 1 : 2;
}

function normalizeSourceName(name: string | null, url: string): string {
  const haystack = `${name || ''} ${url}`;
  if (/\bassociated press\b|\bap news\b|apnews\.com/i.test(haystack)) return 'AP News';
  if (/\breuters\b|reuters\.com/i.test(haystack)) return 'Reuters';
  if (/\bbbc\b|bbc\.com|bbc\.co\.uk/i.test(haystack)) return 'BBC News';
  if (/\bcbs news\b|cbsnews\.com/i.test(haystack)) return 'CBS News';
  if (/\bpbs news\b|pbs\.org/i.test(haystack)) return 'PBS News';
  if (/\bnew york times\b|nytimes\.com/i.test(haystack)) return 'The New York Times';
  if (/\bwashington post\b|washingtonpost\.com/i.test(haystack)) return 'The Washington Post';
  if (/\bcnbc\b|cnbc\.com/i.test(haystack)) return 'CNBC';
  if (/\bfinancial times\b|ft\.com/i.test(haystack)) return 'Financial Times';
  if (/\batlantic council\b|atlanticcouncil\.org/i.test(haystack)) return 'Atlantic Council';
  return name || new URL(url).hostname.replace(/^www\./, '');
}

function createSourceRegistry() {
  const byId = new Map<string, NormalizedReportSource>();
  const byKey = new Map<string, string>();

  return {
    add(nameValue: unknown, urlValue: unknown, usedForValue?: unknown): string[] {
      const rawUrl = normalizeUrl(asString(urlValue));
      const rawName = asString(nameValue);
      const usedFor = asString(usedForValue) ?? undefined;
      if (!rawUrl) return [];

      const name = normalizeSourceName(rawName, rawUrl);
      if (
        /\b(firecrawl|gdelt|google news rss|rss|feed|dashboard|scraper|parser|search)\b/i.test(
          name,
        )
      ) {
        return [];
      }

      const key = name.toLowerCase();
      const existingId = byKey.get(key);
      if (existingId) {
        const previous = byId.get(existingId)!;
        if (sourcePriority(rawUrl) > sourcePriority(previous.url)) {
          byId.set(existingId, {
            ...previous,
            url: rawUrl,
            canonical: !isGoogleNewsRssUrl(rawUrl),
            usedFor: previous.usedFor ?? usedFor,
          });
        }
        return [existingId];
      }

      const id =
        key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
        `source-${byId.size + 1}`;
      byId.set(id, {
        id,
        name,
        url: rawUrl,
        usedFor,
        canonical: !isGoogleNewsRssUrl(rawUrl),
      });
      byKey.set(key, id);
      return [id];
    },
    get(id: string) {
      return byId.get(id);
    },
    list() {
      return [...byId.values()]
        .sort((left, right) => sourcePriority(right.url) - sourcePriority(left.url))
        .slice(0, 8);
    },
  };
}

function currentEvents(liveData: Obj | null): Obj | null {
  return asObject(liveData?.current_events);
}

function framingSignals(liveData: Obj | null): FramingSignals | null {
  return (asObject(currentEvents(liveData)?.framing_signals) as FramingSignals | null) || null;
}

function routeFromText(text: string): 'hormuz' | 'red_sea' | 'suez' | undefined {
  if (/\bhormuz|strait of hormuz\b/i.test(text)) return 'hormuz';
  if (/\bred sea\b/i.test(text)) return 'red_sea';
  if (/\bsuez\b/i.test(text)) return 'suez';
  return undefined;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const text = asString(value)?.toLowerCase();
  return text === 'high' || text === 'medium' || text === 'low' ? text : 'medium';
}

function claimId(...parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join('::')
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, '-');
}

function hasSourceEvidence(claim: NormalizedClaim): boolean {
  return claim.evidence_source_ids.length > 0;
}

function parseConflictStatus(text: string):
  | 'reported_active_war'
  | 'inactive_or_unconfirmed_conflict'
  | undefined {
  if (
    /\bno (?:active )?(?:direct )?(?:full[- ]scale )?(?:war|conflict)\b|\bwar (?:is )?not confirmed\b|\bconflict (?:is )?not confirmed\b/i.test(
      text,
    )
  ) {
    return 'inactive_or_unconfirmed_conflict';
  }

  if (
    /\bactive war\b|\bongoing war\b|\bactive conflict\b|\bprotracted conflict\b|\bhostilities\b|\bwar entering\b|\bwar nearing\b|\bwar with iran\b/i.test(
      text,
    )
  ) {
    return 'reported_active_war';
  }

  return undefined;
}

function parseHormuzRouteStatus(text: string):
  | 'fully_blocked'
  | 'severely_constrained_with_limited_passage'
  | 'severely_constrained'
  | 'elevated_risk_routes_still_operating'
  | undefined {
  const severe =
    /\bseverely constrained\b|\bseverely disrupted\b|\bgatekeep\b|\btoll\b|\bvet(?:ting)?\b|\bdetour\b|\bchokehold\b|\bpermission\b|\bcontrol regime\b|\btraffic had fallen\b|\btraffic collapse\b|\beffectively closed\b|\boperational control\b/i.test(
      text,
    );
  const limitedPassage =
    /\blimited passage\b|\blimited transit\b|\bsome transit\b|\bsome vessels\b|\bsuccessful transits?\b|\bgot through\b|\bresum(?:e|ing)\b|\bnon-hostile vessels may transit\b|\beastbound vessel\b|\bships? still moved\b/i.test(
      text,
    );
  const blocked =
    /\bfully blocked\b|\bfully closed\b|\bcompletely blocked\b|\bshut entirely\b|\bno vessels permitted\b/i.test(
      text,
    );
  const elevatedRisk =
    /\belevated risk\b|\bheightened risk\b|\brisk to shipping\b|\bconcerns for shipping\b/i.test(
      text,
    );

  if ((severe || blocked) && limitedPassage) return 'severely_constrained_with_limited_passage';
  if (blocked) return 'fully_blocked';
  if (severe) return 'severely_constrained';
  if (elevatedRisk) return 'elevated_risk_routes_still_operating';
  return undefined;
}

function parseRedSeaStatus(text: string):
  | 'direct_shipping_attacks_reported'
  | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed'
  | undefined {
  const shippingAttack =
    /\bcommercial shipping\b|\bmerchant shipping\b|\bvessels?\b|\btankers?\b|\bshipping routes?\b/i.test(
      text,
    ) &&
    /\battack|strike|missile|drone\b/i.test(text) &&
    !/\bnot confirmed\b|\bconcern\b|\bfear\b|\brisk\b/i.test(text);

  if (shippingAttack) return 'direct_shipping_attacks_reported';

  if (
    /\bhouthi\b|\bmissile\b|\battack\b|\bconcerns?\b|\bfears?\b|\belevated risk\b|\bnot confirmed\b|\brenewed concerns?\b/i.test(
      text,
    )
  ) {
    return 'elevated_risk_latest_direct_shipping_strikes_not_confirmed';
  }

  return undefined;
}

function parseDiplomaticStatus(text: string):
  | 'reported_by_one_side_disputed_by_other'
  | 'reported_diplomatic_development'
  | undefined {
  if (!/\bproposal|talks?|ceasefire|diplomatic|negotiat|warning\b/i.test(text)) {
    return undefined;
  }
  if (/\bdisput|den(y|ied)|reject|rejected|unrealistic\b/i.test(text)) {
    return 'reported_by_one_side_disputed_by_other';
  }
  return 'reported_diplomatic_development';
}

function normalizeDevelopmentSummary(text: string): string {
  const route = routeFromText(text);
  if (route === 'hormuz') {
    if (
      /\btoll\b|\bvet(?:ting)?\b|\bpermission\b|\bdetour\b|\biranian waters\b|\bcontrol\b/i.test(
        text,
      )
    ) {
      return 'Recent reporting described tighter Iranian administrative control over transit through the Strait of Hormuz.';
    }
    return 'Recent reporting described a Hormuz shipping development with route-level consequences.';
  }
  if (route === 'red_sea') {
    if (/\bhouthi\b|\bmissile\b|\battack\b/i.test(text)) {
      return 'Recent reporting described a Red Sea security development that increased concern about shipping risk.';
    }
    return 'Recent reporting described a Red Sea route-risk development.';
  }
  const diplomatic = parseDiplomaticStatus(text);
  if (diplomatic === 'reported_by_one_side_disputed_by_other') {
    return 'A diplomatic claim was reported by one side and disputed or rejected by the other.';
  }
  if (diplomatic === 'reported_diplomatic_development') {
    return 'Recent reporting described a diplomatic development relevant to the conflict.';
  }
  return 'Recent reporting described a topic-relevant development.';
}

function addClaim(map: Map<string, NormalizedClaim>, claim: NormalizedClaim): void {
  const existing = map.get(claim.claim_id);
  if (!existing) {
    map.set(claim.claim_id, claim);
    return;
  }

  const confidenceRank = { low: 1, medium: 2, high: 3 };
  const pickCurrent =
    confidenceRank[claim.confidence] > confidenceRank[existing.confidence] ||
    (!hasSourceEvidence(existing) && hasSourceEvidence(claim));

  map.set(
    claim.claim_id,
    pickCurrent
      ? claim
      : {
          ...existing,
          disputed: existing.disputed || claim.disputed,
          evidence_source_ids: [
            ...new Set([...existing.evidence_source_ids, ...claim.evidence_source_ids]),
          ],
          notes: [...new Set([...existing.notes, ...claim.notes])],
        },
  );
}

function buildRawClaims(params: FinalizeParams): RawClaimState {
  const topic = asString(params.research?.topic) || params.task || 'AgentFlow';
  const sources = createSourceRegistry();
  const rawClaims = new Map<string, NormalizedClaim>();
  const issues: string[] = [];
  const framing = framingSignals(params.liveData);
  const support = asArray<{
    title?: string;
    source_name?: string;
    source_url?: string;
    date_or_period?: string;
  }>(framing?.support);

  const addStructuredClaim = (claim: NormalizedClaim) => addClaim(rawClaims, claim);

  if (framing?.broader_conflict_status === 'reported_active_war') {
    const ids = sources.add(
      support[0]?.source_name,
      support[0]?.source_url,
      support[0]?.title ?? 'Active conflict reporting',
    );
    if (!ids.length) {
      issues.push('Active conflict framing had no canonicalizable source support.');
    } else {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'broader-conflict'),
      section: 'current_status',
      entity: 'Iran and the United States',
      geography: 'Middle East',
      status: 'reported_active_war',
      status_type: 'broader_conflict_status',
      confidence: 'high',
      time_ref: asDate(support[0]?.date_or_period),
      summary: 'Recent strong-source public reporting described the broader conflict as active.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  if (framing?.hormuz_route_status) {
    const ids = sources.add(
      support[1]?.source_name ?? support[0]?.source_name,
      support[1]?.source_url ?? support[0]?.source_url,
      support[1]?.title ?? 'Hormuz route status',
    );
    if (ids.length) {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'hormuz'),
      section: 'current_status',
      entity: 'Commercial shipping',
      geography: 'Strait of Hormuz',
      route: 'hormuz',
      status: framing.hormuz_route_status,
      status_type: 'route_status',
      confidence: 'high',
      time_ref: asDate(support[1]?.date_or_period ?? support[0]?.date_or_period),
      summary:
        framing.hormuz_route_status === 'severely_constrained_with_limited_passage'
          ? 'The Strait of Hormuz is severely disrupted, with limited successful transits still occurring.'
          : framing.hormuz_route_status === 'severely_constrained'
            ? 'The Strait of Hormuz remains severely disrupted in the latest reporting.'
            : 'The Strait of Hormuz faces elevated risk while some route activity continues.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  if (framing?.red_sea_route_status) {
    const redSeaSupport =
      support.find((item) => /\bred sea\b|shipping/i.test(`${item.title || ''}`)) || support[0];
    const ids = sources.add(
      redSeaSupport?.source_name,
      redSeaSupport?.source_url,
      redSeaSupport?.title ?? 'Red Sea route status',
    );
    if (ids.length) {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'red-sea'),
      section: 'current_status',
      entity: 'Commercial shipping',
      geography: 'Red Sea',
      route: 'red_sea',
      status: framing.red_sea_route_status,
      status_type:
        framing.red_sea_route_status === 'direct_shipping_attacks_reported'
          ? 'shipping_strike_status'
          : 'route_status',
      confidence: 'high',
      time_ref: asDate(redSeaSupport?.date_or_period),
      summary:
        framing.red_sea_route_status === 'direct_shipping_attacks_reported'
          ? 'The latest retrieved reporting includes direct attacks on commercial shipping in the Red Sea.'
          : 'Red Sea shipping risk is elevated, but fresh direct strikes on commercial shipping are not confirmed in the latest retrieved reporting.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  for (const entry of asArray(params.research?.facts)) {
    const item = asObject(entry);
    const text = asString(item?.claim);
    if (!item || !text) continue;

    const ids = sources.add(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support ?? item.used_for,
    );
    if (!ids.length) continue;
    const timeRef = asDate(asString(item.date_or_period));
    const confidence = normalizeConfidence(item.confidence);
    const route = routeFromText(text);
    const conflictStatus = parseConflictStatus(text);
    const hormuzStatus = route === 'hormuz' ? parseHormuzRouteStatus(text) : undefined;
    const redSeaStatus = route === 'red_sea' ? parseRedSeaStatus(text) : undefined;
    const diplomaticStatus = parseDiplomaticStatus(text);

    if (conflictStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'broader-conflict', conflictStatus, timeRef),
        section: 'current_status',
        entity: 'Iran and the United States',
        geography: 'Middle East',
        status: conflictStatus,
        status_type: 'broader_conflict_status',
        confidence,
        time_ref: timeRef,
        summary:
          conflictStatus === 'reported_active_war'
            ? 'Recent strong-source public reporting described the broader conflict as active.'
            : 'Some retrieved wording framed the conflict more cautiously or as not fully confirmed.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: conflictStatus !== 'reported_active_war',
        notes: [text],
      });
      continue;
    }

    if (hormuzStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'hormuz', hormuzStatus, timeRef),
        section: 'current_status',
        entity: 'Commercial shipping',
        geography: 'Strait of Hormuz',
        route: 'hormuz',
        status: hormuzStatus,
        status_type: 'route_status',
        confidence,
        time_ref: timeRef,
        summary:
          hormuzStatus === 'severely_constrained_with_limited_passage'
            ? 'Recent reporting described severe disruption in Hormuz while some transit still occurred.'
            : hormuzStatus === 'fully_blocked'
              ? 'Some retrieved wording described Hormuz as fully blocked or fully closed.'
              : hormuzStatus === 'severely_constrained'
                ? 'Recent reporting described severe disruption in Hormuz.'
                : 'Recent reporting described elevated risk in Hormuz while some route activity continued.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: hormuzStatus === 'fully_blocked',
        notes: [text],
      });
      continue;
    }

    if (redSeaStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'red-sea', redSeaStatus, timeRef),
        section: 'current_status',
        entity: 'Commercial shipping',
        geography: 'Red Sea',
        route: 'red_sea',
        status: redSeaStatus,
        status_type:
          redSeaStatus === 'direct_shipping_attacks_reported'
            ? 'shipping_strike_status'
            : 'route_status',
        confidence,
        time_ref: timeRef,
        summary:
          redSeaStatus === 'direct_shipping_attacks_reported'
            ? 'Some retrieved wording described direct attacks on commercial shipping in the Red Sea.'
            : 'Recent reporting described elevated Red Sea route risk without confirming fresh direct strikes on commercial shipping.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: false,
        notes: [text],
      });
      continue;
    }

    if (diplomaticStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'diplomatic', diplomaticStatus, timeRef),
        section: 'reported_developments',
        entity: 'Iran and the United States',
        geography: 'Middle East',
        status: diplomaticStatus,
        status_type: 'diplomatic_status',
        confidence,
        time_ref: timeRef,
        summary:
          diplomaticStatus === 'reported_by_one_side_disputed_by_other'
            ? 'A diplomatic claim was reported by one side and disputed or rejected by the other.'
            : 'Recent reporting described a diplomatic development relevant to the conflict.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: diplomaticStatus === 'reported_by_one_side_disputed_by_other',
        notes: [text],
      });
      continue;
    }
  }

  for (const entry of asArray(params.research?.recent_developments)) {
    const item = asObject(entry);
    const text = asString(item?.event);
    if (!item || !text) continue;

    const ids = sources.add(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support ?? item.importance,
    );
    if (!ids.length) continue;

    addStructuredClaim({
      topic,
      claim_id: claimId(
        topic,
        'development',
        routeFromText(text),
        asDate(asString(item.date_or_period)),
        normalizeDevelopmentSummary(text),
      ),
      section: 'reported_developments',
      entity:
        routeFromText(text) === 'hormuz'
          ? 'Commercial shipping'
          : routeFromText(text) === 'red_sea'
            ? 'Commercial shipping'
            : 'Topic',
      geography:
        routeFromText(text) === 'hormuz'
          ? 'Strait of Hormuz'
          : routeFromText(text) === 'red_sea'
            ? 'Red Sea'
            : undefined,
      route: routeFromText(text),
      status: 'reported',
      status_type: parseDiplomaticStatus(text) ? 'diplomatic_status' : 'development',
      confidence: normalizeConfidence(item.confidence),
      time_ref: asDate(asString(item.date_or_period)),
      summary: normalizeDevelopmentSummary(text),
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: Boolean(parseDiplomaticStatus(text) === 'reported_by_one_side_disputed_by_other'),
      notes: [text],
    });
  }

  for (const entry of asArray(params.research?.metrics)) {
    const item = asObject(entry);
    const name = asString(item?.name);
    const value = asString(item?.value);
    if (!item || !name || !value) continue;

    const ids = sources.add(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support,
    );
    if (!ids.length) continue;

    addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'metric', name, asDate(asString(item.date_or_period))),
      section: 'data_and_statistics',
      entity: name,
      geography: routeFromText(name),
      route: routeFromText(name),
      status: `${value}${asString(item.unit) ? ` ${asString(item.unit)}` : ''}`,
      status_type: 'metric',
      confidence: normalizeConfidence(item.confidence),
      time_ref: asDate(asString(item.date_or_period)),
      summary: `${name}: ${value}${asString(item.unit) ? ` ${asString(item.unit)}` : ''}`,
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [],
    });
  }

  for (const claim of rawClaims.values()) {
    if (!hasSourceEvidence(claim)) {
      issues.push(`Claim ${claim.claim_id} has no source evidence attached.`);
    }
  }

  return { topic, sources, rawClaims: [...rawClaims.values()], issues };
}

function summarizeHormuzStatus(
  status:
    | 'fully_blocked'
    | 'severely_constrained_with_limited_passage'
    | 'severely_constrained'
    | 'elevated_risk_routes_still_operating',
): string {
  switch (status) {
    case 'severely_constrained_with_limited_passage':
      return 'The Strait of Hormuz is severely disrupted, with limited successful transits still occurring.';
    case 'severely_constrained':
      return 'The Strait of Hormuz remains severely disrupted in the latest reporting.';
    case 'fully_blocked':
      return 'Some retrieved wording described the Strait of Hormuz as fully blocked, but that status should only survive if no limited transit evidence exists.';
    default:
      return 'The Strait of Hormuz faces elevated risk while some route activity continues.';
  }
}

function summarizeRedSeaStatus(
  status:
    | 'direct_shipping_attacks_reported'
    | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed',
): string {
  return status === 'direct_shipping_attacks_reported'
    ? 'The latest retrieved reporting includes direct attacks on commercial shipping in the Red Sea.'
    : 'Red Sea shipping risk is elevated, but fresh direct strikes on commercial shipping are not confirmed in the latest retrieved reporting.';
}

export function applySignalGuardrails(rawClaims: NormalizedClaim[]): {
  claims: NormalizedClaim[];
  issues: string[];
} {
  const issues: string[] = [];
  const claimMap = new Map<string, NormalizedClaim>();
  rawClaims.forEach((claim) => addClaim(claimMap, claim));

  const claims = [...claimMap.values()];
  const currentStatusClaims = claims.filter((claim) => claim.section === 'current_status');

  const conflictClaims = currentStatusClaims.filter(
    (claim) => claim.status_type === 'broader_conflict_status',
  );
  const hormuzClaims = currentStatusClaims.filter(
    (claim) => claim.route === 'hormuz' && claim.status_type === 'route_status',
  );
  const redSeaClaims = currentStatusClaims.filter(
    (claim) =>
      claim.route === 'red_sea' &&
      (claim.status_type === 'route_status' || claim.status_type === 'shipping_strike_status'),
  );
  const diplomaticClaims = claims.filter(
    (claim) => claim.status_type === 'diplomatic_status',
  );

  const reconciledClaims: NormalizedClaim[] = [];

  if (conflictClaims.length) {
    const activeClaims = conflictClaims.filter(
      (claim) => claim.status === 'reported_active_war',
    );
    const inactiveClaims = conflictClaims.filter(
      (claim) => claim.status === 'inactive_or_unconfirmed_conflict',
    );
    const sourceClaims = activeClaims.length ? activeClaims : inactiveClaims;
    const best = sourceClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'broader-conflict'),
        summary:
          best.status === 'reported_active_war'
            ? inactiveClaims.length
              ? 'Current strong-source reporting describes the broader conflict as active, even though some retrieved language is more cautious.'
              : 'Recent strong-source public reporting described the broader conflict as active.'
            : 'The current retrieved source set describes the broader conflict cautiously rather than as a clearly active war.',
        disputed: inactiveClaims.length > 0,
        notes: [
          ...new Set([
            ...best.notes,
            ...(inactiveClaims.length > 0 ? ['Retrieved source wording was mixed on conflict-status framing.'] : []),
          ]),
        ],
      });
    }
  }

  if (hormuzClaims.length) {
    const limited = hormuzClaims.some(
      (claim) =>
        claim.status === 'severely_constrained_with_limited_passage' ||
        /limited transit|limited passage|successful transits/i.test(claim.summary),
    );
    const blocked = hormuzClaims.some((claim) => claim.status === 'fully_blocked');
    const severe = hormuzClaims.some(
      (claim) =>
        claim.status === 'severely_constrained' ||
        claim.status === 'severely_constrained_with_limited_passage' ||
        claim.status === 'fully_blocked',
    );
    const elevated = hormuzClaims.some(
      (claim) => claim.status === 'elevated_risk_routes_still_operating',
    );
    const best = hormuzClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    let status:
      | 'fully_blocked'
      | 'severely_constrained_with_limited_passage'
      | 'severely_constrained'
      | 'elevated_risk_routes_still_operating';

    if (limited && severe) status = 'severely_constrained_with_limited_passage';
    else if (blocked && !limited) status = 'fully_blocked';
    else if (severe) status = 'severely_constrained';
    else status = elevated ? 'elevated_risk_routes_still_operating' : 'severely_constrained';

    if (status === 'fully_blocked') {
      issues.push('Hormuz reconciliation resolved to fully blocked because no limited-transit evidence was present.');
    }

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'hormuz'),
        status,
        summary:
          status === 'fully_blocked' && limited
            ? summarizeHormuzStatus('severely_constrained_with_limited_passage')
            : summarizeHormuzStatus(status),
        disputed: blocked && limited,
        notes: [
          ...new Set([
            ...best.notes,
            ...(blocked && limited
              ? ['Blocked-route wording was reconciled against limited-transit evidence.']
              : []),
          ]),
        ],
      });
    }
  }

  if (redSeaClaims.length) {
    const direct = redSeaClaims.some(
      (claim) => claim.status === 'direct_shipping_attacks_reported',
    );
    const riskOnly = redSeaClaims.some(
      (claim) =>
        claim.status === 'elevated_risk_latest_direct_shipping_strikes_not_confirmed' ||
        /not confirmed|elevated risk/i.test(claim.summary),
    );
    const best = redSeaClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    const status =
      direct && !riskOnly
        ? 'direct_shipping_attacks_reported'
        : 'elevated_risk_latest_direct_shipping_strikes_not_confirmed';

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'red-sea'),
        status,
        status_type:
          status === 'direct_shipping_attacks_reported'
            ? 'shipping_strike_status'
            : 'route_status',
        summary: summarizeRedSeaStatus(status),
        disputed: direct && riskOnly,
        notes: [
          ...new Set([
            ...best.notes,
            ...(direct && riskOnly
              ? ['Direct-attack wording was downgraded because the latest retrieved evidence only supports elevated risk.']
              : []),
          ]),
        ],
      });
    }
  }

  if (diplomaticClaims.length) {
    const disputed = diplomaticClaims.some((claim) => claim.disputed);
    const best = diplomaticClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];
    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'diplomatic'),
        summary: disputed
          ? 'A diplomatic claim was reported by one side and disputed or rejected by the other.'
          : 'Recent reporting described a diplomatic development relevant to the conflict.',
        disputed,
      });
    }
  }

  const finalClaims = [
    ...claims.filter((claim) => claim.section !== 'current_status'),
    ...reconciledClaims,
  ];

  for (const claim of finalClaims) {
    if (
      claim.status_type === 'broader_conflict_status' &&
      claim.status === 'inactive_or_unconfirmed_conflict' &&
      conflictClaims.some((entry) => entry.status === 'reported_active_war')
    ) {
      issues.push('Active-conflict evidence was present alongside inactive-conflict wording.');
    }
    if (
      claim.route === 'hormuz' &&
      claim.status_type === 'route_status' &&
      claim.status === 'fully_blocked' &&
      hormuzClaims.some((entry) =>
        /limited transit|limited passage|successful transits/i.test(entry.summary),
      )
    ) {
      issues.push('Hormuz route remained fully blocked after limited-transit evidence was retrieved.');
    }
    if (
      claim.route === 'red_sea' &&
      claim.status === 'direct_shipping_attacks_reported' &&
      redSeaClaims.some((entry) => /not confirmed/i.test(entry.summary))
    ) {
      issues.push('Red Sea route remained in confirmed-strike mode even though the latest retrieved evidence only supports elevated risk.');
    }
  }

  return { claims: finalClaims, issues };
}

function buildFinalState(params: FinalizeParams): FinalClaimState {
  const raw = buildRawClaims(params);
  const guarded = applySignalGuardrails(raw.rawClaims);
  const sources = raw.sources.list();
  const issues = [...raw.issues, ...guarded.issues];

  for (const claim of guarded.claims) {
    if (!hasSourceEvidence(claim)) {
      issues.push(`Final claim ${claim.claim_id} has no source evidence attached.`);
    }
  }

  return {
    topic: raw.topic,
    sources,
    claims: guarded.claims,
    issues: [...new Set(issues)],
  };
}

function sourceNote(
  sourceMap: Map<string, NormalizedReportSource>,
  sourceIds: string[],
  timeRef?: string,
): string {
  const source = sourceIds[0] ? sourceMap.get(sourceIds[0]) : undefined;
  return source ? `${source.name}${timeRef ? `, ${timeRef}` : ''}` : '';
}

function buildExecutiveSummary(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));

  if (conflict) {
    const note = sourceNote(sourceMap, conflict.evidence_source_ids, conflict.time_ref);
    sentences.push(
      sentence(
        `${conflict.summary.replace(/\.$/, '')}${note ? ` (${note})` : ''}`,
      ),
    );
  }
  if (hormuz) sentences.push(sentence(hormuz.summary));
  if (redSea) sentences.push(sentence(redSea.summary));

  return sentences.length
    ? sentences.join(' ')
    : 'The latest retrieved source set is too thin to support a confident executive summary.';
}

function buildCurrentStatusSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const preferred = claims
    .filter((claim) => claim.section === 'current_status' && claim.claim_id.includes('reconciled::'))
    .slice(0, 5);

  return preferred.length
    ? preferred
        .map((claim) => {
          const note = sourceNote(sourceMap, claim.evidence_source_ids, claim.time_ref);
          return `- ${claim.summary.replace(/\.$/, '')}${note ? ` (${note})` : ''}`;
        })
        .join('\n')
    : '- The current retrieved source set did not produce enough dated status evidence to render this section confidently.';
}

function buildReportedDevelopmentsSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const developments = claims
    .filter((claim) => claim.section === 'reported_developments')
    .slice(0, 3);

  if (!developments.length) {
    return 'The latest retrieved source set does not provide enough dated developments to expand this section confidently.';
  }

  return developments
    .map((claim) => {
      const source = claim.evidence_source_ids[0]
        ? sourceMap.get(claim.evidence_source_ids[0])
        : undefined;
      return sentence(
        `${source?.name || 'A current source'} reported${claim.time_ref ? ` on ${claim.time_ref}` : ''} that ${claim.summary
          .replace(/\.$/, '')
          .charAt(0)
          .toLowerCase()}${claim.summary.replace(/\.$/, '').slice(1)}`,
      );
    })
    .join(' ');
}

function buildMetricsSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const metrics = claims.filter((claim) => claim.status_type === 'metric').slice(0, 5);
  if (!metrics.length) {
    return '- Exact quantitative metrics are limited in the current retrieved source set.';
  }

  return metrics
    .map((claim) => {
      const note = sourceNote(sourceMap, claim.evidence_source_ids, claim.time_ref);
      return `- **${claim.entity}**: ${claim.status}${note ? ` (${note})` : ''}`;
    })
    .join('\n');
}

function buildAnalysisSection(claims: NormalizedClaim[]): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));
  const insuranceMetric = claims.some(
    (claim) => claim.status_type === 'metric' && /insurance/i.test(claim.entity),
  );

  if (conflict && hormuz) {
    sentences.push(
      'The current source set supports separating broader conflict status from route status: the broader conflict is active, while Hormuz is best described as severely disrupted with limited successful transit rather than either fully normal or fully blocked.',
    );
  }

  if (redSea) {
    sentences.push(
      /not confirmed/i.test(redSea.summary)
        ? 'For the Red Sea, the strongest investor-grade framing is elevated route risk and renewed concern, not a confirmed fresh wave of commercial-shipping strikes.'
        : 'For the Red Sea, the current retrieved reporting supports direct commercial-shipping attack language.',
    );
  }

  if (!insuranceMetric) {
    sentences.push(
      'The current retrieved source set does not quantify insurance spikes or broad freight dislocation, so those effects should be treated as plausible but unquantified rather than confirmed.',
    );
  }

  return sentences.map(sentence).join(' ');
}

function buildRisksSection(claims: NormalizedClaim[]): string {
  const lines: string[] = [];
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));
  const diplomatic = claims.find((claim) => claim.claim_id.includes('reconciled::diplomatic'));

  if (hormuz) {
    lines.push(
      '- The main Hormuz uncertainty is whether severe disruption persists or limited successful transits expand.',
    );
  }

  if (redSea) {
    lines.push(
      /not confirmed/i.test(redSea.summary)
        ? '- The main Red Sea uncertainty is whether elevated route risk turns into confirmed fresh attacks on commercial shipping.'
        : '- Red Sea route risk remains materially elevated because direct attacks on commercial shipping have been reported.',
    );
  }

  if (diplomatic?.disputed) {
    lines.push(
      '- Diplomatic claims remain contested, so de-escalation language should be treated cautiously.',
    );
  }

  return lines.length
    ? lines.join('\n')
    : '- The current retrieved source set remains mixed enough that status should be monitored closely for change.';
}

function buildConclusionSection(claims: NormalizedClaim[]): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));

  if (conflict) {
    sentences.push(
      conflict.status === 'reported_active_war'
        ? 'The broader conflict should be treated as active in the current public reporting set.'
        : 'The broader conflict should be described cautiously rather than overstated.',
    );
  }

  if (hormuz) {
    sentences.push(
      'Hormuz is best described as severely disrupted, with limited successful transits, rather than as fully normal or fully blocked.',
    );
  }

  if (redSea) {
    sentences.push(
      /not confirmed/i.test(redSea.summary)
        ? 'The biggest near-term uncertainty is whether elevated Red Sea risk becomes confirmed fresh commercial-shipping disruption.'
        : 'The biggest near-term uncertainty is how long direct Red Sea shipping-attack risk remains elevated.',
    );
  }

  return sentences.map(sentence).join(' ');
}

function buildSourcesSection(sources: NormalizedReportSource[]): string {
  return sources.length
    ? sources
        .map((source) => `- ${source.name}: ${source.url}${source.usedFor ? ` - ${source.usedFor}` : ''}`)
        .join('\n')
    : '- Source URLs unavailable in the current retrieved set.';
}

function sanitizeWriterMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized || /writer agent returned no markdown output/i.test(normalized)) {
    return '';
  }

  const withoutBlockedQuotes = normalized
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!withoutBlockedQuotes) {
    return '';
  }

  return withoutBlockedQuotes.trim();
}

export function buildCurrentEventReportMarkdown(state: FinalClaimState): string {
  const sourceMap = new Map(state.sources.map((source) => [source.id, source]));

  return [
    `# ${state.topic}`,
    '',
    '## Summary',
    '',
    buildExecutiveSummary(state.claims, sourceMap),
    '',
    '## Current Situation',
    '',
    buildCurrentStatusSection(state.claims, sourceMap),
    '',
    '## Key Evidence',
    '',
    buildReportedDevelopmentsSection(state.claims, sourceMap),
    '',
    '## Evidence and Data',
    '',
    buildMetricsSection(state.claims, sourceMap),
    '',
    '## Implications',
    '',
    buildAnalysisSection(state.claims),
    '',
    '## Risks and Unknowns',
    '',
    buildRisksSection(state.claims),
    '',
    '## Sources',
    '',
    buildSourcesSection(state.sources),
    '',
    '## Takeaway',
    '',
    buildConclusionSection(state.claims),
  ].join('\n').trim();
}

export function buildGeneralReportMarkdown(state: FinalClaimState): string {
  const sourceMap = new Map(state.sources.map((source) => [source.id, source]));
  const keyFacts = state.claims
    .filter(
      (claim) =>
        claim.section === 'reported_developments' || claim.section === 'data_and_statistics',
    )
    .slice(0, 5);

  return [
    `# ${state.topic}`,
    '',
    '## Overview',
    '',
    buildExecutiveSummary(state.claims, sourceMap),
    '',
    '## Key Evidence',
    '',
    keyFacts.length
      ? keyFacts.map((claim) => `- ${claim.summary}`).join('\n')
      : '- The current retrieved source set is limited.',
    '',
    '## What Changed',
    '',
    buildReportedDevelopmentsSection(state.claims, sourceMap),
    '',
    '## Evidence and Data',
    '',
    buildMetricsSection(state.claims, sourceMap),
    '',
    '## Why It Matters',
    '',
    buildAnalysisSection(state.claims),
    '',
    '## Risks and Tradeoffs',
    '',
    buildRisksSection(state.claims),
    '',
    '## Sources',
    '',
    buildSourcesSection(state.sources),
    '',
    '## Takeaway',
    '',
    buildConclusionSection(state.claims),
  ].join('\n').trim();
}

function duplicateNarrativeIssues(markdown: string): string[] {
  const issues: string[] = [];
  const narrativeLines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^#/.test(line) &&
        !/^\*\*Prepared by:\*\*/.test(line) &&
        !/^- /.test(line) &&
        !/^## /.test(line),
    );

  const counts = new Map<string, number>();
  for (const line of narrativeLines) {
    const key = line.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [line, count] of counts.entries()) {
    if (count > 1) {
      issues.push(`Repeated narrative line detected: "${line}"`);
    }
  }

  return issues;
}

export function collectPreferredReportSources(params: {
  research: Obj | null;
  liveData: Obj | null;
}): NormalizedReportSource[] {
  return buildFinalState({
    task: asString(params.research?.topic) || 'AgentFlow',
    writerMarkdown: '',
    research: params.research,
    analysis: null,
    liveData: params.liveData,
  }).sources;
}

export function validateReportMarkdown(markdown: string, liveData: Obj | null): string[] {
  const framing = framingSignals(liveData);
  const issues: string[] = [];
  const futureMatches = [
    ...markdown.matchAll(/\b20\d{2}-\d{2}(?:-\d{2})?\b/g),
    ...markdown.matchAll(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/gi,
    ),
  ]
    .map((match) => match[0])
    .filter((value) => isFutureDateValue(value));

  for (const value of [...new Set(futureMatches)]) {
    issues.push(`Report references future date "${value}".`);
  }

  if (/\b(Firecrawl|GDELT|current_events Article|Google News RSS)\b/i.test(markdown)) {
    issues.push('Report cites retrieval tooling instead of public source names.');
  }

  if (!asObject(liveData?.coingecko) && /\bCoinGecko\b/i.test(markdown)) {
    issues.push('Report cites CoinGecko even though CoinGecko data was not retrieved.');
  }

  if (
    framing?.broader_conflict_status === 'reported_active_war' &&
    /\bno (?:active )?(?:direct )?(?:full[- ]scale )?(?:war|conflict) (?:is|was|exists|existed)?\s*(?:confirmed|according to|reported)?\b/i.test(markdown)
  ) {
    issues.push(
      'Report says the conflict is inactive even though current sources describe it as active.',
    );
  }

  if (
    framing?.red_sea_route_status ===
      'elevated_risk_latest_direct_shipping_strikes_not_confirmed' &&
    /\b(?:fresh|new|direct)\s+(?:shipping|commercial shipping)\s+strikes?\s+(?:are|were|remain)?\s*confirmed\b/i.test(
      markdown,
    )
  ) {
    issues.push(
      'Report confirms a shipping strike where sources only support elevated risk.',
    );
  }

  if (
    framing?.hormuz_route_status === 'severely_constrained_with_limited_passage' &&
    /\b(?:is|are|remains?)\s+(?:fully|completely)\s+(?:blocked|closed)\b/i.test(markdown)
  ) {
    issues.push(
      'Report says a route is fully blocked even though sources support severe disruption with limited transit.',
    );
  }

  if (/\bnot confirmed\b[^.\n]*\bbut confirmed\b/i.test(markdown)) {
    issues.push('Report contains a contradictory double-negation phrase.');
  }

  if (/\binsurance spikes?\s+(?:are|were|remain|have been)\b/i.test(markdown)) {
    issues.push('Report states insurance spikes as confirmed without checking source-backed metrics.');
  }

  return [...new Set([...issues, ...duplicateNarrativeIssues(markdown)])];
}

function isBlockingValidationIssue(issue: string): boolean {
  return (
    /future date/i.test(issue) ||
    /retrieval tooling/i.test(issue) ||
    /CoinGecko data was not retrieved/i.test(issue) ||
    /conflict is inactive/i.test(issue) ||
    /shipping strike/i.test(issue) ||
    /fully blocked/i.test(issue) ||
    /insurance spikes/i.test(issue)
  );
}

export function finalizeReportMarkdown(params: FinalizeParams): {
  markdown: string;
  sources: NormalizedReportSource[];
  validationIssues: string[];
  claims: NormalizedClaim[];
} {
  const state = buildFinalState(params);
  const fallbackMarkdown = currentEvents(params.liveData)
    ? buildCurrentEventReportMarkdown(state)
    : buildGeneralReportMarkdown(state);
  const writerMarkdown = sanitizeWriterMarkdown(params.writerMarkdown);
  const writerValidationIssues = writerMarkdown
    ? validateReportMarkdown(writerMarkdown, params.liveData)
    : [];
  const shouldUseFallback =
    !writerMarkdown || writerValidationIssues.some(isBlockingValidationIssue);
  const markdown = shouldUseFallback ? fallbackMarkdown : writerMarkdown;
  const validationIssues = shouldUseFallback
    ? [...new Set([...state.issues, ...validateReportMarkdown(markdown, params.liveData)])]
    : [
        ...new Set([
          ...state.issues,
          ...writerValidationIssues,
          ...validateReportMarkdown(markdown, params.liveData),
        ]),
      ];

  return {
    markdown,
    sources: state.sources,
    validationIssues,
    claims: state.claims,
  };
}
