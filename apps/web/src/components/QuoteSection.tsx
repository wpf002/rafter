'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  MeasurementInput,
  type JobDetail,
  type PriceModel,
  type PriceModelVersion,
  type QuoteComputation,
} from '@rafter/types';
import { api, errorMessage } from '@/lib/api';
import { ProposalTable } from './Proposal';
import { Banner, EmptyState, Skeleton, fmtDate } from './ui';

interface VersionOption {
  id: string;
  label: string;
}

function versionsOf(model: PriceModel): PriceModelVersion[] {
  const list = model.versions !== undefined && model.versions.length > 0
    ? model.versions
    : model.currentVersion !== undefined
      ? [model.currentVersion]
      : [];
  return [...list].sort((a, b) => b.version - a.version);
}

function versionOptions(models: PriceModel[] | null): VersionOption[] {
  const out: VersionOption[] = [];
  for (const m of models ?? []) {
    for (const v of versionsOf(m)) out.push({ id: v.id, label: `${m.name} v${v.version}` });
  }
  return out;
}

function versionLabel(models: PriceModel[] | null, versionId: string): string | null {
  for (const m of models ?? []) {
    for (const v of versionsOf(m)) {
      if (v.id === versionId) return `${m.name} v${v.version}`;
    }
  }
  return null;
}

export function QuoteSection({
  job,
  models,
  onChanged,
}: {
  job: JobDetail;
  models: PriceModel[] | null;
  onChanged: () => void;
}) {
  if (job.quote !== null) {
    return <IssuedQuote job={job} models={models} />;
  }
  if (job.state === 'DRAFT' && job.measurement !== null) {
    return <QuoteBuilder job={job} models={models} onChanged={onChanged} />;
  }
  if (job.state === 'DRAFT') {
    return (
      <section className="section">
        <span className="section-label">Quote</span>
        <div className="card" style={{ marginTop: 8 }}>
          <EmptyState>
            No measurement yet — attach one to price this job.{' '}
            <Link href={`/jobs/new?job=${job.id}`}>Add Measurement</Link>
          </EmptyState>
        </div>
      </section>
    );
  }
  return null;
}

function IssuedQuote({ job, models }: { job: JobDetail; models: PriceModel[] | null }) {
  const quote = job.quote;
  if (quote === null) return null;
  const label = versionLabel(models, quote.priceModelVersionId);
  return (
    <section className="section">
      <span className="section-label">Quote</span>
      <div className="card card-pad print-area" style={{ marginTop: 8 }}>
        <div className="card-head">
          <div>
            <h2>Proposal — {job.name}</h2>
            <div className="quote-meta">
              Issued {fmtDate(quote.issuedAt)} · {label ?? `model ${quote.priceModelVersionId}`} ·
              {quote.engineVersion}
            </div>
          </div>
          <button type="button" className="btn no-print" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
        <ProposalTable comp={quote} />
      </div>
    </section>
  );
}

function QuoteBuilder({
  job,
  models,
  onChanged,
}: {
  job: JobDetail;
  models: PriceModel[] | null;
  onChanged: () => void;
}) {
  const options = useMemo(() => versionOptions(models), [models]);
  const [versionId, setVersionId] = useState<string>('');
  const [preview, setPreview] = useState<QuoteComputation | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const first = options[0];
  useEffect(() => {
    if (versionId === '' && first !== undefined) setVersionId(first.id);
  }, [versionId, first]);

  const measurementInput = useMemo(() => {
    if (job.measurement === null) return null;
    const parsed = MeasurementInput.safeParse(job.measurement);
    return parsed.success ? parsed.data : null;
  }, [job.measurement]);

  useEffect(() => {
    if (versionId === '' || measurementInput === null) return;
    let live = true;
    setPreviewLoading(true);
    setError(null);
    api
      .quotePreview({ measurement: measurementInput, priceModelVersionId: versionId })
      .then((c) => {
        if (live) {
          setPreview(c);
          setPreviewLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setError(errorMessage(e));
          setPreview(null);
          setPreviewLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [versionId, measurementInput, job.id]);

  async function issue() {
    if (versionId === '') return;
    setIssuing(true);
    setError(null);
    try {
      await api.issueQuote(job.id, { priceModelVersionId: versionId });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIssuing(false);
    }
  }

  const selectedLabel = versionLabel(models, versionId);

  return (
    <section className="section">
      <span className="section-label">Quote</span>
      <div className="card card-pad" style={{ marginTop: 8 }}>
        {error !== null && <Banner kind="error">{error}</Banner>}
        <div className="card-head no-print">
          <div className="field" style={{ minWidth: 260 }}>
            <label className="field-label" htmlFor="pm-version">
              Price Model Version
            </label>
            <select
              id="pm-version"
              className="select"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {options.length === 0 && <option value="">No Price Models</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-copper"
            disabled={preview === null || previewLoading || issuing}
            onClick={() => void issue()}
          >
            {issuing ? 'Issuing…' : 'Issue Quote'}
          </button>
        </div>
        {previewLoading ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <Skeleton h={18} />
            <Skeleton h={18} />
            <Skeleton h={18} />
            <Skeleton h={18} w="70%" />
          </div>
        ) : preview !== null ? (
          <>
            <div className="quote-meta" style={{ marginBottom: 8 }}>
              Preview · {selectedLabel ?? ''} · {preview.engineVersion} — issuing locks this quote to the
              selected version permanently.
            </div>
            <ProposalTable comp={preview} />
          </>
        ) : options.length === 0 ? (
          <EmptyState>
            No price models yet. <Link href="/models">Create one</Link> to price this job.
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}
