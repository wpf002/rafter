'use client';

import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import {
  formatMoney,
  toMoney,
  type TunableRateField,
  type TuningRateRow,
  type TuningReplayRow,
  type TuningResponse,
} from '@rafter/types';
import { Banner, fmtDate, Skeleton } from '@/components/ui';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { sumMoney } from '@/lib/money';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

/** Per-unit suffix for each tunable rate. Display only — not money math. */
const RATE_SUFFIX: Record<TunableRateField, string> = {
  tearOffPerSquarePerLayerCents: '/sq/layer',
  underlaymentPerSquareCents: '/sq',
  fieldShinglePerSquareCents: '/sq',
  ridgeHipPerLfCents: '/lf',
  valleyPerLfCents: '/lf',
  flashingPerLfCents: '/lf',
  penetrationEachCents: '/ea',
  disposalPerSquareCents: '/sq',
};

function signedMoney(m: bigint): string {
  return m === 0n ? formatMoney(m) : formatMoney(m, { sign: true });
}

/** Positive gap = you were underpriced (margin lost) = bad. Negative = good. */
function gapClass(m: bigint): string {
  if (m > 0n) return 'gap-bad';
  if (m < 0n) return 'gap-good';
  return 'muted';
}

export default function TuningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tenantId, error: tenantError } = useTenant();
  const tuning = useApi(() => api.tuning(id), [id, tenantId], tenantId !== null);

  const t = tuning.data;
  const error = tenantError ?? tuning.error;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/models" className="crumb">
            ← Price models
          </Link>
          <h1>Auto-tune</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            Deterministic arithmetic on your own closed jobs only. Suggestions are never applied automatically.
          </div>
        </div>
      </div>

      {error !== null && <Banner kind="error">{error}</Banner>}

      {tuning.loading && t === null && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={120} w="100%" />
          <Skeleton h={260} w="100%" />
        </div>
      )}

      {t !== null &&
        (t.report.eligible ? (
          <EligibleView tuning={t} onAccepted={tuning.reload} />
        ) : (
          <IneligiblePanel jobCount={t.report.jobCount} minJobs={t.report.minJobs} />
        ))}
    </>
  );
}

function progressPct(jobCount: number, minJobs: number): number {
  // Counts, not money — plain integer math is fine.
  if (minJobs <= 0) return 100;
  return Math.max(0, Math.min(100, Math.floor((jobCount * 100) / minJobs)));
}

function IneligiblePanel({ jobCount, minJobs }: { jobCount: number; minJobs: number }) {
  const pct = progressPct(jobCount, minJobs);
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <span className="section-label">Not enough history yet</span>
      <p style={{ margin: '10px 0 6px', fontSize: 13 }}>
        Auto-tune unlocks after {minJobs} closed jobs on this model.
      </p>
      <div className="mono" style={{ fontSize: 15, marginBottom: 8 }}>
        {jobCount} / {minJobs}
      </div>
      <div className="tune-progress" role="progressbar" aria-valuenow={jobCount} aria-valuemin={0} aria-valuemax={minJobs}>
        <div className="tune-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        Deterministic arithmetic on your own closed jobs only. Suggestions are never applied automatically.
      </p>
    </div>
  );
}

