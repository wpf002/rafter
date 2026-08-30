'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatBps, formatMoney, JobState, toMoney } from '@rafter/types';
import { Banner, EmptyState, fmtDate, PageHead, Skeleton, StatePill, STATE_LABEL } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

type Tab = JobState | 'ALL';

/** Rows shown per page in the jobs table. */
const JOBS_PER_PAGE = 25;

/** Numbered page buttons are only shown up to this many pages. */
const MAX_NUMBERED_PAGES = 8;

export default function JobsPage() {
  const { tenantId, error: tenantError } = useTenant();
  const jobs = useApi(() => api.jobs(), [tenantId], tenantId !== null);
  const [tab, setTab] = useState<Tab>('ALL');
  const [page, setPage] = useState(1);

  // Switching roofing companies starts the list over at the first page.
  useEffect(() => {
    setPage(1);
  }, [tenantId]);

  const all = jobs.data ?? [];
  const filtered = tab === 'ALL' ? all : all.filter((j) => j.state === tab);
  const countFor = (t: Tab) => (t === 'ALL' ? all.length : all.filter((j) => j.state === t).length);
  const error = tenantError ?? jobs.error;

  // Clamp rather than trust `page`: the list can shrink under us on reload.
  const totalPages = Math.max(1, Math.ceil(filtered.length / JOBS_PER_PAGE));
  const current = Math.min(page, totalPages);
  const from = (current - 1) * JOBS_PER_PAGE;
  const visible = filtered.slice(from, from + JOBS_PER_PAGE);
  const showPager = !jobs.loading && filtered.length > JOBS_PER_PAGE;

  const selectTab = (t: Tab) => {
    setTab(t);
    setPage(1);
  };

  return (
    <>
      <PageHead
        title="Jobs"
        actions={
          <Link href="/jobs/new" className="btn btn-copper">
            New Job
          </Link>
        }
      />
      <p className="why-line">
        Every job you have quoted or built. Open one to see how its price was built, or to enter what it actually
        cost you.
      </p>
      {error !== null && <Banner kind="error">{error}</Banner>}

      <div className="tabs" role="tablist">
        {(['ALL', ...JobState.options] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' is-active' : ''}`}
            onClick={() => selectTab(t)}
          >
            {t === 'ALL' ? 'All' : STATE_LABEL[t]}
            {!jobs.loading && <span className="tab-count">{countFor(t)}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Address</th>
              <th>Customer</th>
              <th>Stage</th>
              <th className="num">Quoted Total</th>
              <th className="num">Profit</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.loading ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={7}>
                    <Skeleton h={16} />
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState>
                    {tab === 'ALL' ? (
                      <>
                        No jobs yet. <Link href="/jobs/new">Create one</Link> to get started.
                      </>
                    ) : (
                      `No ${STATE_LABEL[tab as JobState].toLowerCase()} jobs.`
                    )}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              visible.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/jobs/${j.id}`}>{j.name}</Link>
                  </td>
                  <td className="muted">{j.address}</td>
                  <td>{j.customerName}</td>
                  <td>
                    <StatePill state={j.state} />
                  </td>
                  <td className="num mono">
                    {j.quotedTotalCents !== null ? formatMoney(toMoney(j.quotedTotalCents)) : '—'}
                  </td>
                  <td className="num mono">{j.actualMarginBps !== null ? formatBps(j.actualMarginBps) : '—'}</td>
                  <td className="muted">{fmtDate(j.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {showPager && (
          <div className="pager">
            <button
              type="button"
              className="pager-btn"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            {totalPages <= MAX_NUMBERED_PAGES &&
              Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pager-btn${n === current ? ' is-active' : ''}`}
                  aria-current={n === current ? 'page' : undefined}
                  aria-label={`Page ${n}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
            <button
              type="button"
              className="pager-btn"
              disabled={current === totalPages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
            <span className="pager-info">
              Showing {from + 1}–{from + visible.length} of {filtered.length} Jobs
            </span>
          </div>
        )}
      </div>
    </>
  );
}
