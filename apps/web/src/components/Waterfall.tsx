'use client';

import { formatMoney, type Money } from '@rafter/types';

export interface WaterfallStep {
  label: string;
  /** Signed variance contribution in cents. Positive = cost overrun (margin down). */
  amount: Money;
}

/**
 * Hand-built variance waterfall: Planned margin → one bridge per nonzero
 * reason → Actual margin. All value math stays bigint; pixel positions come
 * from an exact bigint ratio scaled to an integer before the one Number()
 * call (never Number() on raw cents).
 */
export function Waterfall({ planned, actual, steps }: { planned: Money; actual: Money; steps: WaterfallStep[] }) {
  const levels: Money[] = [planned];
  let running = planned;
  for (const s of steps) {
    running -= s.amount;
    levels.push(running);
  }

  let min = 0n;
  let max = 0n;
  for (const v of [...levels, actual]) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) max = min + 100n;

  const W = 640;
  const H = 280;
  const padL = 88;
  const padR = 12;
  const padT = 22;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const range = max - min;

  const ratio = (num: Money): number => Number((num * 100000n) / range) / 100000;
  const y = (v: Money): number => padT + ratio(max - v) * innerH;

  const cols = steps.length + 2;
  const slot = innerW / cols;
  const barW = Math.min(76, slot * 0.62);
  const xFor = (i: number): number => padL + slot * i + (slot - barW) / 2;

  const grid: Money[] = [0n, 1n, 2n, 3n, 4n].map((i) => max - (range * i) / 4n);

  interface Bar {
    x: number;
    top: number;
    bottom: number;
    fill: string;
    axisLabel: string;
    valueLabel: string;
    labelAbove: boolean;
  }

  const bars: Bar[] = [];
  bars.push({
    x: xFor(0),
    top: y(planned > 0n ? planned : 0n),
    bottom: y(planned > 0n ? 0n : planned),
    fill: 'var(--asphalt)',
    axisLabel: 'Planned',
    valueLabel: formatMoney(planned),
    labelAbove: true,
  });
  steps.forEach((s, i) => {
    const from = levels[i] ?? 0n;
    const to = levels[i + 1] ?? 0n;
    const down = s.amount > 0n;
    bars.push({
      x: xFor(i + 1),
      top: y(down ? from : to),
      bottom: y(down ? to : from),
      fill: down ? 'var(--bad)' : 'var(--good)',
      axisLabel: s.label,
      valueLabel: formatMoney(-s.amount, { sign: true }),
      labelAbove: !down,
    });
  });
  bars.push({
    x: xFor(cols - 1),
    top: y(actual > 0n ? actual : 0n),
    bottom: y(actual > 0n ? 0n : actual),
    fill: 'var(--copper)',
    axisLabel: 'Actual',
    valueLabel: formatMoney(actual),
    labelAbove: actual >= 0n,
  });

  return (
    <svg className="waterfall" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Variance waterfall">
      {grid.map((v, i) => (
        <g key={i}>
          <line className="wf-grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
          <text className="wf-label" x={padL - 6} y={y(v) + 3} textAnchor="end">
            {formatMoney(v)}
          </text>
        </g>
      ))}
      <line className="wf-zero" x1={padL} x2={W - padR} y1={y(0n)} y2={y(0n)} />
      {bars.slice(0, -1).map((b, i) => {
        const next = bars[i + 1];
        if (next === undefined) return null;
        const level = levels[Math.min(i, levels.length - 1)] ?? 0n;
        return (
          <line
            key={`conn-${i}`}
            className="wf-conn"
            x1={b.x + barW}
            x2={next.x}
            y1={y(level)}
            y2={y(level)}
          />
        );
      })}
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.top} width={barW} height={Math.max(1, b.bottom - b.top)} fill={b.fill} />
          <text
            className="wf-value"
            x={b.x + barW / 2}
            y={b.labelAbove ? b.top - 5 : b.bottom + 11}
            textAnchor="middle"
          >
            {b.valueLabel}
          </text>
          <text className="wf-label" x={b.x + barW / 2} y={H - padB + 15} textAnchor="middle">
            {b.axisLabel}
          </text>
        </g>
      ))}
    </svg>
  );
}
