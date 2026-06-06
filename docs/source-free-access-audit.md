# Source Free Access Audit

Last updated: 2026-05-22

Purpose: separate truly free public sources from limited free tiers, free web-only sources, trial-only APIs, and paid/enterprise APIs. This avoids treating a human-readable free website as a production-free API.

## Access Labels

| Label | Meaning | Registry guidance |
| --- | --- | --- |
| `free_public` | No API key or subscription needed for the useful endpoint, subject only to ordinary public rate limits. | Prefer `official_api` if JSON/API exists. |
| `free_key_limited` | Free account/key exists, but quotas, endpoints, history, redistribution, or commercial use are limited. | Keep `official_api` only with `requires_key` and clear caveats. |
| `free_web_only` | Public web/reports are free, but API is paid, unavailable, or not useful on the free tier. | Use `scrape`/`rss_plus_scrape`, not `official_api`. |
| `trial_only` | Free access is temporary trial/credits, not durable free access. | Do not call it free for registry purposes. |
| `paid_api` | API requires paid plan, enterprise/custom pricing, or sales contact for useful access. | Do not mark as free API. Use scrape only if public pages are useful and allowed. |
| `unknown` | Not verified yet from primary docs/current tests. | Keep out of production routing or mark for audit. |

## Crypto/Web3 Key Action List

### No API Key Needed

These can be used by AgentFlow without asking you for another key, assuming endpoint stability and normal public rate limits:

- CoinPaprika
- Binance Public API
- Kraken API
- Coinbase API, public spot prices only
- CoinCodex
- DeFiLlama
- L2Beat, if the public endpoint stays stable
- Tensor REST appraisal endpoints, based on current docs showing direct `https://api.tensor.so/...` REST calls

### No API Key, But Scrape/Web Only

These should not be treated as durable free APIs. Use public pages/reports only, and expect scrape quality/anti-bot issues:

- Token Terminal web pages, not API
- Artemis web pages, not API
- Messari public pages, but not reliable API on current free key
- CryptoQuant public/basic web, not useful free API
- Coinglass public pages only, API is not free
- Kaiko public pages/reports only, API paid/custom
- The Tie public pages only, API institutional/paid

### API Key Needed Even If Free/Limited

These are worth adding only if we intend to wire the matching source into the registry/adapter. Some are not currently present in `data/source-registry.json`, but this is the key shopping list.

| Source | Suggested env var | Notes |
| --- | --- | --- |
| CoinMarketCap | `CMC_API_KEY` | Already wired. Free key exists with plan limits. |
| CryptoCompare | `CRYPTOCOMPARE_API_KEY` | Free tier exists; current endpoint can work without key at low volume, but proper usage should use a key. |
| LiveCoinWatch | `LIVECOINWATCH_API_KEY` | Free key, 10,000 requests/day per official page. |
| The Graph | `THE_GRAPH_API_KEY` | Already documented. Needs GraphQL/API-key-in-path adapter work before useful. |
| Etherscan | `ETHERSCAN_API_KEY` | Free tier with rate/chain coverage limits. |
| Polygonscan | `POLYGONSCAN_API_KEY` | Same family; verify whether Etherscan V2 unified key can replace separate keys before adding. |
| Arbiscan | `ARBISCAN_API_KEY` | Same family; verify unified-key support. |
| BaseScan | `BASESCAN_API_KEY` | Same family; verify unified-key support. |
| Optimistic Etherscan | `OPTIMISTIC_ETHERSCAN_API_KEY` | Same family; verify unified-key support. |
| Solscan | `SOLSCAN_API_KEY` | Free/basic API plan exists, lower limits. |
| SubScan | `SUBSCAN_API_KEY` | Free developer plan exists, Pro has higher quotas. |
| DappRadar | `DAPPRADAR_API_KEY` | API can be tried for free, but free tier excludes some useful data. |
| Santiment | `SANTIMENT_API_KEY` | GraphQL; free metrics exist, broader metrics require paid plan. |
| LunarCrush | `LUNARCRUSH_API_KEY` | Free account gives very limited API calls/market data; paid needed for broader social intelligence. |
| Whale Alert | `WHALE_ALERT_API_KEY` | Free/limited plan has high minimum transaction thresholds; useful only for whale-scale alerts. |
| OpenSea | `OPENSEA_API_KEY` | Instant free-tier keys are possible, but key creation is rate-limited and keys expire after 30 days. |
| TokenInsight | `TOKENINSIGHT_API_KEY` | Free tier documented: 5K call credits/month, daily call credits under 200, 60/min, personal-use license. Locally verified on 2026-05-23: key loads, `/api/v1/ping` returns 200, and `/api/v1/simple/price?ids=bitcoin&vs_currencies=usd` returns BTC price data. |
| NFTGo | `NFTGO_API_KEY` | API uses `X-API-KEY`; dealer/customer key flow exists. Free production tier still not proven. |
| Reservoir | `RESERVOIR_API_KEY` | Free developer account/key documented; subscriptions unlock higher limits/features. |

