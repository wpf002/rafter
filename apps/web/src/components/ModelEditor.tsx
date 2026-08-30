'use client';

import { useState } from 'react';
import { PriceModelRates, toMoney, type PriceModelRates as Rates } from '@rafter/types';
import { api, errorMessage } from '@/lib/api';
import {
  bpsToMultiplierInput,
  bpsToPercentInput,
  centsToDollarsInput,
  parseCount,
  parseDollarsToCents,
  parseMultiplierToBps,
  parsePercentToBps,
} from '@/lib/money';
import { Banner } from './ui';

const CENT_FIELDS = [
  ['tearOffPerSquarePerLayerCents', 'Tear-off', '/sq/layer'],
  ['underlaymentPerSquareCents', 'Underlayment', '/sq'],
  ['fieldShinglePerSquareCents', 'Field shingle', '/sq'],
  ['ridgeHipPerLfCents', 'Ridge & hip', '/lf'],
  ['valleyPerLfCents', 'Valley', '/lf'],
  ['flashingPerLfCents', 'Flashing', '/lf'],
  ['penetrationEachCents', 'Penetration', '/ea'],
  ['deckingPerSheetCents', 'Decking', '/sheet'],
  ['permitFlatCents', 'Permit', 'flat'],
  ['disposalPerSquareCents', 'Disposal', '/sq'],
] as const;

type CentField = (typeof CENT_FIELDS)[number][0];

const BPS_FIELDS = [
  ['overheadBps', 'Overhead'],
  ['marginBps', 'Margin'],
  ['wasteBps', 'Waste'],
] as const;

type BpsField = (typeof BPS_FIELDS)[number][0];

const BAND_FIELDS = [
  ['pitchMultipliers', 'Pitch multipliers', 'up to pitch (N/12)'],
  ['storyMultipliers', 'Story multipliers', 'up to stories'],
  ['facetMultipliers', 'Facet multipliers', 'up to facets'],
] as const;

type BandField = (typeof BAND_FIELDS)[number][0];

interface BandRow {
  upTo: string;
  mult: string;
}

function initBands(base: Rates, field: BandField): BandRow[] {
  return base[field].map((b) => ({ upTo: String(b.upTo), mult: bpsToMultiplierInput(b.bps) }));
}

