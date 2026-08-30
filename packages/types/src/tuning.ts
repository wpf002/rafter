import { z } from 'zod';
import { LineItemCode } from './domain';
import { MoneyString } from './money';

/**
 * Phase 5 — Auto-tune. Deterministic arithmetic on the tenant's own closed
 * jobs only. No ML, no pooled data. Suggestions become a NEW price model
 * version on accept — never auto-applied (D3).
 */

/** Rate fields eligible for tuning (per-unit cost rates; policy bps excluded). */
export const TunableRateField = z.enum([
  'tearOffPerSquarePerLayerCents',
  'underlaymentPerSquareCents',
  'fieldShinglePerSquareCents',
  'ridgeHipPerLfCents',
  'valleyPerLfCents',
  'flashingPerLfCents',
  'penetrationEachCents',
  'disposalPerSquareCents',
]);
export type TunableRateField = z.infer<typeof TunableRateField>;

/** One closed job's contribution to the tuning window. */
export const TuningJobRecord = z.object({
  jobId: z.string(),
  closedAt: z.string(), // ISO
  lineItems: z.array(
    z.object({
      code: LineItemCode,
      quantityX100: z.number().int(),
      totalCents: MoneyString,
    }),
  ),
  /** Signed PRICING_ERROR variance attributed at closeout. */
  pricingErrorCents: MoneyString,
});
export type TuningJobRecord = z.infer<typeof TuningJobRecord>;

export const TuningRateRow = z.object({
  rateField: TunableRateField,
  code: LineItemCode,
  label: z.string(),
  currentRateCents: MoneyString,
  totalQuantityX100: z.number().int(),
  /** Pricing-error dollars allocated to this rate across the window. */
  allocatedPricingErrorCents: MoneyString,
  /** Signed realized gap per whole unit. */
  perUnitGapCents: MoneyString,
  suggestedRateCents: MoneyString,
  /** Gap × window quantity. */
  windowImpactCents: MoneyString,
  /** Window impact scaled to 365 days at observed volume. */
  annualizedImpactCents: MoneyString,
  jobsTouched: z.number().int(),
});
export type TuningRateRow = z.infer<typeof TuningRateRow>;

export const TuningReport = z.object({
  eligible: z.boolean(),
  jobCount: z.number().int(),
  minJobs: z.number().int(),
  windowDays: z.number().int(),
  rows: z.array(TuningRateRow),
  totalAnnualizedImpactCents: MoneyString,
});
export type TuningReport = z.infer<typeof TuningReport>;

/** Replay of a recent quote through the tuned rates. */
export const TuningReplayRow = z.object({
  jobId: z.string(),
  jobName: z.string(),
  issuedAt: z.string(),
  oldTotalCents: MoneyString,
  newTotalCents: MoneyString,
  deltaCents: MoneyString,
});
export type TuningReplayRow = z.infer<typeof TuningReplayRow>;

export const TuningResponse = z.object({
  modelId: z.string(),
  baseVersionId: z.string(),
  baseVersion: z.number().int(),
  report: TuningReport,
  replay: z.array(TuningReplayRow),
});
export type TuningResponse = z.infer<typeof TuningResponse>;

export const AcceptTuningRequest = z.object({
  /** Subset of suggested rate fields to accept; omit for all suggested. */
  rateFields: z.array(TunableRateField).optional(),
  /** Guard against accepting against a stale suggestion set. */
  baseVersionId: z.string(),
});
export type AcceptTuningRequest = z.infer<typeof AcceptTuningRequest>;
