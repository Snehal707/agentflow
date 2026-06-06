# Source Expansion Intake

Last updated: 2026-05-23

Purpose: intake the large master list safely. Do not add sources directly to `data/source-registry.json` just because they are on the list. A source moves into the production registry only after its endpoint/feed/scrape target is verified and the method is clear.

## Intake Rules

1. Prefer no-key APIs for factual data and metrics.
2. Prefer RSS or RSS-plus-scrape for fresh articles.
3. Use scrape only with narrow, human-readable pages, not broad homepages when a better section/report URL exists.
4. Do not mark a paid/trial/enterprise API as `official_api`.
5. Key-limited APIs go into the key backlog, not the no-key backlog.
6. JS-heavy dashboards and anti-bot sites stay as candidates until Firecrawl returns useful markdown.

## Batch 1: Crypto/Web3 No-Key API Candidates

These were cross-checked with live endpoint tests on 2026-05-23. They are good candidates to add or keep as `official_api` without asking the user for keys.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| CoinCodex | `https://coincodex.com/api/v1/assets/get_asset?symbol=BTC` | `200`, JSON asset data | Add as no-key `official_api` if not already in registry. |
| Mempool.space | `https://mempool.space/api/v1/fees/recommended` | `200`, JSON fee data | Add as no-key `official_api`. |
| Blockstream API | `https://blockstream.info/api/blocks/tip/height` | `200`, text/number response | Add as no-key `official_api`; adapter text fallback is enough for simple facts. |
| Blockchain.com Explorer | `https://blockchain.info/latestblock` | `200`, JSON latest-block data | Add as no-key `official_api`. |
| Crypto Fear & Greed Index | `https://api.alternative.me/fng/?limit=1` | `200`, JSON sentiment index | Add as no-key `official_api`. |
| GMX stats | `https://gmx-server-mainnet.uw.r.appspot.com/tokens` | `200`, JSON token/market data | Add as no-key `official_api`, but endpoint is unofficial/app backend; lower authority. |
| LI.FI API | `https://li.quest/v1/chains` | `200`, JSON supported chains | Add as no-key `official_api`. |

## Batch 1: Crypto/Web3 Needs More Work

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| Bitnodes | `https://bitnodes.io/api/v1/snapshots/latest/` | Node fetch failed locally despite public docs. | Re-test via browser/PowerShell; likely no-key API but not production-ready yet. |
| dYdX public API | `https://indexer.dydx.trade/v4/markets` | `404`, endpoint candidate wrong. | Find current indexer endpoint before adding. |
| Socket | `https://api.socket.tech/v2/supported/chains` | `401`, API key required. | Move to key-limited backlog, not no-key. |

## Batch 1: Crypto/Web3 Scrape Candidates

These are free web/report sources from the master list. They should be added only after Firecrawl returns useful markdown from a narrow URL.

| Source | Suggested target | Method candidate | Notes |
| --- | --- | --- | --- |
| BitInfoCharts | `https://bitinfocharts.com/` | `scrape` | Public charts/tables; verify content quality per metric page. |
| Etherchain | `https://www.etherchain.org/tools/gasnow` or current gas page | `scrape` | Verify current site availability; gas pages often change. |
| Token Terminal | `https://tokenterminal.com/explorer` | `scrape` | Already retagged scrape; API is paid/custom. |
| Artemis | `https://app.artemis.xyz/` or public terminal pages | `scrape` | Already retagged scrape; verify useful markdown because dashboard may be JS-heavy. |
| Messari | `https://messari.io/research` | `scrape` | Currently disabled until scrape/key usefulness is proven. |
| CryptoQuant | Public/basic pages | `scrape` | API not a durable free source; verify scrape quality. |
| Coinglass | Public charts/pages | `scrape` | API not free; verify public page scrape quality. |
| Kaiko | Public reports/research pages | `scrape` | API paid/custom; public reports may be useful. |
| The Tie | Public reports/blog pages | `scrape` | API institutional/paid. |
| Arkham Intelligence | Public intel/profile pages | `scrape` | Likely JS-heavy; verify carefully. |
| Lookonchain | Public site/posts | `scrape` or `rss_plus_scrape` | Good crypto-event source if feed/page is stable. |
| DeFiTracer | Public pages | `scrape` | Verify actual useful pages. |
| Chainabuse | Public reports/pages | `scrape` | Good crypto-security source if pages are accessible. |
| Stablewatch | Public dashboard/pages | `scrape` | Verify JS/markdown quality. |
| USDT Transparency | Tether transparency page | `scrape` | Good official source, narrow URL preferred. |
| USDC Reserve attestations | Circle reserve/attestation page | `scrape` | Good official source, narrow URL preferred. |
| The Block | Public article pages | `rss_plus_scrape` or `scrape` | Already in registry as scrape; watch paywalls. |
| CoinDesk | RSS + article scrape | `rss_plus_scrape` | Already in registry. |
| Decrypt | RSS + article scrape | `rss_plus_scrape` | Already in registry. |
| Cointelegraph | RSS + article scrape | `rss_plus_scrape` | Already in registry. |
| Bankless | RSS + article scrape | `rss_plus_scrape` | Already in registry. |
| Mirror.xyz | Public posts | `scrape` or `rss_plus_scrape` | Verify feed/account-specific pages. |
| CryptoSlate | Public news/feed | `rss_plus_scrape` | Verify feed URL. |
| Coinspeaker | Public news/feed | `rss_plus_scrape` | Verify feed URL. |
| CryptoNews | Public news/feed | `rss_plus_scrape` | Verify feed URL. |
| Watcher Guru | Public news/feed | `rss_plus_scrape` | Verify feed URL. |
| Galaxy Research | Research pages | `scrape` | Already in registry. |
| Glassnode Insights | RSS + article scrape | `rss_plus_scrape` | Already in registry. |
| Coin Metrics State of the Network | RSS + article scrape | `rss_plus_scrape` | Already in registry. |

## Next Batch

## Batch 2: News/Current Affairs RSS Candidates

These feeds were checked live on 2026-05-23. Passing sources were added to the production registry as `rss_plus_scrape` because the feed gives discovery and article pages give fuller report evidence.