### Still Not Worth Adding As Free API Keys

- CoinAPI: paid/pay-as-you-go, no normal durable free market-data plan confirmed.
- Kaiko: custom/enterprise data plans.
- Amberdata: startup/enterprise pricing and trial/free-access marketing, but durable production-free API not confirmed.
- Footprint Analytics: free web/tooling appears available, durable free API not confirmed.
- The Tie: institutional API suite.
- Coinglass: API pricing is inquiry/custom.

## Crypto/Web3 Batch 1

| Source | Current read | Access label | Registry implication |
| --- | --- | --- | --- |
| CoinGecko | Public/demo API and paid API plans exist; useful market endpoints can be used without paid subscription at low volume. | `free_key_limited` / limited public | Keep API, but expect quota/rate limits. |
| CoinMarketCap | Free API key exists; endpoint coverage and call credits are limited by plan. | `free_key_limited` | Keep `requires_key: true` with `CMC_API_KEY`. |
| CoinPaprika | Public REST API works for basic market/search data. | `free_public` | Good API source. |
| Binance Public API | Public market data endpoints are free but rate-limited. | `free_public` | Good API source for market data. |
| Kraken API | Public market data endpoints are free but rate-limited. | `free_public` | Good API source; occasional pair naming quirks. |
| Coinbase API | Public spot price endpoint works without key; trading APIs need auth. | `free_public` for spot prices | Use only public price endpoints unless adding auth. |
| CryptoCompare | Free API tier exists, key/quotas apply. | `free_key_limited` | Keep API, consider key support later. |
| CoinAPI | Official docs/pricing do not show a normal durable free plan for market data; pay-as-you-go/paid model dominates. | `paid_api` / `trial_only` | Do not treat as free API. |
| LiveCoinWatch | Offers free API key. Limits/features need account-level verification. | `free_key_limited` | API possible with key; not keyless. |
| CoinCodex | Public API documentation exists and endpoints are reachable for basic data. | `free_public` with attribution caveat | API possible; respect attribution/limits. |
| TokenInsight | Free API tier is documented: one key, 5K call credits/month, daily credits under 200, 60 requests/minute, personal-use license; paid tiers unlock more credits/commercial use. | `free_key_limited` | API possible with `TOKENINSIGHT_API_KEY`; do not assume commercial use on free tier. |
| DeFiLlama | Public APIs work without key for many DeFi/stablecoin/protocol datasets. | `free_public` | Excellent API source. |
| L2Beat | Public API/data endpoints exist for scaling summaries; site is free. | `free_public` / limited | Good API source, verify endpoint stability. |
| The Graph | Free plan exists, but API-key and GraphQL/billing model does not fit generic GET adapter. Free monthly quota is limited. | `free_key_limited` | Keep `requires_key`; needs GraphQL adapter, not generic official API. |
| Etherscan family | Free tier exists with rate/chain coverage limits; pro endpoints excluded. | `free_key_limited` | Keep key-gated API; avoid pro-only endpoints. |
| Solscan | Free API plan exists, lower-rate-limit/basic access. | `free_key_limited` | API possible with plan/key caveats. |
| SubScan | Free developer plan exists; Pro gives higher quotas. | `free_key_limited` | API possible with quotas. |
| DappRadar | API can be tried for free, but free tier excludes some useful NFT/DeFi/token data by plan. | `free_key_limited` | Verify endpoint coverage before routing. |
| Footprint Analytics | Free web/tooling appears available; durable free API access not confirmed from primary docs in this pass. | `unknown` / likely limited | Do not assume free API. |
| Artemis | Free web terminal/sheets-like usage exists; API access is paid/authenticated in current testing. | `free_web_only` / `paid_api` | Current registry scrape tag is right. |
| Token Terminal | Web/historical pages can be free, but API requires paid/custom subscription. | `free_web_only` / `paid_api` | Current registry scrape tag is right. |
| Messari | User key loads, but useful market/news/asset endpoints returned permission/payment errors in testing. | `free_web_only` / limited key | Keep disabled or scrape-only until key permissions are proven. |
| Kaiko | Custom enterprise data plans; no practical free API confirmed. | `paid_api` | Do not mark free API. |
| Amberdata | Institutional API product; free access/trial exists in marketing, durable production-free API not confirmed. | `trial_only` / `paid_api` | Do not mark free API without account verification. |
| CryptoQuant | Free web/basic data exists; API access appears plan-gated for useful programmatic access. | `free_web_only` / `paid_api` | Do not mark free API. |
| Santiment | Some metrics are free; broader API/query credits depend on plan. | `free_key_limited` | API possible only for free-labelled metrics/credits. |
| LunarCrush | Free plan has very limited market-data API only; social intelligence/API endpoints require paid plans. | `free_key_limited` | Keep only if using market endpoints and tiny quotas. |
| The Tie | Institutional API suite; no open free API plan confirmed. | `paid_api` | Do not mark free API. |
| Coinglass | API pricing is inquiry/custom; not a free API source. | `paid_api` | Use scrape only if public pages are useful. |
| Whale Alert | Free/trial access exists with strong limits such as minimum transaction values and plan-gated attribution. | `free_key_limited` / `trial_only` | Avoid as default unless limits fit use case. |
| OpenSea API | OpenSea now documents instant free-tier API-key creation without authentication. The key can be used immediately for API endpoints, but key creation is rate-limited and generated keys expire after 30 days. | `free_key_limited` | API possible with an automatically generated temporary key; add `OPENSEA_API_KEY` or a key-rotation flow before relying on it. |
| NFTGo | Developer API exists and uses `X-API-KEY`; docs show dealer/customer key generation, but free production tier is not proven. | `free_key_limited` / `unknown` | Add only with `NFTGO_API_KEY` after account verification. |
| Reservoir | Reservoir docs say the API is free to use with a free developer account/key; subscriptions add more apps, higher limits, and features. | `free_key_limited` | API possible with `RESERVOIR_API_KEY`; watch endpoint/product differences. |
| Tensor | Tensor REST docs show direct public `https://api.tensor.so/...` appraisal endpoints without an API-key requirement in examples. | `free_public` / limited | Treat as keyless for documented appraisal endpoints; verify before broader Tensor marketplace usage. |

