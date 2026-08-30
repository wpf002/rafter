'use client';

import Link from 'next/link';
import { formatBps, type BenchmarkResponse, type DashboardResponse } from '@rafter/types';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';
import { Skeleton } from './ui';

/** Half a percent, in bps — inside this, they are level with the pool. */
const PARITY_BAND_BPS = 50;

/**
 * One-line dashboard strip. The full story (why, the ring, breakdowns by
 * size/pitch/layers/age) lives on /benchmark — this only says the one thing
 * worth clicking for, so the two surfaces never repeat each other.
 */
export function BenchmarkPanel({ dash, loading }: { dash: DashboardResponse | null; loading: boolean }) {
  const { tenantId } = useTenant();
  const unlocked = dash?.benchmarkUnlocked === true;
  const bench = useApi(() => api.benchmark(), [tenantId], tenantId !== null);

  return (
    <Link href="/benchmark" className="card bench bench-strip-row bench-link">
      <span className="section-label">How You Compare</span>
      {loading || dash === null ? (
        <Skeleton h={18} w="60%" />
      ) : unlocked ? (
        <UnlockedLine bench={bench.data} />
      ) : (
        <LockedLine bps={dash.closeoutCompletionBps} remaining={bench.data?.remainingCount ?? null} />
      )}
      <span className="bench-cta mono">→</span>
    </Link>
  );
}

function LockedLine({ bps, remaining }: { bps: number; remaining: number | null }) {
  return (
    <span className="bench-line">
      Locked — final costs entered on <span className="mono">{formatBps(bps)}</span> of your jobs, opens at{' '}
      <span className="mono">80%</span>.{' '}
      <span className="bench-line-cta">
        {remaining !== null && remaining > 0
          ? `Wrap Up ${remaining} More ${remaining === 1 ? 'Job' : 'Jobs'}`
          : 'See What Is Left'}
      </span>
    </span>
  );
}

function UnlockedLine({ bench }: { bench: BenchmarkResponse | null }) {
  const poolBps = bench?.report?.overall.locked === false ? bench.report.overall.p50Bps : null;
  const mineBps = bench?.you?.medianBps ?? null;
  const deltaBps =
    mineBps === null || poolBps === null ? null : (bench?.you?.vsPoolBps ?? mineBps - poolBps);

  if (deltaBps === null || mineBps === null || poolBps === null) {
    return <span className="bench-line">Surprise costs on jobs like yours, from every roofer on Rafter.</span>;
  }
  const tone =
    deltaBps > PARITY_BAND_BPS ? 'var(--bad)' : deltaBps < -PARITY_BAND_BPS ? 'var(--good)' : 'var(--asphalt)';
  const verdict =
    deltaBps > PARITY_BAND_BPS
      ? 'you are carrying more than they are'
      : deltaBps < -PARITY_BAND_BPS
        ? 'you are running leaner'
        : 'right in line';
  return (
    <span className="bench-line" style={{ color: tone }}>
      Surprise costs: your typical job <span className="mono">{formatBps(mineBps)}</span> vs{' '}
      <span className="mono">{formatBps(poolBps)}</span> for most roofers — {verdict}.
    </span>
  );
}
