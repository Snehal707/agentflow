## Post-launch cleanup

### Routing
- dev:stack flakiness on Windows shell (manual service starts work)
- Chat trace messages "AgentFlow routed to vault engine / executed on Arc / receipt recorded" fire BEFORE actual execution. Wire to actual events post-launch.
- Treasury Tier 2 dispatch deferred until admin role infrastructure exists.
- Vision/Transcribe Tier 2 routing deferred until liveAgentClient.ts attachment threading is updated.

### Idempotency
- Rapid duplicate YES requests in dev:stack return "AgentFlow is restarting" instead of real 409. Validate in production via two browser tabs (executionGuard already verified via swap_tokens earlier in session).

### Telemetry
- Investigate why Alchemy throughput limit was at 27% (pre-RPC fix). Confirm new rate is healthy.
- brain_events: Tier 2 intent_router rows show outcome=tool_error before final success override. Pre-existing finalization behavior; investigate outcome write ordering post-launch.

### Phase 1 follow-ups
- ✅ Phase 1 prompt surgery applied — hallucination class killed
- ✅ Predmarket fastpath hardened for natural variants
- ✅ Schedule and contacts are already covered by deterministic non-Hermes handlers; do not re-flag them as unwired Hermes surfaces
- 🟡 Phase 2 telemetry upgrade (experiment_variant column, [HERMES_FREEFORM_AGENT_QUERY] log) — pending
- 🟡 Phase 3 fastpath expansion for unwired Telegram surfaces — pending; revisit which actually need it given schedule and contacts are already covered
- 🟡 "agentflow_circle_stack" capability response polish — defer

### Migration notes
- check_apy vault tool retired; replaced by action='list' with per-vault live APY.
- Bridge port migrated from :3013 to :3021 to make room for predmarket. Production env vars (Railway) need BRIDGE_AGENT_PORT updated if set explicitly.
- Local dev port map:
  - 3010 facilitator
  - 3011 swap
  - 3012 vault
  - 3013 predmarket
  - 3021 bridge
- Production deploy checklist:
  - If Railway sets BRIDGE_AGENT_PORT explicitly, update it to 3021.
  - If frontend or proxy env overrides are used, set NEXT_PUBLIC_PREDMARKET_AGENT_URL / PREDMARKET_AGENT_URL for the predmarket agent.

### Predmarket polish (post-launch)
- M6 idempotency masked by dev:stack restart fallback. Validate crisp "no pending action" response in production via two-tab test. Same root cause as vault M6.
- M8 / unavailable redeem/refund: trace metadata overstates as if execution occurred. Trace wording needs tightening for not-available-yet states.
- M4 / buy result returns maxCostRaw upper bound, not exact cost. Add SharesBought event parsing in lib/predmarket/providers/achmarket.ts buy() to return actual costPaidRaw for accurate display.

## Session: AchMarket integration + Phase 1 prompt surgery

- DONE AchMarket integration shipped (passes 1-5)
  - 53 markets browsable, full LMSR support
  - Live test bet executed: tx 0xf84cd057...
  - Pricing: $0.012/execution, free reads
- DONE Bridge port migrated: 3013 -> 3021 to make room for predmarket
- DONE Predmarket on :3013, all 4 actions verified
- DONE Phase 1 prompt surgery applied to lib/agent-brain.ts
  - Removed prompt promises for unregistered tools
  - Added "do not invent state" hard rule
  - Hallucination class (fake tx hashes) eliminated
- DONE Predmarket fastpath hardened: 8 natural variants now route
- DONE Schedule/contacts telemetry normalized to fastpath labels
- DONE Roster fixed to 12 public agents (predmarket included)

Remaining work (priority order):
1. Phase 3: agentpay_send fastpath (BLOCKER for chat payments)
2. Phase 3: agentpay_history fastpath (visibility for sent payments)
3. Phase 2: experiment_variant + [HERMES_FREEFORM_AGENT_QUERY] log
4. Polish: agentflow_circle_stack capability response
5. Polish: "trace says 'executed on Arc' before actual execution" (vault + predmarket scaffolding)
