import {
  fromMoney,
  toMoney,
  type LineItemCode,
  type PriceModelRates,
  type TunableRateField,
  type TuningJobRecord,
  type TuningRateRow,
  type TuningReport,
} from '@rafter/types';
import { allocate, divHalfEven, mulRatio, sumMoney } from './money';

/**
 * Phase 5 — Auto-tune (deterministic arithmetic on the tenant's OWN closed
 * jobs; no ML, no pooled data, never auto-applied — accepted suggestions
 * become a NEW immutable price model version, D3).
 *
 * Everything here is exact integer math: money is bigint cents (D1),
 * quantities are integer hundredths of a unit, and the only rounding is
 * half-even via divHalfEven. Date.parse on the jobs' ISO closedAt strings is
 * the sole time input — no clock reads (D2).
 */

/**
 * The unit-rate lines eligible for tuning, in display order. OVERHEAD and
 * MARGIN are policy bps, PERMIT is a flat fee, and DECKING is an allowance —
 * none of them is a per-unit cost rate, so none is tunable.
 */
export const TUNABLE_LINES: ReadonlyArray<{
  code: LineItemCode;
  rateField: TunableRateField;
  label: string;
}> = [
  {
    code: 'TEAR_OFF',
    rateField: 'tearOffPerSquarePerLayerCents',
    label: 'Tear-off, per square per layer',
  },
  { code: 'UNDERLAYMENT', rateField: 'underlaymentPerSquareCents', label: 'Underlayment, per square' },
  { code: 'FIELD_SHINGLE', rateField: 'fieldShinglePerSquareCents', label: 'Field shingle, per square' },
  { code: 'RIDGE_HIP', rateField: 'ridgeHipPerLfCents', label: 'Ridge/hip cap, per linear foot' },
  { code: 'VALLEY', rateField: 'valleyPerLfCents', label: 'Valley, per linear foot' },
  { code: 'FLASHING', rateField: 'flashingPerLfCents', label: 'Flashing, per linear foot' },
  { code: 'PENETRATIONS', rateField: 'penetrationEachCents', label: 'Penetrations, each' },
  { code: 'DISPOSAL', rateField: 'disposalPerSquareCents', label: 'Disposal, per square' },
];

const TUNABLE_BY_CODE: ReadonlyMap<LineItemCode, TunableRateField> = new Map(
  TUNABLE_LINES.map((t) => [t.code, t.rateField]),
);

const MS_PER_DAY = 86_400_000;

interface CodeAggregate {
  totalQuantityX100: number;
  allocatedPricingErrorCents: bigint;
  jobsTouched: number;
}

/**
 * Compute rate-tuning suggestions from a window of closed jobs.
 *
 * Algorithm (deterministic, order-independent per code):
 * 1. minJobs defaults to 20; eligible = jobCount >= minJobs. Rows are ALWAYS
 *    computed so the UI can preview an ineligible window.
 * 2. Per job: take its tunable lines with quantityX100 > 0 and split the
 *    job's signed pricingErrorCents across them with allocate() (largest
 *    remainder — the shares sum to the error exactly), weighted by each
 *    line's totalCents. Jobs with no tunable quantity, or whose tunable
 *    lines all have zero totals, contribute quantity/jobsTouched but no
 *    allocation.
 * 3. Aggregate per code: total quantity, allocated error (bigint sum), and
 *    the count of jobs where the code had quantity > 0.
 * 4. perUnitGapCents = allocated×100 / totalQuantityX100 (half-even) — the
 *    ×100 converts hundredth-unit quantities into a per-WHOLE-unit gap.
 *    suggestedRateCents = max(0, current + gap): a rate never goes negative.
 *    windowImpactCents = gap × quantity / 100 — the gap re-applied to the
 *    observed volume.
 * 5. windowDays = max(1, round((max closedAt − min closedAt) / 86400000));
 *    annualizedImpactCents = windowImpact × 365 / windowDays (half-even).
 *    Day counts are plain integers, not money, so Number math is fine.
 * 6. Rows follow TUNABLE_LINES order and only include codes seen with
 *    quantity > 0 in the window.
 */
