# Research Retrieval Architecture (Search-First + Hybrid Timeout)

Date: 2026-05-27

## Overview

AgentFlow fast research now has two retrieval modes:

- search-first public retrieval for external topics
- internal capability retrieval for AgentFlow-native product questions

The architecture is designed to:

- prefer live public evidence when the topic is external
- prefer internal evidence when the topic is about AgentFlow capabilities
- preserve deterministic enrichers such as CoinGecko, DefiLlama, and Wikipedia
- improve cold-path reliability for forecasting and niche protocol research
- keep the default path on a tighter latency budget

## Search Backend

Primary public-web search evidence is collected through a hybrid path:

- `Firecrawl /v2/search`
  - runs through Firecrawl search + scrape
  - returns enriched results with markdown/body-derived summaries
- `SearXNG /search`
  - called directly from AgentFlow
  - returns fast JSON meta-search results

These two paths run in parallel per selected query variant.

Result merge rules:

- dedupe by URL
- prefer Firecrawl-enriched results when both paths return the same URL
- use SearXNG-only results to fill gaps when Firecrawl misses a URL or runs long

Operationally, Firecrawl itself also uses SearXNG as its internal backend on the Hetzner box, so the stack now has:

- Firecrawl backed by SearXNG
- direct SearXNG as an independent fallback path

## Query Normalization

Before public search, the query builder normalizes prompts to improve recall and reduce weak search strings.

Normalizations include:

- strip research scaffolding:
  - `make a research on`
  - `research on`
  - `tell me about`
  - `what is`
  - `give me a report on`
  - `report on`
  - `analyze`
- expand common crypto symbols:
  - `btc -> bitcoin`
  - `eth -> ethereum`
  - `sol -> solana`
  - `bnb -> binance coin`
  - `xrp -> ripple`

Forecasting queries use dedicated forecasting variants instead of current-state variants.

Examples:

- `research on btc over the next 10 years`
  - `bitcoin over the next 10 years`
  - `bitcoin price prediction 2036`
  - `bitcoin long term forecast`
  - `bitcoin 10 years outlook`
  - `bitcoin growth potential`
- `bitcoin price prediction 2030`
  - `bitcoin price prediction 2030`
  - `bitcoin 2030 price prediction`
  - `bitcoin 2030 long term forecast`
  - `bitcoin 2030 future outlook`

Non-forecasting queries keep the current-state variant logic.

## Internal Capability Layer

Fast research now has an internal capability path for AgentFlow-native questions that should not default to public web search.

Design rules:

- capability-first detection decides whether the question is about an internal AgentFlow surface
- entity narrowing is secondary and only focuses retrieval after a capability has already fired
- capability detection requires AgentFlow or user-operation framing, not just a raw keyword match
- ambiguous cases fall through to normal web research

Examples:

- `show me yield options` -> internal vault capability
- `lunex vault yields` -> internal vault capability with Lunex narrowing
- `what is AgentPay` -> internal AgentPay capability
- `yield curve outlook` -> external research, not internal vault retrieval

## Explicit Research Request Detection

Chat routing treats explicit research requests as research pipeline requests before product FAQ or direct feature routes can answer them.

Trigger patterns:

- `research` at the start of the message
- the phrase `research report`
- imperative verb plus `research`, such as `make research`, `make a research`, `do research`, `run research`, `write research`, `create research`, `give me research`, `prepare research`, or `generate research`
- imperative verb plus `report on/about`, such as `make a report on bitcoin`, `write report about ethereum`, or `generate a report on fed rates`

This intentionally catches requests like:

- `Make a research report on the current market and how it affects my portfolio`
- `make a research on btc`
- `research bitcoin`
- `prepare a research report on stablecoins`

The explicit request check overrides product FAQ and direct AgentFlow feature routing, so a deliverable request does not get answered with a product explainer.

The check does not treat genuine product questions as research requests:

- `What is research in AgentFlow`
- `How does research work`
- `What can research do`
- `Explain AgentFlow research`

It also preserves conversational mentions of research:

- `I read some research on bitcoin yesterday`
- `The research I found was interesting`
- `I'm doing my own research`
- `Found some good research material`

## Clarify Outcome

Capability-aware routing now has a third outcome besides feature execution and research:

