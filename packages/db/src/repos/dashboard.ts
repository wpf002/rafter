import { JobState, fromMoney, type DashboardResponse } from '@rafter/types';
import { prisma } from '../client';
import { marginBps } from './jobs';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const dashboard = {
  /** `now` is an explicit parameter so the calendar-month and 30-day windows are testable. */
  async metrics(tenantId: string, now: Date): Promise<DashboardResponse> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const staleCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);

    const [byState, quotedAgg, closed, gateJobs] = await Promise.all([
      prisma.job.groupBy({ by: ['state'], where: { tenantId }, _count: { _all: true } }),
      prisma.quote.aggregate({
        where: { tenantId, issuedAt: { gte: monthStart, lt: nextMonthStart } },
        _sum: { totalCents: true },
      }),
      prisma.job.findMany({
        where: { tenantId, state: 'CLOSED' },
        include: {
          quote: { select: { totalCents: true } },
          closeout: { select: { actualCostCents: true } },
        },
      }),
      prisma.job.findMany({
        where: {
          tenantId,
          state: { in: ['AWAITING_CLOSEOUT', 'CLOSED'] },
          quote: { issuedAt: { lt: staleCutoff } },
        },
        select: { state: true },
      }),
    ]);

    const jobsByState = Object.fromEntries(
      JobState.options.map((s) => [s, 0]),
    ) as Record<JobState, number>;
    for (const row of byState) jobsByState[row.state] = row._count._all;

    const marginSamples = closed
      .filter((j) => j.quote && j.closeout && j.quote.totalCents !== 0n)
      .map((j) => marginBps(j.quote!.totalCents, j.closeout!.actualCostCents));
    const avgActualMarginBps =
      marginSamples.length > 0
        ? Math.round(marginSamples.reduce((a, b) => a + b, 0) / marginSamples.length)
        : null;

    const gateTotal = gateJobs.length;
    const gateClosed = gateJobs.filter((j) => j.state === 'CLOSED').length;
    const closeoutCompletionBps =
      gateTotal === 0 ? 10000 : Math.round((gateClosed * 10000) / gateTotal);

    return {
      jobsByState,
      quotedThisMonthCents: fromMoney(quotedAgg._sum.totalCents ?? 0n),
      closedJobs: closed.length,
      avgActualMarginBps,
      closeoutCompletionBps,
      benchmarkUnlocked: closeoutCompletionBps >= 8000,
    };
  },
};
