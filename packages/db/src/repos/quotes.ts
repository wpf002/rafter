import type { Prisma } from '@prisma/client';
import { toMoney, type QuoteComputation } from '@rafter/types';
import { prisma } from '../client';

export const quotes = {
  /**
   * Persist an engine-computed quote (D2: the engine computed it with an
   * explicit asOf; the DB only stores). Transactionally inserts the quote and
   * its line items, moves the job DRAFT -> QUOTED, and records QUOTE_ISSUED.
   * Once inserted the rows are immutable (Postgres trigger, D3).
   */
  async issue(tenantId: string, jobId: string, computation: QuoteComputation) {
    const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new Error('job not found');
    if (job.state !== 'DRAFT') {
      throw new Error(`quote can only be issued from DRAFT (job is ${job.state})`);
    }

    const issuedAt = new Date(computation.asOf);
    return prisma.$transaction(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          jobId,
          tenantId,
          priceModelVersionId: computation.priceModelVersionId,
          engineVersion: computation.engineVersion,
          asOf: new Date(computation.asOf),
          issuedAt,
          subtotalCents: toMoney(computation.subtotalCents),
          overheadCents: toMoney(computation.overheadCents),
          marginCents: toMoney(computation.marginCents),
          totalCents: toMoney(computation.totalCents),
          lineItems: {
            create: computation.lineItems.map((li, idx) => ({
              tenantId,
              idx,
              code: li.code,
              description: li.description,
              unit: li.unit,
              quantityX100: li.quantityX100,
              unitRateCents: toMoney(li.unitRateCents),
              netMultiplierBps: li.netMultiplierBps,
              totalCents: toMoney(li.totalCents),
              factors: li.factors as unknown as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await tx.job.update({ where: { id: jobId }, data: { state: 'QUOTED' } });
      await tx.event.create({
        data: {
          jobId,
          tenantId,
          kind: 'QUOTE_ISSUED',
          payload: { quoteId: quote.id, totalCents: computation.totalCents },
          at: issuedAt,
        },
      });
      return quote;
    });
  },
};
