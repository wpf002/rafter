import { formatMoney, toMoney } from '@rafter/types';
import type { CloseoutInput, QuoteComputation } from '@rafter/types';
import { describe, expect, it } from 'vitest';
import { computeQuote, computeVariance, validateCloseout } from '../src/index';
import { AS_OF, defaultMeasurement, defaultRates } from './fixtures';

type QuoteTotals = Pick<
  QuoteComputation,
  'subtotalCents' | 'overheadCents' | 'marginCents' | 'totalCents'
>;

/** Round-number quote: quotedCost 880,000 · revenue 1,000,000 · margin 120,000. */
const QUOTE: QuoteTotals = {
  subtotalCents: '800000',
  overheadCents: '80000',
  marginCents: '120000',
  totalCents: '1000000',
};

function closeout(overrides: Partial<CloseoutInput> = {}): CloseoutInput {
  return {
    actualLines: [
      { description: 'Shingles + underlayment', category: 'MATERIAL', amountCents: '500000' },
      { description: 'Crew labor', category: 'LABOR', amountCents: '400000' },
    ],
    attributions: [],
    ...overrides,
  };
}

describe('computeVariance', () => {
  it('computes cost, variance, and margins for a cost overrun', () => {
    // actual 900,000 vs quoted 880,000 → variance +20,000
    const r = computeVariance(QUOTE, closeout());
    expect(r.revenueCents).toBe('1000000');
    expect(r.quotedCostCents).toBe('880000');
    expect(r.plannedMarginCents).toBe('120000');
    expect(r.actualCostCents).toBe('900000');
    expect(r.varianceCents).toBe('20000');
    expect(r.actualMarginCents).toBe('100000');
  });

  it('computes bps of revenue exactly (1200 planned, 1000 actual)', () => {
    const r = computeVariance(QUOTE, closeout());
    expect(r.plannedMarginBps).toBe(1200); // 120,000 / 1,000,000
    expect(r.actualMarginBps).toBe(1000); // 100,000 / 1,000,000
  });

  it('always includes all four byReason keys, defaulting to "0"', () => {
    const r = computeVariance(QUOTE, closeout());
    expect(r.byReason).toEqual({
      CONCEALED_CONDITION: '0',
      CUSTOMER_SCOPE_CHANGE: '0',
      MEASUREMENT_ERROR: '0',
      PRICING_ERROR: '0',
    });
  });

  it('rolls up multiple attributions per reason', () => {
    const r = computeVariance(
      QUOTE,
      closeout({
        attributions: [
          { reason: 'CONCEALED_CONDITION', amountCents: '15000', photoId: 'ph_1' },
          { reason: 'CONCEALED_CONDITION', amountCents: '3000', photoId: 'ph_2' },
          { reason: 'CUSTOMER_SCOPE_CHANGE', amountCents: '2000' },
        ],
      }),
    );
    expect(r.byReason.CONCEALED_CONDITION).toBe('18000');
    expect(r.byReason.CUSTOMER_SCOPE_CHANGE).toBe('2000');
    expect(r.byReason.MEASUREMENT_ERROR).toBe('0');
    expect(r.attributedCents).toBe('20000');
    expect(r.unattributedCents).toBe('0');
  });

  it('unattributed = variance − attributed when attribution is partial', () => {
    const r = computeVariance(
      QUOTE,
      closeout({
        attributions: [{ reason: 'CONCEALED_CONDITION', amountCents: '15000', photoId: 'ph_1' }],
      }),
    );
    expect(r.attributedCents).toBe('15000');
    expect(r.unattributedCents).toBe('5000');
  });

  it('handles a negative variance (under-run) with negative attributions', () => {
    const under = closeout({
      actualLines: [
        { description: 'Materials', category: 'MATERIAL', amountCents: '460000' },
        { description: 'Labor', category: 'LABOR', amountCents: '400000' },
      ],
      attributions: [{ reason: 'MEASUREMENT_ERROR', amountCents: '-20000' }],
    });
    const r = computeVariance(QUOTE, under);
    expect(r.varianceCents).toBe('-20000');
    expect(r.byReason.MEASUREMENT_ERROR).toBe('-20000');
    expect(r.unattributedCents).toBe('0');
    expect(r.actualMarginCents).toBe('140000');
    expect(r.actualMarginBps).toBe(1400);
  });

  it('always includes all five byCategory keys and rolls up actual lines', () => {
    const r = computeVariance(
      QUOTE,
      closeout({
        actualLines: [
          { description: 'Shingles', category: 'MATERIAL', amountCents: '300000' },
          { description: 'Underlayment', category: 'MATERIAL', amountCents: '200000' },
          { description: 'Crew', category: 'LABOR', amountCents: '350000' },
          { description: 'Dumpster', category: 'DISPOSAL', amountCents: '30000' },
          { description: 'City permit', category: 'PERMIT', amountCents: '20000' },
        ],
      }),
    );
    expect(r.byCategory).toEqual({
      MATERIAL: '500000',
      LABOR: '350000',
      DISPOSAL: '30000',
      PERMIT: '20000',
      OTHER: '0',
    });
    expect(r.actualCostCents).toBe('900000');
  });

  it('guards bps fields when revenue is zero', () => {
    const zeroQuote: QuoteTotals = {
      subtotalCents: '0',
      overheadCents: '0',
      marginCents: '0',
      totalCents: '0',
    };
    const r = computeVariance(zeroQuote, closeout({ actualLines: [], attributions: [] }));
    expect(r.plannedMarginBps).toBe(0);
    expect(r.actualMarginBps).toBe(0);
    expect(r.actualCostCents).toBe('0');
  });

  it('integrates with computeQuote output: matching actuals give zero variance', () => {
    const q = computeQuote(
      { measurement: defaultMeasurement(), rates: defaultRates(), priceModelVersionId: 'pmv' },
      AS_OF,
    );
    const quotedCost = toMoney(q.subtotalCents) + toMoney(q.overheadCents);
    const r = computeVariance(q, {
      actualLines: [
        { description: 'All-in actuals', category: 'OTHER', amountCents: quotedCost.toString() },
      ],
      attributions: [],
    });
    expect(r.varianceCents).toBe('0');
    expect(r.unattributedCents).toBe('0');
    expect(r.actualMarginCents).toBe(q.marginCents);
  });
});

