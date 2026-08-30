'use client';

import { formatBps, type BenchmarkReport, type StratumResult } from '@rafter/types';
import { Banner, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export default function BenchmarkPage() {
  const { tenantId, error: tenantError } = useTenant();
  const bench = useApi(() => api.benchmark(), [tenantId], tenantId !== null);

  const b = bench.data;
  const error = tenantError ?? bench.error;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pooled benchmark</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            Concealed-condition variance across the pool — anonymized, aggregate-only (D10).
          </div>
        </div>
      </div>

      {error !== null && <Banner kind="error">{error}</Banner>}

      {bench.loading && b === null && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={180} w="100%" />
          <Skeleton h={240} w="100%" />
        </div>
      )}

      {b !== null &&
        (b.unlocked && b.report !== null ? (
          <UnlockedView report={b.report} />
        ) : (
          <LockedView completionBps={b.completionBps} remainingCount={b.remainingCount} />
        ))}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Locked — completion ring gate (D8: quoting is never blocked)      */
/* ---------------------------------------------------------------- */

function LockedView({ completionBps, remainingCount }: { completionBps: number; remainingCount: number }) {
  // Ring arc fraction — bps is a ratio, not money.
  const frac = Math.max(0, Math.min(completionBps, 10000)) / 10000;
  return (
    <div className="card card-pad" style={{ maxWidth: 480 }}>
      <span className="section-label">Locked</span>
      <svg className="bench-ring" viewBox="0 0 120 120" role="img" aria-label="Closeout completion">
        <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={RING_R}
          fill="none"
          stroke="var(--copper)"
          strokeWidth="8"
          strokeDasharray={`${RING_C * frac} ${RING_C}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="66" textAnchor="middle" className="ring-num">
          {formatBps(completionBps)}
        </text>
      </svg>
      <p className="bench-text">
        {formatBps(completionBps)} closeout completion — pooled benchmark unlocks at 80%.
      </p>
      <p className="bench-pct">
        Close out {remainingCount} more aging {remainingCount === 1 ? 'job' : 'jobs'} to unlock
      </p>
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 12, marginBottom: 0 }}>
        Quoting is never blocked by this gate (D8) — the benchmark is the benefit withheld, not the tool.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Unlocked — headline stratum + four grouped breakdowns             */
/* ---------------------------------------------------------------- */

function openMax(strata: StratumResult[]): number {
  // bps are ratios/counts — Number math is fine for bar scaling.
  let max = 0;
  for (const s of strata) {
    if (!s.locked && s.p95Bps !== null && s.p95Bps > max) max = s.p95Bps;
  }
  return max;
}

function UnlockedView({ report }: { report: BenchmarkReport }) {
  const all = [report.overall, ...report.bySquares, ...report.byPitch, ...report.byLayers, ...report.byRoofAge];
  const scaleMax = Math.max(openMax(all), 1);
  const groups: [string, StratumResult[]][] = [
    ['Squares', report.bySquares],
    ['Pitch', report.byPitch],
    ['Existing layers', report.byLayers],
    ['Roof age', report.byRoofAge],
  ];

  return (
    <>
      <section className="section">
        <span className="section-label">All pooled jobs</span>
        <div className="card card-pad" style={{ marginTop: 8, maxWidth: 640 }}>
          {report.overall.locked ? (
            <LockedStratumNote kJobs={report.kJobs} kTenants={report.kTenants} />
          ) : (
            <>
              <div className="card-head">
                <h2>Concealed-condition variance</h2>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {report.overall.jobs} jobs · {report.overall.tenants} tenants
                </span>
              </div>
              <PercentileBars stratum={report.overall} scaleMax={scaleMax} tall />
            </>
          )}
        </div>
      </section>

      {groups.map(([label, strata]) => (
        <section className="section" key={label}>
          <span className="section-label">{label}</span>
          <div className="card" style={{ marginTop: 8, maxWidth: 640 }}>
            {strata.length === 0 ? (
              <div className="empty-state">No strata in this group yet.</div>
            ) : (
              strata.map((s) => <StratumRow key={s.key} stratum={s} scaleMax={scaleMax} kJobs={report.kJobs} kTenants={report.kTenants} />)
            )}
          </div>
        </section>
      ))}

      <p className="bench-foot">
        Scope changes excluded · concealed variance deflated for material price movement · no contractor ever sees
        another&rsquo;s jobs.
      </p>
    </>
  );
}

function StratumRow({
  stratum,
  scaleMax,
  kJobs,
  kTenants,
}: {
  stratum: StratumResult;
  scaleMax: number;
  kJobs: number;
  kTenants: number;
}) {
  if (stratum.locked) {
    return (
      <div className="stratum-row stratum-locked">
        <span className="stratum-label">
          <LockGlyph /> {stratum.label}
        </span>
        <span style={{ fontSize: 12 }}>
          needs {kJobs} jobs from {kTenants} contractors
        </span>
        <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
          {stratum.jobs} jobs · {stratum.tenants} tenants
        </span>
      </div>
    );
  }
  return (
    <div className="stratum-row">
      <span className="stratum-label">{stratum.label}</span>
      <PercentileBars stratum={stratum} scaleMax={scaleMax} />
      <span className="mono muted" style={{ fontSize: 11, textAlign: 'right' }}>
        {stratum.jobs} jobs · {stratum.tenants} tenants
      </span>
    </div>
  );
}

function PercentileBars({ stratum, scaleMax, tall = false }: { stratum: StratumResult; scaleMax: number; tall?: boolean }) {
  const rows: [string, 'p50' | 'p90' | 'p95', number | null][] = [
    ['P50', 'p50', stratum.p50Bps],
    ['P90', 'p90', stratum.p90Bps],
    ['P95', 'p95', stratum.p95Bps],
  ];
  return (
    <div style={{ display: 'grid', gap: tall ? 8 : 3 }}>
      {rows.map(([label, cls, bps]) => {
        const v = bps ?? 0;
        const pct = Math.max(0, Math.min(100, (v / scaleMax) * 100));
        return (
          <div className="hbar-row" key={label}>
            <span className="hbar-name">{label}</span>
            <div className={`hbar-track${tall ? ' hbar-tall' : ''}`}>
              <div className={`hbar-fill ${cls}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="hbar-val mono">{bps !== null ? formatBps(bps) : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

function LockedStratumNote({ kJobs, kTenants }: { kJobs: number; kTenants: number }) {
  return (
    <div className="empty-state">
      <LockGlyph /> Below the k-anonymity floor — needs {kJobs} jobs from {kTenants} contractors.
    </div>
  );
}

function LockGlyph() {
  return (
    <svg className="lock-glyph" width="9" height="11" viewBox="0 0 10 12" aria-hidden="true">
      <path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1" y="5" width="8" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}