## Working Rule For Registry Cleanup

1. `official_api` should mean a durable, reachable endpoint that the adapter can call today.
2. If the site is free but API is paid, use `scrape`, `rss`, or `rss_plus_scrape`.
3. If API is free only after signup, set `requires_key: true` and add `key_env_var`.
4. If API is trial-only or enterprise-only, do not count it as an AgentFlow free source.
5. If public pages are marketing dashboards behind heavy JS/anti-bot, do not assume scrape will be reliable.

## Sources Checked In This Pass

- CoinGecko API pricing: https://www.coingecko.com/en/api/pricing
- CoinMarketCap API pricing: https://coinmarketcap.com/api/pricing/
- CoinAPI pricing/FAQ: https://www.coinapi.io/Pricing and https://www.coinapi.io/products/exchange-rates-api/faq
- LiveCoinWatch API: https://www.livecoinwatch.com/tools/api
- CoinCodex API docs: https://coincodex.com/page/api/
- TokenInsight API/pricing: https://tokeninsight.com/en/products/api and https://tokeninsight.com/zh/products/api/pricing
- Kaiko pricing/contracts: https://www.kaiko.com/about-kaiko/pricing-and-contracts
- DappRadar API docs/blog: https://docs.dappradar.com/dappradar-api and https://dappradar.com/blog/dappradar-api-nft-defi-dapp-data
- LunarCrush pricing/FAQ: https://lunarcrush.com/pricing and https://lunarcrush.com/faq
- The Tie API docs/rate limit: https://www.thetie.io/solutions/apis/ and https://docs.thetie.io/reference/rate-limit
- CoinGlass pricing: https://www.coinglass.com/pricing
- Whale Alert docs/pricing: https://developer.whale-alert.io/ and https://developer.whale-alert.io/documentation/
- The Graph billing/pricing docs: https://thegraph.com/docs/fr/subgraphs/billing/ and https://thegraph.com/docs/tr/token-api/endpoint-pricing/
- Etherscan rate limits/free-tier notes: https://docs.etherscan.io/resources/rate-limits and https://info.etherscan.com/whats-changing-in-the-free-api-tier-coverage-and-why/
- Solscan API plans/terms: https://solscan.io/apis and https://docs.solscan.io/api-access/solscan-pro-api-terms-and-services
- Subscan API Pro/free plan docs: https://support.subscan.io/ and https://support.subscan.io/doc-735188
- Kraken API rate limits: https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-
- Coinbase Advanced/API docs/help: https://www.coinbase.com/developer-platform/products/advanced-trade-api/ and https://help.coinbase.com/en-gb/coinbase/trading-and-funding/advanced-trade/what-is-advanced-trade
- OpenSea API keys/changelog: https://docs.opensea.io/reference/api-keys and https://docs.opensea.io/changelog/new-api-endpoints
- TokenInsight free-tier docs: https://tokeninsight.com/zh/products/api/pricing and https://tokeninsight-api.readme.io/reference/api-key-usage-credits
- LiveCoinWatch API: https://www.livecoinwatch.com/tools/api and https://livecoinwatch.github.io/lcw-api-docs/
- Reservoir API free-key docs: https://nft.reservoir.tools/docs/is-the-reservoir-api-free-to-use and https://nft.reservoir.tools/docs/how-do-i-get-a-reservoir-api-key
- NFTGo developer API docs: https://docs.nftgo.io/ and https://docs.nftgo.io/reference/generate_dealer_key_api_v1_dealer_api_key_post
- Tensor REST docs: https://docs.tensor.so/consume/rest-api
- Santiment API docs/plans: https://santiment.github.io/articles/api-reference/ and https://academy-stage.santiment.net/products-and-plans/sanapi-plans/
- DappRadar API docs: https://docs.dappradar.com/dappradar-api
- Amberdata pricing/docs: https://www.amberdata.io/pricing and https://docs.amberdata.io/docs/market/prices

