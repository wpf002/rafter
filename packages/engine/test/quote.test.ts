import { toMoney } from '@rafter/types';
import type { ComputedLineItem, LineItemCode, QuoteComputation } from '@rafter/types';
import { describe, expect, it } from 'vitest';
import { computeQuote, divHalfEven, EngineError, ENGINE_VERSION } from '../src/index';
import {
  AS_OF,
  defaultMeasurement,
  defaultRates,
  parseMoneyCents,
  parseMultiplierBps,
  parseQuantityX100,
} from './fixtures';

/**
 * Hand-computed fixture. Measurement: 2,430 sqft (24.30 SQ), pitch 8/12,
 * 2 stories, 12 facets, 1 layer, ridge 85 lf, valley 40 lf, flashing 30 lf,
 * 7 penetrations, decking allowance 2 sheets.
 * Multipliers: pitch 8 → 11500 · story 2 → 10500 · facet 12 → 10750 ·
 * waste = 10000 + 1000 = 11000.
 *
 * TEAR_OFF      5500 × 2430 × 11500 × 10500 / (100 × 10000²)
 *               = 1,613,823,750,000,000 / 10¹⁰ = 161,382.375   → 161382
 * UNDERLAYMENT  2850 × 2430 × 11000 × 11500 / 10¹⁰
 *               = 876,075,750,000,000 / 10¹⁰ = 87,607.575      → 87608
 * FIELD_SHINGLE 28500 × 2430 × 11000 × 11500 × 10500 × 10750 / (100 × 10000⁴)
 *               = 988,870,502,812,500,000,000,000 / 10¹⁸
 *               = 988,870.5028125                              → 988871
 * RIDGE_HIP     1275 × 8500 / 100 = 108,375 exact
 * VALLEY        1400 × 4000 / 100 = 56,000 exact
 * FLASHING      950 × 3000 / 100 = 28,500 exact
 * PENETRATIONS  4500 × 700 / 100 = 31,500 exact
 * DECKING       9500 × 200 / 100 = 19,000 exact
 * PERMIT        35000 × 100 / 100 = 35,000 exact
 * DISPOSAL      2200 × 2430 / 100 = 53,460 exact
 * subtotal      = 1,569,696
 * OVERHEAD      1,569,696 × 1000 / 10000 = 156,969.6           → 156970
 * MARGIN        (1,569,696 + 156,970) × 2000 / 10000
 *               = 1,726,666 × 0.2 = 345,333.2                  → 345333
 * total         = 1,726,666 + 345,333 = 2,071,999
 */
const EXPECTED: Record<LineItemCode, string> = {
  TEAR_OFF: '161382',
  UNDERLAYMENT: '87608',
  FIELD_SHINGLE: '988871',
  RIDGE_HIP: '108375',
  VALLEY: '56000',
  FLASHING: '28500',
  PENETRATIONS: '31500',
  DECKING_ALLOWANCE: '19000',
  PERMIT: '35000',
  DISPOSAL: '53460',
  OVERHEAD: '156970',
  MARGIN: '345333',
};

function fixtureQuote(): QuoteComputation {
  return computeQuote(
    {
      measurement: defaultMeasurement(),
      rates: defaultRates(),
      priceModelVersionId: 'pmv_test_1',
    },
    AS_OF,
  );
}

function line(q: QuoteComputation, code: LineItemCode): ComputedLineItem {
  const found = q.lineItems.find((li) => li.code === code);
  if (!found) throw new Error(`missing line ${code}`);
  return found;
}

/** Rebuild a direct line's total from its factors alone (D4 hand-check). */
function reconstructFromFactors(li: ComputedLineItem): bigint {
  const input = li.factors.find((f) => f.kind === 'INPUT');
  const rate = li.factors.find((f) => f.kind === 'RATE');
  if (!input || !rate) throw new Error('missing INPUT/RATE factor');
  const qtyX100 = parseQuantityX100(input.value);
  const rateCents = parseMoneyCents(rate.value);
  const mults = li.factors.filter((f) => f.kind === 'MULTIPLIER');
  let numerator = rateCents * BigInt(qtyX100);
  let denominator = 100n;
  for (const m of mults) {
    numerator *= parseMultiplierBps(m.value);
    denominator *= 10000n;
  }
  return divHalfEven(numerator, denominator);
}

