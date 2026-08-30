import {
  BPS_ONE,
  formatBps,
  formatMoney,
  formatMultiplier,
  fromMoney,
  toMoney,
} from '@rafter/types';
import type {
  ComputedLineItem,
  Factor,
  LineItemCode,
  MeasurementInput,
  Money,
  MultiplierBand,
  PriceModelRates,
  QuoteComputation,
  Unit,
} from '@rafter/types';
import { EngineError } from './errors';
import { divHalfEven, mulBps, sumMoney } from './money';

export { EngineError } from './errors';

export const ENGINE_VERSION = 'engine@0.1.0';

interface AppliedMultiplier {
  label: string;
  bps: number;
}

/**
 * Bands are matched ascending by upTo (inclusive): the first band whose upTo
 * >= value wins. Input order does not matter — we sort a copy. No matching
 * band is a model-coverage bug and throws.
 */
function lookupBand(bands: MultiplierBand[], value: number, dimension: string): number {
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo);
  for (const band of sorted) {
    if (band.upTo >= value) return band.bps;
  }
  throw new EngineError(
    `No ${dimension} multiplier band covers value ${value} (max upTo ${
      sorted.length > 0 ? (sorted[sorted.length - 1] as MultiplierBand).upTo : 'none'
    })`,
  );
}

/** "2430" hundredths of SQ → "24.30 SQ". Pure integer/string math. */
function formatQuantityX100(qtyX100: number, unit: Unit): string {
  const neg = qtyX100 < 0;
  const abs = neg ? -qtyX100 : qtyX100;
  const s = abs.toString().padStart(3, '0');
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = s.slice(-2);
  return `${neg ? '-' : ''}${whole}.${frac} ${unit}`;
}

/**
 * One direct line. Single rounding step (D1):
 *   totalCents = divHalfEven(rate × qtyX100 × Πbps_i, 100 × 10000^k)
 * The Factor[] carries quantity, rate, and every multiplier so a hand-checker
 * can reconstruct totalCents from the factors alone (D4).
 */
function computeLine(args: {
  code: LineItemCode;
  description: string;
  unit: Unit;
  quantityX100: number;
  rateCents: Money;
  multipliers: AppliedMultiplier[];
  ruleVersion: string;
  inputLabel: string;
}): ComputedLineItem {
  const { code, description, unit, quantityX100, rateCents, multipliers, ruleVersion, inputLabel } =
    args;
  const k = multipliers.length;

  let numerator = rateCents * BigInt(quantityX100);
  let denominator = 100n;
  let bpsProduct = 1n;
  for (const m of multipliers) {
    numerator *= BigInt(m.bps);
    denominator *= 10_000n;
    bpsProduct *= BigInt(m.bps);
  }
  const totalCents = divHalfEven(numerator, denominator);
  const netMultiplierBps =
    k > 0 ? Number(divHalfEven(bpsProduct, 10_000n ** BigInt(k - 1))) : BPS_ONE;

  const factors: Factor[] = [
    {
      kind: 'INPUT',
      label: inputLabel,
      value: formatQuantityX100(quantityX100, unit),
      ruleVersion,
    },
    {
      kind: 'RATE',
      label: 'Rate',
      value: `${formatMoney(rateCents)}/${unit}`,
      ruleVersion,
    },
    ...multipliers.map(
      (m): Factor => ({
        kind: 'MULTIPLIER',
        label: m.label,
        value: formatMultiplier(m.bps),
        ruleVersion,
      }),
    ),
    {
      kind: 'SUBTOTAL',
      label: 'Line total',
      value: formatMoney(totalCents),
      runningCents: fromMoney(totalCents),
      ruleVersion,
    },
  ];

  return {
    code,
    description,
    unit,
    quantityX100,
    unitRateCents: fromMoney(rateCents),
    netMultiplierBps,
    totalCents: fromMoney(totalCents),
    factors,
  };
}

/** OVERHEAD / MARGIN: a bps percentage applied to a cents basis. */
function percentLine(args: {
  code: LineItemCode;
  description: string;
  basisLabel: string;
  basisCents: Money;
  bps: number;
  ruleVersion: string;
}): ComputedLineItem {
  const { code, description, basisLabel, basisCents, bps, ruleVersion } = args;
  const totalCents = mulBps(basisCents, bps);
  const factors: Factor[] = [
    {
      kind: 'SUBTOTAL',
      label: basisLabel,
      value: formatMoney(basisCents),
      runningCents: fromMoney(basisCents),
      ruleVersion,
    },
    {
      kind: 'MULTIPLIER',
      label: description,
      value: formatBps(bps),
      ruleVersion,
    },
    {
      kind: 'SUBTOTAL',
      label: 'Line total',
      value: formatMoney(totalCents),
      runningCents: fromMoney(totalCents),
      ruleVersion,
    },
  ];
  return {
    code,
    description,
    unit: 'PCT',
    quantityX100: bps,
    unitRateCents: fromMoney(basisCents),
    netMultiplierBps: bps,
    totalCents: fromMoney(totalCents),
    factors,
  };
}

/**
 * Pure quote computation (D2). `asOf` is an explicit input, serialized once via
 * toISOString — the engine never reads a clock. Quantity convention:
 * quantityX100 is hundredths of the unit, and squaresX100 === roofAreaSqFt
 * (1 SQ = 100 sqft, so 2430 sqft = 24.30 SQ).
 */
