import { createHash } from 'node:crypto';
import { fromMoney, type BenchmarkRecord } from '@rafter/types';
import { prisma } from '../client';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Opaque 12-hex tenant key. Raw tenant ids never leave this module (D10). */
function tenantKey(tenantId: string): string {
  return createHash('sha256').update(tenantId).digest('hex').slice(0, 12);
}

export const benchmark = {
  /**
   * Phase 6 gate (D8 — withhold the benefit, never the tool): eligible jobs
   * are those created ≥30 days before `now` that reached AWAITING_CLOSEOUT or
   * CLOSED. `now` is an explicit parameter so the window is testable.
   */
  async gate(
    tenantId: string,
    now: Date,
  ): Promise<{ completionBps: number; remainingCount: number }> {
    const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
    const rows = await prisma.job.findMany({
      where: {
        tenantId,
        createdAt: { lte: cutoff },
        state: { in: ['AWAITING_CLOSEOUT', 'CLOSED'] },
      },
      select: { state: true },
    });
    const eligible = rows.length;
    const closed = rows.filter((r) => r.state === 'CLOSED').length;
    const completionBps = eligible === 0 ? 10000 : Math.round((closed * 10000) / eligible);
    const remainingCount = Math.max(0, Math.ceil(0.8 * eligible) - closed);
    return { completionBps, remainingCount };
  },

  /**
   * CROSS-TENANT ON PURPOSE (D10): this is the ONLY query in the repo layer
   * that reads across tenants. It feeds aggregate-only computation — the
   * engine reduces these rows to k-anonymous percentile strata and nothing
   * row-level is ever served. tenantKey is an opaque hash, never an id.
   */
  async poolRecords(): Promise<BenchmarkRecord[]> {
    const rows = await prisma.job.findMany({
      where: {
        state: 'CLOSED',
        quote: { isNot: null },
        measurement: { isNot: null },
        closeout: { isNot: null },
      },
      include: {
        quote: { select: { totalCents: true, asOf: true } },
        measurement: {
          select: {
            roofAreaSqFt: true,
            pitchTwelfths: true,
            existingLayers: true,
            roofAgeYears: true,
          },
        },
        closeout: {
          select: {
            submittedAt: true,
            attributions: { select: { reason: true, amountCents: true } },
          },
        },
      },
      orderBy: [{ closeout: { submittedAt: 'asc' } }, { id: 'asc' }],
    });

    return rows
      .filter((j) => j.quote !== null && j.measurement !== null && j.closeout !== null)
      .map((j) => {
        let concealed = 0n;
        for (const a of j.closeout!.attributions) {
          if (a.reason === 'CONCEALED_CONDITION') concealed += a.amountCents;
        }
        return {
          tenantKey: tenantKey(j.tenantId),
          concealedCents: fromMoney(concealed),
          contractCents: fromMoney(j.quote!.totalCents),
          squaresX100: j.measurement!.roofAreaSqFt,
          pitchTwelfths: j.measurement!.pitchTwelfths,
          existingLayers: j.measurement!.existingLayers,
          roofAgeYears: j.measurement!.roofAgeYears,
          quoteMonth: j.quote!.asOf.toISOString().slice(0, 7),
          closeMonth: j.closeout!.submittedAt.toISOString().slice(0, 7),
        };
      });
  },
};
