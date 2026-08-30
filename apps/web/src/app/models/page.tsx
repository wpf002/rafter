'use client';

import { useState } from 'react';
import {
  formatBps,
  formatMoney,
  toMoney,
  type PriceModel,
  type PriceModelVersion,
} from '@rafter/types';
import { ModelEditor } from '@/components/ModelEditor';
import { Banner, Chip, EmptyState, fmtDate, Skeleton } from '@/components/ui';
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

export default function ModelsPage() {
  const { tenantId, error: tenantError } = useTenant();
  const models = useApi(() => api.priceModels(), [tenantId], tenantId !== null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const error = tenantError ?? models.error;

  return (
    <>
      <div className="page-head">
        <h1>Price models</h1>
      </div>
      {error !== null && <Banner kind="error">{error}</Banner>}
      {saved !== null && <Banner kind="ok">{saved}</Banner>}

      {models.loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={140} w="100%" />
          <Skeleton h={140} w="100%" />
        </div>
      ) : (models.data?.length ?? 0) === 0 ? (
        <div className="card">
          <EmptyState>No price models for this tenant yet — seed data creates one per tenant.</EmptyState>
        </div>
      ) : (
        (models.data ?? []).map((model) => {
          const versions = versionsOf(model);
          const latest = versions[0];
          return (
            <section className="section" key={model.id}>
              <div className="card card-pad">
                <div className="card-head">
                  <h2>{model.name}</h2>
                  {latest !== undefined && (
                    <button
                      type="button"
                      className="btn btn-copper btn-small"
                      onClick={() => {
                        setSaved(null);
                        setEditing(editing === model.id ? null : model.id);
                      }}
                    >
                      {editing === model.id ? 'Close editor' : 'New version'}
                    </button>
                  )}
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Created</th>
                      <th>Rates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td className="mono">v{v.version}</td>
                        <td className="muted">{fmtDate(v.createdAt)}</td>
                        <td>
                          <div className="version-chips">
                            <Chip>shingle {formatMoney(toMoney(v.rates.fieldShinglePerSquareCents))}/sq</Chip>
                            <Chip>tear-off {formatMoney(toMoney(v.rates.tearOffPerSquarePerLayerCents))}/sq</Chip>
                            <Chip>OH {formatBps(v.rates.overheadBps)}</Chip>
                            <Chip>margin {formatBps(v.rates.marginBps)}</Chip>
                            <Chip>waste {formatBps(v.rates.wasteBps)}</Chip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {editing === model.id && latest !== undefined && (
                  <ModelEditor
                    modelId={model.id}
                    base={latest.rates}
                    baseVersion={latest.version}
                    onSaved={() => {
                      setEditing(null);
                      setSaved(`${model.name} v${latest.version + 1} created.`);
                      models.reload();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
