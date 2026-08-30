import type { MeasurementInput, PriceModelRates } from '@rafter/types';

/**
 * Realistic default rates shared across engine tests.
 * tear-off $55.00/sq/layer · underlayment $28.50/sq · field shingle $285.00/sq
 * ridge $12.75/lf · valley $14.00/lf · flashing $9.50/lf · penetration $45.00
 * decking $95.00/sheet (allowance 2) · permit $350.00 · disposal $22.00/sq
 * overhead 10% · margin 20% · waste 10%
 */
export function defaultRates(overrides: Partial<PriceModelRates> = {}): PriceModelRates {
  return {
    tearOffPerSquarePerLayerCents: '5500',
    underlaymentPerSquareCents: '2850',
    fieldShinglePerSquareCents: '28500',
    ridgeHipPerLfCents: '1275',
    valleyPerLfCents: '1400',
    flashingPerLfCents: '950',
    penetrationEachCents: '4500',
    deckingPerSheetCents: '9500',
    deckingAllowanceSheets: 2,
    permitFlatCents: '35000',
    disposalPerSquareCents: '2200',
    overheadBps: 1000,
    marginBps: 2000,
    wasteBps: 1000,
    // pitch bands cover the full 0–24 domain
    pitchMultipliers: [
      { upTo: 6, bps: 10000 },
      { upTo: 9, bps: 11500 },
      { upTo: 24, bps: 13000 },
    ],
    // stories cover 1–4
    storyMultipliers: [
      { upTo: 1, bps: 10000 },
      { upTo: 2, bps: 10500 },
      { upTo: 4, bps: 11000 },
    ],
    // facets cover 1–200
    facetMultipliers: [
      { upTo: 10, bps: 10000 },
      { upTo: 20, bps: 10750 },
      { upTo: 200, bps: 11500 },
    ],
    ...overrides,
  };
}

/** 2,430 sqft (24.30 SQ), 8/12 pitch, 2 stories, 12 facets, 1 layer. */
export function defaultMeasurement(overrides: Partial<MeasurementInput> = {}): MeasurementInput {
  return {
    roofAreaSqFt: 2430,
    pitchTwelfths: 8,
    stories: 2,
    facets: 12,
    ridgeHipLf: 85,
    valleyLf: 40,
    eaveLf: 160,
    rakeLf: 120,
    flashingLf: 30,
    penetrations: 7,
    existingLayers: 1,
    deckingCondition: 'UNKNOWN',
    ...overrides,
  };
}

export const AS_OF = new Date('2026-01-15T12:00:00.000Z');

/* -------- factor-value parsers (reconstruction from provenance) -------- */

/** "24.30 SQ" → 2430 (hundredths of the unit). */
export function parseQuantityX100(value: string): number {
  const numPart = (value.split(' ')[0] ?? '').replace(/,/g, '');
  const [whole = '0', frac = '00'] = numPart.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** "$55.00/SQ" or "$12,345.00" → 5500n / 1234500n cents. */
export function parseMoneyCents(value: string): bigint {
  const moneyPart = value.split('/')[0] ?? '';
  const neg = moneyPart.includes('-');
  const digits = moneyPart.replace(/[^0-9]/g, '');
  const cents = BigInt(digits);
  return neg ? -cents : cents;
}

/** "×1.15" → 11500n bps. */
export function parseMultiplierBps(value: string): bigint {
  const stripped = value.replace('×', '');
  const [whole = '0', frac = ''] = stripped.split('.');
  return BigInt(whole) * 10000n + BigInt(frac.padEnd(4, '0'));
}
