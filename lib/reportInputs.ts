type JsonObject = Record<string, unknown>;

function tryParseObject(value: string): JsonObject | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

export function buildAnalystModelInput(params: {
  task: string;
  researchText: string;
  research?: JsonObject | null;
  liveData?: JsonObject | null;
}): string {
  const research = params.research ?? tryParseObject(params.researchText);

  return JSON.stringify(
    {
      task: params.task,
      current_date: new Date().toISOString().slice(0, 10),
      current_source_set_only: true,
      prior_report_language_allowed: false,
      instructions: [
        'Base the analysis only on the provided research payload and live source state.',
        'Do not inherit framing from earlier report language or user assumptions.',
        'Do not introduce dates later than current_date.',
        'If liveData.current_events.framing_signals exist, preserve them exactly and keep conflict status separate from route status.',
        'If liveData.wallet_context exists, use it as private exposure context. Classify what the user actually holds (stablecoins, volatile crypto, DeFi, Gateway, mixed) and assess impact through those asset classes.',
        'Do not expose full wallet addresses, raw balances, or PnL unless the task explicitly asks for a balance/portfolio breakdown.',
      ],
      research: research ?? params.researchText,
      liveData: params.liveData ?? null,
    },
    null,
    2,
  );
}

export function buildWriterModelInput(params: {
  task: string;
  researchText: string;
  analysisText: string;
  research?: JsonObject | null;
  analysis?: JsonObject | null;
  liveData?: JsonObject | null;
}): string {
  const research = params.research ?? tryParseObject(params.researchText);
  const analysis = params.analysis ?? tryParseObject(params.analysisText);

  return JSON.stringify(
    {
      task: params.task,
      current_date: new Date().toISOString().slice(0, 10),
      current_source_set_only: true,
      prior_report_language_allowed: false,
      regenerate_from_latest_retrieved_sources: true,
      instructions: [
        'Write only from the provided research, analysis, and live source state.',
        'Do not reuse or preserve stale wording from earlier reports.',
        'Do not introduce dates later than current_date.',
        'Use a Perplexity-style structure: direct answer first, evidence bullets, uncertainty, then numbered sources with real URLs.',
        'Never cite source registry candidates or retrieval tools as sources; cite only actual retrieved publishers, APIs, or article URLs.',
        'If liveData.current_events.framing_signals exist, keep the broader conflict status and each route status aligned with those signals.',
        'If liveData.wallet_context exists, include a concise personalized impact section that explains how the event affects the detected exposure profile. Avoid raw balances, full wallet addresses, and PnL unless explicitly requested.',
        'For stablecoin-heavy portfolios, focus on peg, issuer/reserve, redemption/liquidity, regulation, rates/Treasuries, on/off-ramp, and Gateway/settlement risks rather than generic BTC/ETH volatility.',
      ],
      research: research ?? params.researchText,
      analysis: analysis ?? params.analysisText,
      liveData: params.liveData ?? null,
    },
    null,
    2,
  );
}
