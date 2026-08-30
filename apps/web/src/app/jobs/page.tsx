'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatBps, formatMoney, JobState, toMoney } from '@rafter/types';
import { Banner, EmptyState, fmtDate, Skeleton, StatePill, STATE_LABEL } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

type Tab = JobState | 'ALL';

export default function JobsPage() {
  const { tenantId, error: tenantError } = useTenant();
  const jobs = useApi(() => api.jobs(), [tenantId], tenantId !== null);
  const [tab, setTab] = useState<Tab>('ALL');

  const all = jobs.data ?? [];
  const filtered = tab === 'ALL' ? all : all.filter((j) => j.state === tab);
  const countFor = (t: Tab) => (t === 'ALL' ? all.length : all.filter((j) => j.state === t).length);
  const error = tenantError ?? jobs.error;

  return (
    <>
      <div className="page-head">
        <h1>Jobs</h1>
        <Link href="/jobs/new" className="btn btn-copper">
          New job
        </Link>
      </div>
      {error !== null && <Banner kind="error">{error}</Banner>}

      <div className="tabs" role="tablist">
        {(['ALL', ...JobState.options] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
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
              <th>State</th>
              <th className="num">Quoted total</th>
              <th className="num">Margin</th>
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
            ) : filtered.length === 0 ? (
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
              filtered.map((j) => (
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
      </div>
    </>
  );
}