## Non-Crypto No-Key Sources Added In Batch 7

These were checked live on 2026-05-23 and added/corrected in `data/source-registry.json` as no-key API sources:

- Open-Meteo
- NOAA climate time-series
- NOAA NWS
- Climate Watch
- WHO Global Health Observatory
- Our World in Data Grapher CSV
- Wikipedia
- Wikidata
- DBpedia
- MusicBrainz
- TheAudioDB public endpoint
- Jikan MAL
- Open Food Facts
- Open Beauty Facts

Key-gated sources confirmed or deferred from this batch:

- EIA requires `EIA_API_KEY`; local key verified through the adapter on 2026-05-23.
- NOAA NCEI Access Services has newer no-key search/data endpoints under `/access/services/search/v1/data` and `/access/services/data/v1`; the older CDO v2 endpoint still uses `NOAA_CDO_API_KEY`.

## Non-Crypto No-Key Sources Added In Batch 8

Checked live on 2026-05-23 and added/corrected as no-key API sources:

- Nominatim
- USGS Earthquake Catalog
- GDACS
- Humanitarian Data Exchange
- OpenSky Network
- NASA JPL Fireball Data API
- NASA Earthdata CMR search
- GBIF
- iNaturalist

Deferred/key-gated from this batch:

- ReliefWeb v2 requires an approved app name from 2025-11-01; added as gated by `RELIEFWEB_APPNAME`.
- OpenStreetMap Overpass is no-key but needs source-specific query DSL before it is useful.
- eBird 1.1 is gone (`410`); eBird 2.0 requires `EBIRD_API_KEY` via `X-eBirdApiToken`. Local key verified through the adapter on 2026-05-23.
- Mapbox, GeoNames, N2YO, MarineTraffic, and FlightRadar24 need keys, paid access, or narrow scrape verification.

## Non-Crypto No-Key Sources Added In Batch 9

Checked live on 2026-05-23 and added/corrected as no-key API sources:

- Internet Archive advanced search
- Open Library search
- Library of Congress JSON API
- Wikisource MediaWiki API

Deferred from this batch:

- Gutendex / Project Gutenberg API is documented as public, but requests from this local environment hung for more than 20 seconds with zero bytes; do not rely on it until a stable path is found.
- HathiTrust needs a better identifier strategy.
- DOAB returned HTML for tested legacy API route.
- OpenStax tested API route failed from local environment.

## Non-Crypto No-Key Sources Added In Batch 10

Checked live on 2026-05-23 and added as no-key API sources:

- UniProt
- PDBe Protein Data Bank
- ITIS
- OBIS
- SIMBAD
- NASA/IPAC NED

Deferred from this batch:

- VizieR needs a proper TAP/VOTable endpoint path; tested catalogue URL returned HTML.
- Materials Project requires an API key; local `MATERIALS_PROJECT_API_KEY` verified through the adapter on 2026-05-23.
- GISAID is account-controlled and should not be treated as a durable free public API.
- ChemSpider requires API credentials; local `CHEMSPIDER_API_KEY` verified through the adapter on 2026-05-23.

