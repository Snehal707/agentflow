export interface BatchPaymentRow {
  to: string;
  amount: string;
  remark?: string;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Detect separator: comma or tab. */
function detectSeparator(firstDataLine: string): ',' | '\t' {
  const commas = (firstDataLine.match(/,/g) ?? []).length;
  const tabs = (firstDataLine.match(/\t/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

function isHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes('address') ||
    lower.includes('wallet') ||
    lower.includes('to') ||
    lower.includes('recipient') ||
    lower.includes('amount') ||
    lower.includes('remark') ||
    lower.includes('note')
  );
}

/**
 * Parse a CSV string into BatchPaymentRow[].
 * Accepts comma or tab separators, optional header row, optional quotes.
 * Returns an error object if parsing fails.
 */
export function parseCSVBatch(
  csvText: string,
): BatchPaymentRow[] | { error: string } {
  // Strip UTF-8 BOM
  let cleaned = csvText.replace(/^\uFEFF/, '').trim();

  if (!cleaned) {
    return { error: 'CSV is empty.' };
  }

  // Strip leading chat-command keyword (e.g. "batch pay", "payroll") — keep any CSV
  // data that was pasted on the same line after the keyword.
  cleaned = cleaned
    .replace(/^\s*(?:batch\s+pay(?:ment)?|payroll|bulk\s+pay|pay\s+multiple|pay\s+everyone)\s*[:\n]?\s*/i, '')
    .trim();

  if (!cleaned) {
    return { error: 'CSV is empty — paste CSV rows below the "batch pay" keyword.' };
  }

  // Normalize single-line multi-row paste like "addr,amt[,remark] addr,amt[,remark]"
  // by inserting newlines between matching groups. Matches ",<number>[,<word>]" followed
  // by whitespace + a new token that looks like another "addr,<number>" pair.
  cleaned = cleaned.replace(
    /(,\s*\d+(?:\.\d+)?(?:\s*,\s*[^\s,]+)?)\s+(?=\S+\s*,\s*\d)/g,
    '$1\n',
  );

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (!lines.length) {
    return { error: 'CSV is empty after removing comments.' };
  }

  const separator = detectSeparator(lines[0]);

  // Skip header row if the first line looks like column names
  const startIndex = isHeaderLine(lines[0]) ? 1 : 0;

  const payments: BatchPaymentRow[] = [];
  const errors: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(separator).map(stripQuotes);

    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: needs at least address and amount (got "${lines[i]}")`);
      continue;
    }

    const to = parts[0];
    const rawAmount = parts[1];
    const remark = parts[2] ?? undefined;

    if (!to) {
      errors.push(`Line ${i + 1}: missing address`);
      continue;
    }

    const amountNum = parseFloat(rawAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      errors.push(`Line ${i + 1}: invalid amount "${rawAmount}"`);
      continue;
    }

    payments.push({
      to,
      amount: amountNum.toString(),
      remark: remark || undefined,
    });
  }

  if (errors.length > 0) {
    return { error: errors.join('\n') };
  }

  if (payments.length === 0) {
    return { error: 'No valid payments found in CSV.' };
  }

  if (payments.length < 2) {
    return { error: 'Batch requires at least 2 payments.' };
  }

  if (payments.length > 500) {
    return { error: `Too many rows: ${payments.length}. Maximum is 500 per batch.` };
  }

  return payments;
}

/**
 * Extract an inline CSV body from a chat message.
 * Delegates to parseCSVBatch which handles both:
 *  - Multi-line: "batch pay\nalice.arc,100\nbob.arc,50"
 *  - Single-line: "batch pay alice.arc,100 bob.arc,50"
 * Returns a friendly error with the expected format when no valid rows are found.
 */
export function parseInlineCsvFromMessage(
  message: string,
): BatchPaymentRow[] | { error: string } {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      error:
        'No CSV rows found. Format:\nbatch pay\nalice.arc,100,salary\nbob.arc,100,salary',
    };
  }
  const parsed = parseCSVBatch(trimmed);
  if (!Array.isArray(parsed)) {
    // Wrap the raw parser error with a clearer example for chat users
    return {
      error: `${parsed.error}\n\nUse this format:\nbatch pay\nalice.arc,100,salary\nbob.arc,100,salary`,
    };
  }
  return parsed;
}