- `clarify`

This fires only for:

- `bridge`
- `vault`
- `swap`

Conditions:

- capability is confirmed
- there is no action signal
- ambiguity cues are present

Examples of ambiguity cues:

- `vs`
- `compare`
- `comparison`
- `best`
- `fees`
- `providers`
- `sources`

Examples:

- `arbitrum vs base` -> clarify
- `lunex yields` -> clarify
- `swap fees comparison` -> clarify
- `best vault providers` -> clarify
- `compare bridge sources` -> clarify

The clarify reply uses the existing `quickActionGroups` pattern.

Important implementation notes:

- no Redis pending state is used
- button clicks send a normal next user message
- the next message is routed through the standard chat flow again

Prompt design rules:

- research-option prompts use external framing
  - `research Arbitrum vs Base bridge comparison`
  - `research swap fees across DEX providers`
  - `research bridge source chain comparison`
  - `research yield vault providers in DeFi`
- feature-option prompts keep AgentFlow framing
  - `show supported bridge source chains`
  - `show me Lunex vault options`
  - `show me vaults`
  - `swap 1 USDC to EURC`

This keeps the clarify branch stateless while still letting the next message resolve cleanly.

## Framing Discriminator

Internal capability detection uses framing scores to avoid false positives.

Internal framing examples:

- explicit product scope:
  - `AgentFlow`
  - `on AgentFlow`
  - `via AgentFlow`
- direct capability phrasing:
  - `show me`
  - `list`
  - `how do I`
  - `what is`
  - `can I`
- product-native entities:
  - `.arc`
  - `Lunex`
  - `achswap`
  - `swaparc`
- user-funds phrasing:
  - `my funds`
  - `my balance`
  - `my idle USDC`

External framing examples:

- `outlook`
- `forecast`
- `analysis`
- `comparison`
- `yield curve`
- `DeFi strategies`
- external protocol or product references such as `Aave`, `Lido`, or `Telegram stock`

The detector only fires internal capability retrieval when internal framing beats external framing. If the result is ambiguous, the request falls through to web research.

## Capability and Entity Model

Implemented capabilities in the fast research path:

- `vault`
- `swap`
- `bridge`
- `agentpay_feature`
- `telegram_feature`
- `agentflow_feature`

Predmarket is intentionally deferred because it crosses the boundary between internal integration state and external public reputation.

Entity narrowing is registry-driven:

- vaults from `LUNEX_VAULTS`
- bridge sources from `SUPPORTED_BRIDGE_SOURCES`
- swap providers from `getDexProviderNames()`
- AgentPay, Telegram, and general AgentFlow feature aliases from Product KB docs

There are no hardcoded provider lists in the detector.

## Registry-Driven Internal Retrieval

Internal retrieval reads runtime registries and product docs instead of assuming fixed provider names.

Current internal retrieval paths:

- `vault`
  - Product KB
  - `listAllVaults()`
  - optional wallet positions
  - APY only for explicit yield-focused asks, with timeout guard
- `swap`
  - Product KB
  - DEX provider names from the router export
  - optional quote only when a pair is extractable
- `bridge`
  - Product KB
  - supported source-chain registry
  - no live bridge-state claims
- `agentpay_feature`
  - Product KB slices selected by query topic
  - optional `.arc` on-chain resolution when a specific handle is named
- `telegram_feature`
  - Product KB only
- `agentflow_feature`
  - Product KB only

## AgentPay Surface Coverage

The AgentPay internal capability path covers all eight dedicated Product KB sections:

- `agentpay`
- `schedule-payments`
- `split-payments`
- `batch-payments`
- `invoices`
- `contacts`
- `arc-handles`
- `payment-links-qr`

Retrieval selects only the relevant sections for the query instead of always loading all eight.

Examples:

- scheduling query -> `agentpay`, `schedule-payments`
- split query -> `agentpay`, `split-payments`
- batch query -> `agentpay`, `batch-payments`
- invoice query -> `agentpay`, `invoices`
- payment link or QR query -> `agentpay`, `payment-links-qr`
- contacts query -> `agentpay`, `contacts`
- `.arc` handle query -> `agentpay`, `arc-handles`

## Per-Class Timeout