## Non-Crypto No-Key Sources Added In Batch 11

Checked live on 2026-05-23 and added/corrected as no-key API sources:

- npm Registry
- PyPI
- Maven Central
- Stack Exchange / Stack Overflow search
- OSV
- deps.dev
- DEV.to

Deferred from this batch:

- Crates.io returned `503` from the current environment.
- libraries.io needs `LIBRARIES_IO_API_KEY`; local key verified through the adapter on 2026-05-23.

## Non-Crypto No-Key Sources Added In Batch 12

Checked live on 2026-05-23 and added as no-key API sources:

- DailyMed
- RxNorm
- NLM Clinical Tables Conditions
- NLM Clinical Tables RxTerms
- FDA NDC Directory

Deferred from this batch:

- HealthData.gov timed out or returned `404` for tested catalog routes.
- NHS Website Content API v2 uses `https://api.service.nhs.uk/nhs-website-content/...` and production auth via an `apikey` header. Local `NHS_API_KEY`, `NHS_SECRET_KEY`, and `NHS_APPLICATION_ID` are present for a Production app, but live checks on production and integration hosts return `401 Invalid ApiKey for given resource`. NHS developer community threads show this exact error when the Website Content API production connection is pending and needs NHS/APIM approval for the App ID. NHS assurance docs confirm production/live access is gated by API/service approval and onboarding. Do not add until NHS confirms the app/key is approved for Website Content API and the endpoint returns `200`.
- KFF needs current API/feed/scrape verification before insertion.
- OpenWeatherMap requires `OPENWEATHERMAP_API_KEY`; local key verified on 2026-05-23 and source added as key-gated `official_api`.
- WAQI requires `WAQI_API_KEY`
- TMDB requires `TMDB_API_KEY`
- OMDB requires `OMDB_API_KEY`
- Last.fm requires `LASTFM_API_KEY`
- Discogs requires `DISCOGS_API_KEY`

## Non-Crypto Sources Checked In Batch 13

Checked live on 2026-05-23 and corrected as working API sources:

- The Guardian: key-gated, local `GUARDIAN_API_KEY` verified; endpoint corrected to query-aware Content API search.
- Federal Register: no-key, endpoint corrected to query-aware documents API.
- Congress.gov: key-gated, local `CONGRESS_API_KEY` verified; endpoint corrected to summaries API, though broad-query relevance is weak and needs a later search-quality pass.
- US Census: key-gated, local `CENSUS_API_KEY` verified; existing ACS endpoint still works.
- BLS: no-key public API, existing CPI endpoint still works.
- Treasury FiscalData: no-key API works, but can be slow from the current environment.
- TreasuryDirect: previous human-site fallback returned `404`; registry now uses FiscalData average interest rates API while preserving TreasuryDirect as the human-facing source.

Deferred from this batch:

- BEA requires a registered API `UserID`; the old `sampleUser` returns `APIErrorCode 4`. Registry now requires `BEA_API_KEY`, but local key is not present yet.

## Non-Crypto Sources Checked In Batch 14

Checked live on 2026-05-23 and verified/corrected as no-key API sources:

- Eurostat: no-key JSON-stat API works; readable mapper added.
- OECD: no-key SDMX dataflow endpoint works, but useful report routing needs later per-dataset templates.
- ECB: no-key SDMX dataflow endpoint works, but useful report routing needs later per-series templates.
- BIS: no-key SDMX JSON endpoint works; registry corrected and readable mapper added.
- ILOSTAT: no-key JSON endpoint works; added to registry with readable mapper.
- WTO: key-gated Stats API works with local `WTO_API_KEY` using `Ocp-Apim-Subscription-Key`; added to registry with readable mapper.

Deferred from this batch:

- FAOSTAT timed out from the current environment.
- UN Comtrade returned `401` and requires a subscription key.

## Non-Crypto Sources Checked In Batch 15

Checked live on 2026-05-23 and corrected as no-key API sources:

- OpenAlex: query-aware works search; readable mapper added.
- Crossref: query-aware works search; readable mapper added.
- Semantic Scholar: query-aware paper search; readable mapper added. It can return `429` under light unauthenticated rate limits, but succeeds on retry.
- CORE: query-aware works search; readable mapper added.
- DOAJ: query-aware article search; readable mapper added.
- PubMed: query-aware E-utilities `esearch`; mapper added for result count and top PubMed IDs. Full metadata needs a later chained `esummary`/`efetch` workflow.
- Europe PMC: query-aware biomedical search; readable mapper added.
- ORCID: query-aware public search; mapper added for ORCID IDs.
- ROR: query-aware organization search; readable mapper added.

