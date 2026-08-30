'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import {
  formatMoney,
  fromMoney,
  toMoney,
  type ActualCategory,
  type ActualLine,
  type Money,
  type Quote,
  type SubmitCloseoutRequest,
  type VarianceAttribution,
  type VarianceReason,
} from '@rafter/types';
import { api, errorMessage } from '@/lib/api';
import { centsToDollarsInput, parseDollarsToCents } from '@/lib/money';
import { Banner, fmtDateTime } from './ui';

const CATEGORIES: ActualCategory[] = ['MATERIAL', 'LABOR', 'DISPOSAL', 'PERMIT', 'OTHER'];

/** Display copy only — the wire values stay the ActualCategory enum. */
const CATEGORY_LABEL: Record<ActualCategory, string> = {
  MATERIAL: 'Material',
  LABOR: 'Labor',
  DISPOSAL: 'Disposal',
  PERMIT: 'Permit',
  OTHER: 'Other',
};

const REASONS: { reason: VarianceReason; label: string }[] = [
  { reason: 'CONCEALED_CONDITION', label: 'Concealed Condition' },
  { reason: 'CUSTOMER_SCOPE_CHANGE', label: 'Customer Scope Change' },
  { reason: 'MEASUREMENT_ERROR', label: 'Measurement Error' },
  { reason: 'PRICING_ERROR', label: 'Pricing Error' },
];

interface ActualRow {
  key: number;
  description: string;
  category: ActualCategory;
  amount: string;
}

interface UploadedPhoto {
  id: string;
  thumb: string;
  exif: string | null;
  filename: string;
}

/**
 * Closeout flow (D6/D7): paired quoted/actual grid, staged ingest drafts
 * (D5 — drafts never auto-enter), per-dollar attribution allocator, and a
 * sticky footer that blocks submit while a single cent is unattributed.
 */