| Source | Feed checked | Result | Action |
| --- | --- | --- | --- |
| NPR | `https://feeds.npr.org/1001/rss.xml` | `200`, RSS, 10 items | Retagged from `official_api` to `rss_plus_scrape`. |
| ProPublica | `https://feeds.propublica.org/propublica/main` | `200`, RSS, 20 items | Retagged from `official_api` to `rss_plus_scrape`. |
| PBS NewsHour | `https://www.pbs.org/newshour/feeds/rss/headlines` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |
| ABC News Australia | `https://www.abc.net.au/news/feed/51120/rss.xml` | `200`, RSS, 25 items | Added as `rss_plus_scrape`. |
| CBC Canada | `https://www.cbc.ca/cmlink/rss-topstories` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |
| Times of India | `https://timesofindia.indiatimes.com/rssfeedstopstories.cms` | `200`, RSS, 46 items | Added as `rss_plus_scrape`. |
| Mint | `https://www.livemint.com/rss/news` | `200`, RSS, 35 items | Added as `rss_plus_scrape`. |
| AllAfrica | `https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf` | `200`, RSS/RDF, 30 items | Added as `rss_plus_scrape`. |
| Daily Maverick | `https://www.dailymaverick.co.za/dmrss/` | `200`, RSS, 48 items | Added as `rss_plus_scrape`. |
| Middle East Eye | `https://www.middleeasteye.net/rss` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |
| Japan Times | `https://www.japantimes.co.jp/feed/` | `200`, RSS, 30 items | Added as `rss_plus_scrape`. |
| Channel News Asia | `https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |

## Batch 2: News/Current Affairs Deferred

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| AP News | `https://apnews.com/hub/ap-top-news?output=rss` | `200`, but HTML not RSS | Keep current scrape entry; remove/replace bad feed fields in a data-quality pass. |
| Reuters | Prior audit found Reuters RSS candidates dead or anti-bot blocked. | Not reliable RSS | Keep Reuters Agency scrape caveat. |
| Arab News | `https://www.arabnews.com/rss.xml` | `403` Cloudflare page | Do not add until a feed/page works. |
| Scroll.in | `https://scroll.in/latest/rss` | `404` | Find current feed URL before adding. |
| The Wire | `https://thewire.in/feed` | `200`, HTML app shell, not RSS | Find current feed URL or scrape target before adding. |
| Korea Herald | `https://www.koreaherald.com/rss/rss.php` | `200`, HTML not RSS | Find current feed URL before adding. |

## Next Batch

Recommended next batch: cybersecurity advisories and vendor threat research. Reason: many have reliable RSS feeds or static advisory pages and improve high-value security reports quickly.

## Batch 3: Cybersecurity RSS/Advisory Candidates

These feeds were checked live on 2026-05-23. Passing sources were added to production as `rss_plus_scrape`, except existing API sources like CISA KEV/NVD/MITRE which remain `official_api`.

| Source | Feed checked | Result | Action |
| --- | --- | --- | --- |
| CISA Advisories | `https://www.cisa.gov/cybersecurity-advisories/all.xml` | `200`, RSS, 30 items | Added as `rss_plus_scrape`. |
| CERT/CC | `https://kb.cert.org/vuls/atomfeed` | `200`, Atom, 15 items | Added as `rss_plus_scrape`. |
| NCSC UK | `https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |
| CrowdStrike Blog | `https://www.crowdstrike.com/en-us/blog/feed/` | `200`, RSS, 10 items, but adapter verification returned empty item content and Firecrawl timeouts | Added but disabled until a better feed/scrape target is found. |
| Palo Alto Unit 42 | `https://unit42.paloaltonetworks.com/feed/` | `200`, RSS, 15 items | Added as `rss_plus_scrape`. |
| Kaspersky Securelist | `https://securelist.com/feed/` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| ESET WeLiveSecurity | `https://www.welivesecurity.com/feed/` | `200`, RSS, 100 items | Added as `rss_plus_scrape`. |
| Check Point Research | `https://research.checkpoint.com/feed/` | `200`, RSS, 15 items | Added as `rss_plus_scrape`. |
| Proofpoint Threat Insight | `https://www.proofpoint.com/us/rss.xml` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| Citizen Lab | `https://citizenlab.ca/feed/` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| Trail of Bits | `https://blog.trailofbits.com/feed/` | `200`, RSS, 20 items | Added as `rss_plus_scrape`. |
| OpenZeppelin | `https://blog.openzeppelin.com/rss.xml` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| SlowMist | `https://slowmist.medium.com/feed` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| Troy Hunt | `https://www.troyhunt.com/rss/` | `200`, RSS, 15 items | Added as `rss_plus_scrape`. |
| Risky Business | `https://risky.biz/feeds/risky-business-news/` | `200`, RSS, 100 items | Added as `rss_plus_scrape`. |
| Help Net Security | `https://www.helpnetsecurity.com/feed/` | `200`, RSS, 10 items | Added as `rss_plus_scrape`. |
| InfoSecurity Magazine | `https://www.infosecurity-magazine.com/rss/news/` | `200`, RSS, 250 items | Added as `rss_plus_scrape`. |
| The Register Security | `https://www.theregister.com/security/headlines.atom` | `200`, Atom/RSS, 50 items | Added as `rss_plus_scrape`. |

## Batch 3: Cybersecurity Deferred

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| CISA Alerts legacy URL | `https://www.cisa.gov/news-events/cybersecurity-advisories.xml` | `404` | Use `all.xml` advisory feed instead. |
| Sophos News | `https://news.sophos.com/en-us/feed/` | `404` | Find current feed or scrape target before adding. |
| Halborn | `https://www.halborn.com/blog/rss.xml` | `200`, HTML not RSS | Find current feed or scrape target before adding. |
| SC Magazine | `https://www.scworld.com/feed` | `200`, HTML not RSS | Find current feed or scrape target before adding. |

## Batch 4: Academic/Research No-Key APIs

