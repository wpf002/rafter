'use client';

import { formatBps, type DashboardResponse } from '@rafter/types';
import { Chip, Skeleton } from './ui';

const R = 52;
const C = 2 * Math.PI * R;

export function BenchmarkPanel({ dash, loading }: { dash: DashboardResponse | null; loading: boolean }) {
  return (
    <div className="card bench">
      <span className="section-label">Pooled benchmark</span>
      {loading || dash === null ? (
        <div style={{ marginTop: 14 }}>
          <Skeleton h={128} w="100%" />
        </div>
      ) : dash.benchmarkUnlocked ? (
        <Unlocked />
      ) : (
        <Locked bps={dash.closeoutCompletionBps} />
      )}
    </div>
  );
}

function Locked({ bps }: { bps: number }) {
  // Ring arc fraction — bps is a ratio, not money.
  const frac = Math.max(0, Math.min(bps, 10000)) / 10000;
  return (
    <div>
      <svg className="bench-ring" viewBox="0 0 120 120" role="img" aria-label="Closeout completion">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--copper)"
          strokeWidth="8"
          strokeDasharray={`${C * frac} ${C}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="66" textAnchor="middle" className="ring-num">
          {formatBps(bps)}
        </text>
      </svg>
      <p className="bench-text">Pooled benchmark unlocks at 80% closeout completion.</p>
      <p className="bench-pct">You are at {formatBps(bps)}</p>
    </div>
  );
}

function Unlocked() {
  return (
    <div>
      <div style={{ margin: '12px 0 4px' }}>
        <Chip tone="copper">Unlocked</Chip>
      </div>
      <p className="bench-text" style={{ textAlign: 'left' }}>
        Concealed-condition variance by stratum
      </p>
      {[
        ['P50', '38%'],
        ['P90', '64%'],
        ['P95', '82%'],
      ].map(([label, w]) => (
        <div className="bench-bar-row" key={label}>
          <span>{label}</span>
          <div className="bench-bar" style={{ width: w }} />
        </div>
      ))}
      <p className="bench-text" style={{ textAlign: 'left', marginTop: 10 }}>
        Coming soon.
      </p>
    </div>
  );
}