export function CloseoutFlow({ jobId, quote, onDone }: { jobId: string; quote: Quote; onDone: () => void }) {
  const keyRef = useRef(1);
  const [rows, setRows] = useState<ActualRow[]>([{ key: 0, description: '', category: 'MATERIAL', amount: '' }]);
  const [staged, setStaged] = useState<ActualLine[]>([]);
  const [invoiceText, setInvoiceText] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestErr, setIngestErr] = useState<string | null>(null);
  const [attr, setAttr] = useState<Record<VarianceReason, string>>({
    CONCEALED_CONDITION: '',
    CUSTOMER_SCOPE_CHANGE: '',
    MEASUREMENT_ERROR: '',
    PRICING_ERROR: '',
  });
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const subtotal = toMoney(quote.subtotalCents);
  const overhead = toMoney(quote.overheadCents);
  const quotedCost = subtotal + overhead;
  const planned = toMoney(quote.marginCents);

  const activeRows = rows.filter((r) => r.description.trim() !== '' || r.amount.trim() !== '');
  let rowsValid = activeRows.length > 0;
  let actualTotal: Money = 0n;
  for (const r of activeRows) {
    const cents = parseDollarsToCents(r.amount);
    if (cents === null || r.description.trim() === '') rowsValid = false;
    else actualTotal += cents;
  }

  let attrValid = true;
  let attributed: Money = 0n;
  const attrCents: Record<VarianceReason, Money> = {
    CONCEALED_CONDITION: 0n,
    CUSTOMER_SCOPE_CHANGE: 0n,
    MEASUREMENT_ERROR: 0n,
    PRICING_ERROR: 0n,
  };
  for (const { reason } of REASONS) {
    const raw = attr[reason].trim();
    if (raw === '') continue;
    const cents = parseDollarsToCents(raw);
    if (cents === null) attrValid = false;
    else {
      attrCents[reason] = cents;
      attributed += cents;
    }
  }

  const variance = actualTotal - quotedCost;
  const unattributed = variance - attributed;
  const needsPhoto = attrCents.CONCEALED_CONDITION !== 0n && photo === null;
  const canSubmit = rowsValid && attrValid && unattributed === 0n && !needsPhoto && !submitBusy;

  function setRow(key: number, patch: Partial<ActualRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow(prefill?: { description: string; category: ActualCategory; amount: string }) {
    const key = keyRef.current;
    keyRef.current += 1;
    setRows((rs) => [
      ...rs,
      { key, description: prefill?.description ?? '', category: prefill?.category ?? 'MATERIAL', amount: prefill?.amount ?? '' },
    ]);
  }

  function removeRow(key: number) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  async function runIngest() {
    if (invoiceText.trim() === '') return;
    setIngestBusy(true);
    setIngestErr(null);
    try {
      const res = await api.ingestInvoice(invoiceText);
      setStaged((s) => [...s, ...res.draftLines]);
      setInvoiceText('');
    } catch (e) {
      setIngestErr(errorMessage(e));
    } finally {
      setIngestBusy(false);
    }
  }

  function confirmStaged(index: number) {
    const line = staged[index];
    if (line === undefined) return;
    addRow({
      description: line.description,
      category: line.category,
      amount: centsToDollarsInput(toMoney(line.amountCents)),
    });
    setStaged((s) => s.filter((_, i) => i !== index));
  }

  function rejectStaged(index: number) {
    setStaged((s) => s.filter((_, i) => i !== index));
  }

  function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    setPhotoBusy(true);
    setPhotoErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      api
        .uploadPhoto(jobId, { filename: file.name, dataBase64 })
        .then((p) => {
          setPhoto({ id: p.id, thumb: dataUrl, exif: p.exifTakenAt, filename: p.filename });
          setPhotoBusy(false);
        })
        .catch((err: unknown) => {
          setPhotoErr(errorMessage(err));
          setPhotoBusy(false);
        });
    };
    reader.onerror = () => {
      setPhotoErr('Could not read the selected file.');
      setPhotoBusy(false);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitBusy(true);
    setSubmitErr(null);
    const actualLines: ActualLine[] = activeRows.map((r) => {
      const cents = parseDollarsToCents(r.amount);
      return {
        description: r.description.trim(),
        category: r.category,
        amountCents: fromMoney(cents ?? 0n),
      };
    });
    const attributions: VarianceAttribution[] = REASONS.flatMap(({ reason }) => {
      const cents = attrCents[reason];
      if (cents === 0n) return [];
      const base: VarianceAttribution = { reason, amountCents: fromMoney(cents) };
      if (reason === 'CONCEALED_CONDITION' && photo !== null) base.photoId = photo.id;
      return [base];
    });
    const body: SubmitCloseoutRequest = { actualLines, attributions };
    try {
      await api.submitCloseout(jobId, body);
      onDone();
    } catch (e) {
      // 422s from the API render verbatim in the sticky bar.
      setSubmitErr(errorMessage(e));
      setSubmitBusy(false);
      return;
    }
    setSubmitBusy(false);
  }

  const footerMessage = !rowsValid
    ? activeRows.length === 0
      ? 'Add at least one actual cost line.'
      : 'Fix invalid amounts or empty descriptions in actuals.'
    : !attrValid
      ? 'Fix invalid attribution amounts.'
      : needsPhoto
        ? 'Concealed condition attribution requires a photo.'
        : null;

  return (
    <section className="section">
      <span className="section-label">Final Costs</span>
      <div className="closeout-grid" style={{ marginTop: 8 }}>
        <div className="card card-pad">
          <h2 style={{ marginBottom: 8 }}>Quoted</h2>
          <div className="kv">
            <span>Direct Subtotal</span>
            <span className="val">{formatMoney(subtotal)}</span>
          </div>
          <div className="kv">
            <span>Overhead</span>
            <span className="val">{formatMoney(overhead)}</span>
          </div>
          <div className="kv strong">
            <span>Quoted Cost</span>
            <span className="val">{formatMoney(quotedCost)}</span>
          </div>
          <div className="kv">
            <span>Planned Profit</span>
            <span className="val">{formatMoney(planned)}</span>
          </div>
        </div>

        <div className="card card-pad">
          <h2 style={{ marginBottom: 8 }}>Actual</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <input
                      className="input"
                      aria-label="Description"
                      value={r.description}
                      onChange={(e) => setRow(r.key, { description: e.target.value })}
                      placeholder="e.g. Shingle order — supplier"
                    />
                  </td>
                  <td style={{ width: 130 }}>
                    <select
                      className="select"
                      aria-label="Category"
                      value={r.category}
                      onChange={(e) => setRow(r.key, { category: e.target.value as ActualCategory })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ width: 130 }}>
                    <input
                      className="input mono-input actual-amount"
                      aria-label="Amount"
                      value={r.amount}
                      onChange={(e) => setRow(r.key, { amount: e.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </td>
                  <td style={{ width: 40 }}>
                    <button type="button" className="btn btn-small" onClick={() => removeRow(r.key)} aria-label="Remove line">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <button type="button" className="btn btn-small" onClick={() => addRow()}>
              Add Line
            </button>
          </div>

          {staged.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span className="section-label">Staged From Invoice — Confirm to Enter</span>
              <div style={{ marginTop: 8 }}>
                {staged.map((line, i) => (
                  <div className="staged-line" key={`${line.description}-${i}`}>
                    <span className="staged-desc">{line.description}</span>
                    <span className="staged-cat">{CATEGORY_LABEL[line.category]}</span>
                    <span className="staged-amt">{formatMoney(toMoney(line.amountCents))}</span>
                    <button type="button" className="btn btn-small btn-copper" onClick={() => confirmStaged(i)}>
                      Confirm
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => rejectStaged(i)} aria-label="Discard draft">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <span className="section-label">Paste Invoice</span>
            {ingestErr !== null && <Banner kind="error">{ingestErr}</Banner>}
            <textarea
              className="textarea"
              style={{ marginTop: 8 }}
              value={invoiceText}
              onChange={(e) => setInvoiceText(e.target.value)}
              placeholder="Paste supplier invoice text — parsed lines arrive as drafts you confirm."
            />
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                disabled={ingestBusy || invoiceText.trim() === ''}
                onClick={() => void runIngest()}
              >
                {ingestBusy ? 'Parsing…' : 'Parse Invoice'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="compute-bar">
        <div className="kv2">
          <span className="section-label">Actual Total</span>
          <span className="val">{formatMoney(actualTotal)}</span>
        </div>
        <div className="kv2">
          <span className="section-label">Quoted Cost</span>
          <span className="val">{formatMoney(quotedCost)}</span>
        </div>
        <div className="kv2">
          <span className="section-label">Over or Under</span>
          <span className="val" style={{ color: variance > 0n ? 'var(--bad)' : variance < 0n ? 'var(--good)' : undefined }}>
            {formatMoney(variance, { sign: true })}
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 4 }}>Where the Difference Came From</h2>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Every dollar over or under maps to exactly one reason before this job can close.
        </p>
        {REASONS.map(({ reason, label }) => (
          <div className="alloc-row" key={reason}>
            <div>
              <div className="alloc-label">{label}</div>
              {reason === 'CONCEALED_CONDITION' && (
                <div className="photo-line">
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="Concealed condition photo"
                    onChange={onPhotoChange}
                    disabled={photoBusy}
                  />
                  {photoBusy && <span className="muted" style={{ fontSize: 12 }}>Uploading…</span>}
                  {photo !== null && (
                    <>
                      <img className="photo-thumb" src={photo.thumb} alt={photo.filename} />
                      <span className="chip chip-copper">{photo.id}</span>
                      <span className="photo-exif">
                        {photo.exif !== null ? `EXIF ${fmtDateTime(photo.exif)}` : 'no EXIF timestamp'}
                      </span>
                    </>
                  )}
                  {photoErr !== null && <span className="unattr unattr-bad">{photoErr}</span>}
                </div>
              )}
            </div>
            <input
              className="input mono-input"
              aria-label={`${label} amount`}
              value={attr[reason]}
              onChange={(e) => setAttr((a) => ({ ...a, [reason]: e.target.value }))}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
        ))}
      </div>

      <div className="closeout-footer">
        <div>
          {submitErr !== null ? (
            <span className="unattr unattr-bad">{submitErr}</span>
          ) : footerMessage !== null ? (
            <span className="unattr unattr-bad">{footerMessage}</span>
          ) : unattributed !== 0n ? (
            <span className="unattr unattr-bad">Not Accounted For: {formatMoney(unattributed)}</span>
          ) : (
            <span className="unattr unattr-good">$0.00 — every dollar accounted for</span>
          )}
        </div>
        <button type="button" className="btn btn-copper" disabled={!canSubmit} onClick={() => void submit()}>
          {submitBusy ? 'Submitting…' : 'Submit Final Costs'}
        </button>
      </div>
    </section>
  );
}
