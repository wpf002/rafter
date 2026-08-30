import type { PriceModelRates, TuningJobRecord } from '@rafter/types';
import { describe, expect, it } from 'vitest';
import { TUNABLE_LINES, applySuggestions, computeTuning, sumMoney } from '../src/index';
import { defaultRates } from './fixtures';

/** Build a closed-job record with sensible defaults. */
function job(
  overrides: Partial<TuningJobRecord> & Pick<TuningJobRecord, 'lineItems' | 'pricingErrorCents'>,
): TuningJobRecord {
  return {
    jobId: 'job-1',
    closedAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

const rates: PriceModelRates = defaultRates();

describe('TUNABLE_LINES', () => {
  it('maps exactly the eight unit-rate lines in display order', () => {
    expect(TUNABLE_LINES.map((t) => [t.code, t.rateField])).toEqual([
      ['TEAR_OFF', 'tearOffPerSquarePerLayerCents'],
      ['UNDERLAYMENT', 'underlaymentPerSquareCents'],
      ['FIELD_SHINGLE', 'fieldShinglePerSquareCents'],
      ['RIDGE_HIP', 'ridgeHipPerLfCents'],
      ['VALLEY', 'valleyPerLfCents'],
      ['FLASHING', 'flashingPerLfCents'],
      ['PENETRATIONS', 'penetrationEachCents'],
      ['DISPOSAL', 'disposalPerSquareCents'],
    ]);
    expect(TUNABLE_LINES[0]?.label).toBe('Tear-off, per square per layer');
  });
});

describe('computeTuning — hand-computed single job, single line', () => {
  // One job, one tunable line: FIELD_SHINGLE, 20.00 SQ (quantityX100 = 2000),
  // pricing error +$60.00 (6000¢). The whole error lands on the one line.
  //   perUnitGap  = 6000 × 100 / 2000 = 300¢  ($3.00 per square)
  //   suggested   = 28500 + 300       = 28800¢
  //   windowImpact = 300 × 2000 / 100 = 6000¢ (recovers the error exactly)
  //   windowDays  = 1 (single job)  → annualized = 6000 × 365 / 1 = 2,190,000¢
  const report = computeTuning({
    closedJobs: [
      job({
        lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 2000, totalCents: '570000' }],
        pricingErrorCents: '6000',
      }),
    ],
    currentRates: rates,
    minJobs: 1,
  });

  it('produces the exact per-unit gap and suggested rate', () => {
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.code).toBe('FIELD_SHINGLE');
    expect(row.rateField).toBe('fieldShinglePerSquareCents');
    expect(row.allocatedPricingErrorCents).toBe('6000');
    expect(row.perUnitGapCents).toBe('300');
    expect(row.currentRateCents).toBe('28500');
    expect(row.suggestedRateCents).toBe('28800');
    expect(row.totalQuantityX100).toBe(2000);
    expect(row.jobsTouched).toBe(1);
  });

  it('produces the exact window and annualized impact', () => {
    const row = report.rows[0]!;
    expect(row.windowImpactCents).toBe('6000');
    expect(report.windowDays).toBe(1);
    expect(row.annualizedImpactCents).toBe('2190000');
    expect(report.totalAnnualizedImpactCents).toBe('2190000');
  });
});

describe('computeTuning — allocation', () => {
  it('splits a job error across tunable lines summing exactly to the pricing error', () => {
    // Weights 33000 / 9000 / 13500 do not divide 1001 evenly; largest
    // remainder must still make the three shares sum to exactly 1001¢.
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [
            { code: 'TEAR_OFF', quantityX100: 300, totalCents: '33000' },
            { code: 'UNDERLAYMENT', quantityX100: 300, totalCents: '9000' },
            { code: 'FIELD_SHINGLE', quantityX100: 300, totalCents: '13500' },
          ],
          pricingErrorCents: '1001',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const allocated = sumMoney(report.rows.map((r) => BigInt(r.allocatedPricingErrorCents)));
    expect(allocated).toBe(1001n);
    expect(report.rows).toHaveLength(3);
  });

  it('ignores non-tunable lines when allocating', () => {
    // PERMIT and OVERHEAD are not unit rates; the full error goes to VALLEY.
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [
            { code: 'PERMIT', quantityX100: 100, totalCents: '35000' },
            { code: 'OVERHEAD', quantityX100: 100, totalCents: '90000' },
            { code: 'VALLEY', quantityX100: 4000, totalCents: '56000' },
          ],
          pricingErrorCents: '800',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.code).toBe('VALLEY');
    expect(report.rows[0]?.allocatedPricingErrorCents).toBe('800');
  });

  it('skips jobs whose tunable lines all have zero totals', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          jobId: 'zero-weight',
          lineItems: [{ code: 'FLASHING', quantityX100: 500, totalCents: '0' }],
          pricingErrorCents: '9999',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    // Quantity still shows up in the window, but no error was allocated.
    expect(report.rows[0]?.code).toBe('FLASHING');
    expect(report.rows[0]?.totalQuantityX100).toBe(500);
    expect(report.rows[0]?.allocatedPricingErrorCents).toBe('0');
    expect(report.rows[0]?.perUnitGapCents).toBe('0');
  });

  it('skips jobs with no tunable quantity entirely', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          jobId: 'has-shingle',
          lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 1000, totalCents: '285000' }],
          pricingErrorCents: '1000',
        }),
        job({
          jobId: 'no-tunables',
          lineItems: [
            { code: 'PERMIT', quantityX100: 100, totalCents: '35000' },
            { code: 'FIELD_SHINGLE', quantityX100: 0, totalCents: '0' },
          ],
          pricingErrorCents: '555555',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const row = report.rows[0]!;
    // The second job's error is untouched and it does not count as touching.
    expect(row.allocatedPricingErrorCents).toBe('1000');
    expect(row.jobsTouched).toBe(1);
    expect(report.jobCount).toBe(2);
  });
});

