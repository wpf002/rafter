'use client';

import {
  formatBps,
  formatMoney,
  toMoney,
  type ActualCategory,
  type VarianceReason,
  type VarianceReport,
} from '@rafter/types';
import { DeltaChip, MetricCard } from './ui';
import { Waterfall, type WaterfallStep } from './Waterfall';

const REASON_ORDER: { reason: VarianceReason; label: string }[] = [
  { reason: 'CONCEALED_CONDITION', label: 'Surprises' },
  { reason: 'CUSTOMER_SCOPE_CHANGE', label: 'Scope' },
  { reason: 'MEASUREMENT_ERROR', label: 'Measure' },
  { reason: 'PRICING_ERROR', label: 'Pricing' },
];

const CATEGORY_LABEL: Record<ActualCategory, string> = {
  MATERIAL: 'Material',
  LABOR: 'Labor',
  DISPOSAL: 'Disposal',
  PERMIT: 'Permit',
  OTHER: 'Other',
};

/** The headline output: per-job margin report with the variance waterfall. */
export function MarginReport({ variance }: { variance: VarianceReport }) {
  const planned = toMoney(variance.plannedMarginCents);
  const actual = toMoney(variance.actualMarginCents);
  const delta = actual - planned;

  const steps: WaterfallStep[] = REASON_ORDER.flatMap(({ reason, label }) => {
    const amount = toMoney(variance.byReason[reason] ?? '0');
    return amount === 0n ? [] : [{ label, amount }];
  });

  const categories = (Object.keys(CATEGORY_LABEL) as ActualCategory[])
    .map((c) => ({ c, amount: toMoney(variance.byCategory[c] ?? '0') }))
    .filter((e) => e.amount !== 0n);

  return (
    <section className="section">
      <span className="section-label">Profit on This Job</span>
      <div className="metric-row" style={{ marginTop: 8 }}>
        <MetricCard label="Revenue" value={formatMoney(toMoney(variance.revenueCents))} />
        <MetricCard label="Actual Cost" value={formatMoney(toMoney(variance.actualCostCents))} />
        <MetricCard
          label="Actual Profit"
          value={formatMoney(actual)}
          sub={formatBps(variance.actualMarginBps)}
          chip={
            <DeltaChip good={delta >= 0n}>
              {formatMoney(delta, { sign: true })} vs Plan
            </DeltaChip>
          }
        />
        <MetricCard
          label="Planned Profit"
          value={formatMoney(planned)}
          sub={formatBps(variance.plannedMarginBps)}
        />
      </div>
      <div className="card card-pad">
        <Waterfall planned={planned} actual={actual} steps={steps} />
      </div>
      {categories.length > 0 && (
        <div className="card" style={{ marginTop: 12, maxWidth: 380 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Actual Costs by Category</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(({ c, amount }) => (
                <tr key={c}>
                  <td>{CATEGORY_LABEL[c]}</td>
                  <td className="num mono">{formatMoney(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
