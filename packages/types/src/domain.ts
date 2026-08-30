import { z } from 'zod';
import { Bps, MoneyString } from './money';

/* ------------------------------------------------------------------ */
/* Job lifecycle                                                       */
/* ------------------------------------------------------------------ */

export const JobState = z.enum([
  'DRAFT',
  'QUOTED',
  'SOLD',
  'IN_PROGRESS',
  'AWAITING_CLOSEOUT',
  'CLOSED',
]);
export type JobState = z.infer<typeof JobState>;

/** Legal transitions. CLOSED is only reachable via a complete closeout (D6). */
export const JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  DRAFT: ['QUOTED'],
  QUOTED: ['SOLD'],
  SOLD: ['IN_PROGRESS'],
  IN_PROGRESS: ['AWAITING_CLOSEOUT'],
  AWAITING_CLOSEOUT: ['CLOSED'],
  CLOSED: [],
};

/* ------------------------------------------------------------------ */
/* Measurement (D9 — provider-agnostic; no vendor names)               */
/* ------------------------------------------------------------------ */

export const MeasurementSource = z.enum(['MANUAL', 'AERIAL_STUB']);
export type MeasurementSource = z.infer<typeof MeasurementSource>;

/**
 * All quantities are integers so downstream math never touches floats.
 * roofAreaSqFt doubles as "squares × 100" (1 square = 100 sqft).
 */
export const MeasurementInput = z.object({
  roofAreaSqFt: z.number().int().positive(),
  pitchTwelfths: z.number().int().min(0).max(24), // 6 → 6/12
  stories: z.number().int().min(1).max(4),
  facets: z.number().int().min(1).max(200),
  ridgeHipLf: z.number().int().min(0),
  valleyLf: z.number().int().min(0),
  eaveLf: z.number().int().min(0),
  rakeLf: z.number().int().min(0),
  flashingLf: z.number().int().min(0),
  penetrations: z.number().int().min(0),
  existingLayers: z.number().int().min(1).max(4),
  deckingCondition: z.enum(['UNKNOWN', 'GOOD', 'SUSPECT']).default('UNKNOWN'),
});
export type MeasurementInput = z.infer<typeof MeasurementInput>;

export const Measurement = MeasurementInput.extend({
  id: z.string(),
  jobId: z.string(),
  source: MeasurementSource,
  providerRef: z.string().nullish(),
  capturedAt: z.string(), // ISO
});
export type Measurement = z.infer<typeof Measurement>;

/* ------------------------------------------------------------------ */
/* Price model (D3 — versions are immutable)                           */
/* ------------------------------------------------------------------ */

const MultiplierBand = z.object({
  /** Band upper bound, inclusive. Bands are matched in ascending order. */
  upTo: z.number().int(),
  bps: Bps,
});
export type MultiplierBand = z.infer<typeof MultiplierBand>;

export const PriceModelRates = z.object({
  tearOffPerSquarePerLayerCents: MoneyString,
  underlaymentPerSquareCents: MoneyString,
  fieldShinglePerSquareCents: MoneyString,
  ridgeHipPerLfCents: MoneyString,
  valleyPerLfCents: MoneyString,
  flashingPerLfCents: MoneyString,
  penetrationEachCents: MoneyString,
  deckingPerSheetCents: MoneyString,
  /** Sheets of decking replacement included in the fixed price. */
  deckingAllowanceSheets: z.number().int().min(0),
  permitFlatCents: MoneyString,
  disposalPerSquareCents: MoneyString,
  overheadBps: Bps,
  marginBps: Bps,
  /** Waste applied to field shingle + underlayment quantities. */
  wasteBps: Bps,
  /** Keyed by pitchTwelfths (upTo inclusive). Must cover pitch 0–24. */
  pitchMultipliers: z.array(MultiplierBand).min(1),
  /** Keyed by stories (upTo inclusive). Must cover 1–4. */
  storyMultipliers: z.array(MultiplierBand).min(1),
  /** Keyed by facet count (upTo inclusive). Must cover up to 200. */
  facetMultipliers: z.array(MultiplierBand).min(1),
});
export type PriceModelRates = z.infer<typeof PriceModelRates>;

export const PriceModelVersion = z.object({
  id: z.string(),
  priceModelId: z.string(),
  version: z.number().int().positive(),
  rates: PriceModelRates,
  createdAt: z.string(),
});
export type PriceModelVersion = z.infer<typeof PriceModelVersion>;

export const PriceModel = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  versions: z.array(PriceModelVersion).optional(),
  currentVersion: PriceModelVersion.optional(),
});
export type PriceModel = z.infer<typeof PriceModel>;

/* ------------------------------------------------------------------ */
/* Quote (D4 — every line carries Factor[] provenance)                 */
/* ------------------------------------------------------------------ */