describe('computeTuning — multi-job aggregation', () => {
  it('sums quantity and allocated error per code and counts jobs touched', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          jobId: 'a',
          closedAt: '2026-01-01T00:00:00.000Z',
          lineItems: [
            { code: 'FIELD_SHINGLE', quantityX100: 1000, totalCents: '285000' },
            { code: 'RIDGE_HIP', quantityX100: 8000, totalCents: '102000' },
          ],
          pricingErrorCents: '0',
        }),
        job({
          jobId: 'b',
          closedAt: '2026-01-02T00:00:00.000Z',
          lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 3000, totalCents: '855000' }],
          pricingErrorCents: '900',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const shingle = report.rows.find((r) => r.code === 'FIELD_SHINGLE')!;
    const ridge = report.rows.find((r) => r.code === 'RIDGE_HIP')!;
    expect(shingle.totalQuantityX100).toBe(4000);
    expect(shingle.allocatedPricingErrorCents).toBe('900');
    expect(shingle.jobsTouched).toBe(2);
    expect(ridge.totalQuantityX100).toBe(8000);
    expect(ridge.jobsTouched).toBe(1);
  });

  it('sorts rows by TUNABLE_LINES order regardless of input order', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [
            { code: 'DISPOSAL', quantityX100: 2000, totalCents: '44000' },
            { code: 'VALLEY', quantityX100: 4000, totalCents: '56000' },
            { code: 'TEAR_OFF', quantityX100: 2000, totalCents: '110000' },
          ],
          pricingErrorCents: '0',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    expect(report.rows.map((r) => r.code)).toEqual(['TEAR_OFF', 'VALLEY', 'DISPOSAL']);
  });

  it('excludes codes absent from the window', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [{ code: 'TEAR_OFF', quantityX100: 2000, totalCents: '110000' }],
          pricingErrorCents: '100',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    expect(report.rows.map((r) => r.code)).toEqual(['TEAR_OFF']);
  });
});

describe('computeTuning — signs and floors', () => {
  it('lowers the suggested rate on a negative (over-priced) error', () => {
    // -$40.00 over 20.00 SQ → gap = -4000×100/2000 = -200¢/sq.
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 2000, totalCents: '570000' }],
          pricingErrorCents: '-4000',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const row = report.rows[0]!;
    expect(row.perUnitGapCents).toBe('-200');
    expect(row.suggestedRateCents).toBe('28300'); // 28500 − 200
    expect(row.windowImpactCents).toBe('-4000');
  });

  it('floors the suggested rate at zero', () => {
    // VALLEY current is 1400¢; gap = -50000×100/1000 = -5000¢ → floor at 0.
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [{ code: 'VALLEY', quantityX100: 1000, totalCents: '14000' }],
          pricingErrorCents: '-50000',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const row = report.rows[0]!;
    expect(row.perUnitGapCents).toBe('-5000');
    expect(row.suggestedRateCents).toBe('0');
  });

  it('yields zero gaps and unchanged suggestions on zero error', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          lineItems: [
            { code: 'TEAR_OFF', quantityX100: 2000, totalCents: '110000' },
            { code: 'DISPOSAL', quantityX100: 2000, totalCents: '44000' },
          ],
          pricingErrorCents: '0',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    for (const row of report.rows) {
      expect(row.perUnitGapCents).toBe('0');
      expect(row.suggestedRateCents).toBe(row.currentRateCents);
      expect(row.windowImpactCents).toBe('0');
      expect(row.annualizedImpactCents).toBe('0');
    }
    expect(report.totalAnnualizedImpactCents).toBe('0');
  });
});

