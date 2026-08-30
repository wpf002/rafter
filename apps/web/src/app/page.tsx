'use client';

import Link from 'next/link';
import { formatBps, formatMoney, toMoney, type JobState, type JobSummary } from '@rafter/types';
import { BenchmarkPanel } from '@/components/BenchmarkPanel';
import { Banner, DeltaChip, EmptyState, MetricCard, PageHead, Skeleton, STATE_LABEL } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

const COLUMNS: JobState[] = ['DRAFT', 'QUOTED', 'SOLD', 'IN_PROGRESS', 'AWAITING_CLOSEOUT', 'CLOSED'];

/**
 * Share of finished jobs that need real costs entered before this roofer's
 * numbers can be compared against other roofers. Unchanged math (8000 bps =
 * 80%) — only the way it is worded on screen changed.
 */
const COMPARISON_TARGET_BPS = 8000;

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
  const comparisonUnlocked = d !== null && d.closeoutCompletionBps >= COMPARISON_TARGET_BPS;
  // Whole percentage points still to go, never rounded down to a bare "0".
  const pointsToGo =
    d !== null ? Math.max(1, Math.round((COMPARISON_TARGET_BPS - d.closeoutCompletionBps) / 100)) : 0;

  const byState = new Map<JobState, JobSummary[]>();
  for (const s of COLUMNS) byState.set(s, []);
  for (const j of jobs.data ?? []) byState.get(j.state)?.push(j);

  return (
    <>
      <PageHead
        title="Dashboard"
        actions={
          <Link href="/jobs/new" className="btn btn-copper">
            New Job
          </Link>
        }
      />
      <p className="why-line">
        Where every job stands today, and which ones still need their real costs entered before you know what you
        actually made on them.
      </p>
      {error !== null && <Banner kind="error">{error}</Banner>}

      <div className="metric-row">
        <MetricCard
          label="Quoted This Month"
          loading={dash.loading}
          value={d !== null ? formatMoney(toMoney(d.quotedThisMonthCents)) : '—'}
        />
        <MetricCard
          label="Active Jobs"
          loading={dash.loading}
          value={activeJobs}
          sub="Sold · In Progress · Awaiting Closeout"
        />
        <MetricCard
          label="Average Profit"
          loading={dash.loading}
          value={d !== null && d.avgActualMarginBps !== null ? formatBps(d.avgActualMarginBps) : '—'}
          sub={`${d?.closedJobs ?? 0} Finished Jobs · After Real Costs`}
        />
        <MetricCard
          label="Final Costs Entered"
          loading={dash.loading}
          value={d !== null ? formatBps(d.closeoutCompletionBps) : '—'}
          sub="Comparison Unlocks at 80%"
          chip={
            d !== null ? (
              <DeltaChip good={comparisonUnlocked}>
                {comparisonUnlocked ? 'Comparison Unlocked' : `${pointsToGo}% to Go`}
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
                    {state === 'AWAITING_CLOSEOUT' && list.length > 0 && (
                      <div className="kanban-col-flag">
                        <span className="badge-closeout">{list.length} Need Final Costs</span>
                      </div>
                    )}
                    <div className="kanban-col-head">
                      <span className="section-label">{STATE_LABEL[state]}</span>
                      {!jobs.loading && <span className="kanban-count">{list.length}</span>}
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
                            <DeltaChip good={j.actualMarginBps >= 0}>{formatBps(j.actualMarginBps)} Profit</DeltaChip>
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
        <div className="bench-strip">
          <BenchmarkPanel dash={d} loading={dash.loading} />
        </div>
      </div>
    </>
  );
}