Fast research uses a hybrid live-data timeout policy for public retrieval.

- forecasting: `120s`
- niche protocol: `90s`
- current-events: `60s`
- default: `45s`

This policy is applied only to live-data retrieval in the research agent. It does not change routing, deep research, or execution-tool timeouts.

## Detection Functions

Timeout dispatch and retrieval shaping rely on existing deterministic detectors:

- `detectForecastingIntent`
  - recognizes long-horizon, prediction, and outlook phrasing
- `detectProtocolQueryShape`
  - identifies niche crypto or protocol-shaped asks such as status and strong crypto protocol prompts
- `shouldGatherCurrentEvents`
  - identifies current-events, macro, and geopolitics style asks

Fallback behavior:

- if no specific class matches, use the default `45s` budget

## Cache Behavior

Cache rules were tightened to avoid stale empty-result poisoning:

- do not negative-cache empty Firecrawl result sets at normal TTL
- do not cache fully empty final `liveData` payloads
- retry once on a full-empty Firecrawl search outcome

This keeps warm-path benefits without locking future runs behind transient empty responses.

## Integration Point

The internal capability path runs only inside fast research.

Location:

- [agents/research/server.ts](/c:/Users/ASUS/agent-economy/agents/research/server.ts:517)

Order of execution:

- after chat fast-paths have already classified the message as research-shaped
- after capability-aware routing has already filtered out action requests
- clarify replies are emitted from the chat fast-path direct-route layer, not from research

## Research Prefix Hard Guard

Messages starting with:

- `^\s*research\b`

now get a deterministic routing override:

- `parseDirectAgentFlowRoute(...)` immediately returns `null`
- `shouldHandleAsResearchRequest(...)` immediately returns `true`

This means:

- `research X` -> always external research
- non-prefix uses of `research` continue through normal logic

Examples:

- `research bridge fees` -> research
- `research swap providers` -> research
- `I want to research bridges later` -> not matched by the hard guard
- `find research on vaults` -> not matched by the hard guard

This hard guard is intentionally redundant with capability-aware explicit research cue detection. It protects against future drift where a new feature fast-path might otherwise intercept a `research X` query because of bridge, vault, or swap keywords later in the message.

## Known Limitations

- predmarket clarify is deferred
  - AchMarket and similar cases cross the boundary between internal integration state and external public reputation
  - a dedicated cross-boundary policy is still needed post-launch

- internal capability routing still has known pre-existing external-research edge cases:
  - `yield curve outlook`
  - `DeFi yield strategies`
  - `L2 bridge designs`
  - `Aave yields`
  - `Lido staking status`
  - `Will ARC launch its Mainnet before June 30`

- clarify currently targets only:
  - `bridge`
  - `vault`
  - `swap`

- deep research is unchanged
  - clarify and internal capability retrieval live in fast research / chat routing only
- after the normal research classification step

The local `hasActionSignal(...)` check is defensive only. The primary protection against transactional interception happens upstream.

## Known Limitations

- cold-path latency is higher for forecasting queries
  - this is acceptable for the user's explicit research latency budget
- direct web search is still the wrong source for AgentFlow-internal entities such as:
  - Lunex vault
  - Arc-native internal or community flows
  - AgentFlow-specific product surfaces
- those entities need a separate retrieval path using:
  - product RAG
  - structured capability registries
  - on-chain reads
- predmarket retrieval is deferred post-launch
  - cross-boundary policy is still needed because public reputation and external coverage are distinct from internal integration state

## Files

Core implementation lives in:

- [lib/firecrawl.ts](/c:/Users/ASUS/agent-economy/lib/firecrawl.ts:1)
- [lib/live-data.ts](/c:/Users/ASUS/agent-economy/lib/live-data.ts:1)
- [lib/internal-capability-detection.ts](/c:/Users/ASUS/agent-economy/lib/internal-capability-detection.ts:1)
- [lib/internal-capability-retrieval.ts](/c:/Users/ASUS/agent-economy/lib/internal-capability-retrieval.ts:1)
- [lib/dex/router.ts](/c:/Users/ASUS/agent-economy/lib/dex/router.ts:1)
- [agents/research/server.ts](/c:/Users/ASUS/agent-economy/agents/research/server.ts:1)