These endpoints were checked live on 2026-05-23. Passing sources were added or corrected as `official_api`. Several use fixed starter queries for now; a later endpoint-builder pass should make the query parameters dynamic per user query.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| OpenAlex | `https://api.openalex.org/works?search=artificial%20intelligence&per-page=2` | `200`, JSON works | Existing entry corrected with API endpoint. |
| Crossref | `https://api.crossref.org/works?query=artificial%20intelligence&rows=2` | `200`, JSON works | Existing entry corrected with API endpoint. |
| PubMed | NCBI ESearch endpoint | `200`, JSON IDs/counts | Existing entry corrected with API endpoint. |
| ClinicalTrials.gov | `https://clinicaltrials.gov/api/v2/studies?...` | `200`, JSON studies | Existing entry corrected with API endpoint. |
| Europe PMC | Europe PMC REST search | `200`, JSON papers | Added as `official_api`. |
| CORE | `https://api.core.ac.uk/v3/search/works?...` | `200`, JSON works | Added as `official_api`. |
| DOAJ | DOAJ article search | `200`, JSON articles | Added as `official_api`. |
| Unpaywall | DOI lookup with email parameter | `200`, JSON OA location | Added as `official_api`, but search endpoint returned `500`; DOI lookup only for now. |
| OpenAIRE | researchProducts search API | `200`, JSON results | Added as `official_api`. |
| ORCID | public search API | `200`, JSON identifiers | Added as `official_api`. |
| ROR | organization search API | `200`, JSON organizations | Added as `official_api`. |
| bioRxiv | details API | `200`, JSON preprints | Added as `official_api`. |
| medRxiv | details API | `200`, JSON preprints | Added as `official_api`. |
| DBLP | publication search API | `200`, JSON publications | Added as `official_api`. |
| PubChem | PUG REST property endpoint | `200`, JSON compact compound properties | Added as `official_api`. |
| Zenodo | records API | `200`, JSON records | Added as `official_api`. |
| Figshare | articles listing API | `200`, JSON articles | Added as `official_api`; search endpoint candidate returned `404`, so this is broad for now. |
| OSF Preprints | public API preprints filter | `200`, JSON preprints | Added as `official_api`. |
| Internet Archive Scholar | advancedsearch API | `200`, JSON records | Added as `official_api`. |
| INSPIRE-HEP | literature API | `200`, JSON records | Added as `official_api`. |
| Open Library | search API | `200`, JSON books | Existing entry corrected with API endpoint. |

## Batch 4: Academic/Research Deferred

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| Semantic Scholar | Graph API paper search | `429` from current IP; no-key exists but rate-limited hard | Kept existing source with lower rate limit; add `SEMANTIC_SCHOLAR_API_KEY` later if needed. |
| BASE | HTTP search API | `200` with access-denied body for current IP/user agent | Do not add until access path is confirmed. |
| NASA ADS | search API | `401`, missing authorization | Requires API token; keep out of no-key registry. |
| NCBI Datasets | tested gene endpoint | `404`, bad endpoint candidate | Revisit with correct NCBI dataset endpoint. |

## Batch 4: Mapper Notes

- Added generic official-api wrapper extraction for `resultList.result`, `hits.hits`, `message.items`, `collection`, `messages`, `studies`, and `PC_Compounds`.
- OpenAlex, ClinicalTrials, Zenodo, DOAJ, and PubChem now return useful data, but still deserve source-specific mappers later for cleaner snippets.
- Europe PMC and Zenodo improved from wrapper blobs to individual records after the generic wrapper patch.

## Batch 4 Follow-Up: NASA ADS And NCBI Datasets

Checked on 2026-05-23 after `NASA_ADS_API_KEY` was added locally.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| NASA ADS | `https://api.adsabs.harvard.edu/v1/search/query?q=machine%20learning&fl=title,bibcode,abstract,year,author&rows=5` with `Authorization: Bearer <NASA_ADS_API_KEY>` | `200`, JSON documents | Added as key-gated `official_api`; adapter now sends bearer auth and avoids appending API key query params. |
| NCBI Datasets | `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/BRCA1/taxon/human` | `200`, JSON gene reports | Added as no-key `official_api`; generic mapper now unwraps `reports`. |

## Batch 5: Government/Economic No-Key APIs

These endpoints were checked live on 2026-05-23 and added or corrected as `official_api`.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| SEC EDGAR | `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` | `200`, JSON company facts | Existing entry corrected with no-key XBRL endpoint and conservative rate limit. |
| Treasury FiscalData | average interest rates endpoint | `200`, JSON records | Existing entry corrected with no-key FiscalData endpoint. |
| OpenFDA | `https://api.fda.gov/drug/event.json?limit=5` | `200`, JSON adverse-event records | Existing entry corrected with no-key endpoint. |
| Eurostat | real GDP growth dataset endpoint | `200`, JSON-stat data | Existing entry corrected with no-key endpoint. |
| BEA | `GETDATASETLIST` with `sampleUser` | `200`, JSON dataset list | Existing BEA entry corrected if present. |
| UK ONS | `https://api.beta.ons.gov.uk/v1/datasets?limit=5` | `200`, JSON datasets | Added as no-key `official_api`. |
| Bank of Canada | Valet FX observations endpoint | `200`, JSON observations | Added as no-key `official_api`. |
| CDC Open Data | Socrata catalog search | `200`, JSON dataset catalog hits | Added as no-key `official_api`. |

## Batch 5: Government/Economic Deferred

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| data.gov | CKAN package search candidates | `404` from tested URLs | Find current catalog API route before adding. |
| USAspending | autocomplete endpoint | `405`, GET not allowed | Needs POST-capable adapter path; not for current generic GET API adapter. |
| Federal Reserve H.15 | Data download JSON candidate | `200`, empty/non-JSON body from tested URL | Find stable modern endpoint or use existing Federal Reserve JSON press source for now. |

## Batch 6: Finance/Markets No-Key And Key-Limited APIs

Checked live on 2026-05-23. Production additions here are limited to endpoints that returned usable no-key JSON/CSV. Demo-only endpoints are documented but kept key-limited.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Yahoo Finance | `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d` | `200`, JSON chart data | Existing entry corrected with no-key chart endpoint. |
| Stooq | `https://stooq.com/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv` | `200`, CSV quote row | Added as no-key `official_api`. |
| Nasdaq Quote API | `https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks` | `200`, JSON quote/company info | Added as no-key `official_api`; public endpoint may change, keep moderate priority. |
| Nasdaq Earnings Calendar | `https://api.nasdaq.com/api/calendar/earnings?date=2026-05-22` | `200`, JSON earnings calendar | Added as no-key `official_api`. |
| SEC Company Tickers | `https://www.sec.gov/files/company_tickers.json` | `200`, JSON ticker/CIK map | Added as no-key `official_api`. |
| CBOE VIX History | `https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv` | `200`, CSV VIX history | Added as no-key `official_api`. |
| Alpha Vantage | demo global quote endpoint | `200`, JSON demo quote | Existing source given endpoint, but remains key-limited; demo key is not durable report coverage. |
| Twelve Data | demo quote endpoint | `200`, JSON demo quote | Existing source given endpoint, but remains key-limited; demo key is not durable report coverage. |

## Batch 6: Finance/Markets Deferred

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| Financial Modeling Prep | stable profile endpoint with `demo` key | `401`, invalid API key | Existing source remains key-limited with endpoint placeholder. |
| FRED | series search endpoint | Requires API key; local `FRED_API_KEY` was verified on 2026-05-23 and adapter returned inflation-related series successfully | Already correctly key-gated with `FRED_API_KEY`; use `npx tsx --env-file=.env ...` for local adapter tests. |
| CME delayed quotes | tested quote endpoint | `404` | Find current endpoint or use scrape later. |
| MarketWatch, Investing.com, FinViz, Stockanalysis, Macrotrends, TradingView, Barchart, Morningstar | Not added in this pass | Primarily scrape/web targets or key/anti-bot risk | Verify narrow scrape URLs before production registry insertion. |

