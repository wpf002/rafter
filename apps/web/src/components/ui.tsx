'use client';

import type { JobState } from '@rafter/types';
import type { ReactNode } from 'react';

export const STATE_LABEL: Record<JobState, string> = {
  DRAFT: 'Draft',
  QUOTED: 'Quoted',
  SOLD: 'Sold',
  IN_PROGRESS: 'In progress',
  AWAITING_CLOSEOUT: 'Awaiting closeout',
  CLOSED: 'Closed',
};

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
