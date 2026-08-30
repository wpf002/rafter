'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { JOB_TRANSITIONS, type JobState } from '@rafter/types';
import { CloseoutFlow } from '@/components/CloseoutFlow';
import { EventLog } from '@/components/EventLog';
import { MarginReport } from '@/components/MarginReport';
import { MeasurementCard } from '@/components/MeasurementCard';
import { QuoteSection } from '@/components/QuoteSection';
import { Banner, Skeleton, StatePill } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useTenant } from '@/lib/tenant';

/**
 * The next legal transition that is triggered by a plain button. DRAFT→QUOTED
 * happens by issuing a quote; AWAITING_CLOSEOUT→CLOSED only via a complete
 * closeout (D6); CLOSED never has a button.
 */
const TRANSITION_ACTIONS: Partial<Record<JobState, { to: JobState; label: string }>> = {
  QUOTED: { to: 'SOLD', label: 'Mark sold' },
  SOLD: { to: 'IN_PROGRESS', label: 'Start work' },
  IN_PROGRESS: { to: 'AWAITING_CLOSEOUT', label: 'Mark work complete' },
};

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tenantId, error: tenantError } = useTenant();
  const detail = useApi(() => api.job(id), [id, tenantId], tenantId !== null);
  const models = useApi(() => api.priceModels(), [tenantId], tenantId !== null);
  const [transBusy, setTransBusy] = useState(false);
  const [transErr, setTransErr] = useState<string | null>(null);

  const job = detail.data;
  const action = job !== null ? TRANSITION_ACTIONS[job.state] : undefined;
  const legal = job !== null && action !== undefined && JOB_TRANSITIONS[job.state].includes(action.to);

  async function doTransition() {
    if (job === null || action === undefined) return;
    setTransBusy(true);
    setTransErr(null);
    try {
      await api.transition(job.id, action.to);
      detail.reload();
    } catch (e) {
      setTransErr(errorMessage(e));
    } finally {
      setTransBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/jobs" className="crumb">
            ← Jobs
          </Link>
          {job !== null ? (
            <>
              <h1>{job.name}</h1>
              <div className="muted" style={{ fontSize: 13 }}>
                {job.address} · {job.customerName}
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              <Skeleton h={24} w={260} />
              <Skeleton h={14} w={200} />
            </div>
          )}
        </div>
        <div className="head-actions no-print">
          {job !== null && <StatePill state={job.state} />}
          {legal && action !== undefined && (
            <button type="button" className="btn btn-copper" disabled={transBusy} onClick={() => void doTransition()}>
              {transBusy ? 'Working…' : action.label}
            </button>
          )}
        </div>
      </div>

      {tenantError !== null && <Banner kind="error">{tenantError}</Banner>}
      {detail.error !== null && <Banner kind="error">{detail.error}</Banner>}
      {transErr !== null && <Banner kind="error">{transErr}</Banner>}

      {detail.loading && job === null && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={120} w="100%" />
          <Skeleton h={260} w="100%" />
        </div>
      )}

      {job !== null && (
        <>
          {job.measurement !== null && <MeasurementCard measurement={job.measurement} />}
          <QuoteSection job={job} models={models.data} onChanged={detail.reload} />
          {job.state === 'AWAITING_CLOSEOUT' && job.closeout === null && job.quote !== null && (
            <CloseoutFlow jobId={job.id} quote={job.quote} onDone={detail.reload} />
          )}
          {job.state === 'CLOSED' && job.variance !== null && <MarginReport variance={job.variance} />}
          {job.events.length > 0 && <EventLog events={job.events} />}
        </>
      )}
    </>
  );
}