export function computeTuning(input: {
  closedJobs: TuningJobRecord[];
  currentRates: PriceModelRates;
  minJobs?: number;
}): TuningReport {
  const minJobs = input.minJobs ?? 20;
  const jobCount = input.closedJobs.length;

  if (jobCount === 0) {
    return {
      eligible: false,
      jobCount: 0,
      minJobs,
      windowDays: 0,
      rows: [],
      totalAnnualizedImpactCents: '0',
    };
  }

  const eligible = jobCount >= minJobs;

  // ---- steps 2–3: allocate each job's pricing error, aggregate per code ----
  const aggregates = new Map<LineItemCode, CodeAggregate>();
  let minClosedMs = Number.POSITIVE_INFINITY;
  let maxClosedMs = Number.NEGATIVE_INFINITY;

  for (const job of input.closedJobs) {
    const closedMs = Date.parse(job.closedAt);
    if (closedMs < minClosedMs) minClosedMs = closedMs;
    if (closedMs > maxClosedMs) maxClosedMs = closedMs;

    const tunableLines = job.lineItems.filter(
      (li) => TUNABLE_BY_CODE.has(li.code) && li.quantityX100 > 0,
    );

    // Number() on cents is permitted here: totals are only allocation WEIGHTS.
    const weights = tunableLines.map((li) => Number(toMoney(li.totalCents)));
    const canAllocate = tunableLines.length > 0 && weights.some((w) => w !== 0);
    const shares = canAllocate
      ? allocate(toMoney(job.pricingErrorCents), weights)
      : tunableLines.map(() => 0n);

    const codesTouched = new Set<LineItemCode>();
    for (let i = 0; i < tunableLines.length; i++) {
      const line = tunableLines[i] as (typeof tunableLines)[number];
      const agg = aggregates.get(line.code) ?? {
        totalQuantityX100: 0,
        allocatedPricingErrorCents: 0n,
        jobsTouched: 0,
      };
      agg.totalQuantityX100 += line.quantityX100;
      agg.allocatedPricingErrorCents += shares[i] as bigint;
      aggregates.set(line.code, agg);
      codesTouched.add(line.code);
    }
    for (const code of codesTouched) {
      (aggregates.get(code) as CodeAggregate).jobsTouched += 1;
    }
  }

  // ---- step 5: observed window in whole days (minimum 1) ----
  const windowDays = Math.max(1, Math.round((maxClosedMs - minClosedMs) / MS_PER_DAY));

  // ---- steps 4 + 6: build rows in TUNABLE_LINES order ----
  const rows: TuningRateRow[] = [];
  for (const { code, rateField, label } of TUNABLE_LINES) {
    const agg = aggregates.get(code);
    if (!agg || agg.totalQuantityX100 <= 0) continue;

    const currentRateCents = toMoney(input.currentRates[rateField]);
    const quantity = BigInt(agg.totalQuantityX100);
    // Gap per WHOLE unit: quantities are hundredths, so scale by 100 first.
    const perUnitGapCents = divHalfEven(agg.allocatedPricingErrorCents * 100n, quantity);
    const suggestedRaw = currentRateCents + perUnitGapCents;
    const suggestedRateCents = suggestedRaw < 0n ? 0n : suggestedRaw;
    const windowImpactCents = mulRatio(perUnitGapCents, quantity, 100n);
    const annualizedImpactCents = divHalfEven(windowImpactCents * 365n, BigInt(windowDays));

    rows.push({
      rateField,
      code,
      label,
      currentRateCents: fromMoney(currentRateCents),
      totalQuantityX100: agg.totalQuantityX100,
      allocatedPricingErrorCents: fromMoney(agg.allocatedPricingErrorCents),
      perUnitGapCents: fromMoney(perUnitGapCents),
      suggestedRateCents: fromMoney(suggestedRateCents),
      windowImpactCents: fromMoney(windowImpactCents),
      annualizedImpactCents: fromMoney(annualizedImpactCents),
      jobsTouched: agg.jobsTouched,
    });
  }

  const totalAnnualizedImpactCents = sumMoney(rows.map((r) => toMoney(r.annualizedImpactCents)));

  return {
    eligible,
    jobCount,
    minJobs,
    windowDays,
    rows,
    totalAnnualizedImpactCents: fromMoney(totalAnnualizedImpactCents),
  };
}

/**
 * Apply accepted suggestions to a rates object, returning a NEW object —
 * inputs are never mutated (the caller persists the result as a new immutable
 * price model version, D3).
 *
 * `accept` selects which rate fields to take; when omitted, every row whose
 * suggestion differs from its current rate is accepted. Fields in `accept`
 * with no corresponding row are ignored.
 */
export function applySuggestions(
  current: PriceModelRates,
  rows: TuningRateRow[],
  accept?: TunableRateField[],
): PriceModelRates {
  const accepted = accept
    ? new Set<TunableRateField>(accept)
    : new Set<TunableRateField>(
        rows
          .filter((r) => toMoney(r.suggestedRateCents) !== toMoney(r.currentRateCents))
          .map((r) => r.rateField),
      );

  const next: PriceModelRates = { ...current };
  for (const row of rows) {
    if (accepted.has(row.rateField)) {
      next[row.rateField] = row.suggestedRateCents;
    }
  }
  return next;
}
