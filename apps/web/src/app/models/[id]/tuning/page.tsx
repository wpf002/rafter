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
import { Banner, fmtDate, PageHead, Skeleton } from '@/components/ui';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { sumMoney } from '@/lib/money';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

/** Rate names as they read on the Pricing page. Display only. */
const RATE_LABEL: Record<TunableRateField, string> = {
  tearOffPerSquarePerLayerCents: 'Tear-Off',
  underlaymentPerSquareCents: 'Underlayment',
  fieldShinglePerSquareCents: 'Field Shingles',
  ridgeHipPerLfCents: 'Ridge & Hip Cap',
  valleyPerLfCents: 'Valley',
  flashingPerLfCents: 'Flashing',
  penetrationEachCents: 'Penetrations',
  disposalPerSquareCents: 'Disposal & Haul-Off',
};

/** How each rate is charged, spelled out. Display only — not money math. */
const RATE_UNIT: Record<TunableRateField, string> = {
  tearOffPerSquarePerLayerCents: 'per square, per layer',
  underlaymentPerSquareCents: 'per square',
  fieldShinglePerSquareCents: 'per square',
  ridgeHipPerLfCents: 'per foot',
  valleyPerLfCents: 'per foot',
  flashingPerLfCents: 'per foot',
  penetrationEachCents: 'each',
  disposalPerSquareCents: 'per square',
};

function signedMoney(m: bigint): string {
  return m === 0n ? formatMoney(m) : formatMoney(m, { sign: true });
}

/** Positive = you charged less than the work cost, so it's money out of your pocket. */
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
      <PageHead
        above={
          <Link href="/models" className="crumb">
            ← Pricing
          </Link>
        }
        title="Check My Rates"
      />
      <p className="why-line">
        Rafter compared what you charged against what the work actually cost you on your finished
        jobs. These are the rates that look off — nothing changes until you save.
      </p>

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
      <span className="section-label">Not Enough Finished Jobs Yet</span>
      <p style={{ margin: '10px 0 6px', fontSize: 13 }}>
        Rafter needs <span className="mono">{minJobs}</span> finished jobs priced with these rates
        before it can tell a real pattern from a one-off bad week.
      </p>
      <div className="mono" style={{ fontSize: 15, marginBottom: 8 }}>
        {jobCount} / {minJobs}
      </div>
      <div
        className="tune-progress"
        role="progressbar"
        aria-valuenow={jobCount}
        aria-valuemin={0}
        aria-valuemax={minJobs}
      >
        <div className="tune-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        Every job you finish and close out counts toward this. Rafter never changes your prices on
        its own.
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
        Saved as Version {acceptedVersion}. New quotes use these prices from now on — quotes you
        already sent keep the prices you gave your customers. <Link href="/models">Back to Pricing</Link>
      </Banner>
    );
  }

  return (
    <>
      {conflict && (
        <Banner kind="error">
          Your prices changed since Rafter ran this check, so these suggestions are out of date.{' '}
          <button type="button" className="btn btn-small" onClick={onAccepted}>
            Check Again
          </button>
        </Banner>
      )}
      {error !== null && <Banner kind="error">{error}</Banner>}

      <section className="section">
        <span className="section-label">Your Prices vs. What the Work Cost You</span>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', maxWidth: 700 }}>
          Tick the rates you want to fix. A rate with no suggestion is already close enough to what
          it really costs you.
        </p>
        <div className="card" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Rate</th>
                <th className="num">You Charge</th>
                <th className="num">You&rsquo;re Off By</th>
                <th className="num">Suggested Price</th>
                <th className="num">Cost You per Year</th>
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
              <span className="section-label">The Ticked Rates Cost You per Year</span>{' '}
              <span className={`mono ${gapClass(selectedImpact)}`} style={{ fontSize: 15, marginLeft: 8 }}>
                {signedMoney(selectedImpact)}
              </span>
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              Based on your last {report.jobCount} finished jobs
            </span>
          </div>
        </div>
      </section>

      <section className="section">
        <span className="section-label">
          What These Prices Would Have Done to Your Last {replay.length} Quotes
        </span>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', maxWidth: 700 }}>
          These quotes are already out the door and won&rsquo;t change. This just shows how much
          bigger or smaller they would have been.
        </p>
        <div className="card" style={{ marginTop: 8 }}>
          {replay.length === 0 ? (
            <div className="empty-state">No quotes sent yet to compare against.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th className="num">Quoted</th>
                  <th className="num">Would Have Been</th>
                  <th className="num">Difference</th>
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
          {busy ? 'Saving…' : `Save These Prices as Version ${baseVersion + 1}`}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Only new quotes use them. Quotes you already sent keep the prices you gave your customers.
        </span>
      </div>
    </>
  );
}

function RateRow({ row, checked, onToggle }: { row: TuningRateRow; checked: boolean; onToggle: () => void }) {
  const gap = toMoney(row.perUnitGapCents);
  const impact = toMoney(row.annualizedImpactCents);
  const unchanged = row.suggestedRateCents === row.currentRateCents;
  const label = RATE_LABEL[row.rateField];
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          aria-label={`Include ${label}`}
          checked={checked}
          disabled={unchanged}
          onChange={onToggle}
        />
      </td>
      <td>
        <div>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {RATE_UNIT[row.rateField]} · <span className="mono">{row.jobsTouched}</span> jobs
        </div>
      </td>
      <td className="num mono">{formatMoney(toMoney(row.currentRateCents))}</td>
      <td className={`num mono ${gapClass(gap)}`}>{signedMoney(gap)}</td>
      <td className="num mono">
        {unchanged ? <span className="muted">Looks Right</span> : formatMoney(toMoney(row.suggestedRateCents))}
      </td>
      <td className={`num mono ${gapClass(impact)}`}>{signedMoney(impact)}</td>
    </tr>
  );
}

function ReplayRow({ row }: { row: TuningReplayRow }) {
  const delta = toMoney(row.deltaCents);
  // Positive delta = these prices would have quoted the job higher — money you
  // left on the table. Negative = you would have quoted less.
  const cls = delta > 0n ? 'gap-good' : delta < 0n ? 'gap-bad' : 'muted';
  return (
    <tr>
      <td>
        <div>{row.jobName}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          Sent {fmtDate(row.issuedAt)}
        </div>
      </td>
      <td className="num mono">{formatMoney(toMoney(row.oldTotalCents))}</td>
      <td className="num mono">{formatMoney(toMoney(row.newTotalCents))}</td>
      <td className={`num mono ${cls}`}>{signedMoney(delta)}</td>
    </tr>
  );
}
