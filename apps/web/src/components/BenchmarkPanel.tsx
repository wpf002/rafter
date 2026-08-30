'use client';

import Link from 'next/link';
import { formatBps, type BenchmarkResponse, type DashboardResponse } from '@rafter/types';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';
import { Chip, Skeleton } from './ui';

const R = 52;
const C = 2 * Math.PI * R;

/** Half a percent, in bps — inside this, they are level with the pool. */
const PARITY_BAND_BPS = 50;

export function BenchmarkPanel({ dash, loading }: { dash: DashboardResponse | null; loading: boolean }) {
  const { tenantId } = useTenant();
  const unlocked = dash?.benchmarkUnlocked === true;
  // Only fetched once the gate is open — the locked panel needs nothing but the ring.
  const bench = useApi(() => api.benchmark(), [tenantId], unlocked && tenantId !== null);

  return (
    <Link href="/benchmark" className="card bench bench-link">
      <span className="section-label">How You Compare</span>
      {loading || dash === null ? (
        <div style={{ marginTop: 14 }}>
          <Skeleton h={128} w="100%" />
        </div>
      ) : unlocked ? (
        <Unlocked bench={bench.data} />
      ) : (
        <Locked bps={dash.closeoutCompletionBps} />
      )}
    </Link>
  );
}

function Locked({ bps }: { bps: number }) {
  // Ring arc fraction — bps is a ratio, not money.
  const frac = Math.max(0, Math.min(bps, 10000)) / 10000;
  return (
    <div>
      <svg className="bench-ring" viewBox="0 0 120 120" role="img" aria-label="Final costs entered">
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
      <p className="bench-text">
        Rot and bad decking you only find once the roof is open cost every roofer money. Enter final costs on
        80% of your jobs and you can see what those surprises cost other roofers on work like yours.
      </p>
      <p className="bench-pct">You Are At {formatBps(bps)} — See What Is Left →</p>
    </div>
  );
}

/**
 * Unlocked strip: the one line worth clicking through for — their typical
 * surprise cost against the pool's. Falls back to the teaser until both
 * figures exist.
 */
function Unlocked({ bench }: { bench: BenchmarkResponse | null }) {
  const poolBps = bench?.report?.overall.locked === false ? bench.report.overall.p50Bps : null;
  const mineBps = bench?.you?.medianBps ?? null;
  const deltaBps =
    mineBps === null || poolBps === null ? null : (bench?.you?.vsPoolBps ?? mineBps - poolBps);

  return (
    <div>
      <div style={{ margin: '12px 0 4px' }}>
        <Chip tone="copper">Unlocked</Chip>
      </div>
      {deltaBps !== null && mineBps !== null && poolBps !== null ? (
        <p className="bench-text" style={{ textAlign: 'left', flex: '1 1 320px' }}>
          <span
            style={{
              color:
                deltaBps > PARITY_BAND_BPS
                  ? 'var(--bad)'
                  : deltaBps < -PARITY_BAND_BPS
                    ? 'var(--good)'
                    : 'var(--asphalt)',
            }}
          >
            Your typical job eats <span className="mono">{formatBps(mineBps)}</span> in surprise costs,
            against <span className="mono">{formatBps(poolBps)}</span> for most roofers
            {deltaBps > PARITY_BAND_BPS
              ? ' — you are carrying more than they are.'
              : deltaBps < -PARITY_BAND_BPS
                ? ' — you are running leaner.'
                : ' — right in line.'}
          </span>
        </p>
      ) : (
        <p className="bench-text" style={{ textAlign: 'left', flex: '1 1 320px' }}>
          See what rot, bad decking and extra layers cost other roofers on jobs like yours — by roof size,
          steepness, layers and age — and whether your prices carry enough cushion.
        </p>
      )}
      <p className="bench-pct" style={{ textAlign: 'left' }}>
        Open The Full Comparison →
      </p>
    </div>
  );
}
