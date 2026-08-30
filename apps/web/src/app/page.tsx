'use client';

import Link from 'next/link';
import { formatBps, formatMoney, toMoney, type JobState, type JobSummary } from '@rafter/types';
import { BenchmarkPanel } from '@/components/BenchmarkPanel';
import { Banner, DeltaChip, EmptyState, MetricCard, Skeleton, STATE_LABEL } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

const COLUMNS: JobState[] = ['DRAFT', 'QUOTED', 'SOLD', 'IN_PROGRESS', 'AWAITING_CLOSEOUT', 'CLOSED'];

export default function DashboardPage() {
  const { tenantId, error: tenantError } = useTenant();
  const dash = useApi(() => api.dashboard(), [tenantId], tenantId !== null);
  const jobs = useApi(() => api.jobs(), [tenantId], tenantId !== null);

  const d = dash.data;
  const error = tenantError ?? dash.error ?? jobs.error;

  const activeJobs =
    d !== null
      ? (d.jobsByState.SOLD ?? 0) + (d.jobsByState.IN_PROGRESS ?? 0) + (d.jobsByState.AWAITING_CLOSEOUT ?? 0)
      : 0;
  const gateDelta = d !== null ? d.closeoutCompletionBps - 8000 : 0;

  const byState = new Map<JobState, JobSummary[]>();
  for (const s of COLUMNS) byState.set(s, []);
  for (const j of jobs.data ?? []) byState.get(j.state)?.push(j);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link href="/jobs/new" className="btn btn-copper">
          New job
        </Link>
      </div>
      {error !== null && <Banner kind="error">{error}</Banner>}

      <div className="metric-row">
        <MetricCard
          label="Quoted this month"
          loading={dash.loading}
          value={d !== null ? formatMoney(toMoney(d.quotedThisMonthCents)) : '—'}
        />
        <MetricCard
          label="Active jobs"
          loading={dash.loading}
          value={activeJobs}
          sub="sold · in progress · awaiting closeout"
        />
        <MetricCard
          label="Avg actual margin"
          loading={dash.loading}
          value={d !== null && d.avgActualMarginBps !== null ? formatBps(d.avgActualMarginBps) : '—'}
          sub={`${d?.closedJobs ?? 0} closed jobs`}
        />
        <MetricCard
          label="Closeout completion"
          loading={dash.loading}
          value={d !== null ? formatBps(d.closeoutCompletionBps) : '—'}
          chip={
            d !== null ? (
              <DeltaChip good={gateDelta >= 0}>
                {gateDelta >= 0 ? '+' : ''}
                {formatBps(gateDelta)} vs 80% gate
              </DeltaChip>
            ) : undefined
          }
        />
      </div>

      <div className="dash-grid">
        <section>
          <span className="section-label" style={{ display: 'block', marginBottom: 8 }}>
            Pipeline
          </span>
          <div className="kanban-wrap">
            <div className="kanban">
              {COLUMNS.map((state) => {
                const list = byState.get(state) ?? [];
                return (
                  <div className="kanban-col" key={state}>
                    <div className="kanban-col-head">
                      <span className="section-label">{STATE_LABEL[state]}</span>
                      {!jobs.loading && <span className="kanban-count">{list.length}</span>}
                      {state === 'AWAITING_CLOSEOUT' && list.length > 0 && (
                        <span className="badge-closeout">{list.length} need closeout</span>
                      )}
                    </div>
                    {jobs.loading ? (
                      <Skeleton h={64} w="100%" />
                    ) : (
                      list.map((j) => (
                        <Link className="job-card" key={j.id} href={`/jobs/${j.id}`}>
                          <div className="job-card-name">{j.name}</div>
                          <div className="job-card-addr">{j.address}</div>
                          {j.quotedTotalCents !== null && (
                            <div className="job-card-total">{formatMoney(toMoney(j.quotedTotalCents))}</div>
                          )}
                          {j.state === 'CLOSED' && j.actualMarginBps !== null && (
                            <DeltaChip good={j.actualMarginBps >= 0}>{formatBps(j.actualMarginBps)} margin</DeltaChip>
                          )}
                        </Link>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {!jobs.loading && (jobs.data?.length ?? 0) === 0 && jobs.error === null && (
            <div className="card" style={{ marginTop: 10 }}>
              <EmptyState>
                No jobs yet. <Link href="/jobs/new">Create your first job</Link> to start quoting.
              </EmptyState>
            </div>
          )}
        </section>
        <BenchmarkPanel dash={d} loading={dash.loading} />
      </div>
    </>
  );
}