describe('computeQuote — hand-computed fixture', () => {
  const q = fixtureQuote();

  for (const [code, cents] of Object.entries(EXPECTED)) {
    it(`${code} totals ${cents} cents`, () => {
      expect(line(q, code as LineItemCode).totalCents).toBe(cents);
    });
  }

  it('subtotal / overhead / margin / total match hand math', () => {
    expect(q.subtotalCents).toBe('1569696');
    expect(q.overheadCents).toBe('156970');
    expect(q.marginCents).toBe('345333');
    expect(q.totalCents).toBe('2071999');
  });

  it('emits all 12 lines in canonical order', () => {
    expect(q.lineItems.map((li) => li.code)).toEqual([
      'TEAR_OFF',
      'UNDERLAYMENT',
      'FIELD_SHINGLE',
      'RIDGE_HIP',
      'VALLEY',
      'FLASHING',
      'PENETRATIONS',
      'DECKING_ALLOWANCE',
      'PERMIT',
      'DISPOSAL',
      'OVERHEAD',
      'MARGIN',
    ]);
  });

  it('sum of ALL lineItems totalCents equals totalCents exactly', () => {
    let sum = 0n;
    for (const li of q.lineItems) sum += toMoney(li.totalCents);
    expect(sum).toBe(toMoney(q.totalCents));
  });

  it('carries engine metadata and serializes asOf via toISOString', () => {
    expect(q.engineVersion).toBe(ENGINE_VERSION);
    expect(ENGINE_VERSION).toBe('engine@0.1.0');
    expect(q.priceModelVersionId).toBe('pmv_test_1');
    expect(q.asOf).toBe('2026-01-15T12:00:00.000Z');
  });

  it('net multipliers: tear-off 12075, underlayment 12650, field shingle 14279', () => {
    // 11500×10500/10000 = 12075 · 11000×11500/10000 = 12650
    // 11000×11500×10500×10750/10000³ = 14,278.6875 → 14279
    expect(line(q, 'TEAR_OFF').netMultiplierBps).toBe(12075);
    expect(line(q, 'UNDERLAYMENT').netMultiplierBps).toBe(12650);
    expect(line(q, 'FIELD_SHINGLE').netMultiplierBps).toBe(14279);
    expect(line(q, 'RIDGE_HIP').netMultiplierBps).toBe(10000);
  });
});

describe('computeQuote — Factor[] provenance (D4)', () => {
  const q = fixtureQuote();

  it('every line has factors, each stamped with a ruleVersion', () => {
    for (const li of q.lineItems) {
      expect(li.factors.length).toBeGreaterThanOrEqual(2);
      for (const f of li.factors) {
        expect(f.ruleVersion).toMatch(/^[a-z-]+@\d+$/);
      }
    }
  });

  it('every line ends with a SUBTOTAL factor whose runningCents is the line total', () => {
    for (const li of q.lineItems) {
      const last = li.factors[li.factors.length - 1];
      expect(last?.kind).toBe('SUBTOTAL');
      expect(last?.runningCents).toBe(li.totalCents);
    }
  });

  it('TEAR_OFF total is reconstructible from its factors alone', () => {
    const li = line(q, 'TEAR_OFF');
    expect(reconstructFromFactors(li)).toBe(toMoney(li.totalCents));
    // and the factors say what we expect them to say
    const labels = li.factors.map((f) => f.label);
    expect(labels).toContain('Pitch 8/12');
    expect(labels).toContain('2-story');
  });

  it('FIELD_SHINGLE total is reconstructible from its factors alone', () => {
    const li = line(q, 'FIELD_SHINGLE');
    expect(li.factors.filter((f) => f.kind === 'MULTIPLIER')).toHaveLength(4);
    expect(reconstructFromFactors(li)).toBe(toMoney(li.totalCents));
  });

  it('UNDERLAYMENT and DISPOSAL totals are reconstructible from factors', () => {
    for (const code of ['UNDERLAYMENT', 'DISPOSAL'] as const) {
      const li = line(q, code);
      expect(reconstructFromFactors(li)).toBe(toMoney(li.totalCents));
    }
  });

  it('RATE factors render as money-per-unit', () => {
    expect(line(q, 'TEAR_OFF').factors.find((f) => f.kind === 'RATE')?.value).toBe('$55.00/SQ');
    expect(line(q, 'PERMIT').factors.find((f) => f.kind === 'RATE')?.value).toBe('$350.00/FLAT');
  });
});

describe('computeQuote — determinism (D2)', () => {
  it('100 runs with identical input and asOf serialize identically', () => {
    const input = {
      measurement: defaultMeasurement(),
      rates: defaultRates(),
      priceModelVersionId: 'pmv_test_1',
    };
    const first = JSON.stringify(computeQuote(input, AS_OF));
    for (let i = 0; i < 99; i++) {
      expect(JSON.stringify(computeQuote(input, AS_OF))).toBe(first);
    }
  });
});

