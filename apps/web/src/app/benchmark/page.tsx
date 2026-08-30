'use client';

import Link from 'next/link';
import {
  formatBps,
  formatMoney,
  type BenchmarkReport,
  type StratumResult,
  type YourStanding,
} from '@rafter/types';
import { Banner, DeltaChip, PageHead, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Reference job used to restate a percentage as dollars a roofer can picture:
 * a $25,000 roof, held as integer cents (D1 — bigint money, never a float).
 */
const REFERENCE_CONTRACT_CENTS = 2_500_000n;

/** Closed jobs a roofer needs before their own figure can be placed. */
const MIN_OWN_JOBS = 3;

/** Half a percent, in bps — inside this, they are level with the pool. */
const PARITY_BAND_BPS = 50;

export default function BenchmarkPage() {
  const { tenantId, error: tenantError } = useTenant();
  const bench = useApi(() => api.benchmark(), [tenantId], tenantId !== null);

  const b = bench.data;
  const error = tenantError ?? bench.error;

  return (
    <>
      <PageHead
        title="How You Compare"
        sub={
          <span className="why-line">
            Every roofer eats surprise costs — rot, bad decking, an extra layer nobody saw until the roof was
            open — and this page shows what those surprises cost you against what they cost everyone else, so
            you can tell whether the cushion in your prices is realistic or you are eating losses everyone
            else charges for.
          </span>
        }
      />

      {error !== null && <Banner kind="error">{error}</Banner>}

      {bench.loading && b === null && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={180} w="100%" />
          <Skeleton h={240} w="100%" />
        </div>
      )}

      {b !== null &&
        (b.unlocked && b.report !== null ? (
          <UnlockedView report={b.report} you={b.you ?? null} />
        ) : (
          <LockedView completionBps={b.completionBps} remainingCount={b.remainingCount} />
        ))}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Locked — completion ring. Quoting is never held up by this gate.  */
/* ---------------------------------------------------------------- */

function LockedView({ completionBps, remainingCount }: { completionBps: number; remainingCount: number }) {
  // Ring arc fraction — bps is a ratio, not money.
  const frac = Math.max(0, Math.min(completionBps, 10000)) / 10000;
  return (
    <div className="card card-pad locked-wide">
      <span className="section-label">Locked</span>
      <svg className="bench-ring" viewBox="0 0 120 120" role="img" aria-label="Final costs entered">
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
        You have entered final costs on {formatBps(completionBps)} of your jobs — this unlocks at 80%.
      </p>
      <p className="bench-pct">
        <Link href="/jobs">
          Wrap Up {remainingCount} More Aging {remainingCount === 1 ? 'Job' : 'Jobs'} to Unlock
        </Link>
      </p>
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 12, marginBottom: 0 }}>
        Keep quoting exactly as you always have — nothing here holds up a job. The comparison is what you get
        back for keeping your cost records current, and it opens on its own once they are.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Unlocked — your number first, then four ways of slicing the pool  */
/* ---------------------------------------------------------------- */

function openMax(strata: StratumResult[]): number {
  // bps are ratios/counts — Number math is fine for bar scaling.
  let max = 0;
  for (const s of strata) {
    if (!s.locked && s.p95Bps !== null && s.p95Bps > max) max = s.p95Bps;
  }
  return max;
}

/**
 * Plain names for the three figures. The engine keeps p50/p90/p95 — a roofer
 * never sees those words.
 */
const FIGURES: { name: string; short: string; cls: 'p50' | 'p90' | 'p95'; gloss: string }[] = [
  { name: 'Typical Job', short: 'Typical', cls: 'p50', gloss: 'Half of all jobs come in under this.' },
  { name: 'Rough Job — 1 in 10', short: '1 in 10', cls: 'p90', gloss: 'One job in ten runs worse than this.' },
  { name: 'Worst Case — 1 in 20', short: '1 in 20', cls: 'p95', gloss: 'One job in twenty runs worse than this.' },
];

function bpsOf(stratum: StratumResult, cls: 'p50' | 'p90' | 'p95'): number | null {
  if (cls === 'p50') return stratum.p50Bps;
  if (cls === 'p90') return stratum.p90Bps;
  return stratum.p95Bps;
}

/** Percentage of the reference job, in dollars. Bigint cents throughout. */
function onReferenceJob(bps: number): string {
  const cents = (REFERENCE_CONTRACT_CENTS * BigInt(Math.abs(bps))) / 10_000n;
  const wholeDollars = ((cents + 50n) / 100n) * 100n;
  return formatMoney(wholeDollars).replace(/\.00$/, '');
}

/** "27 Jobs From 3 Roofers" — never "tenants". */
function poolCount(jobs: number, roofers: number): string {
  return `${jobs} ${jobs === 1 ? 'Job' : 'Jobs'} From ${roofers} ${roofers === 1 ? 'Roofer' : 'Roofers'}`;
}

/** Plain, Title Case names for the bands. Falls back to whatever the API sent. */
const STRATUM_LABEL: Record<string, string> = {
  'squares:<15': 'Under 15 Squares',
  'squares:15-25': '15–25 Squares',
  'squares:25-35': '25–35 Squares',
  'squares:>35': 'Over 35 Squares',
  'pitch:<=4': '4/12 Or Flatter',
  'pitch:5-8': '5/12 To 8/12',
  'pitch:>=9': '9/12 Or Steeper',
  'layers:1': 'One Layer',
  'layers:2+': 'Two Or More Layers',
  'age:<10': 'Under 10 Years Old',
  'age:10-20': '10–20 Years Old',
  'age:>20': 'Over 20 Years Old',
  'age:unknown': 'Age Not Recorded',
};

function labelOf(stratum: StratumResult): string {
  return STRATUM_LABEL[stratum.key] ?? stratum.label;
}

function UnlockedView({ report, you }: { report: BenchmarkReport; you: YourStanding | null }) {
  const all = [report.overall, ...report.bySquares, ...report.byPitch, ...report.byLayers, ...report.byRoofAge];
  const scaleMax = Math.max(openMax(all), 1);
  const groups: { heading: string; shortName: string; why: string; strata: StratumResult[] }[] = [
    {
      heading: 'By Roof Size',
      shortName: 'Roof Size',
      why: 'More squares means more deck to open up — and more places for rot to be hiding.',
      strata: report.bySquares,
    },
    {
      heading: 'By Steepness',
      shortName: 'Steepness',
      why: 'Steep roofs are slower to strip and harder to work, so the same bad decking costs more to put right.',
      strata: report.byPitch,
    },
    {
      heading: 'By Existing Layers',
      shortName: 'Existing Layers',
      why: 'With a second layer over the top, nobody sees the decking until the last course comes off.',
      strata: report.byLayers,
    },
    {
      heading: 'By Roof Age',
      shortName: 'Roof Age',
      why: 'An old roof has been letting water through for longer, so the wood underneath is more often gone.',
      strata: report.byRoofAge,
    },
  ];

  // Only rows that actually have figures are worth a line on the page. A group
  // with nothing to show drops out entirely and is named once in the summary.
  const shown = groups
    .map((g) => ({ ...g, open: g.strata.filter((s) => !s.locked) }))
    .filter((g) => g.open.length > 0);

  const building: string[] = [];
  for (const g of groups) {
    const held = g.strata.filter((s) => s.locked);
    if (held.length === 0) continue;
    if (held.length === g.strata.length) building.push(g.shortName);
    else building.push(...held.map(labelOf));
  }

  return (
    <>
      <div className="compare-2col section">
        <YourStandingCard report={report} you={you} />
        <div className="card card-pad">
          {report.overall.locked ? (
            <NotEnoughData kJobs={report.kJobs} kRoofers={report.kTenants} />
          ) : (
            <>
              <div className="card-head">
                <h2>Surprise Repair Costs</h2>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {poolCount(report.overall.jobs, report.overall.tenants)}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '-4px 0 14px' }}>
                What roofers actually spent on damage they could not see when they quoted, on top of the price
                the job was sold for.
              </p>
              <div className="compare-row">
                {FIGURES.map((f) => {
                  const bps = bpsOf(report.overall, f.cls);
                  return (
                    <div className="compare-cell" key={f.cls}>
                      <span className="section-label">{f.name}</span>
                      <div className="mono" style={{ fontSize: 28, lineHeight: 1.1, margin: '4px 0 6px' }}>
                        {bps !== null ? formatBps(bps) : '—'}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {f.gloss}
                      </div>
                      {bps !== null && (
                        <div style={{ fontSize: 12, marginTop: 2 }}>
                          About <span className="mono">{onReferenceJob(bps)}</span> on a $25,000 roof
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="compare-2col">
        {shown.map((g) => (
          <section className="section" key={g.heading}>
            <span className="section-label">{g.heading}</span>
            <p className="muted" style={{ fontSize: 12, margin: '-4px 0 8px' }}>
              {g.why}
            </p>
            <div className="card">
              {g.open.map((s) => (
                <StratumRow key={s.key} stratum={s} scaleMax={scaleMax} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {building.length > 0 && (
        <p className="muted" style={{ fontSize: 12, maxWidth: 640, marginTop: -10, marginBottom: 22 }}>
          <LockGlyph /> Still building: {building.join(', ')}. Each one needs {report.kJobs} jobs from at
          least {report.kTenants} different roofers before it can be shown.
        </p>
      )}

      <p className="bench-foot">
        Extras the customer asked for along the way are left out — this counts only work you had to do, not
        work you sold.{' '}
        {report.deflated && 'Older jobs are adjusted for material price changes so they line up with today. '}
        No roofer ever sees another roofer&rsquo;s jobs, customers or addresses — only the pooled figures on
        this page.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* The comparison itself — your typical job against everyone else's  */
/* ---------------------------------------------------------------- */

interface Verdict {
  tone: 'good' | 'bad' | 'level';
  text: string;
}

function verdictFor(deltaBps: number): Verdict {
  if (deltaBps > PARITY_BAND_BPS) {
    return {
      tone: 'bad',
      text:
        `You are eating about ${formatBps(deltaBps)} more than most roofers — roughly ` +
        `${onReferenceJob(deltaBps)} a roof. Either your prices need more cushion, or your crews are ` +
        `finding more damage than most.`,
    };
  }
  if (deltaBps < -PARITY_BAND_BPS) {
    return {
      tone: 'good',
      text:
        `You are running leaner than most roofers on surprises — about ${formatBps(-deltaBps)} less, ` +
        `roughly ${onReferenceJob(deltaBps)} a roof you are not eating.`,
    };
  }
  return { tone: 'level', text: 'You are right in line with everyone else.' };
}

function YourStandingCard({ report, you }: { report: BenchmarkReport; you: YourStanding | null }) {
  const poolBps = report.overall.p50Bps;
  // Nothing to compare against yet — the pool card below already says so.
  if (report.overall.locked || poolBps === null) return null;

  const mineBps = you?.medianBps ?? null;
  const deltaBps = mineBps === null ? null : (you?.vsPoolBps ?? mineBps - poolBps);
  const verdict = deltaBps === null ? null : verdictFor(deltaBps);

  return (
      <div className="card card-pad">
        <div className="card-head">
          <h2>Your Surprise Costs</h2>
          {deltaBps !== null && Math.abs(deltaBps) > PARITY_BAND_BPS && (
            <DeltaChip good={deltaBps < 0}>
              {formatBps(deltaBps)} {deltaBps > 0 ? 'Above' : 'Below'} Most Roofers
            </DeltaChip>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            columnGap: 18,
            rowGap: 10,
            alignItems: 'baseline',
          }}
        >
          {mineBps !== null && (
            <>
              <span className="section-label" style={{ color: 'var(--asphalt)', fontSize: 13 }}>
                Your Typical Surprise Cost
              </span>
              <span className="mono" style={{ fontSize: 30, lineHeight: 1.1, textAlign: 'right' }}>
                {formatBps(mineBps)}
              </span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {onReferenceJob(mineBps)} on a $25,000 roof
              </span>
            </>
          )}
          <span className="section-label" style={{ fontSize: 13 }}>
            Most Roofers
          </span>
          <span
            className="mono"
            style={{
              fontSize: 30,
              lineHeight: 1.1,
              textAlign: 'right',
              color: mineBps === null ? undefined : 'var(--muted)',
            }}
          >
            {formatBps(poolBps)}
          </span>
          <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {onReferenceJob(poolBps)} on a $25,000 roof
          </span>
        </div>

        <p
          style={{
            fontSize: 14,
            lineHeight: 1.45,
            margin: '14px 0 0',
            paddingTop: 12,
            borderTop: '1px solid var(--line)',
            maxWidth: 640,
            color:
              verdict === null
                ? 'var(--muted)'
                : verdict.tone === 'bad'
                  ? 'var(--bad)'
                  : verdict.tone === 'good'
                    ? 'var(--good)'
                    : 'var(--asphalt)',
          }}
        >
          {verdict !== null ? verdict.text : <NeedsOwnJobs you={you} />}
        </p>
      </div>
  );
}

/** Their own figure is withheld until they have enough finished jobs of their own. */
function NeedsOwnJobs({ you }: { you: YourStanding | null }) {
  const done = you?.jobs ?? 0;
  return (
    <>
      Finish and enter final costs on at least {MIN_OWN_JOBS} jobs and your own number lands here beside the
      pool — you have {done} {done === 1 ? 'job' : 'jobs'} closed out so far. Until then, the figures on this
      page are everyone else&rsquo;s.
    </>
  );
}

function StratumRow({ stratum, scaleMax }: { stratum: StratumResult; scaleMax: number }) {
  return (
    <div className="stratum-row">
      <span className="stratum-label">{labelOf(stratum)}</span>
      <CompareBars stratum={stratum} scaleMax={scaleMax} />
      <span className="mono muted" style={{ fontSize: 11, textAlign: 'right' }}>
        {poolCount(stratum.jobs, stratum.tenants)}
      </span>
    </div>
  );
}

function CompareBars({ stratum, scaleMax }: { stratum: StratumResult; scaleMax: number }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {FIGURES.map((f) => {
        const bps = bpsOf(stratum, f.cls);
        const pct = Math.max(0, Math.min(100, ((bps ?? 0) / scaleMax) * 100));
        return (
          <div className="hbar-row" key={f.cls} style={{ gridTemplateColumns: '56px 1fr 64px' }}>
            <span className="hbar-name">{f.short}</span>
            <div className="hbar-track">
              <div className={`hbar-fill ${f.cls}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="hbar-val mono">{bps !== null ? formatBps(bps) : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

function NotEnoughData({ kJobs, kRoofers }: { kJobs: number; kRoofers: number }) {
  return (
    <div className="empty-state">
      <LockGlyph /> Not Enough Data Yet — the pool needs {kJobs} jobs from at least {kRoofers} different
      roofers before any figures can be shown.
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
