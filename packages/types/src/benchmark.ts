import { z } from 'zod';
import { MoneyString } from './money';

/**
 * Phase 6 — Pooled benchmark. D10: anonymized, aggregate-only. No contractor
 * ever sees another contractor's individual jobs. CUSTOMER_SCOPE_CHANGE is
 * excluded from every distribution. Concealed-condition variance is deflated
 * for material price movement between quote month and close month.
 */

/** One anonymized closed job. tenantKey is an opaque hash, never an id. */
export const BenchmarkRecord = z.object({
  tenantKey: z.string(),
  concealedCents: MoneyString,
  contractCents: MoneyString,
  squaresX100: z.number().int(),
  pitchTwelfths: z.number().int(),
  existingLayers: z.number().int(),
  roofAgeYears: z.number().int().nullable(),
  quoteMonth: z.string().regex(/^\d{4}-\d{2}$/),
  closeMonth: z.string().regex(/^\d{4}-\d{2}$/),
});
export type BenchmarkRecord = z.infer<typeof BenchmarkRecord>;

export const StratumResult = z.object({
  key: z.string(), // e.g. "squares:15-25"
  label: z.string(), // e.g. "15–25 squares"
  jobs: z.number().int(),
  tenants: z.number().int(),
  /** True when below the k-anonymity floor — percentiles withheld. */
  locked: z.boolean(),
  /** Concealed-condition variance as bps of contract value. */
  p50Bps: z.number().int().nullable(),
  p90Bps: z.number().int().nullable(),
  p95Bps: z.number().int().nullable(),
});
export type StratumResult = z.infer<typeof StratumResult>;

export const BenchmarkReport = z.object({
  overall: StratumResult,
  bySquares: z.array(StratumResult),
  byPitch: z.array(StratumResult),
  byLayers: z.array(StratumResult),
  byRoofAge: z.array(StratumResult),
  /** k-anonymity floor: no stratum renders below this. */
  kJobs: z.number().int(),
  kTenants: z.number().int(),
  deflated: z.boolean(),
});
export type BenchmarkReport = z.infer<typeof BenchmarkReport>;

export const BenchmarkResponse = z.object({
  /** Gate (D8): unlocks at 80% closeout completion on jobs ≥30 days old. */
  unlocked: z.boolean(),
  completionBps: z.number().int(),
  /** Jobs still needing closeout to reach the gate. */
  remainingCount: z.number().int(),
  /** Aggregate-only report; null while locked. */
  report: BenchmarkReport.nullable(),
});
export type BenchmarkResponse = z.infer<typeof BenchmarkResponse>;