describe('computeTuning — eligibility', () => {
  const makeJobs = (n: number): TuningJobRecord[] =>
    Array.from({ length: n }, (_, i) =>
      job({
        jobId: `j${i}`,
        closedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
        lineItems: [{ code: 'TEAR_OFF', quantityX100: 2000, totalCents: '110000' }],
        pricingErrorCents: '100',
      }),
    );

  it('is ineligible at 19 jobs with the default minJobs of 20', () => {
    const report = computeTuning({ closedJobs: makeJobs(19), currentRates: rates });
    expect(report.minJobs).toBe(20);
    expect(report.eligible).toBe(false);
    // Preview rows are still computed for the UI.
    expect(report.rows.length).toBeGreaterThan(0);
  });

  it('is eligible at exactly 20 jobs', () => {
    const report = computeTuning({ closedJobs: makeJobs(20), currentRates: rates });
    expect(report.eligible).toBe(true);
    expect(report.jobCount).toBe(20);
  });

  it('honors a minJobs override', () => {
    expect(computeTuning({ closedJobs: makeJobs(5), currentRates: rates, minJobs: 5 }).eligible).toBe(
      true,
    );
    expect(computeTuning({ closedJobs: makeJobs(4), currentRates: rates, minJobs: 5 }).eligible).toBe(
      false,
    );
  });

  it('returns the empty report for no closed jobs', () => {
    const report = computeTuning({ closedJobs: [], currentRates: rates });
    expect(report).toEqual({
      eligible: false,
      jobCount: 0,
      minJobs: 20,
      windowDays: 0,
      rows: [],
      totalAnnualizedImpactCents: '0',
    });
  });
});

