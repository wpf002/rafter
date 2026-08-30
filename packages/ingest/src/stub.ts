import { ActualLine, type ActualCategory } from '@rafter/types';
import type { InvoiceParser } from './parser';

/**
 * Line-oriented regex parser. Each non-empty line of the form
 *   "<description> $1,234.56"  or  "<description> 1234.56"  or "<description> $350"
 * becomes a draft ActualLine. Anything else is skipped.
 *
 * D1 — amount → cents via pure string math. No parseFloat / Number() ever.
 */
const LINE_RE = /^(.+?)\s+\$?(\d[\d,]*)(?:\.(\d{1,2}))?$/;

/** Keyword → category, matched in order against the lowercased description. */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [ActualCategory, readonly string[]]> = [
  ['MATERIAL', ['shingle', 'underlayment', 'lumber', 'decking', 'nails', 'material']],
  ['LABOR', ['labor', 'crew', 'install']],
  ['DISPOSAL', ['dump', 'disposal', 'haul']],
  ['PERMIT', ['permit']],
];

export function categorize(description: string): ActualCategory {
  const lower = description.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return 'OTHER';
}

/** "1,234" + ".5" → 123450n. String math only (D1). */
function toCents(dollarsRaw: string, fracRaw: string | undefined): bigint {
  const dollars = dollarsRaw.replace(/,/g, '');
  const frac = (fracRaw ?? '0').padEnd(2, '0');
  return BigInt(dollars) * 100n + BigInt(frac);
}

export class StubParser implements InvoiceParser {
  readonly id = 'stub';

  async parseDraft(text: string): Promise<ActualLine[]> {
    const lines: ActualLine[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '') continue;
      const m = LINE_RE.exec(line);
      if (m === null) continue; // unparseable → skipped, never guessed
      const description = m[1]!.trim();
      const cents = toCents(m[2]!, m[3]);
      lines.push(
        ActualLine.parse({
          description,
          category: categorize(description),
          amountCents: cents.toString(),
        }),
      );
    }
    return lines;
  }
}
