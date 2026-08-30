import { toMoney, type CloseoutInput, type VarianceReport } from '@rafter/types';
import { prisma } from '../client';

export const closeouts = {
  /**
   * Submit the closeout and close the job in one transaction.
   * The CLOSED transition happens via a raw UPDATE so the Postgres
   * job_close_gate trigger is the authority (D6/D7) — a closeout row with
   * unattributedCents = 0 must exist or the whole transaction rolls back.
   */
  async submit(
    tenantId: string,
    jobId: string,
    closeout: CloseoutInput,
    report: VarianceReport,
    submittedAt?: Date,
  ) {
    const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new Error('job not found');
    if (job.state !== 'AWAITING_CLOSEOUT') {
      throw new Error(`closeout can only be submitted from AWAITING_CLOSEOUT (job is ${job.state})`);
    }

    const at = submittedAt ?? new Date();
    return prisma.$transaction(async (tx) => {
      const created = await tx.closeout.create({
        data: {
          jobId,
          tenantId,
          submittedAt: at,
          actualCostCents: toMoney(report.actualCostCents),
          varianceCents: toMoney(report.varianceCents),
          attributedCents: toMoney(report.attributedCents),
          unattributedCents: toMoney(report.unattributedCents),
          lines: {
            create: closeout.actualLines.map((l) => ({
              tenantId,
              description: l.description,
              category: l.category,
              amountCents: toMoney(l.amountCents),
            })),
          },
          attributions: {
            create: closeout.attributions.map((a) => ({
              tenantId,
              reason: a.reason,
              amountCents: toMoney(a.amountCents),
              note: a.note ?? null,
              photoId: a.photoId ?? null,
            })),
          },
        },
      });

      // The DB trigger validates completeness; this must not bypass it.
      await tx.$executeRaw`UPDATE "Job" SET "state" = 'CLOSED', "updatedAt" = now() WHERE "id" = ${jobId} AND "tenantId" = ${tenantId}`;

      await tx.event.create({
        data: {
          jobId,
          tenantId,
          kind: 'CLOSEOUT_SUBMITTED',
          payload: {
            closeoutId: created.id,
            actualCostCents: report.actualCostCents,
            varianceCents: report.varianceCents,
          },
          at,
        },
      });
      return created;
    });
  },
};