describe('computeQuote — multiplier band lookup', () => {
  const rates = defaultRates();

  function tearOffNet(pitchTwelfths: number, stories = 1): number {
    const q = computeQuote(
      {
        measurement: defaultMeasurement({ pitchTwelfths, stories }),
        rates,
        priceModelVersionId: 'pmv',
      },
      AS_OF,
    );
    const li = q.lineItems.find((l) => l.code === 'TEAR_OFF');
    return li ? li.netMultiplierBps : -1;
  }

  it('picks the first band with upTo >= value (inclusive upper bounds)', () => {
    expect(tearOffNet(0)).toBe(10000); // ≤6 band
    expect(tearOffNet(6)).toBe(10000); // boundary of first band
    expect(tearOffNet(7)).toBe(11500); // next band starts
    expect(tearOffNet(9)).toBe(11500); // boundary of second band
    expect(tearOffNet(10)).toBe(13000); // last band
    expect(tearOffNet(24)).toBe(13000); // top of domain
  });

  it('band order in the rates array does not matter', () => {
    const shuffled = defaultRates({
      pitchMultipliers: [
        { upTo: 24, bps: 13000 },
        { upTo: 6, bps: 10000 },
        { upTo: 9, bps: 11500 },
      ],
    });
    const a = computeQuote(
      { measurement: defaultMeasurement(), rates: shuffled, priceModelVersionId: 'pmv' },
      AS_OF,
    );
    const b = fixtureQuote();
    expect(a.totalCents).toBe(b.totalCents);
    expect(JSON.stringify(a.lineItems)).toBe(JSON.stringify(b.lineItems));
  });

  it('throws EngineError when no band covers the value', () => {
    const capped = defaultRates({
      pitchMultipliers: [
        { upTo: 6, bps: 10000 },
        { upTo: 9, bps: 11500 },
      ],
    });
    expect(() =>
      computeQuote(
        {
          measurement: defaultMeasurement({ pitchTwelfths: 12 }),
          rates: capped,
          priceModelVersionId: 'pmv',
        },
        AS_OF,
      ),
    ).toThrow(EngineError);
    expect(() =>
      computeQuote(
        {
          measurement: defaultMeasurement({ pitchTwelfths: 12 }),
          rates: capped,
          priceModelVersionId: 'pmv',
        },
        AS_OF,
      ),
    ).toThrow(/pitch/);
  });
});

describe('computeQuote — quantities and edge cases', () => {
  it('zero-quantity lines are present with a "0" total', () => {
    const q = computeQuote(
      {
        measurement: defaultMeasurement({ valleyLf: 0, penetrations: 0 }),
        rates: defaultRates(),
        priceModelVersionId: 'pmv',
      },
      AS_OF,
    );
    const valley = q.lineItems.find((l) => l.code === 'VALLEY');
    expect(valley).toBeDefined();
    expect(valley?.quantityX100).toBe(0);
    expect(valley?.totalCents).toBe('0');
    expect(q.lineItems.find((l) => l.code === 'PENETRATIONS')?.totalCents).toBe('0');
  });

  it('existingLayers scales tear-off and disposal quantities before multipliers', () => {
    const q = computeQuote(
      {
        measurement: defaultMeasurement({ existingLayers: 2 }),
        rates: defaultRates(),
        priceModelVersionId: 'pmv',
      },
      AS_OF,
    );
    const tearOff = q.lineItems.find((l) => l.code === 'TEAR_OFF');
    const disposal = q.lineItems.find((l) => l.code === 'DISPOSAL');
    expect(tearOff?.quantityX100).toBe(4860); // 24.30 SQ × 2 layers
    expect(disposal?.quantityX100).toBe(4860);
    // 5500 × 4860 × 11500 × 10500 / 10¹⁰ = 322,764.75 → 322765 (single rounding
    // step on the doubled numerator, not 2 × the 1-layer rounded total)
    expect(tearOff?.totalCents).toBe('322765');
    // disposal is exact: 2200 × 4860 / 100 = 106,920 = 2 × 53,460
    expect(disposal?.totalCents).toBe('106920');
  });

  it('squaresX100 convention: quantityX100 equals roofAreaSqFt (24.30 SQ)', () => {
    const q = fixtureQuote();
    const field = q.lineItems.find((l) => l.code === 'FIELD_SHINGLE');
    expect(field?.quantityX100).toBe(2430);
    expect(field?.factors.find((f) => f.kind === 'INPUT')?.value).toBe('24.30 SQ');
  });

  it('OVERHEAD line applies overheadBps to the direct subtotal', () => {
    const q = fixtureQuote();
    const oh = q.lineItems.find((l) => l.code === 'OVERHEAD');
    expect(oh?.unit).toBe('PCT');
    expect(oh?.quantityX100).toBe(1000);
    expect(oh?.netMultiplierBps).toBe(1000);
    expect(oh?.unitRateCents).toBe(q.subtotalCents);
    expect(oh?.factors.find((f) => f.kind === 'MULTIPLIER')?.value).toBe('10.00%');
  });

  it('MARGIN line applies marginBps to subtotal + overhead', () => {
    const q = fixtureQuote();
    const margin = q.lineItems.find((l) => l.code === 'MARGIN');
    expect(margin?.unitRateCents).toBe('1726666'); // 1,569,696 + 156,970
    expect(margin?.quantityX100).toBe(2000);
    expect(margin?.factors.find((f) => f.kind === 'MULTIPLIER')?.value).toBe('20.00%');
  });

  it('no multipliers on the per-length and flat lines', () => {
    const q = fixtureQuote();
    for (const code of [
      'RIDGE_HIP',
      'VALLEY',
      'FLASHING',
      'PENETRATIONS',
      'DECKING_ALLOWANCE',
      'PERMIT',
      'DISPOSAL',
    ] as const) {
      const li = q.lineItems.find((l) => l.code === code);
      expect(li?.factors.filter((f) => f.kind === 'MULTIPLIER')).toHaveLength(0);
      expect(li?.netMultiplierBps).toBe(10000);
    }
  });
});
