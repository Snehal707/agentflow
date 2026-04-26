import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * Reads OPENAI_API_KEY from a .env file (line-based, no full dotenv parser).
 * Strips optional surrounding quotes on the value.
 */
function readOpenAiKeyFromFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "OPENAI_API_KEY") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * Resolves the OpenAI API key for server routes. Uses `process.env` first; if
 * missing or blank (e.g. empty `OPENAI_API_KEY=` in `.env.local` overwrote the
 * monorepo root), scans env files in order and returns the first non-empty key.
 */
export function resolveOpenAiApiKey(): string | undefined {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "..", ".env"),
    path.join(cwd, "..", ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
  ];

  for (const p of candidates) {
    const k = readOpenAiKeyFromFile(p);
    if (k) return k;
  }
  return undefined;
}
