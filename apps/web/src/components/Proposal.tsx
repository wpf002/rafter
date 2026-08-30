'use client';

import { useState } from 'react';
import {
  formatMoney,
  formatMultiplier,
  toMoney,
  type ComputedLineItem,
  type Factor,
  type QuoteComputation,
} from '@rafter/types';
import { formatQtyX100, UNIT_LABEL } from '@/lib/money';

/**
 * The proposal table. Every computed line expands into its provenance
 * receipt (D4 — Factor[] on every line).
 */
export function ProposalTable({ comp }: { comp: QuoteComputation }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const direct: [ComputedLineItem, number][] = [];
  const overlay: [ComputedLineItem, number][] = [];
  comp.lineItems.forEach((li, i) => {
    if (li.code === 'OVERHEAD' || li.code === 'MARGIN') overlay.push([li, i]);
    else direct.push([li, i]);
  });

  return (
    <table className="proposal">
      <thead>
        <tr>
          <th className="chev" aria-hidden="true" />
          <th>Line</th>
          <th className="num">Qty</th>
          <th className="num">Rate</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {direct.map(([li, i]) => (
          <LineRow key={li.code} li={li} open={open.has(i)} onToggle={() => toggle(i)} />
        ))}
        <tr className="row-subtotal">
          <td className="chev" />
          <td>Direct cost subtotal</td>
          <td className="num" />
          <td className="num" />
          <td className="num mono">{formatMoney(toMoney(comp.subtotalCents))}</td>
        </tr>
        {overlay.map(([li, i], idx) => (
          <LineRow key={li.code} li={li} heavy={idx === 0} open={open.has(i)} onToggle={() => toggle(i)} />
        ))}
        <tr className="row-total">
          <td className="chev" />
          <td>Contract total</td>
          <td className="num" />
          <td className="num" />
          <td className="num">{formatMoney(toMoney(comp.totalCents))}</td>
        </tr>
      </tbody>
    </table>
  );
}

function LineRow({
  li,
  open,
  onToggle,
  heavy = false,
}: {
  li: ComputedLineItem;
  open: boolean;
  onToggle: () => void;
  heavy?: boolean;
}) {
  const isPct = li.unit === 'PCT';
  return (
    <>
      <tr
        className={`line-row${heavy ? ' row-heavy' : ''}`}
        onClick={onToggle}
        role="button"
        aria-expanded={open}
      >
        <td className="chev">{open ? '▾' : '▸'}</td>
        <td className="desc">{li.description}</td>
        <td className="num mono">{isPct ? '—' : `${formatQtyX100(li.quantityX100)} ${UNIT_LABEL[li.unit]}`}</td>
        <td className="num mono">
          {isPct ? '—' : formatMoney(toMoney(li.unitRateCents))}
          {li.netMultiplierBps !== 10000 && <span className="rate-mult">{formatMultiplier(li.netMultiplierBps)}</span>}
        </td>
        <td className="num mono">{formatMoney(toMoney(li.totalCents))}</td>
      </tr>
      {open && (
        <tr className="receipt-row">
          <td colSpan={5}>
            <Receipt factors={li.factors} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The signature component: one receipt line per Factor, dotted leaders, rule footer. */
export function Receipt({ factors }: { factors: Factor[] }) {
  const rules = [...new Set(factors.map((f) => f.ruleVersion))];
  return (
    <div className="receipt">
      {factors.map((f, i) => (
        <div className="receipt-line" key={i}>
          <span className="receipt-label">{f.label}</span>
          <span className="receipt-dots" aria-hidden="true" />
          <span className="receipt-value">{f.value}</span>
          <span className="receipt-running">
            {f.runningCents !== undefined ? formatMoney(toMoney(f.runningCents)) : ''}
          </span>
        </div>
      ))}
      <div className="receipt-footer">rule {rules.join(' · ')}</div>
    </div>
  );
}