## Batch 7: Climate, Weather, Reference, And Consumer No-Key APIs

Checked live on 2026-05-23. Before treating any source as missing-key, `.env` was checked. `EIA_API_KEY` was later added and verified locally; no `NOAA_CDO_API_KEY`, `OPENWEATHERMAP_API_KEY`, `WAQI_API_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY`, `LASTFM_API_KEY`, or `DISCOGS_API_KEY` was present locally.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Open-Meteo | Forecast API for Delhi current weather | `200`, JSON current weather | Added as no-key `official_api`. |
| NOAA | NCEI global climate time-series JSON | `200`, JSON temperature departures | Existing NOAA entry corrected with no-key climate endpoint. |
| NOAA NWS | `api.weather.gov/points` endpoint | `200`, JSON forecast metadata | Added as no-key `official_api`. |
| Climate Watch | Historical emissions API | `200`, JSON emissions rows | Added as no-key `official_api`. |
| WHO | Global Health Observatory `Indicator` endpoint | `200`, JSON indicators | Existing WHO entry corrected with no-key GHO endpoint. |
| Our World in Data | Grapher CO2 CSV endpoint | `200`, CSV data | Existing entry corrected with no-key grapher endpoint. |
| Wikipedia | MediaWiki search API | `200`, JSON search results | Existing entry corrected with query-aware API endpoint/template. |
| Wikidata | Entity search API | `200`, JSON entity results | Existing entry corrected with query-aware API endpoint/template. |
| DBpedia | Lookup search endpoint | `200`, XML result content | Added as no-key `official_api`; generic mapper can consume XML text, but JSON-quality mapper would be better later. |
| MusicBrainz | Artist search API | `200`, JSON artists | Added as no-key `official_api`. |
| TheAudioDB | Public search endpoint using documented public key path | `200`, JSON artist results | Added as no-key `official_api`; monitor public endpoint durability. |
| Jikan MAL | Unofficial MyAnimeList API | `200`, JSON anime results | Added as no-key `official_api`. |
| Open Food Facts | Search API | Intermittent `503` during concurrent adapter probes, then `200` on retry | Added as no-key `official_api`; monitor reliability and consider lower concurrency/rate later. |
| Open Beauty Facts | Search API | `200`, JSON product results | Added as no-key `official_api`. |

## Batch 7: Deferred Or Key-Gated

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| EIA | OpenData v2 energy endpoint | `200`, JSON energy price rows with local `EIA_API_KEY` | Corrected existing EIA entry to `requires_key: true` with `EIA_API_KEY`; adapter now sends `api_key`. |
| NOAA NCEI Access Services | `/access/services/search/v1/data` and `/access/services/data/v1` | `200`, JSON search/data responses with no token | Replaced the old token-gated CDO v2 registry entry with the newer no-key NCEI Access Services endpoint. |
| OpenWeatherMap | Public API | Requires key; local `OPENWEATHERMAP_API_KEY` now verified | Added as key-gated `official_api`; adapter sends `appid`. |
| WAQI | Public API | Requires token and no local key present | Deferred; `.env.example` placeholder added. |
| TMDB, OMDB, Last.fm, Discogs | Public APIs | Require keys and no local keys present | Deferred; `.env.example` placeholders added. |
| AniList | GraphQL API | Public API exists, but current generic official-api adapter is GET-only | Defer until GraphQL/POST adapter path exists. |

## Batch 8: Geo, Disaster, Aviation, Space, And Biodiversity APIs

Checked live on 2026-05-23. Local `.env` was checked first; no Mapbox, GeoNames, OpenSky, N2YO, MarineTraffic, or other transport/geo keys were present.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Nominatim | OpenStreetMap search API | `200`, JSON place results | Added as no-key `official_api` with conservative rate limit. |
| USGS Earthquake Catalog | Past-day GeoJSON earthquake feed | `200`, GeoJSON features | Added as no-key `official_api`. |
| GDACS | Event list API | `200`, GeoJSON disaster events | Added as no-key `official_api`. |
| Humanitarian Data Exchange | CKAN `package_search` | `200`, JSON dataset results | Added as no-key `official_api`; fixed generic endpoint matching so `data.*` hosts do not accidentally route to Wikidata templates. |
| OpenSky Network | `/api/states/all` | `200`, JSON aircraft state arrays | Added as no-key `official_api`; added mapper for readable aircraft snippets. |
| NASA JPL Fireball Data API | Fireball API | `200`, JSON array rows | Added as no-key `official_api`; added mapper for readable fireball snippets. |
| NASA Earthdata | CMR collections search | `200`, JSON collection metadata | Existing NASA Earthdata entry corrected with no-key CMR endpoint. |
| GBIF | Species search API | `200`, JSON taxonomy results | Added as no-key `official_api`. |
| iNaturalist | Observations API | `200`, JSON observation results | Added as no-key `official_api`. |

## Batch 8: Deferred Or Key-Gated

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| ReliefWeb | v2 reports API plus fields table docs | `403`, requires approved `appname` from 2025-11-01 | Added as key-gated `official_api` using `RELIEFWEB_APPNAME`; adapter sends it as `appname` query param. |
| OpenStreetMap Overpass | Overpass interpreter | `200`, but requires source-specific query DSL for useful retrieval | Deferred until query-template support is richer. |
| eBird | 1.1 docs and v2 recent observations API | 1.1 returns `410 Gone`; v2 verified with local `EBIRD_API_KEY` | Added as key-gated `official_api` using `EBIRD_API_KEY`; adapter sends `X-eBirdApiToken` and returns recent observations. |
| Mapbox, GeoNames, N2YO, MarineTraffic, FlightRadar24 | Not added | Key-gated, paid, or scrape/anti-bot sensitive | Verify with keys or narrow scrape plan later. |

## Batch 9: Books, Libraries, Archives, And Public Domain

Checked live on 2026-05-23. Local `.env` was checked first; no library/archive API keys were present.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Internet Archive | `advancedsearch.php` JSON API | `200`, JSON docs | Existing entry corrected with query-aware no-key API endpoint. |
| Open Library | `search.json` API | `200`, JSON docs | Existing entry corrected from static query to query-aware no-key endpoint. |
| Library of Congress | LoC.gov JSON API | `200`, JSON search results | Added as no-key `official_api`. |
| Wikisource | MediaWiki search API | `200`, JSON search results | Added as no-key `official_api`. |