describe('computeTuning — window and annualization', () => {
  it('scales window impact by exactly ×5 for a 73-day window', () => {
    // 2026-01-01 → 2026-03-15 is 73 days; 365 / 73 = 5 exactly.
    // Combined: error 6000¢ over 20.00 SQ → gap 300¢, windowImpact 6000¢.
    const report = computeTuning({
      closedJobs: [
        job({
          jobId: 'first',
          closedAt: '2026-01-01T00:00:00.000Z',
          lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 1000, totalCents: '285000' }],
          pricingErrorCents: '3000',
        }),
        job({
          jobId: 'last',
          closedAt: '2026-03-15T00:00:00.000Z',
          lineItems: [{ code: 'FIELD_SHINGLE', quantityX100: 1000, totalCents: '285000' }],
          pricingErrorCents: '3000',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    expect(report.windowDays).toBe(73);
    const row = report.rows[0]!;
    expect(row.windowImpactCents).toBe('6000');
    expect(row.annualizedImpactCents).toBe('30000'); // 6000 × 365 / 73 = 6000 × 5
    expect(report.totalAnnualizedImpactCents).toBe('30000');
  });

  it('clamps a same-instant window to one day', () => {
    const report = computeTuning({
      closedJobs: [
        job({
          jobId: 'x',
          lineItems: [{ code: 'TEAR_OFF', quantityX100: 100, totalCents: '5500' }],
          pricingErrorCents: '0',
        }),
        job({
          jobId: 'y',
          lineItems: [{ code: 'TEAR_OFF', quantityX100: 100, totalCents: '5500' }],
          pricingErrorCents: '0',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    expect(report.windowDays).toBe(1);
  });
});

describe('computeTuning — determinism', () => {
  it('returns byte-identical reports across 50 runs', () => {
    const closedJobs: TuningJobRecord[] = Array.from({ length: 23 }, (_, i) =>
      job({
        jobId: `j${i}`,
        closedAt: `2026-0${(i % 3) + 1}-${String((i % 27) + 1).padStart(2, '0')}T08:30:00.000Z`,
        lineItems: [
          { code: 'TEAR_OFF', quantityX100: 1500 + i * 37, totalCents: String(82500 + i * 991) },
          { code: 'FIELD_SHINGLE', quantityX100: 1500 + i * 37, totalCents: String(427500 + i * 7) },
          { code: 'RIDGE_HIP', quantityX100: 6000 + i * 11, totalCents: String(76500 + i * 13) },
        ],
        pricingErrorCents: String((i % 2 === 0 ? 1 : -1) * (997 * (i + 1))),
      }),
    );
    const first = JSON.stringify(computeTuning({ closedJobs, currentRates: rates }));
    for (let run = 0; run < 49; run++) {
      expect(JSON.stringify(computeTuning({ closedJobs, currentRates: rates }))).toBe(first);
    }
  });
});

describe('computeTuning — convergence', () => {
  // 25 single-line jobs where field shingle is underpriced by exactly $3.00/sq:
  // pricingError = 300¢ × squares. Whole-square quantities keep everything exact.
  const squaresFor = (i: number): number => 10 + i; // 10..34 squares
  const buildJobs = (tunedGapCents: bigint): TuningJobRecord[] =>
    Array.from({ length: 25 }, (_, i) => {
      const squares = squaresFor(i);
      // True cost gap $3.00/sq minus whatever the tuned rate now covers.
      const errorCents = (300n - tunedGapCents) * BigInt(squares);
      return job({
        jobId: `conv-${i}`,
        closedAt: `2026-0${(i % 6) + 1}-10T00:00:00.000Z`,
        lineItems: [
          { code: 'FIELD_SHINGLE', quantityX100: squares * 100, totalCents: String(28500 * squares) },
        ],
        pricingErrorCents: errorCents.toString(),
      });
    });

  it('recovers a systematic $3.00/sq underprice exactly', () => {
    const report = computeTuning({ closedJobs: buildJobs(0n), currentRates: rates });
    expect(report.eligible).toBe(true);
    const row = report.rows[0]!;
    expect(row.perUnitGapCents).toBe('300');
    expect(row.suggestedRateCents).toBe('28800'); // 28500 + 300, exactly
  });

  it('leaves zero aggregate error once the rates are tuned', () => {
    const first = computeTuning({ closedJobs: buildJobs(0n), currentRates: rates });
    const tuned = applySuggestions(rates, first.rows);
    expect(tuned.fieldShinglePerSquareCents).toBe('28800');
    // Re-close the same jobs as if quoted at the tuned rate: every job's
    // pricing error becomes (300 − 300) × squares = 0.
    const second = computeTuning({ closedJobs: buildJobs(300n), currentRates: tuned });
    const row = second.rows[0]!;
    expect(row.allocatedPricingErrorCents).toBe('0');
    expect(row.perUnitGapCents).toBe('0');
    expect(row.suggestedRateCents).toBe('28800');
  });
});

describe('applySuggestions', () => {
  const report = computeTuning({
    closedJobs: [
      job({
        lineItems: [
          { code: 'TEAR_OFF', quantityX100: 2000, totalCents: '110000' },
          { code: 'DISPOSAL', quantityX100: 2000, totalCents: '44000' },
          { code: 'VALLEY', quantityX100: 1000, totalCents: '14000' },
        ],
        pricingErrorCents: '15400', // split by weights 110000/44000/14000 → 10084/4033/1283
      }),
    ],
    currentRates: rates,
    minJobs: 1,
  });

  it('never mutates its inputs and returns a new object', () => {
    const before = JSON.stringify(rates);
    const rowsBefore = JSON.stringify(report.rows);
    const next = applySuggestions(rates, report.rows);
    expect(next).not.toBe(rates);
    expect(JSON.stringify(rates)).toBe(before);
    expect(JSON.stringify(report.rows)).toBe(rowsBefore);
  });

  it('applies every changed suggestion by default', () => {
    const next = applySuggestions(rates, report.rows);
    for (const row of report.rows) {
      expect(next[row.rateField]).toBe(row.suggestedRateCents);
    }
    // Untouched fields carry over unchanged.
    expect(next.permitFlatCents).toBe(rates.permitFlatCents);
    expect(next.overheadBps).toBe(rates.overheadBps);
  });

  it('accepts only the requested subset', () => {
    const next = applySuggestions(rates, report.rows, ['valleyPerLfCents']);
    const valley = report.rows.find((r) => r.rateField === 'valleyPerLfCents')!;
    expect(next.valleyPerLfCents).toBe(valley.suggestedRateCents);
    expect(next.tearOffPerSquarePerLayerCents).toBe(rates.tearOffPerSquarePerLayerCents);
    expect(next.disposalPerSquareCents).toBe(rates.disposalPerSquareCents);
  });

  it('skips rows whose suggestion equals the current rate by default', () => {
    const zeroReport = computeTuning({
      closedJobs: [
        job({
          lineItems: [{ code: 'FLASHING', quantityX100: 3000, totalCents: '28500' }],
          pricingErrorCents: '0',
        }),
      ],
      currentRates: rates,
      minJobs: 1,
    });
    const next = applySuggestions(rates, zeroReport.rows);
    expect(next).toEqual(rates);
  });

  it('ignores accepted fields with no corresponding row', () => {
    const next = applySuggestions(rates, report.rows, ['ridgeHipPerLfCents']);
    expect(next).toEqual(rates);
  });
});