export function computeQuote(
  input: { measurement: MeasurementInput; rates: PriceModelRates; priceModelVersionId: string },
  asOf: Date,
): QuoteComputation {
  const { measurement: m, rates } = input;
  const squaresX100 = m.roofAreaSqFt;

  const pitch: AppliedMultiplier = {
    label: `Pitch ${m.pitchTwelfths}/12`,
    bps: lookupBand(rates.pitchMultipliers, m.pitchTwelfths, 'pitch'),
  };
  const story: AppliedMultiplier = {
    label: `${m.stories}-story`,
    bps: lookupBand(rates.storyMultipliers, m.stories, 'story'),
  };
  const facet: AppliedMultiplier = {
    label: `${m.facets} facets`,
    bps: lookupBand(rates.facetMultipliers, m.facets, 'facet'),
  };
  const waste: AppliedMultiplier = {
    label: 'Waste allowance',
    bps: BPS_ONE + rates.wasteBps,
  };

  const directLines: ComputedLineItem[] = [
    computeLine({
      code: 'TEAR_OFF',
      description: `Tear-off (${m.existingLayers} ${m.existingLayers === 1 ? 'layer' : 'layers'})`,
      unit: 'SQ',
      quantityX100: squaresX100 * m.existingLayers,
      rateCents: toMoney(rates.tearOffPerSquarePerLayerCents),
      multipliers: [pitch, story],
      ruleVersion: 'tear-off@1',
      inputLabel: 'Roof area × layers',
    }),
    computeLine({
      code: 'UNDERLAYMENT',
      description: 'Underlayment',
      unit: 'SQ',
      quantityX100: squaresX100,
      rateCents: toMoney(rates.underlaymentPerSquareCents),
      multipliers: [waste, pitch],
      ruleVersion: 'underlayment@1',
      inputLabel: 'Roof area',
    }),
    computeLine({
      code: 'FIELD_SHINGLE',
      description: 'Field shingles',
      unit: 'SQ',
      quantityX100: squaresX100,
      rateCents: toMoney(rates.fieldShinglePerSquareCents),
      multipliers: [waste, pitch, story, facet],
      ruleVersion: 'field-shingle@1',
      inputLabel: 'Roof area',
    }),
    computeLine({
      code: 'RIDGE_HIP',
      description: 'Ridge & hip cap',
      unit: 'LF',
      quantityX100: m.ridgeHipLf * 100,
      rateCents: toMoney(rates.ridgeHipPerLfCents),
      multipliers: [],
      ruleVersion: 'ridge-hip@1',
      inputLabel: 'Ridge + hip length',
    }),
    computeLine({
      code: 'VALLEY',
      description: 'Valley',
      unit: 'LF',
      quantityX100: m.valleyLf * 100,
      rateCents: toMoney(rates.valleyPerLfCents),
      multipliers: [],
      ruleVersion: 'valley@1',
      inputLabel: 'Valley length',
    }),
    computeLine({
      code: 'FLASHING',
      description: 'Flashing',
      unit: 'LF',
      quantityX100: m.flashingLf * 100,
      rateCents: toMoney(rates.flashingPerLfCents),
      multipliers: [],
      ruleVersion: 'flashing@1',
      inputLabel: 'Flashing length',
    }),
    computeLine({
      code: 'PENETRATIONS',
      description: 'Penetrations',
      unit: 'EA',
      quantityX100: m.penetrations * 100,
      rateCents: toMoney(rates.penetrationEachCents),
      multipliers: [],
      ruleVersion: 'penetrations@1',
      inputLabel: 'Penetration count',
    }),
    computeLine({
      code: 'DECKING_ALLOWANCE',
      description: 'Decking replacement allowance',
      unit: 'SHEET',
      quantityX100: rates.deckingAllowanceSheets * 100,
      rateCents: toMoney(rates.deckingPerSheetCents),
      multipliers: [],
      ruleVersion: 'decking-allowance@1',
      inputLabel: 'Allowance sheets',
    }),
    computeLine({
      code: 'PERMIT',
      description: 'Permit',
      unit: 'FLAT',
      quantityX100: 100,
      rateCents: toMoney(rates.permitFlatCents),
      multipliers: [],
      ruleVersion: 'permit@1',
      inputLabel: 'Permit',
    }),
    computeLine({
      code: 'DISPOSAL',
      description: 'Disposal',
      unit: 'SQ',
      quantityX100: squaresX100 * m.existingLayers,
      rateCents: toMoney(rates.disposalPerSquareCents),
      multipliers: [],
      ruleVersion: 'disposal@1',
      inputLabel: 'Roof area × layers',
    }),
  ];

  const subtotal = sumMoney(directLines.map((li) => toMoney(li.totalCents)));

  const overheadLine = percentLine({
    code: 'OVERHEAD',
    description: 'Overhead',
    basisLabel: 'Direct cost subtotal',
    basisCents: subtotal,
    bps: rates.overheadBps,
    ruleVersion: 'overhead@1',
  });
  const overhead = toMoney(overheadLine.totalCents);

  const marginBasis = subtotal + overhead;
  const marginLine = percentLine({
    code: 'MARGIN',
    description: 'Margin',
    basisLabel: 'Cost basis (subtotal + overhead)',
    basisCents: marginBasis,
    bps: rates.marginBps,
    ruleVersion: 'margin@1',
  });
  const margin = toMoney(marginLine.totalCents);

  const total = marginBasis + margin;

  return {
    priceModelVersionId: input.priceModelVersionId,
    engineVersion: ENGINE_VERSION,
    asOf: asOf.toISOString(),
    lineItems: [...directLines, overheadLine, marginLine],
    subtotalCents: fromMoney(subtotal),
    overheadCents: fromMoney(overhead),
    marginCents: fromMoney(margin),
    totalCents: fromMoney(total),
  };
}
