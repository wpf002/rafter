'use client';

import type { Measurement } from '@rafter/types';
import { formatQtyX100 } from '@/lib/money';
import { Chip, fmtDate } from './ui';

/** Display copy only — the stored source/condition enums are unchanged. */
const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  AERIAL_STUB: 'Aerial',
};

const DECKING_LABEL: Record<string, string> = {
  UNKNOWN: 'Unknown',
  GOOD: 'Good',
  SUSPECT: 'Suspect',
};

/**
 * Sanity-check grid of measurement figures. Area is not money — plain
 * number math is fine here (squares = sqft / 100).
 */
export function MeasurementCard({ measurement }: { measurement: Measurement }) {
  const m = measurement;
  const figures: [string, string][] = [
    ['Area', `${m.roofAreaSqFt.toLocaleString('en-US')} sqft`],
    ['Squares', `${formatQtyX100(m.roofAreaSqFt)} sq`],
    ['Pitch', `${m.pitchTwelfths}/12`],
    ['Stories', String(m.stories)],
    ['Facets', String(m.facets)],
    ['Ridge + Hip', `${m.ridgeHipLf.toLocaleString('en-US')} lf`],
    ['Valley', `${m.valleyLf.toLocaleString('en-US')} lf`],
    ['Eave', `${m.eaveLf.toLocaleString('en-US')} lf`],
    ['Rake', `${m.rakeLf.toLocaleString('en-US')} lf`],
    ['Flashing', `${m.flashingLf.toLocaleString('en-US')} lf`],
    ['Penetrations', String(m.penetrations)],
    ['Layers', String(m.existingLayers)],
    ['Roof Age', m.roofAgeYears !== null ? `${m.roofAgeYears} yrs` : '—'],
  ];

  return (
    <section className="section">
      <span className="section-label">Measurement</span>
      <div className="card card-pad" style={{ marginTop: 8 }}>
        <div className="card-head">
          <div className="card-head-meta">
            <Chip tone={m.source === 'MANUAL' ? 'muted' : 'copper'}>{SOURCE_LABEL[m.source] ?? m.source}</Chip>
            <span>Captured {fmtDate(m.capturedAt)}</span>
            <span>Decking {DECKING_LABEL[m.deckingCondition] ?? m.deckingCondition}</span>
          </div>
        </div>
        <div className="measure-grid">
          {figures.map(([label, value]) => (
            <div key={label}>
              <div className="figure-label">{label}</div>
              <div className="figure-value">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
