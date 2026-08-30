'use client';

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MeasurementInput } from '@rafter/types';
import { Banner, PageHead, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { parseCount } from '@/lib/money';
import { useTenant } from '@/lib/tenant';

export default function NewJobPage() {
  return (
    <Suspense fallback={<Skeleton h={200} w="100%" />}>
      <NewJobInner />
    </Suspense>
  );
}

function NewJobInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingJobId = searchParams.get('job');
  const { tenantId, error: tenantError } = useTenant();

  const [step, setStep] = useState<'job' | 'measure'>(existingJobId !== null ? 'measure' : 'job');
  const [jobId, setJobId] = useState<string | null>(existingJobId);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resuming an existing job (e.g. from the job page): prefill from the record.
  useEffect(() => {
    if (existingJobId === null || tenantId === null) return;
    let live = true;
    api
      .job(existingJobId)
      .then((j) => {
        if (live) {
          setName(j.name);
          setAddress(j.address);
          setCustomer(j.customerName);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [existingJobId, tenantId]);

  async function createJob(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createJob({ name, address, customerName: customer });
      setJobId(res.id);
      setStep('measure');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="New Job" />
      {tenantError !== null && <Banner kind="error">{tenantError}</Banner>}
      {error !== null && <Banner kind="error">{error}</Banner>}

      {step === 'job' ? (
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <div className="step-label">Step 1 of 2 — Job</div>
          <form onSubmit={(e) => void createJob(e)}>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label" htmlFor="job-name">
                Job Name
              </label>
              <input
                id="job-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Hendricks re-roof"
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label" htmlFor="job-address">
                Address
              </label>
              <input
                id="job-address"
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                placeholder="Street, city"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="job-customer">
                Customer
              </label>
              <input
                id="job-customer"
                className="input"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                required
                placeholder="Customer name"
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-copper" disabled={busy}>
                {busy ? 'Creating…' : 'Create Job — Next: Measurement'}
              </button>
            </div>
          </form>
        </div>
      ) : jobId !== null ? (
        <MeasurementStep
          jobId={jobId}
          address={address}
          onAddressChange={setAddress}
          onDone={() => router.push(`/jobs/${jobId}`)}
        />
      ) : null}
    </>
  );
}

type Mode = 'MANUAL' | 'AERIAL';

function MeasurementStep({
  jobId,
  address,
  onAddressChange,
  onDone,
}: {
  jobId: string;
  address: string;
  onAddressChange: (a: string) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('MANUAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [m, setM] = useState({
    roofAreaSqFt: '',
    pitchTwelfths: '6',
    stories: '1',
    facets: '1',
    ridgeHipLf: '0',
    valleyLf: '0',
    eaveLf: '0',
    rakeLf: '0',
    flashingLf: '0',
    penetrations: '0',
    existingLayers: '1',
    roofAgeYears: '',
    deckingCondition: 'UNKNOWN',
  });

  const set = (k: keyof typeof m) => (v: string) => setM((prev) => ({ ...prev, [k]: v }));

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const ints: Record<string, number | null> = {
      roofAreaSqFt: parseCount(m.roofAreaSqFt),
      pitchTwelfths: parseCount(m.pitchTwelfths),
      stories: parseCount(m.stories),
      facets: parseCount(m.facets),
      ridgeHipLf: parseCount(m.ridgeHipLf),
      valleyLf: parseCount(m.valleyLf),
      eaveLf: parseCount(m.eaveLf),
      rakeLf: parseCount(m.rakeLf),
      flashingLf: parseCount(m.flashingLf),
      penetrations: parseCount(m.penetrations),
      existingLayers: parseCount(m.existingLayers),
    };
    const invalid = Object.entries(ints).filter(([, v]) => v === null);
    if (invalid.length > 0) {
      setError('All measurement figures must be whole numbers.');
      return;
    }
    // Roof age is optional — blank means unknown (null). Not money; a plain count.
    const ageRaw = m.roofAgeYears.trim();
    const roofAgeYears = ageRaw === '' ? null : parseCount(ageRaw);
    if (ageRaw !== '' && roofAgeYears === null) {
      setError('Roof age must be a whole number of years, or left blank.');
      return;
    }
    const parsed = MeasurementInput.safeParse({ ...ints, roofAgeYears, deckingCondition: m.deckingCondition });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
      return;
    }
    setBusy(true);
    try {
      await api.attachMeasurement(jobId, { source: 'MANUAL', input: parsed.data });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function fetchAerial() {
    setError(null);
    if (address.trim() === '') {
      setError('An address is required for an aerial measurement.');
      return;
    }
    setBusy(true);
    try {
      await api.attachMeasurement(jobId, { source: 'AERIAL_STUB', address });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 760 }}>
      <div className="step-label">Step 2 of 2 — Measurement</div>
      <div className="card-head">
        <div className="seg" role="tablist" aria-label="Measurement source">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'MANUAL'}
            className={mode === 'MANUAL' ? 'is-active' : ''}
            onClick={() => setMode('MANUAL')}
          >
            Manual
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'AERIAL'}
            className={mode === 'AERIAL' ? 'is-active' : ''}
            onClick={() => setMode('AERIAL')}
          >
            Aerial
          </button>
        </div>
      </div>
      {error !== null && <Banner kind="error">{error}</Banner>}

      {mode === 'MANUAL' ? (
        <form onSubmit={(e) => void submitManual(e)}>
          <div className="form-grid">
            <SuffixField label="Roof Area" suffix="sqft" value={m.roofAreaSqFt} onChange={set('roofAreaSqFt')} />
            <SelectField label="Pitch" value={m.pitchTwelfths} onChange={set('pitchTwelfths')}>
              {Array.from({ length: 25 }, (_, n) => (
                <option key={n} value={String(n)}>
                  {n}/12
                </option>
              ))}
            </SelectField>
            <SelectField label="Stories" value={m.stories} onChange={set('stories')}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </SelectField>
            <SuffixField label="Facets" suffix="count" value={m.facets} onChange={set('facets')} />
            <SuffixField label="Ridge + Hip" suffix="lf" value={m.ridgeHipLf} onChange={set('ridgeHipLf')} />
            <SuffixField label="Valley" suffix="lf" value={m.valleyLf} onChange={set('valleyLf')} />
            <SuffixField label="Eave" suffix="lf" value={m.eaveLf} onChange={set('eaveLf')} />
            <SuffixField label="Rake" suffix="lf" value={m.rakeLf} onChange={set('rakeLf')} />
            <SuffixField label="Flashing" suffix="lf" value={m.flashingLf} onChange={set('flashingLf')} />
            <SuffixField label="Penetrations" suffix="count" value={m.penetrations} onChange={set('penetrations')} />
            <SelectField label="Existing Layers" value={m.existingLayers} onChange={set('existingLayers')}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </SelectField>
            <SuffixField
              label="Roof Age (Optional)"
              suffix="yrs"
              value={m.roofAgeYears}
              onChange={set('roofAgeYears')}
            />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="field-label">Decking Condition</span>
            <div className="radio-row">
              {(['UNKNOWN', 'GOOD', 'SUSPECT'] as const).map((c) => (
                <label key={c}>
                  <input
                    type="radio"
                    name="decking"
                    value={c}
                    checked={m.deckingCondition === c}
                    onChange={() => set('deckingCondition')(c)}
                  />
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-copper" disabled={busy}>
              {busy ? 'Attaching…' : 'Attach Measurement'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ maxWidth: 460 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field-label" htmlFor="aerial-address">
              Address
            </label>
            <input
              id="aerial-address"
              className="input"
              value={address}
              onChange={(e) => onAddressChange(e.target.value)}
            />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
            The aerial provider returns a full measurement for this address (stub provider in v1). Any roof age it
            reports is attached with the measurement and shown on the job.
          </p>
          <button type="button" className="btn btn-copper" disabled={busy} onClick={() => void fetchAerial()}>
            {busy ? 'Fetching…' : 'Fetch Aerial Measurement'}
          </button>
        </div>
      )}
    </div>
  );
}

function SuffixField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `mf-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="suffix-wrap">
        <input
          id={id}
          className="input mono-input"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="suffix">{suffix}</span>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = `ms-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select mono" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
