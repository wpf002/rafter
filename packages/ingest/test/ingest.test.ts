import { describe, expect, it } from 'vitest';
import { ActualLine, MoneyString } from '@rafter/types';
import { LlmParser, StubParser, categorize, getParser, parserRegistry } from '../src/index';

const stub = new StubParser();

describe('StubParser amounts (string math, D1)', () => {
  it('parses "$1,234.56" to exactly 123456 cents', async () => {
    const [line] = await stub.parseDraft('Architectural shingles $1,234.56');
    expect(line?.amountCents).toBe('123456');
  });

  it('parses a bare "1234.56" without a dollar sign', async () => {
    const [line] = await stub.parseDraft('Crew day rate 1234.56');
    expect(line?.amountCents).toBe('123456');
  });

  it('pads a one-digit fraction: "$1,234.5" → 123450 cents', async () => {
    const [line] = await stub.parseDraft('Dump run $1,234.5');
    expect(line?.amountCents).toBe('123450');
  });

  it('handles whole-dollar amounts: "$350" → 35000 cents', async () => {
    const [line] = await stub.parseDraft('Building permit $350');
    expect(line?.amountCents).toBe('35000');
  });

  it('handles thousands separators on whole dollars: "$12,000" → 1200000', async () => {
    const [line] = await stub.parseDraft('Lumber package $12,000');
    expect(line?.amountCents).toBe('1200000');
  });

  it('every amount is a valid MoneyString and line a valid ActualLine', async () => {
    const lines = await stub.parseDraft(
      'Shingles $8,412.10\nCrew labor 3200\nDump fees $415.5\nPermit $350\nCaulk 12.99',
    );
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => MoneyString.parse(line.amountCents)).not.toThrow();
      expect(() => ActualLine.parse(line)).not.toThrow();
    }
  });
});

describe('StubParser categories', () => {
  it('maps material keywords', () => {
    for (const d of ['Shingle bundles', 'Synthetic underlayment', 'lumber', 'Decking sheets', 'Roofing NAILS', 'misc material']) {
      expect(categorize(d)).toBe('MATERIAL');
    }
  });

  it('maps labor keywords', () => {
    for (const d of ['Labor - tear off', 'crew of five', 'Installation day 2']) {
      expect(categorize(d)).toBe('LABOR');
    }
  });

  it('maps disposal keywords', () => {
    for (const d of ['Dump ticket', 'Debris disposal', 'Haul-away service']) {
      expect(categorize(d)).toBe('DISPOSAL');
    }
  });

  it('maps permit keyword and falls back to OTHER', () => {
    expect(categorize('City permit')).toBe('PERMIT');
    expect(categorize('Porta-john rental')).toBe('OTHER');
  });

  it('categorizes end to end, case-insensitively', async () => {
    const lines = await stub.parseDraft('SHINGLES $10\nCrew Labor $20\nhaul off $30\nPermit $40\nMisc $50');
    expect(lines.map((l) => l.category)).toEqual(['MATERIAL', 'LABOR', 'DISPOSAL', 'PERMIT', 'OTHER']);
  });
});

describe('StubParser skipping', () => {
  it('skips junk, headers, blank lines, and malformed decimals', async () => {
    const text = [
      'INVOICE #4471',
      '',
      'Shingles $500.00',
      'Thank you for your business!',
      'Weird decimals 12.345',
      '$50', // amount with no description
      'Crew labor 250',
    ].join('\n');
    const lines = await stub.parseDraft(text);
    expect(lines.map((l) => l.description)).toEqual(['Shingles', 'Crew labor']);
  });

  it('returns an empty array for fully unparseable text', async () => {
    expect(await stub.parseDraft('no amounts here\njust words')).toEqual([]);
  });

  it('preserves line order and trims whitespace', async () => {
    const lines = await stub.parseDraft('  Shingles $10  \n  Crew labor $20  ');
    expect(lines.map((l) => l.description)).toEqual(['Shingles', 'Crew labor']);
    expect(lines.map((l) => l.amountCents)).toEqual(['1000', '2000']);
  });
});

describe('LlmParser placeholder (D5)', () => {
  it('throws the exact not-configured error', async () => {
    await expect(new LlmParser().parseDraft('anything')).rejects.toThrow(
      'LLM parser not configured — drafts only, never pricing (D5)',
    );
  });
});

describe('registry and getParser', () => {
  it('registry holds stub and llm with matching ids', () => {
    expect(parserRegistry.stub?.id).toBe('stub');
    expect(parserRegistry.llm?.id).toBe('llm');
  });

  it('getParser resolves by id and defaults to stub', () => {
    expect(getParser().id).toBe('stub');
    expect(getParser('llm').id).toBe('llm');
    expect(getParser('nope').id).toBe('stub');
  });
});
