/**
 * Date utilities for Supabase/Postgres values.
 *
 * Most of our timestamp columns are declared as `timestamp` (without time
 * zone). Postgres stores UTC values there via `now()`, but the bare `timestamp`
 * type is serialized by Supabase/PostgREST as a naive ISO string with NO
 * timezone suffix — e.g. `"2026-04-17T11:36:55.123"`.
 *
 * JavaScript's `new Date(...)` parses that naive form as LOCAL time per
 * ECMA-262, which makes the browser render UTC timestamps as if they were
 * already local — off by the user's UTC offset. (E.g. a UTC `11:36` event
 * shows as `11:36 AM IST` to an IST user instead of the correct `5:06 PM`.)
 *
 * Fix: normalize naive ISO to UTC by appending `Z` so JS parses it correctly.
 * If the string already carries `Z` or an offset, trust it as-is.
 */

export function parseServerDate(value: unknown): Date {
  if (value == null) return new Date(NaN);
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const raw = String(value).trim();
  if (!raw) return new Date(NaN);
  // Already has a timezone indicator — Z, +HH:MM, +HHMM, -HH:MM, -HHMM.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return new Date(raw);
  }
  // Normalize "YYYY-MM-DD HH:MM:SS[.ffffff]" → ISO form, then tag as UTC.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  return new Date(`${iso}Z`);
}

export function formatServerDateTime(
  value: unknown,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = parseServerDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, opts);
}

export function formatServerDate(
  value: unknown,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = parseServerDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, opts);
}
