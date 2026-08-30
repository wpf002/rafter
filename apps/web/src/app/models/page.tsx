'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import {
  BPS_ONE,
  formatBps,
  formatMoney,
  toMoney,
  type MultiplierBand,
  type PriceModel,
  type PriceModelRates,
  type PriceModelVersion,
} from '@rafter/types';
import { ModelEditor } from '@/components/ModelEditor';
import { Banner, EmptyState, fmtDate, PageHead, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

function versionsOf(model: PriceModel): PriceModelVersion[] {
  const list =
    model.versions !== undefined && model.versions.length > 0
      ? model.versions
      : model.currentVersion !== undefined
        ? [model.currentVersion]
        : [];
  return [...list].sort((a, b) => b.version - a.version);
}

/** Percent text, trimmed so a roofer reads "15%" not "15.00%". String math on formatBps only. */
function pctText(bps: number): string {
  return formatBps(bps)
    .replace(/\.00%$/, '%')
    .replace(/(\.\d)0%$/, '$1%');
}

/* ------------------------------------------------------------------ */
/* Rate sheet                                                          */
/* ------------------------------------------------------------------ */

const LABOR_RATES = [
  ['tearOffPerSquarePerLayerCents', 'Tear-Off', 'per square, per layer'],
  ['underlaymentPerSquareCents', 'Underlayment', 'per square'],
  ['fieldShinglePerSquareCents', 'Field Shingles', 'per square'],
  ['ridgeHipPerLfCents', 'Ridge & Hip Cap', 'per foot'],
  ['valleyPerLfCents', 'Valley', 'per foot'],
  ['flashingPerLfCents', 'Flashing', 'per foot'],
  ['penetrationEachCents', 'Penetrations — Pipes, Vents & Boots', 'each'],
  ['deckingPerSheetCents', 'Decking', 'per sheet'],
  ['disposalPerSquareCents', 'Disposal & Haul-Off', 'per square'],
] as const;

const MARKUP_RATES = [
  ['overheadBps', 'Overhead', 'trucks, insurance, the office'],
  ['marginBps', 'Profit Margin', 'what you keep on the job'],
  ['wasteBps', 'Waste', 'extra shingles and underlayment you order'],
] as const;

type BandKind = 'pitch' | 'story' | 'facet';

const BAND_FLOOR: Record<BandKind, number> = { pitch: 0, story: 1, facet: 1 };

function bandLabel(kind: BandKind, n: number): string {
  if (kind === 'pitch') return `${n}/12`;
  if (kind === 'story') return n === 1 ? '1 Story' : `${n} Stories`;
  return n === 1 ? '1 Section' : `${n} Sections`;
}

function bandEffect(bps: number): string {
  if (bps === BPS_ONE) return 'No Increase';
  return bps > BPS_ONE ? `Adds ${pctText(bps - BPS_ONE)}` : `Takes Off ${pctText(BPS_ONE - bps)}`;
}

interface BandLine {
  key: string;
  range: string;
  effect: string;
}

/** Bands are upper bounds; turn them into readable ranges ("7/12 to 9/12 — Adds 15%"). */
function bandLines(kind: BandKind, bands: readonly MultiplierBand[]): BandLine[] {
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo);
  const out: BandLine[] = [];
  let lo = BAND_FLOOR[kind];
  for (const [i, b] of sorted.entries()) {
    // "3 to 4 Stories", not "3 Stories to 4 Stories"; pitch reads "7/12 to 9/12".
    const loText = kind === 'pitch' ? bandLabel(kind, lo) : String(lo);
    const range =
      lo >= b.upTo
        ? bandLabel(kind, b.upTo)
        : i === 0
          ? `Up to ${bandLabel(kind, b.upTo)}`
          : `${loText} to ${bandLabel(kind, b.upTo)}`;
    out.push({ key: `${kind}-${i}-${b.upTo}`, range, effect: bandEffect(b.bps) });
    lo = b.upTo + 1;
  }
  return out;
}

function RateLine({ label, unit, value }: { label: string; unit?: string; value: string }) {
  return (
    <div className="rate-row">
      <span>
        {label}
        {unit !== undefined && (
          <span className="muted" style={{ fontSize: 11 }}>
            {' '}
            {unit}
          </span>
        )}
      </span>
      <span className="val mono">{value}</span>
    </div>
  );
}

