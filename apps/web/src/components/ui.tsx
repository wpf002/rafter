'use client';

import type { JobState } from '@rafter/types';
import type { ReactNode } from 'react';
import { useTenant } from '@/lib/tenant';

export const STATE_LABEL: Record<JobState, string> = {
  DRAFT: 'Draft',
  QUOTED: 'Quoted',
  SOLD: 'Sold',
  IN_PROGRESS: 'In Progress',
  AWAITING_CLOSEOUT: 'Awaiting Closeout',
  CLOSED: 'Closed',
};

/**
 * Tenant switcher. Lives in the page header, immediately left of the primary
 * action — never in the sidebar. Print hides it with the rest of .page-head.
 */
export function TenantSelect() {
  const { tenants, tenantId, setTenant } = useTenant();
  return (
    <select
      className="tenant-inline"
      aria-label="Tenant"
      value={tenantId ?? ''}
      onChange={(e) => setTenant(e.target.value)}
    >
      {tenants.length === 0 ? (
        <option value="">—</option>
      ) : (
        tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))
      )}
    </select>
  );
}

/**
 * The one page header. `above` carries a breadcrumb, `sub` a one-line caption;
 * `actions` is the primary action, always rendered to the right of the tenant
 * switcher.
 */
export function PageHead({
  title,
  above,
  sub,
  actions,
}: {
  title: ReactNode;
  above?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {above}
        <h1>{title}</h1>
        {sub !== undefined && (
          <div className="muted" style={{ fontSize: 13 }}>
            {sub}
          </div>
        )}
      </div>
      <div className="head-actions no-print">
        <TenantSelect />
        {actions}
      </div>
    </div>
  );
}

export function StatePill({ state }: { state: JobState }) {
  return <span className={`pill pill-${state}`}>{STATE_LABEL[state]}</span>;
}

export function DeltaChip({ good, children }: { good: boolean; children: ReactNode }) {
  return <span className={`chip ${good ? 'chip-good' : 'chip-bad'}`}>{children}</span>;
}

export function Chip({ tone = 'muted', children }: { tone?: 'muted' | 'copper'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Banner({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function MetricCard({
  label,
  value,
  sub,
  chip,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  chip?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card metric-card">
      {loading ? <Skeleton h={29} w="64%" /> : <div className="metric-value">{value}</div>}
      <div className="section-label">{label}</div>
      {sub !== undefined && !loading && <div className="metric-sub">{sub}</div>}
      {chip !== undefined && !loading && chip}
    </div>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