describe('validateCloseout', () => {
  it('passes a fully attributed closeout with photos on concealed conditions', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [
          { reason: 'CONCEALED_CONDITION', amountCents: '12000', photoId: 'ph_9' },
          { reason: 'PRICING_ERROR', amountCents: '8000' },
        ],
      }),
    );
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('blocks unattributed variance, naming the exact amount and all four reasons', () => {
    const result = validateCloseout(QUOTE, closeout()); // 20,000 unattributed
    expect(result.ok).toBe(false);
    const msg = result.errors.join(' ');
    expect(msg).toContain(formatMoney(20000n)); // "$200.00"
    expect(msg).toContain('CONCEALED_CONDITION');
    expect(msg).toContain('CUSTOMER_SCOPE_CHANGE');
    expect(msg).toContain('MEASUREMENT_ERROR');
    expect(msg).toContain('PRICING_ERROR');
  });

  it('states a negative unattributed amount exactly', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [{ reason: 'PRICING_ERROR', amountCents: '22500' }], // over-attributed
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain(formatMoney(-2500n)); // "-$25.00"
  });

  it('requires photoId on every CONCEALED_CONDITION attribution', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [
          { reason: 'CONCEALED_CONDITION', amountCents: '15000' }, // missing photo
          { reason: 'CONCEALED_CONDITION', amountCents: '5000', photoId: 'ph_1' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const photoErrors = result.errors.filter((e) => e.includes('photoId'));
    expect(photoErrors).toHaveLength(1);
    expect(photoErrors[0]).toContain('CONCEALED_CONDITION');
  });

  it('treats an empty-string photoId as missing', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [{ reason: 'CONCEALED_CONDITION', amountCents: '20000', photoId: '' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('photoId'))).toBe(true);
  });

  it('does not flag photos on other reasons', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [
          { reason: 'MEASUREMENT_ERROR', amountCents: '20000' }, // no photo needed
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an empty actualLines list', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        actualLines: [],
        attributions: [{ reason: 'MEASUREMENT_ERROR', amountCents: '-880000' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('actual cost line'))).toBe(true);
  });

  it('accumulates multiple independent errors', () => {
    const result = validateCloseout(
      QUOTE,
      closeout({
        attributions: [{ reason: 'CONCEALED_CONDITION', amountCents: '5000' }],
      }),
    );
    // 15,000 still unattributed AND the concealed attribution lacks a photo
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