function BandBlock({ title, kind, bands }: { title: string; kind: BandKind; bands: readonly MultiplierBand[] }) {
  return (
    <>
      <div className="field-label" style={{ marginTop: 12, marginBottom: 4 }}>
        {title}
      </div>
      <div className="rate-list">
        {bandLines(kind, bands).map((l) => (
          <div className="rate-row" key={l.key}>
            <span>{l.range}</span>
            <span className="val mono">{l.effect}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The full, readable price sheet for one version. */
function RateSheet({ rates }: { rates: PriceModelRates }) {
  return (
    <>
      <div className="rate-group">
        <h3 className="section-label">Labor &amp; Materials</h3>
        <div className="rate-list">
          {LABOR_RATES.map(([f, label, unit]) => (
            <Fragment key={f}>
              <RateLine label={label} unit={unit} value={formatMoney(toMoney(rates[f]))} />
              {f === 'deckingPerSheetCents' && (
                <RateLine
                  label="Decking Included in the Price"
                  unit="before it costs the customer extra"
                  value={`${rates.deckingAllowanceSheets} sheets`}
                />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="rate-group">
        <h3 className="section-label">Fees</h3>
        <div className="rate-list">
          <RateLine label="Permit" unit="flat, per job" value={formatMoney(toMoney(rates.permitFlatCents))} />
        </div>
      </div>

      <div className="rate-group">
        <h3 className="section-label">Markup</h3>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 6px', maxWidth: 640 }}>
          Added on top of labor and materials on every job.
        </p>
        <div className="rate-list">
          {MARKUP_RATES.map(([f, label, unit]) => (
            <RateLine key={f} label={label} unit={unit} value={pctText(rates[f])} />
          ))}
        </div>
      </div>

      <div className="rate-group">
        <h3 className="section-label">Steepness, Height &amp; Complexity</h3>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', maxWidth: 640 }}>
          Steeper, taller and more cut-up roofs are slower and riskier to do, so Rafter adds these
          percentages to the price.
        </p>
        <BandBlock title="Roof Pitch" kind="pitch" bands={rates.pitchMultipliers} />
        <BandBlock title="Height" kind="story" bands={rates.storyMultipliers} />
        <BandBlock title="Separate Roof Sections" kind="facet" bands={rates.facetMultipliers} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ModelsPage() {
  const { tenantId, error: tenantError } = useTenant();
  const models = useApi(() => api.priceModels(), [tenantId], tenantId !== null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const error = tenantError ?? models.error;

  return (
    <>
      <PageHead title="Pricing" />
      <p className="why-line">
        The rates Rafter uses to build every quote. Change them here and new quotes use the new
        numbers — quotes you already sent never change.
      </p>

      {error !== null && <Banner kind="error">{error}</Banner>}
      {saved !== null && <Banner kind="ok">{saved}</Banner>}

      {models.loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={140} w="100%" />
          <Skeleton h={140} w="100%" />
        </div>
      ) : (models.data?.length ?? 0) === 0 ? (
        <div className="card">
          <EmptyState>No pricing set up yet. Rafter needs a set of rates before it can build a quote.</EmptyState>
        </div>
      ) : (
        <div className="models-grid">
          {(models.data ?? []).map((model) => {
          const versions = versionsOf(model);
          const latest = versions[0];
          const older = versions.slice(1);
          const isEditing = editing === model.id;
          return (
            <section className="section" key={model.id}>
              <div className="card card-pad">
                <div className="card-head">
                  <div>
                    <h2>{model.name}</h2>
                    {latest !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                        <span className="in-use-badge">In Use</span>
                        <span className="quote-meta">
                          Version {latest.version} · Created {fmtDate(latest.createdAt)}
                        </span>
                      </div>
                    )}
                  </div>
                  {latest !== undefined && (
                    <div className="head-actions no-print">
                      <Link href={`/models/${model.id}/tuning`} className="btn btn-small">
                        Check My Rates
                      </Link>
                      <button
                        type="button"
                        className="btn btn-copper btn-small"
                        onClick={() => {
                          setSaved(null);
                          setEditing(isEditing ? null : model.id);
                        }}
                      >
                        {isEditing ? 'Cancel' : 'Edit Rates'}
                      </button>
                    </div>
                  )}
                </div>

                {latest === undefined ? (
                  <EmptyState>No rates saved for this price sheet yet.</EmptyState>
                ) : isEditing ? (
                  <ModelEditor
                    modelId={model.id}
                    base={latest.rates}
                    baseVersion={latest.version}
                    onSaved={() => {
                      setEditing(null);
                      setSaved(
                        `Saved. New quotes now use Version ${latest.version + 1} of ${model.name}. Quotes you already sent are unchanged.`,
                      );
                      models.reload();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <RateSheet rates={latest.rates} />
                    {older.length > 0 && (
                      <details className="version-history">
                        <summary>Previous Versions ({older.length})</summary>
                        <p className="muted" style={{ fontSize: 12, margin: '8px 0 4px', maxWidth: 640 }}>
                          Quotes you already sent keep the exact prices you quoted them at, so Rafter
                          keeps every older set of rates exactly as it was. They can&rsquo;t be edited or
                          deleted.
                        </p>
                        {older.map((v) => (
                          <details className="events" key={v.id} style={{ marginTop: 10 }}>
                            <summary>
                              Version {v.version} · Created {fmtDate(v.createdAt)}
                            </summary>
                            <div className="events-list">
                              <RateSheet rates={v.rates} />
                            </div>
                          </details>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </div>
            </section>
          );
          })}
        </div>
      )}
    </>
  );
}