function EligibleView({ tuning, onAccepted }: { tuning: TuningResponse; onAccepted: () => void }) {
  const { report, replay, baseVersion, baseVersionId, modelId } = tuning;

  const [checked, setChecked] = useState<ReadonlySet<TunableRateField>>(
    () => new Set(report.rows.filter((r) => r.suggestedRateCents !== r.currentRateCents).map((r) => r.rateField)),
  );
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(null);

  const selectedImpact = useMemo(
    () => sumMoney(report.rows.filter((r) => checked.has(r.rateField)).map((r) => toMoney(r.annualizedImpactCents))),
    [report.rows, checked],
  );

  function toggle(f: TunableRateField) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  async function accept() {
    setError(null);
    setConflict(false);
    setBusy(true);
    try {
      const v = await api.acceptTuning(modelId, { rateFields: [...checked], baseVersionId });
      setAcceptedVersion(v.version);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) setConflict(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (acceptedVersion !== null) {
    return (
      <Banner kind="ok">
        Version {acceptedVersion} created — issued quotes keep the version they were priced with (D3).{' '}
        <Link href="/models">Back to price models</Link>
      </Banner>
    );
  }

  return (
    <>
      {conflict && (
        <Banner kind="error">
          The model has a newer version than these suggestions were computed against.{' '}
          <button type="button" className="btn btn-small" onClick={onAccepted}>
            Refresh suggestions
          </button>
        </Banner>
      )}
      {error !== null && <Banner kind="error">{error}</Banner>}

      <section className="section">
        <span className="section-label">Rate table</span>
        <div className="card" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Line</th>
                <th className="num">Current rate</th>
                <th className="num">Realized gap</th>
                <th className="num">Suggested rate</th>
                <th className="num">Annualized impact</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <RateRow key={r.rateField} row={r} checked={checked.has(r.rateField)} onToggle={() => toggle(r.rateField)} />
              ))}
            </tbody>
          </table>
          <div className="tune-summary">
            <span>
              <span className="section-label">Annualized impact</span>{' '}
              <span className="mono" style={{ fontSize: 15, marginLeft: 8 }}>
                {signedMoney(selectedImpact)}
              </span>
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {report.jobCount} closed jobs over {report.windowDays} days
            </span>
          </div>
        </div>
      </section>

      <section className="section">
        <span className="section-label">Replay — if these rates had priced your last {replay.length} quotes</span>
        <div className="card" style={{ marginTop: 8 }}>
          {replay.length === 0 ? (
            <div className="empty-state">No issued quotes to replay yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Issued</th>
                  <th className="num">Old total</th>
                  <th className="num">New total</th>
                  <th className="num">Delta</th>
                </tr>
              </thead>
              <tbody>
                {replay.map((row) => (
                  <ReplayRow key={row.jobId} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="form-actions no-print">
        <button
          type="button"
          className="btn btn-copper"
          disabled={busy || checked.size === 0}
          onClick={() => void accept()}
        >
          {busy ? 'Creating…' : `Accept as v${baseVersion + 1}`}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Creates a new immutable version — never applied automatically (D3).
        </span>
      </div>
    </>
  );
}

function RateRow({ row, checked, onToggle }: { row: TuningRateRow; checked: boolean; onToggle: () => void }) {
  const gap = toMoney(row.perUnitGapCents);
  const impact = toMoney(row.annualizedImpactCents);
  const unchanged = row.suggestedRateCents === row.currentRateCents;
  const suffix = RATE_SUFFIX[row.rateField];
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          aria-label={`Include ${row.label}`}
          checked={checked}
          disabled={unchanged}
          onChange={onToggle}
        />
      </td>
      <td>
        {row.label}
        <span className="rate-mult">{row.jobsTouched} jobs</span>
      </td>
      <td className="num mono">
        {formatMoney(toMoney(row.currentRateCents))}
        <span className="rate-mult">{suffix}</span>
      </td>
      <td className={`num mono ${gapClass(gap)}`}>
        {signedMoney(gap)}
        <span className="rate-mult">{suffix}</span>
      </td>
      <td className="num mono">
        {unchanged ? <span className="muted">—</span> : formatMoney(toMoney(row.suggestedRateCents))}
        {!unchanged && <span className="rate-mult">{suffix}</span>}
      </td>
      <td className="num mono">{signedMoney(impact)}</td>
    </tr>
  );
}

function ReplayRow({ row }: { row: TuningReplayRow }) {
  const delta = toMoney(row.deltaCents);
  // Positive delta = the tuned rates would have priced the job higher —
  // margin recovered (good). Negative = would have charged less (bad).
  const cls = delta > 0n ? 'gap-good' : delta < 0n ? 'gap-bad' : 'muted';
  return (
    <tr>
      <td>{row.jobName}</td>
      <td className="muted">{fmtDate(row.issuedAt)}</td>
      <td className="num mono">{formatMoney(toMoney(row.oldTotalCents))}</td>
      <td className="num mono">{formatMoney(toMoney(row.newTotalCents))}</td>
      <td className={`num mono ${cls}`}>{signedMoney(delta)}</td>
    </tr>
  );
}