## Batch 9: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| Gutendex / Project Gutenberg metadata API | `/books/?search=shakespeare`; docs confirm JSON API exists | Requests from local environment hung with zero bytes for >20s via both `fetch` and `curl` | Do not wire into production adapter yet; keep Project Gutenberg for later scrape or alternate mirror pass. |
| HathiTrust | volumes brief API candidate | `200` but empty for tested ISBN; other route returned `404` | Needs better identifier strategy before adding. |
| DOAB | legacy JSON candidate | Returned HTML site shell, not JSON API | Needs current API/discovery pass. |
| OpenStax | tested API candidate | Network fetch failed | Revisit with current docs. |

## Batch 10: Scientific Databases, Taxonomy, Proteins, And Astronomy

Checked live on 2026-05-23. Local `.env` was checked first; no Materials Project, GISAID, UniProt, PDB, ITIS, OBIS, ChemSpider, SIMBAD, NED, or VizieR keys were present.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| UniProt | UniProtKB REST search | `200`, JSON protein entries | Added as no-key `official_api`; added readable mapper for accession/gene/organism/sequence length. |
| PDBe Protein Data Bank | PDBe Solr search endpoint | `200`, JSON PDB docs | Added as no-key `official_api`. |
| ITIS | scientific name search JSON service | `200`, JSON taxon names | Added as no-key `official_api`; added readable mapper with TSN/taxon authority. |
| OBIS | occurrence API for `Gadus morhua` | `200`, JSON occurrence records | Added as no-key `official_api`; added readable mapper for dataset/date/location. |
| SIMBAD | object lookup ASCII endpoint | `200`, text object record | Added as no-key `official_api`; generic text path handles content. |
| NASA/IPAC NED | object lookup JSON endpoint | `200`, JSON object record | Added as no-key `official_api`; added readable mapper for object type, coordinates, redshift. |

## Batch 10: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| VizieR | catalogue URL candidate with JSON flag | `200`, HTML catalogue shell | Needs proper VOTable/TAP/SCS endpoint selection before registry insertion. |
| Materials Project | Current `/materials/summary/` API | `200`, JSON material summaries with local `MATERIALS_PROJECT_API_KEY` | Added as key-gated `official_api`; adapter sends `X-API-KEY` and maps material ID/formula/band gap/energy above hull. |
| GISAID | Not added | Account-controlled access; not a durable public API | Do not add as free API. |
| ChemSpider | RSC compounds API name filter workflow | `200`, query/status/results/details with local `CHEMSPIDER_API_KEY` | Added as key-gated `official_api`; adapter handles POST filter workflow and maps compound formula/mass/SMILES/InChIKey. |

## Batch 11: Software, Package, Developer, And Vulnerability APIs

Checked live on 2026-05-23. Local `.env` was checked first; no Stack Exchange, libraries.io, GitHub, npm, PyPI, Maven, OSV, or deps.dev keys were present or required for the endpoints used here.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| npm Registry | npm search API | `200`, JSON package results | Existing entry corrected with query-aware no-key endpoint and readable mapper. |
| PyPI | project JSON API | `200`, JSON package metadata | Existing entry corrected with query-aware no-key endpoint; root package response is mapped as one item. |
| Maven Central | Solr search API | `200`, JSON artifact docs | Added as no-key `official_api` with readable mapper. |
| Stack Exchange | Stack Overflow advanced search API | `200`, JSON questions | Existing entry corrected with no-key endpoint and readable mapper. |
| OSV | vulnerability query API | `200`, JSON vulnerabilities via POST | Added as no-key `official_api`; adapter handles POST query workflow for npm package names. |
| deps.dev | package versions endpoint | `200`, JSON package versions | Added as no-key `official_api` with readable mapper. |
| DEV.to | articles API by tag | `200`, JSON articles | Added as no-key `official_api`. |

## Batch 11: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| Crates.io | crate API | `503` from current environment | Defer until endpoint is stable from deployment environment. |
| libraries.io | search and package APIs | `200`, JSON project/package metadata with local `LIBRARIES_IO_API_KEY` | Added as key-gated `official_api`; adapter sends `api_key` and maps release/dependency metadata. |

## Batch 12: Health, Medical, Drug, And Clinical Reference APIs

Checked live on 2026-05-23. Local `.env` was checked first; no DailyMed, RxNorm, NLM Clinical Tables, FDA NDC, CDC, KFF, or HealthData keys were present or required for the endpoints added here.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| DailyMed | SPL search by drug name | `200`, JSON label records | Added as no-key `official_api`; mapper returns label title, set ID, SPL version, publish date. |
| RxNorm | RxNav drug search | `200`, JSON RxNorm concept groups | Added as no-key `official_api`; mapper unwraps `drugGroup.conceptGroup` and returns RxCUI/synonym/term type. |
| NLM Clinical Tables Conditions | conditions search API | `200`, compact JSON rows | Added as no-key `official_api`; mapper handles clinical table array rows. |
| NLM Clinical Tables RxTerms | RxTerms search API | `200`, compact JSON rows | Added as no-key `official_api`; mapper handles clinical table array rows. |
| FDA NDC Directory | openFDA NDC endpoint | `200`, JSON drug product records | Added as no-key `official_api`; mapper returns NDC, generic name, labeler, dosage form, marketing category. |

## Batch 12: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| HealthData.gov | `data.json` and CKAN-style package search | `data.json` timed out locally; CKAN route returned `404` | Defer until a reliable catalog endpoint is confirmed. |
| NHS Website Content API | Official Content API v2 endpoint `https://api.service.nhs.uk/nhs-website-content/conditions/acne/` | Local `NHS_API_KEY`, `NHS_SECRET_KEY`, and `NHS_APPLICATION_ID` are present for a Production app. Official production auth is `apikey` header; live response is `401 Invalid ApiKey for given resource` on production and integration hosts. NHS developer community threads show this exact error when the NHS Website Content API production connection is still pending; NHS staff resolved prior cases by approving the connected API / APIM workflow after receiving the App ID. NHS assurance docs also say production access must be requested per API/service. Legacy `api.nhs.uk` route also rejected. | Do not add to registry yet. Ask NHS/API Platform support to approve/complete the NHS Website Content API production connection/APIM workflow for the production App ID, then retest. Secret/application id are not sufficient for this Content API. |
| KFF | Not added in this pass | Need current API/feed/scrape path verification | Revisit in a separate health-content pass. |

## Batch 13: Government, Macro, And Policy APIs