export const LineItemCode = z.enum([
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
export type LineItemCode = z.infer<typeof LineItemCode>;

export const Unit = z.enum(['SQ', 'LF', 'EA', 'SHEET', 'FLAT', 'PCT']);
export type Unit = z.infer<typeof Unit>;

export const Factor = z.object({
  kind: z.enum(['INPUT', 'RATE', 'MULTIPLIER', 'SUBTOTAL', 'ROUNDING']),
  label: z.string(), // "Roof area", "Pitch 8/12", "Tear-off rate"
  value: z.string(), // "2,430 sqft", "×1.15", "$110.00/sq"
  /** Running total in cents after this factor is applied, when meaningful. */
  runningCents: MoneyString.optional(),
  /** Engine rule that emitted this factor, e.g. "tear-off@1". */
  ruleVersion: z.string(),
});
export type Factor = z.infer<typeof Factor>;

export const ComputedLineItem = z.object({
  code: LineItemCode,
  description: z.string(),
  unit: Unit,
  /** Quantity in hundredths of the unit (2430 = 24.30 SQ). */
  quantityX100: z.number().int(),
  unitRateCents: MoneyString,
  /** Net multiplier applied to this line, in bps (10000 = ×1). */
  netMultiplierBps: z.number().int(),
  totalCents: MoneyString,
  factors: z.array(Factor).min(1),
});
export type ComputedLineItem = z.infer<typeof ComputedLineItem>;

export const QuoteComputation = z.object({
  priceModelVersionId: z.string(),
  engineVersion: z.string(),
  asOf: z.string(), // ISO — explicit input, never the clock (D2)
  lineItems: z.array(ComputedLineItem),
  /** Direct-cost lines only (everything except OVERHEAD and MARGIN). */
  subtotalCents: MoneyString,
  overheadCents: MoneyString,
  marginCents: MoneyString,
  totalCents: MoneyString,
});
export type QuoteComputation = z.infer<typeof QuoteComputation>;

export const Quote = QuoteComputation.extend({
  id: z.string(),
  jobId: z.string(),
  issuedAt: z.string(),
});
export type Quote = z.infer<typeof Quote>;

/* ------------------------------------------------------------------ */
/* Closeout (D6/D7)                                                    */
/* ------------------------------------------------------------------ */

export const ActualCategory = z.enum(['MATERIAL', 'LABOR', 'DISPOSAL', 'PERMIT', 'OTHER']);
export type ActualCategory = z.infer<typeof ActualCategory>;

export const ActualLine = z.object({
  description: z.string().min(1),
  category: ActualCategory,
  amountCents: MoneyString,
});
export type ActualLine = z.infer<typeof ActualLine>;

export const VarianceReason = z.enum([
  'CONCEALED_CONDITION',
  'CUSTOMER_SCOPE_CHANGE',
  'MEASUREMENT_ERROR',
  'PRICING_ERROR',
]);
export type VarianceReason = z.infer<typeof VarianceReason>;

export const VarianceAttribution = z.object({
  reason: VarianceReason,
  amountCents: MoneyString, // signed; positive = cost overrun vs quote
  note: z.string().optional(),
  /** Required when reason is CONCEALED_CONDITION (enforced in engine + DB). */
  photoId: z.string().optional(),
});
export type VarianceAttribution = z.infer<typeof VarianceAttribution>;

export const CloseoutInput = z.object({
  actualLines: z.array(ActualLine).min(1),
  attributions: z.array(VarianceAttribution),
});
export type CloseoutInput = z.infer<typeof CloseoutInput>;

export const Closeout = CloseoutInput.extend({
  id: z.string(),
  jobId: z.string(),
  submittedAt: z.string(),
});
export type Closeout = z.infer<typeof Closeout>;

/* ------------------------------------------------------------------ */
/* Variance report — the per-job margin report is the headline output  */
/* ------------------------------------------------------------------ */

export const VarianceReport = z.object({
  /** Contract price = issued quote total. */
  revenueCents: MoneyString,
  /** Quoted cost basis: direct subtotal + overhead. */
  quotedCostCents: MoneyString,
  plannedMarginCents: MoneyString,
  plannedMarginBps: z.number().int(),
  actualCostCents: MoneyString,
  actualMarginCents: MoneyString,
  actualMarginBps: z.number().int(),
  /** actualCost − quotedCost. Positive = overrun. */
  varianceCents: MoneyString,
  byReason: z.record(VarianceReason, MoneyString),
  byCategory: z.record(ActualCategory, MoneyString),
  attributedCents: MoneyString,
  /** Must be "0" before a job may close (D7). */
  unattributedCents: MoneyString,
});
export type VarianceReport = z.infer<typeof VarianceReport>;

/* ------------------------------------------------------------------ */
/* Events (append-only)                                                */
/* ------------------------------------------------------------------ */

export const JobEvent = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: z.string(), // e.g. "STATE_CHANGED", "QUOTE_ISSUED", "CLOSEOUT_SUBMITTED"
  payload: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type JobEvent = z.infer<typeof JobEvent>;