## Non-Crypto Sources Checked In Batch 16

Checked live on 2026-05-23 and verified/corrected as no-key API sources:

- SEC EDGAR: company facts API works; mapper added for entity/CIK/fact summary.
- SEC Company Tickers: SEC ticker map works; mapper added for ticker/title/CIK list.
- Federal Reserve: JSON press-release feed works; mapper added.
- OpenFDA: adverse-event endpoint works; mapper added.

Deferred from this batch:

- USAspending fetch failed from the current environment.
- GovInfo fetch failed from the current environment and generally needs a key for production use.
- CFPB complaints API timed out from the current environment.
- FDIC BankFind initially returned `200`, then timed out on direct retest and returned empty through the adapter. Deferred until stable from deployment environment.

## Non-Crypto Sources Checked In Batch 17

Checked live on 2026-05-23 and verified/corrected as no-key API sources:

- CourtListener: no-key REST v4 search API works for case-law search; registry corrected to query-aware endpoint and readable mapper added.
- CFTC Commitments of Traders: no-key Public Reporting Environment API works; added to registry with readable mapper for report date, market, open interest, and position fields.

Deferred from this batch:

- USPTO Patent File Wrapper Search returned `403 Forbidden` for tested official GET and POST search variants. Do not add until access requirements or a stable public endpoint are confirmed.
- WIPO PATENTSCOPE / WIPO Lex are free web databases, but no durable no-key JSON search endpoint was confirmed.
- EPO OPS and EUIPO APIs are portal/credential workflows, not no-key sources.
- FATF official high-risk jurisdictions page returned a challenge page from this environment.
- FinCEN candidate alerts/advisories URL returned `404`; needs current URL discovery before scrape insertion.

## Broad No-Key Intake Pass

Checked live on 2026-05-23. This pass intentionally prioritized no-key APIs and scrapeable public websites from the master list. Sources were added only when they returned usable JSON/XML/HTML without credentials from the current environment and did not require source-specific adapter support beyond the current GET/scrape model.

Added as no-key sources:

- Crypto & Web3: Deribit Public API, dYdX Public API, DeFiLlama Stablecoins, Crypto Fees, BitInfoCharts, Stablewatch, USDT Transparency, USDC Reserve Attestations, Chainabuse.
- News & Current Affairs: Hacker News API via Algolia, Lobste.rs, Techmeme, Reporters Without Borders, Committee to Protect Journalists.
- US Government & Legal: eCFR, GAO Reports, DOJ News, FTC News, Cornell Law LII.
- Geopolitics & International Orgs: EU Sanctions Map, NATO, African Union.
- Finance & Markets: Frankfurter FX, ECB Euro Exchange Rates, FINRA TRACE, WorldGovernmentBonds.com, LBMA, World Gold Council.
- Academic & Research: HAL, RePEc IDEAS, SSRN, Standard Ebooks, Directory of Open Access Books, Open Textbook Library, OpenStax.
- Sports: MLB Stats API, NHL API, Chess.com API, Lichess API, Jolpica F1 API.
- Statistics & Society: UN Population Division.

Deferred by field:

- Crypto & Web3: Bitnodes failed network fetch from current environment; Bankless DeFi Index tested URL returned `404`; De.Fi Scanner returned `403`; Socket API returned `401 Unauthorized`; dYdX old `/v4/markets` path returned `404` and was corrected to `/v4/perpetualMarkets`.
- News & Current Affairs: GDELT returned `429` despite no key requirement, so it needs stricter rate-limit handling before registry insertion; Wayback CDX timed out locally.
- US Government & Legal: USA.gov/Data.gov tested CKAN route returned `404`; Regulations.gov requires an API key; CBO and CRS returned challenge/403 pages; Justia returned a challenge/403 page.
- Geopolitics & International Orgs: UN Sanctions XML timed out locally; ASEAN returned a JavaScript redirect/interstitial.
- Finance & Markets: World Bank Pink Sheet tested route returned an XML error, not usable data; LME returned a challenge/403 page.
- Academic & Research: Project Gutenberg Gutendex returned `200` directly but hung through the adapter path, so it was removed again pending stability; no GraphQL/POST-only sources were added in this no-key GET/scrape pass.
- Cultural & Creative: AniList is no-key but GraphQL POST, so defer until official-api supports POST/GraphQL source metadata; TMDB and OMDb remain key-gated.
- Statistics & Society: NCES tested endpoint failed network fetch; FBI Crime Data API requires a data.gov API key.

