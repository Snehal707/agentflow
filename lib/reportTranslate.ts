import { callHermesFast } from './hermes';

// Translate a finished assistant message into a target language. Used for both
// research reports AND deterministic action receipts (swap/pay/bridge/etc.).
// We translate the already-assembled English text rather than generating
// in-language, so everything — body, headings, labels, and English scaffolding —
// comes out consistently translated. Uses the FAST model: translating existing
// English is far easier than generating, so quality holds and it runs in a few
// seconds. Only runs for non-English requests, so the English path is untouched.

const TRANSLATE_SYSTEM = `You translate a finished assistant message — a research report OR an action receipt/status message (e.g. a swap, payment, or bridge confirmation) — into a target language.

Rules:
- Output ONLY the translated text. No preamble, no commentary, no surrounding code fences.
- Translate ALL human-readable text: prose, headings, section titles, table headers, list items, and labels (e.g. "Summary", "Sources", "Provider", "Route", "Impact", "Swap complete", "Settled on Arc", "Approval tx", "Executed from", "Explorer").
- Preserve EXACTLY, never translate or alter: markdown structure and symbols (#, *, -, |, >, and links like [text](url)); numbers, percentages, dates; currency and token tickers (USDC, EURC, BTC, ETH); URLs; domain and source names; code; proper nouns (company, product, person names); wallet addresses and transaction hashes (any 0x... hex string); and the literal confirmation keywords YES, NO, and CONFIRM (keep them as the exact English word).
- Keep the exact same structure, ordering, tables, and links. Do not add, remove, summarize, or invent anything.`;

export async function translateReportMarkdown(
  markdown: string,
  targetLanguageName: string,
): Promise<string> {
  const input =
    `Target language: ${targetLanguageName}\n\n` +
    `Translate the following into ${targetLanguageName}, following the rules exactly:\n\n${markdown}`;
  const out = await callHermesFast(TRANSLATE_SYSTEM, input);
  const trimmed = (out ?? '').trim();
  // Fail-safe: if the model returns nothing, keep the original English text
  // rather than dropping the message entirely.
  return trimmed || markdown;
}

// Clearer alias for non-report callers (receipts/status messages).
export const translateAssistantText = translateReportMarkdown;

// Localize a deterministic assistant reply to the given language name (or return
// it unchanged for English / no language). Never throws — falls back to the
// original text on any error, so a translation hiccup can't drop a reply.
export async function localizeReply(
  text: string,
  targetLanguageName: string | null,
): Promise<string> {
  if (!targetLanguageName || !text || !text.trim()) {
    return text;
  }
  try {
    return await translateReportMarkdown(text, targetLanguageName);
  } catch {
    return text;
  }
}