export function ModelEditor({
  modelId,
  base,
  baseVersion,
  onSaved,
  onCancel,
}: {
  modelId: string;
  base: Rates;
  baseVersion: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [cents, setCents] = useState<Record<CentField, string>>(() => {
    const out = {} as Record<CentField, string>;
    for (const [f] of CENT_FIELDS) out[f] = centsToDollarsInput(toMoney(base[f]));
    return out;
  });
  const [bps, setBps] = useState<Record<BpsField, string>>(() => {
    const out = {} as Record<BpsField, string>;
    for (const [f] of BPS_FIELDS) out[f] = bpsToPercentInput(base[f]);
    return out;
  });
  const [sheets, setSheets] = useState(String(base.deckingAllowanceSheets));
  const [bands, setBands] = useState<Record<BandField, BandRow[]>>({
    pitchMultipliers: initBands(base, 'pitchMultipliers'),
    storyMultipliers: initBands(base, 'storyMultipliers'),
    facetMultipliers: initBands(base, 'facetMultipliers'),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const centChanged = (f: CentField) => parseDollarsToCents(cents[f]) !== toMoney(base[f]);
  const bpsChanged = (f: BpsField) => parsePercentToBps(bps[f]) !== base[f];
  const sheetsChanged = () => parseCount(sheets) !== base.deckingAllowanceSheets;
  const bandChanged = (field: BandField, i: number): boolean => {
    const baseBand = base[field][i];
    const row = bands[field][i];
    if (row === undefined) return true;
    if (baseBand === undefined) return true;
    return parseCount(row.upTo) !== baseBand.upTo || parseMultiplierToBps(row.mult) !== baseBand.bps;
  };

  function setBand(field: BandField, i: number, patch: Partial<BandRow>) {
    setBands((b) => ({ ...b, [field]: b[field].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }

  function addBand(field: BandField) {
    setBands((b) => ({ ...b, [field]: [...b[field], { upTo: '', mult: '1' }] }));
  }

  function removeBand(field: BandField, i: number) {
    setBands((b) => ({ ...b, [field]: b[field].filter((_, j) => j !== i) }));
  }

  async function save() {
    setError(null);
    const problems: string[] = [];
    const built: Record<string, unknown> = {};

    for (const [f, label] of CENT_FIELDS) {
      const c = parseDollarsToCents(cents[f]);
      if (c === null || c < 0n) problems.push(`${label} rate is invalid`);
      else built[f] = c.toString();
    }
    for (const [f, label] of BPS_FIELDS) {
      const v = parsePercentToBps(bps[f]);
      if (v === null || v < 0) problems.push(`${label} percent is invalid`);
      else built[f] = v;
    }
    const sheetCount = parseCount(sheets);
    if (sheetCount === null) problems.push('Decking allowance sheets is invalid');
    else built.deckingAllowanceSheets = sheetCount;

    for (const [f, label] of BAND_FIELDS) {
      const rows = bands[f];
      if (rows.length === 0) {
        problems.push(`${label} needs at least one band`);
        continue;
      }
      const parsed: { upTo: number; bps: number }[] = [];
      for (const r of rows) {
        const upTo = parseCount(r.upTo);
        const mult = parseMultiplierToBps(r.mult);
        if (upTo === null || mult === null) {
          problems.push(`${label} has an invalid band`);
          break;
        }
        parsed.push({ upTo, bps: mult });
      }
      built[f] = parsed;
    }

    if (problems.length > 0) {
      setError(problems.join(' · '));
      return;
    }
    const validated = PriceModelRates.safeParse(built);
    if (!validated.success) {
      setError(`Rates failed validation: ${validated.error.issues.map((i) => i.message).join(' · ')}`);
      return;
    }
    setSaving(true);
    try {
      await api.createModelVersion(modelId, { rates: validated.data });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 10 }}>
      <div className="d3-note">
        Editing creates version {baseVersion + 1} — issued quotes keep the version they were priced with.
      </div>
      {error !== null && <Banner kind="error">{error}</Banner>}

      <span className="section-label">Rates</span>
      <div className="rates-grid" style={{ margin: '8px 0 16px' }}>
        {CENT_FIELDS.map(([f, label, suffix]) => (
          <div className={`field${centChanged(f) ? ' changed' : ''}`} key={f}>
            <label className="field-label" htmlFor={`rate-${f}`}>
              {label} <span className="muted">$ {suffix}</span>
            </label>
            <input
              id={`rate-${f}`}
              className="input mono-input"
              value={cents[f]}
              inputMode="decimal"
              onChange={(e) => setCents((c) => ({ ...c, [f]: e.target.value }))}
            />
          </div>
        ))}
        <div className={`field${sheetsChanged() ? ' changed' : ''}`}>
          <label className="field-label" htmlFor="rate-sheets">
            Decking allowance <span className="muted">sheets</span>
          </label>
          <input
            id="rate-sheets"
            className="input mono-input"
            value={sheets}
            inputMode="numeric"
            onChange={(e) => setSheets(e.target.value)}
          />
        </div>
        {BPS_FIELDS.map(([f, label]) => (
          <div className={`field${bpsChanged(f) ? ' changed' : ''}`} key={f}>
            <label className="field-label" htmlFor={`bps-${f}`}>
              {label} <span className="muted">%</span>
            </label>
            <input
              id={`bps-${f}`}
              className="input mono-input"
              value={bps[f]}
              inputMode="decimal"
              onChange={(e) => setBps((b) => ({ ...b, [f]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      {BAND_FIELDS.map(([f, label, upToLabel]) => (
        <div className="band-group" key={f}>
          <span className="section-label">{label}</span>
          <div style={{ marginTop: 6 }}>
            <div className="band-row muted" style={{ fontSize: 11 }}>
              <span>{upToLabel}</span>
              <span>multiplier ×</span>
              <span />
            </div>
            {bands[f].map((row, i) => (
              <div className={`band-row${bandChanged(f, i) ? ' changed' : ''}`} key={i}>
                <input
                  className="input mono-input"
                  aria-label={`${label} band ${i + 1} upper bound`}
                  value={row.upTo}
                  inputMode="numeric"
                  onChange={(e) => setBand(f, i, { upTo: e.target.value })}
                />
                <input
                  className="input mono-input"
                  aria-label={`${label} band ${i + 1} multiplier`}
                  value={row.mult}
                  inputMode="decimal"
                  onChange={(e) => setBand(f, i, { mult: e.target.value })}
                />
                <button type="button" className="btn btn-small" onClick={() => removeBand(f, i)} aria-label="Remove band">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-small" onClick={() => addBand(f)}>
              Add band
            </button>
          </div>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn-copper" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : `Save as v${baseVersion + 1}`}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
