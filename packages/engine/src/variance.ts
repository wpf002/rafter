import { formatMoney, fromMoney, toMoney } from '@rafter/types';
import type {
  ActualCategory,
  CloseoutInput,
  MoneyString,
  QuoteComputation,
  VarianceReason,
  VarianceReport,
} from '@rafter/types';
import { divHalfEven, sumMoney } from './money';

const REASONS: readonly VarianceReason[] = [
  'CONCEALED_CONDITION',
  'CUSTOMER_SCOPE_CHANGE',
  'MEASUREMENT_ERROR',
  'PRICING_ERROR',
];

const CATEGORIES: readonly ActualCategory[] = [
  'MATERIAL',
  'LABOR',
  'DISPOSAL',
  'PERMIT',
  'OTHER',
];

type QuoteTotals = Pick<
  QuoteComputation,
  'subtotalCents' | 'overheadCents' | 'marginCents' | 'totalCents'
>;

/** x as bps of revenue, half-even; 0 when revenue is zero. */
function bpsOfRevenue(x: bigint, revenue: bigint): number {
  return revenue === 0n ? 0 : Number(divHalfEven(x * 10_000n, revenue));
}

/**
 * Per-job variance report (D7): every dollar of actual-vs-quoted cost variance
 * must land in exactly one attribution reason; anything left over is
 * unattributed and blocks closeout.
 */
export function computeVariance(quote: QuoteTotals, closeout: CloseoutInput): VarianceReport {
  const revenue = toMoney(quote.totalCents);
  const quotedCost = toMoney(quote.subtotalCents) + toMoney(quote.overheadCents);
  const plannedMargin = toMoney(quote.marginCents);
  const actualCost = sumMoney(closeout.actualLines.map((l) => toMoney(l.amountCents)));
  const variance = actualCost - quotedCost; // positive = overrun
  const attributed = sumMoney(closeout.attributions.map((a) => toMoney(a.amountCents)));
  const unattributed = variance - attributed;
  const actualMargin = revenue - actualCost;

  const byReasonCents = {} as Record<VarianceReason, bigint>;
  for (const r of REASONS) byReasonCents[r] = 0n;
  for (const a of closeout.attributions) {
    byReasonCents[a.reason] += toMoney(a.amountCents);
  }

  const byCategoryCents = {} as Record<ActualCategory, bigint>;
  for (const c of CATEGORIES) byCategoryCents[c] = 0n;
  for (const l of closeout.actualLines) {
    byCategoryCents[l.category] += toMoney(l.amountCents);
  }

  const byReason = {} as Record<VarianceReason, MoneyString>;
  for (const r of REASONS) byReason[r] = fromMoney(byReasonCents[r]);
  const byCategory = {} as Record<ActualCategory, MoneyString>;
  for (const c of CATEGORIES) byCategory[c] = fromMoney(byCategoryCents[c]);

  return {
    revenueCents: fromMoney(revenue),
    quotedCostCents: fromMoney(quotedCost),
    plannedMarginCents: fromMoney(plannedMargin),
    plannedMarginBps: bpsOfRevenue(plannedMargin, revenue),
    actualCostCents: fromMoney(actualCost),
    actualMarginCents: fromMoney(actualMargin),
    actualMarginBps: bpsOfRevenue(actualMargin, revenue),
    varianceCents: fromMoney(variance),
    byReason,
    byCategory,
    attributedCents: fromMoney(attributed),
    unattributedCents: fromMoney(unattributed),
  };
}

/**
 * Closeout gate (D6/D7): a job may only close when every cent of variance is
 * attributed, every CONCEALED_CONDITION attribution has a photo, and at least
 * one actual cost line exists.
 */
export function validateCloseout(
  quote: QuoteTotals,
  closeout: CloseoutInput,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (closeout.actualLines.length === 0) {
    errors.push('Closeout requires at least one actual cost line.');
  }

  const report = computeVariance(quote, closeout);
  const unattributed = toMoney(report.unattributedCents);
  if (unattributed !== 0n) {
    errors.push(
      `Unattributed variance of ${formatMoney(unattributed)} remains. ` +
        `Every dollar of variance must be attributed to exactly one of: ${REASONS.join(', ')}.`,
    );
  }

  closeout.attributions.forEach((a, i) => {
    if (a.reason === 'CONCEALED_CONDITION' && (a.photoId === undefined || a.photoId === '')) {
      errors.push(
        `Attribution ${i + 1} (CONCEALED_CONDITION) requires a photoId as evidence.`,
      );
    }
  });

  return { ok: errors.length === 0, errors };
}