Checked live on 2026-05-23. Local `.env` was checked first; `CONGRESS_API_KEY`, `GUARDIAN_API_KEY`, and `CENSUS_API_KEY` are present. No `BEA_API_KEY` is present.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| The Guardian | Content API search with `q={query}` and `api-key` | `200`, query-relevant JSON articles | Corrected endpoint to query-aware template and added readable mapper for title, URL, trail text, section, and publish date. |
| Federal Register | Documents API with `conditions[term]={query}` | `200`, query-relevant JSON documents | Corrected endpoint to query-aware template and added readable mapper for abstract, agency, type, document number, and publication date. |
| Congress.gov | v3 summaries endpoint with `query={query}` and local `CONGRESS_API_KEY` | `200`, JSON legislative summaries; relevance is still weak/latest-heavy for broad queries | Corrected endpoint from generic bill list to summaries endpoint and added readable mapper; needs a later per-source search-quality pass. |
| US Census | ACS population endpoint with local `CENSUS_API_KEY` | `200`, JSON table rows | Existing endpoint still works; no registry change. |
| BLS | Public API CPI series endpoint | `200`, JSON time series | Existing endpoint still works; no registry change. |
| Treasury FiscalData | Average interest rates endpoint | `200`, JSON rows; occasional slow response from local environment | Added readable mapper for Treasury rate rows. |
| TreasuryDirect | Previous human-site fallback returned `404` | Registry source now points to the same no-key FiscalData average interest rates API while keeping TreasuryDirect as the human citation domain. |

## Batch 13: Deferred Or Key-Gated

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| BEA | Official BEA API with old `sampleUser` | `200` response body contained `APIErrorCode 4`, `UserId is not active` | Corrected registry to `requires_key: true` with `BEA_API_KEY`; added `.env.example` placeholder. Retest after key is added. |

## Batch 14: International Statistics And Multilateral Data APIs

Checked live on 2026-05-23. Local `.env` was checked first; no OECD, ECB, Eurostat, BIS, ILOSTAT, FAOSTAT, UN Comtrade, or WTO keys were present.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Eurostat | Dissemination API dataset `tec00115` | `200`, JSON-stat GDP growth dataset | Existing source verified and readable mapper added for label/source/update/sample values. |
| OECD | SDMX dataflow endpoint | `200`, SDMX/XML dataflow content | Existing source verified; output remains dataflow-catalog style and needs later per-dataset routing for user-specific indicators. |
| ECB | Data API dataflow endpoint | `200`, SDMX/XML exchange-rate dataflow content | Existing source verified; output remains dataflow-catalog style and needs later per-series routing for user-specific metrics. |
| BIS | SDMX JSON dataflow endpoint | `200`, JSON dataflows | Corrected existing source from human-site fallback to working no-key BIS SDMX API endpoint; readable mapper added for dataflow ID/name/version/agency. |
| ILOSTAT | ILOStat unemployment indicator endpoint | `200`, JSON labor-stat observations | Added as no-key `official_api` with readable mapper for reference area, indicator, sex, classification, time, and observed value. |
| WTO | Timeseries API with local `WTO_API_KEY` | `200`, JSON trade observations using `Ocp-Apim-Subscription-Key`; prior failure was an invalid product code, not invalid credentials | Added as key-gated `official_api`; adapter sends WTO key in `Ocp-Apim-Subscription-Key` header and maps indicator, economies, product/sector, year, and value. |

## Batch 14: Deferred Or Key-Gated

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| FAOSTAT | FENIX API domains and indicators endpoints | Timed out locally after 12s | Defer until a stable endpoint or longer-running dataset fetch path is chosen. |
| UN Comtrade | v1 data endpoint | `401`, subscription key required | Defer until a `UN_COMTRADE_API_KEY` is available and auth placement is implemented. |

## Batch 15: Academic, Biomedical, And Open Research Index APIs

Checked live on 2026-05-23. Local `.env` was checked first; no OpenAlex, Crossref, Semantic Scholar, CORE, DOAJ, PubMed, Europe PMC, ORCID, or ROR keys were present or required for the endpoints used here.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| OpenAlex | Works search API | `200`, JSON work records | Corrected endpoint from static query to `{q}` template; mapper added for DOI/OpenAlex URL, authors, year, type, citation count, and reconstructed abstract. |
| Crossref | Works query API | `200`, JSON work records | Corrected endpoint from static query to `{q}` template; mapper added for DOI URL, publisher, container title, and abstract. |
| Semantic Scholar | Graph paper search API | Initially `429`, then `200` on retry; no key required for light usage | Corrected endpoint from static query to `{q}` template; mapper added for title, URL, authors, venue, year, citations, abstract, and publication date. Monitor rate limits. |
| CORE | Works search API | `200`, JSON work records | Corrected endpoint from static query to `{q}` template; mapper added for title, authors, DOI/download URL, publication date, and abstract. |
| DOAJ | Article search API | `200`, JSON article records | Corrected endpoint from static query to `{q}` template; mapper added for title, journal, year, identifiers, and abstract. |
| PubMed | E-utilities `esearch` | `200`, JSON search IDs | Corrected endpoint from static query to `{q}` template; mapper added for result count, top PubMed IDs, and query translation. Full article metadata would need a later `esummary`/`efetch` chained adapter. |
| Europe PMC | Search API | `200`, JSON biomedical records | Corrected endpoint from static query to `{q}` template; mapper added for DOI/PubMed URL, authors, journal, year, DOI, and abstract text. |
| ORCID | Public search API | `200`, JSON ORCID IDs | Corrected endpoint from static query to `{q}` template; mapper added for ORCID URL/path. |
| ROR | Organization search API | `200`, JSON organization records | Corrected endpoint from static query to `{q}` template; mapper added for ROR ID, established year, type, and country. |

## Batch 16: US Public Finance, Filings, Banking, And Regulatory APIs

Checked live on 2026-05-23. Local `.env` was checked first; no SEC, FDIC, Federal Reserve, OpenFDA, USAspending, GovInfo, or CFPB keys were present or required for the endpoints added here.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| SEC EDGAR | Company facts API for Apple CIK | `200`, JSON XBRL company facts | Existing source verified; mapper added to summarize entity, CIK, fact namespaces, and sample facts instead of raw 4KB JSON. |
| SEC Company Tickers | SEC company tickers JSON | `200`, JSON ticker map | Existing source verified; mapper added to list ticker, company title, and CIK. |
| Federal Reserve | Press release JSON feed | `200`, JSON release records | Existing source verified; mapper added for release title, type, date, and URL. |
| OpenFDA | Drug adverse event endpoint | `200`, JSON adverse event records | Existing source verified; mapper added for safety report ID, received date, serious flag, drugs, reactions, and source country. |