## Post Broad-Pass Fixes

Checked live on 2026-05-23 after local `.env` was checked first. `API_DATA_GOV_KEY` and `ANALYTICS_USA_GOV_API_KEY` are present locally; secret values were not logged.

Resolved:

- Regulations.gov Documents: key-gated through `API_DATA_GOV_KEY`; endpoint works with `api_key` query parameter and `page[size] >= 5`. Added as `official_api`.
- FBI Wanted API: no-key REST endpoint documented by FBI and verified at `https://api.fbi.gov/wanted/v1/list`. Added as `official_api`.
- AniList: no-key GraphQL endpoint works. Added special GraphQL POST handling in `official-api.ts` and added source as `official_api`.
- GDELT: no-key DOC API works, but is slow/flaky from the current environment. Added as `official_api` with strict rate limit of 1 call per 6 seconds.

Still deferred:

- FBI Crime Data API: `API_DATA_GOV_KEY` is present, but tested `api.usa.gov/crime/fbi/...` routes returned `404`. This is an endpoint/path issue, not a missing-key issue. Keep deferred until the current production CDE endpoint is confirmed.
- Analytics.usa.gov: local key is present, but this is a separate analytics source and was not needed for Regulations.gov. Add only in a dedicated government/web-analytics pass.

## Keyed Source Fixes: Trade, Markets, And Sanctions

Checked live on 2026-05-23 after local `.env` was checked first. Local keys are present for `UN_COMTRADE_API_KEY`, `UN_COMTRADE_SECONDARY_KEY`, `BEA_Data_API`, `Alpha_Vantage_API_KEY`, `Finnhub_API_KEY`, `Twelve_Data_API_KEY`, and `FMP_API_KEY`.

Resolved:

- BEA: registry now uses local `BEA_Data_API`; `GETDATASETLIST` returns JSON dataset metadata and mapper produces readable dataset snippets.
- Alpha Vantage: registry now uses local `Alpha_Vantage_API_KEY`; global quote endpoint verified.
- Finnhub: registry now uses local `Finnhub_API_KEY`; adapter sends `token` query parameter and quote endpoint verified.
- Twelve Data: registry now uses local `Twelve_Data_API_KEY`; quote endpoint verified.
- Financial Modeling Prep: local `FMP_API_KEY` verified against the stable profile endpoint.
- UN Comtrade: added as key-gated `official_api` using `UN_COMTRADE_API_KEY` in `Ocp-Apim-Subscription-Key`. The heavy trade-data endpoints timed out locally, but `getLiveUpdate` returns current Comtrade release metadata reliably enough for registry inclusion.
- UN Sanctions List: added official no-key XML consolidated list endpoint. It returns current UN Security Council sanctions XML and is now available as `official_api`.

Still deferred:

- UN Comtrade detailed trade extraction: data endpoints timed out from the current environment even with the subscription key. Keep current source on `getLiveUpdate`; add narrower trade-data templates later.
- sanctions.io: API docs confirm it requires an API token via `Authorization: Bearer <token>` and versioned `Accept` headers. No local `SANCTIONS_IO_API_KEY` is present, so do not add yet.

## Wide Remaining-Source Scrape Intake

Checked live on 2026-05-23 after local `.env` was checked first. `GOVINFO_API_KEY` is present locally.

Added as verified public scrape targets:

- Country statistics and central banks: Statistics Canada, Reserve Bank of Australia, Swiss National Bank, Bank of Israel, Bank Indonesia, Banco de Mexico, South African Reserve Bank, Destatis Germany, INSEE France, ISTAT Italy, SCB Sweden, SSB Norway, Stats NZ.
- Legal and IP: WIPO, International Court of Justice.
- Sports: Olympics.com, FIFA, World Athletics, WTA Tennis, PGA Tour, Transfermarkt, Understat, HLTV, Liquipedia.
- Transport, shipping, tourism, aid, religion: Bureau of Transportation Statistics, AirNav, VesselFinder, Flexport Research, US Travel Association, AidData, IATI, World Religion Database, Pew Religion.
- Regional news and think tanks: Premium Times Nigeria, Council on Foreign Relations, Brookings, Carnegie Endowment, Atlantic Council, International Crisis Group, ECFR.
- Finance scrape/public pages: FinViz, StockCharts, Zacks, Roic.ai, Simply Wall St, Finbox, VettaFi, SWF Institute.
- Science/public reference: NIST Chemistry WebBook, Crystallography Open Database, USGS Publications, OSTI.gov, DTIC.

