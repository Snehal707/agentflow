// Decide whether a research report should be written in a non-English language.
//
// The research/analyst pipeline runs on the cheap fast model (70B) by default,
// which is fine for English (the vast majority of traffic). We only escalate the
// WRITER stage to the deep model (405B) when the report is actually requested in,
// or written in, another language — so we don't pay for 405B on every run.
//
// Triggers (either one):
//   1) The user explicitly asks for a language, e.g. "... in Spanish",
//      "genera el informe en español", "report Hindi mein".
//   2) The request itself is written in a non-English language (detected by
//      non-Latin script, or by strong Latin-script European-language signals).
//
// Returns null for English / unknown (keep the cheap fast path).

export type ReportLanguage = { code: string; name: string };

const NAMED: Record<string, ReportLanguage> = {
  english: { code: "en", name: "English" },
  ingles: { code: "en", name: "English" },
  spanish: { code: "es", name: "Spanish" },
  espanol: { code: "es", name: "Spanish" },
  "español": { code: "es", name: "Spanish" },
  castellano: { code: "es", name: "Spanish" },
  french: { code: "fr", name: "French" },
  francais: { code: "fr", name: "French" },
  "français": { code: "fr", name: "French" },
  german: { code: "de", name: "German" },
  deutsch: { code: "de", name: "German" },
  italian: { code: "it", name: "Italian" },
  italiano: { code: "it", name: "Italian" },
  portuguese: { code: "pt", name: "Portuguese" },
  portugues: { code: "pt", name: "Portuguese" },
  "português": { code: "pt", name: "Portuguese" },
  hindi: { code: "hi", name: "Hindi" },
  thai: { code: "th", name: "Thai" },
  // Best-effort extras (honored if explicitly requested, even if not in the
  // officially-supported 8 — the user asked, so we comply).
  chinese: { code: "zh", name: "Chinese" },
  mandarin: { code: "zh", name: "Chinese" },
  japanese: { code: "ja", name: "Japanese" },
  korean: { code: "ko", name: "Korean" },
  arabic: { code: "ar", name: "Arabic" },
  russian: { code: "ru", name: "Russian" },
};

// 1) Explicit "in <language>" style instruction.
function detectExplicit(text: string): ReportLanguage | null {
  const lower = text.toLowerCase();
  // "... in spanish", "report in french", "respond/write/generate ... in X"
  const inMatch = lower.match(
    /\b(?:in|en|into|reply in|write in|respond in|answer in|report in|generate (?:the |a )?report in)\s+([a-zà-ÿñ]+)\b/,
  );
  if (inMatch && NAMED[inMatch[1]]) return NAMED[inMatch[1]];
  // "<language> mein/me" (Hindi-style), "<language> me likho"
  const meMatch = lower.match(/\b([a-zà-ÿñ]+)\s+(?:mein|me)\b/);
  if (meMatch && NAMED[meMatch[1]]) return NAMED[meMatch[1]];
  // Bare language name mention near report/translate keywords.
  if (/\b(report|informe|rapport|translate|translation|language|idioma)\b/.test(lower)) {
    for (const key of Object.keys(NAMED)) {
      if (key !== "english" && new RegExp(`\\b${key}\\b`).test(lower)) return NAMED[key];
    }
  }
  return null;
}

// 2a) Non-Latin script detection.
function detectByScript(text: string): ReportLanguage | null {
  const ranges: Array<[RegExp, ReportLanguage]> = [
    [/[ऀ-ॿ]/g, { code: "hi", name: "Hindi" }],
    [/[฀-๿]/g, { code: "th", name: "Thai" }],
    [/[぀-ヿ]/g, { code: "ja", name: "Japanese" }],
    [/[가-힯]/g, { code: "ko", name: "Korean" }],
    [/[一-鿿]/g, { code: "zh", name: "Chinese" }],
    [/[؀-ۿ]/g, { code: "ar", name: "Arabic" }],
    [/[Ѐ-ӿ]/g, { code: "ru", name: "Russian" }],
  ];
  for (const [re, lang] of ranges) {
    const hits = text.match(re);
    if (hits && hits.length >= 2) return lang;
  }
  return null;
}

// 2b) Latin-script European languages — conservative: require >= 2 distinct
// language-specific stopwords so English is never misflagged (false positives
// waste the deep model, which is exactly what we want to avoid).
const EURO_STOPWORDS: Array<{ lang: ReportLanguage; words: string[] }> = [
  { lang: { code: "es", name: "Spanish" }, words: ["el", "la", "los", "las", "un", "una", "qué", "cómo", "sobre", "informe", "genera", "por favor", "para", "del", "está"] },
  { lang: { code: "fr", name: "French" }, words: ["le", "la", "les", "un", "une", "que", "comment", "rapport", "génère", "s'il", "pour", "sur", "avec", "vous"] },
  { lang: { code: "de", name: "German" }, words: ["der", "die", "das", "und", "ein", "eine", "bericht", "über", "erstelle", "bitte", "für", "mit", "nicht"] },
  { lang: { code: "pt", name: "Portuguese" }, words: ["o", "os", "as", "um", "uma", "que", "como", "relatório", "gere", "sobre", "para", "com", "está"] },
  { lang: { code: "it", name: "Italian" }, words: ["il", "lo", "gli", "un", "una", "che", "come", "rapporto", "genera", "per favore", "sulla", "con"] },
];

function detectLatinEuropean(text: string): ReportLanguage | null {
  const tokens = text.toLowerCase().split(/[^a-zà-ÿ'']+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const tokenSet = new Set(tokens);
  let best: { lang: ReportLanguage; score: number } | null = null;
  for (const { lang, words } of EURO_STOPWORDS) {
    const score = words.filter((w) => (w.includes(" ") ? text.toLowerCase().includes(w) : tokenSet.has(w))).length;
    if (score >= 2 && (!best || score > best.score)) best = { lang, score };
  }
  return best?.lang ?? null;
}

export function resolveReportLanguage(task: string): ReportLanguage | null {
  const text = (task ?? "").trim();
  if (!text) return null;

  const explicit = detectExplicit(text);
  if (explicit) return explicit.code === "en" ? null : explicit;

  const script = detectByScript(text);
  if (script) return script;

  const euro = detectLatinEuropean(text);
  if (euro) return euro;

  return null; // English / unknown -> keep the cheap fast path
}