## Batch 16: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| USAspending | Award search API | Network fetch failed from current environment | Defer until stable from deployment environment or add a server-side retry/proxy check. |
| GovInfo | Search API candidate with demo key | Network fetch failed from current environment; production use usually needs an API key | Defer until `GOVINFO_API_KEY` is available and endpoint is verified. |
| CFPB Consumer Complaints | Search API | Timed out locally after 12s | Defer until stable endpoint behavior is confirmed. |
| FDIC BankFind | Institutions API | Initially returned `200`, then timed out on direct retest and returned empty through adapter | Defer until endpoint stability is confirmed from deployment environment. Mapper code is present for a future retry, but source is not enabled in registry. |

## Batch 17: Legal, Patents, And Market Regulatory APIs

Checked live on 2026-05-23. Local `.env` was checked first; no CourtListener, USPTO, CFTC, WIPO, EPO, EUIPO, FinCEN, or FATF keys were present or required for the sources added here.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| CourtListener | REST v4 legal search API with `q={query}` | `200`, JSON case-law search results | Corrected existing source from human-site fallback to query-aware no-key API endpoint; mapper added for case name, citations, court, docket, status, and opinion snippets. |
| CFTC Commitments of Traders | Public Reporting Environment Socrata endpoint for legacy futures COT rows with `$q={query}` | `200`, query-relevant JSON report rows | Added as no-key `official_api`; mapper added for market, report date, open interest, and commercial/non-commercial positions. |

## Batch 17: Deferred Or Not Production-Ready

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| USPTO Patent File Wrapper Search | Official `api.uspto.gov/api/v1/patent/applications/search` GET and POST variants | `403 Forbidden` from current environment across tested query forms | Defer until USPTO access requirements or a stable public endpoint are confirmed. Do not add a dead API source. |
| WIPO PATENTSCOPE / WIPO Lex | Official web portals and docs | Free web databases, but no durable no-key JSON search endpoint confirmed in this pass | Defer to scrape/API verification pass. |
| EPO OPS | Official OPS docs | Registration/API credential workflow, not a no-key source | Defer until credentials are intentionally added. |
| EUIPO APIs | Official API portal | Sandbox/API portal workflow, not a simple no-key source | Defer until a public endpoint or credentials are confirmed. |
| FATF high-risk jurisdictions | Official FATF page | Current environment received `403` challenge page | Defer; do not add scrape source until Firecrawl or another fetch path resolves content reliably. |
| FinCEN alerts/advisories | Candidate news URL | Candidate returned `404`; current URL structure needs discovery | Defer to regulatory scrape pass. |

## Broad No-Key Intake Pass

Checked live on 2026-05-23. This was a wide pass across the master list to reduce tiny batching. It added only no-key sources that returned usable content from the current environment.

| Field | Added |
| --- | --- |
| Crypto & Web3 | Deribit Public API; dYdX Public API; DeFiLlama Stablecoins; Crypto Fees; BitInfoCharts; Stablewatch; USDT Transparency; USDC Reserve Attestations; Chainabuse |
| News & Current Affairs | Hacker News API via Algolia; Lobste.rs; Techmeme; Reporters Without Borders; Committee to Protect Journalists |
| US Government & Legal | eCFR; GAO Reports; DOJ News; FTC News; Cornell Law LII |
| Geopolitics & International Orgs | EU Sanctions Map; NATO; African Union |
| Finance & Markets | Frankfurter FX; ECB Euro Exchange Rates; FINRA TRACE; WorldGovernmentBonds.com; LBMA; World Gold Council |
| Academic & Research | HAL; RePEc IDEAS; SSRN; Standard Ebooks; Directory of Open Access Books; Open Textbook Library; OpenStax |
| Sports | MLB Stats API; NHL API; Chess.com API; Lichess API; Jolpica F1 API |
| Statistics & Society | UN Population Division |

## Broad No-Key Intake Deferrals By Field

| Field | Deferred | Reason |
| --- | --- | --- |
| Crypto & Web3 | Bitnodes; Bankless DeFi Index; De.Fi Scanner; Socket API | Network failure, `404`, `403`, or `401` from current environment. |
| News & Current Affairs | GDELT; Wayback CDX | GDELT returned `429`; Wayback CDX timed out locally. |
| US Government & Legal | USA.gov/Data.gov CKAN route; Regulations.gov; CBO Reports; CRS Reports; Justia | `404`, key-required, or challenge/403 pages. |
| Geopolitics & International Orgs | UN Sanctions XML; ASEAN | Timeout or JavaScript interstitial. |
| Finance & Markets | World Bank Pink Sheet; LME | Tested route returned XML error or challenge/403. |
| Academic & Research | Project Gutenberg Gutendex | Direct request returned `200`, but adapter path hung; removed pending stability. |
| Cultural & Creative | AniList; TMDB; OMDb | AniList needs POST/GraphQL support; TMDB and OMDb are key-gated. |
| Statistics & Society | NCES; FBI Crime Data API | Network fetch failure or data.gov API key required. |

## Post Broad-Pass Fixes

Checked live on 2026-05-23 after confirming local `.env` contains `API_DATA_GOV_KEY` and `ANALYTICS_USA_GOV_API_KEY`.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Regulations.gov Documents | `https://api.regulations.gov/v4/documents?filter[searchTerm]={q}&page[size]=5` with `API_DATA_GOV_KEY` as `api_key` | `200`, JSON document results | Added as key-gated `official_api`; mapper added for document title, type, docket, agency, posted date, and Regulations.gov document URL. |
| FBI Wanted API | `https://api.fbi.gov/wanted/v1/list?title={q}` | `200`, JSON wanted-program records; FBI docs confirm no key and REST query params | Added as no-key `official_api`; mapper added for title, FBI URL, subjects, field offices, description, and publication date. |
| AniList | `https://graphql.anilist.co` GraphQL POST | `200`, JSON media results without key | Added as no-key `official_api`; adapter now has an AniList GraphQL POST path and readable mapper. |
| GDELT | DOC 2.0 API article list endpoint | `200`, JSON articles after waiting; latency around 17s locally | Added as no-key `official_api` with strict `1 call / 6 seconds` source rate limit; monitor latency in production. |

Still deferred:

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| FBI Crime Data API | `api.usa.gov/crime/fbi/...` and cloud.gov candidates with `API_DATA_GOV_KEY` | `404` from tested routes | Endpoint/path issue, not a missing key. Keep deferred until the current production CDE API route is confirmed. |
| Analytics.usa.gov | Local `ANALYTICS_USA_GOV_API_KEY` present | Not needed for Regulations.gov | Add in a dedicated analytics/government web metrics pass if useful. |

## Keyed Source Fixes: Trade, Markets, And Sanctions