Added after the latest `.env` check:

- WAQI: local key present and verified; added as key-gated `official_api` using `token`.
- OMDB: local key present and verified; added as key-gated `official_api`.
- TVMaze: public show search endpoint verified without a key; added as no-key `official_api`.
- Last.fm: local key present and verified; added as key-gated `official_api` using `api_key`.

Deferred by field:

- Country statistics and central banks: Reserve Bank of New Zealand, Bank Negara Malaysia returned `403`; Central Bank of Turkey looked like an anti-bot/interstitial page; National Bank of Poland and Statistics South Africa returned Incapsula/noindex shell pages.
- Legal/courts: WorldLII, CanLII, AustLII, SAFLII returned Cloudflare/anti-bot pages; HUDOC and International Criminal Court returned pages that looked like JS/security shells; EPO fetch failed from local Node.
- Sports: ATP Tour returned Cloudflare/anti-bot.
- Transport/shipping/tourism: Container xChange and UN Tourism returned Cloudflare/anti-bot.
- News/think tanks: Arab News, Bangkok Post, Daily Maverick, RAND, Chatham House, Al-Monitor, The Standard Kenya were blocked, TollBit-gated, or anti-bot-heavy from this environment.
- Finance: MarketWatch, Barchart, GuruFocus, ETF.com, Global SWF were blocked or anti-bot; QuickFS failed network fetch; Morningstar returned `202` and was left out pending better scrape verification.
- Science/books: GISAID is public-facing but controlled for actual data access, so not added as a production research source; National Academies Press timed out locally.
- Cultural/media: Discogs consumer key/secret are present locally and match the app-credential shape shown in the Discogs developer page, but live checks still return `401 Invalid consumer key/secret`. Tested both `key`/`secret` query params and `Authorization: Discogs key=..., secret=...` header with a required User-Agent. The correct production path for AgentFlow is now `DISCOGS_USER_TOKEN` with `Authorization: Discogs token=...`; registry and adapter are wired for that token. The screenshot shows a token, but the actual saved `.env` did not contain `DISCOGS_USER_TOKEN` during verification. Discogs data dumps at `https://data.discogs.com/` are public bulk XML dumps, useful for a future dataset ingestion job, not the real-time adapter path.

## Prediction Market Sources

Checked live on 2026-05-23 and added as no-key `official_api` sources:

- Polymarket Gamma: `https://gamma-api.polymarket.com/public-search?q={q}&limit=10`
- Kalshi public trade API: `https://external-api.kalshi.com/trade-api/v2/markets?limit=1000&status=open`
- Manifold Markets: `https://api.manifold.markets/v0/search-markets?term={q}&limit=10`

These sources provide market-native questions, URLs, outcome prices/probabilities, volume/liquidity, close times, and resolution/rules fields where available. Polymarket and Manifold now use query-aware search endpoints. Kalshi's public markets endpoint did not appear to honor search params in live testing, so AgentFlow fetches open markets and applies local relevance ranking; if no Kalshi market matches the query terms, it returns no items instead of noisy unrelated markets.

Deferred:

- Metaculus returned `403`; API access requires authenticated account/API setup.
- Sports odds providers such as The Odds API require keys/free tiers and should be added only when keys are present.

## Robots.txt Audit For Scrape Sources

Added `npm run audit:robots` on 2026-05-23 to check `robots.txt` for enabled `scrape` and `rss_plus_scrape` registry sources before relying on Firecrawl. The script checks each source origin, applies the `User-agent: *` or AgentFlow-specific group when present, and flags root-level `Disallow: /`.

Latest run:

- Checked scrape-style sources: 213
- Allows root: 193
- No robots.txt found: 10
- Fetch failed / manually verify: 6
- Blocks root: 4

Root-blocked sources to defer or replace with official/API/feed paths:

- Lobste.rs
- Cricbuzz
- Understat
- Crystallography Open Database

Manual verification needed because `robots.txt` fetch failed:

- The Block
- Daily Maverick
- Japan Times
- RBI
- IMO
- South African Reserve Bank

No `robots.txt` found, but still respect source terms/rate limits:

- The Record
- Risky Business
- CERT/CC
- OpenZeppelin
- Google Research
- LangChain
- Crypto Fees
- EU Sanctions Map
- HITRAN
- NIST Atomic Spectra