Checked live on 2026-05-23 after confirming local `.env` contains `UN_COMTRADE_API_KEY`, `UN_COMTRADE_SECONDARY_KEY`, `BEA_Data_API`, `Alpha_Vantage_API_KEY`, `Finnhub_API_KEY`, `Twelve_Data_API_KEY`, and `FMP_API_KEY`.

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| BEA | `GETDATASETLIST` with `BEA_Data_API` as `UserID` | `200`, JSON dataset metadata | Registry key env corrected from `BEA_API_KEY` to `BEA_Data_API`; readable mapper verified. |
| Alpha Vantage | Global quote endpoint with `Alpha_Vantage_API_KEY` as `apikey` | `200`, JSON quote | Registry key env corrected and readable quote mapper added. |
| Finnhub | Quote endpoint with `Finnhub_API_KEY` as `token` | `200`, JSON quote | Registry key env corrected; adapter now sends Finnhub token as `token`; mapper added. |
| Twelve Data | Quote endpoint with `Twelve_Data_API_KEY` as `apikey` | `200`, JSON quote | Registry key env corrected and mapper added. |
| Financial Modeling Prep | Stable profile endpoint with `FMP_API_KEY` as `apikey` | `200`, JSON company profile | Key verified and mapper added. |
| UN Comtrade | `getLiveUpdate` with `UN_COMTRADE_API_KEY` as `Ocp-Apim-Subscription-Key` | `200`, JSON Comtrade release metadata | Added as key-gated `official_api`; detailed trade extraction remains deferred because trade-data endpoints timed out locally. |
| UN Sanctions List | Official Security Council consolidated XML list | `200`, XML | Added as no-key `official_api`. |

Still deferred:

| Source | Checked | Result | Action |
| --- | --- | --- | --- |
| UN Comtrade detailed trade data | `data/v1/get/...` and `public/v1/preview/...` with subscription key | Timed out locally after 12-20s | Keep current Comtrade source on `getLiveUpdate`; add narrower trade-data templates later. |
| sanctions.io | API reference | Requires API token via `Authorization: Bearer` and versioned `Accept` header | Do not add until `SANCTIONS_IO_API_KEY` is available. |

## Wide Remaining-Source Scrape Intake

Checked live on 2026-05-23 after confirming `.env` first. This pass focused on remaining large untouched areas from the original master list and added only sources whose public pages returned usable content from the current environment.

| Field | Added |
| --- | --- |
| Country statistics and central banks | Statistics Canada; Reserve Bank of Australia; Swiss National Bank; Bank of Israel; Bank Indonesia; Banco de Mexico; South African Reserve Bank; Destatis Germany; INSEE France; ISTAT Italy; SCB Sweden; SSB Norway; Stats NZ |
| Legal and IP | WIPO; International Court of Justice |
| Sports | Olympics.com; FIFA; World Athletics; WTA Tennis; PGA Tour; Transfermarkt; Understat; HLTV; Liquipedia |
| Transport, shipping, tourism, aid, religion | Bureau of Transportation Statistics; AirNav; VesselFinder; Flexport Research; US Travel Association; AidData; IATI; World Religion Database; Pew Religion |
| Regional news and think tanks | Premium Times Nigeria; Council on Foreign Relations; Brookings; Carnegie Endowment; Atlantic Council; International Crisis Group; ECFR |
| Finance scrape/public pages | FinViz; StockCharts; Zacks; Roic.ai; Simply Wall St; Finbox; VettaFi; SWF Institute |
| Science/public reference | NIST Chemistry WebBook; Crystallography Open Database; USGS Publications; OSTI.gov; DTIC |
| Weather and media after latest `.env` check | WAQI; OMDB; TVMaze; Last.fm |

## Remaining Deferrals From Wide Scrape Intake

| Field | Deferred | Reason |
| --- | --- | --- |
| Country statistics and central banks | Reserve Bank of New Zealand; Bank Negara Malaysia; Central Bank of Turkey; National Bank of Poland; Statistics South Africa | `403`, anti-bot/interstitial, or Incapsula/noindex shell pages from current environment. |
| Legal/courts/IP | WorldLII; CanLII; AustLII; SAFLII; HUDOC; International Criminal Court; EPO | Cloudflare/anti-bot, JS/security shell, or fetch failure. |
| Sports | ATP Tour | Cloudflare/anti-bot. |
| Transport/shipping/tourism | Container xChange; UN Tourism | Cloudflare/anti-bot. |
| News/think tanks | Arab News; Bangkok Post; Daily Maverick; RAND; Chatham House; Al-Monitor; The Standard Kenya | Blocked, TollBit-gated, or anti-bot-heavy from current environment. |
| Finance | MarketWatch; Barchart; GuruFocus; ETF.com; Global SWF; QuickFS; Morningstar | Blocked/anti-bot, network failure, or uncertain `202` response. |
| Science/books | GISAID; National Academies Press | GISAID actual data is controlled/login-gated; NAP timed out locally. |
| Cultural/media | Discogs | Consumer key/secret returned `401` with both supported lightweight auth shapes. Registry now uses `DISCOGS_USER_TOKEN` with `Authorization: Discogs token=...`; the screenshot showed a token, but the saved `.env` did not contain `DISCOGS_USER_TOKEN` during verification. `https://data.discogs.com/` is a public bulk XML dump source for future dataset ingestion, not the live report adapter. |

## Prediction Market Source Intake

Checked live on 2026-05-23 and added as no-key `official_api` sources:

| Source | Endpoint checked | Result | Action |
| --- | --- | --- | --- |
| Polymarket Gamma | `https://gamma-api.polymarket.com/public-search?q={q}&limit=10` | `200`, JSON search results | Added with mapper for question, outcome prices, volume/liquidity, close date, category, resolution source, and description. |
| Kalshi | `https://external-api.kalshi.com/trade-api/v2/markets?limit=1000&status=open` | `200`, JSON market objects | Added with mapper for title, ticker, yes bid/ask, last price, volume/liquidity, close/expiration time, and rules. Official docs expose ticker/event/series/status filters, not keyword search, so adapter locally ranks open markets by query relevance and returns empty instead of unrelated markets when no query term matches. |
| Manifold Markets | `https://api.manifold.markets/v0/search-markets?term={q}&limit=10` | `200`, JSON search results | Added with mapper for question, URL, probability, liquidity, volume, close time, resolution, and description. |

Deferred:

| Source | Result | Action |
| --- | --- | --- |
| Metaculus | `403`, authenticated API required | Add later only after account/API auth is available. |
| Sports odds APIs | Key/free-tier gated | Add later after keys are present and quotas are understood. |
