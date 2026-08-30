import {
  fromMoney,
  type LineItemCode,
  type MeasurementInput,
  type MoneyString,
  type TuningJobRecord,
} from '@rafter/types';
import { prisma } from '../client';

/**
 * Phase 5 data access. Tuning is deterministic arithmetic on the tenant's OWN
 * closed jobs — these queries are always tenant-scoped and never pooled.
 */
export const tuning = {
  /**
   * CLOSED jobs whose quote was issued from any version of `modelId`,
   * ordered by closeout submission (oldest first) — the tuning window.
   */
  async tuningHistory(
    tenantId: string,
    modelId: string,
    limit = 50,
  ): Promise<TuningJobRecord[]> {
    const rows = await prisma.job.findMany({
      where: {
        tenantId,
        state: 'CLOSED',
        quote: { priceModelVersion: { priceModelId: modelId } },
        closeout: { isNot: null },
      },
      include: {
        quote: {
          include: { lineItems: { orderBy: { idx: 'asc' } } },
        },
        closeout: { include: { attributions: true } },
      },
      orderBy: { closeout: { submittedAt: 'asc' } },
      take: limit,
    });

    return rows
      .filter((j) => j.quote !== null && j.closeout !== null)
      .map((j) => {
        let pricingError = 0n;
        for (const a of j.closeout!.attributions) {
          if (a.reason === 'PRICING_ERROR') pricingError += a.amountCents;
        }
        return {
          jobId: j.id,
          closedAt: j.closeout!.submittedAt.toISOString(),
          lineItems: j.quote!.lineItems.map((li) => ({
            code: li.code as LineItemCode,
            quantityX100: li.quantityX100,
            totalCents: fromMoney(li.totalCents),
          })),
          pricingErrorCents: fromMoney(pricingError),
        };
      });
  },

  /**
   * Most recent quotes issued from any version of `modelId` (jobs with a
   * measurement only) — the replay set for previewing tuned rates.
   */
  async recentQuotes(
    tenantId: string,
    modelId: string,
    limit = 20,
  ): Promise<
    {
      jobId: string;
      jobName: string;
      issuedAt: string;
      asOf: string;
      totalCents: MoneyString;
      measurement: MeasurementInput;
      priceModelVersionId: string;
    }[]
  > {
    const rows = await prisma.job.findMany({
      where: {
        tenantId,
        quote: { priceModelVersion: { priceModelId: modelId } },
        measurement: { isNot: null },
      },
      include: { quote: true, measurement: true },
      orderBy: { quote: { issuedAt: 'desc' } },
      take: limit,
    });

    return rows
      .filter((j) => j.quote !== null && j.measurement !== null)
      .map((j) => ({
        jobId: j.id,
        jobName: j.name,
        issuedAt: j.quote!.issuedAt.toISOString(),
        asOf: j.quote!.asOf.toISOString(),
        totalCents: fromMoney(j.quote!.totalCents),
        measurement: {
          roofAreaSqFt: j.measurement!.roofAreaSqFt,
          pitchTwelfths: j.measurement!.pitchTwelfths,
          stories: j.measurement!.stories,
          facets: j.measurement!.facets,
          ridgeHipLf: j.measurement!.ridgeHipLf,
          valleyLf: j.measurement!.valleyLf,
          eaveLf: j.measurement!.eaveLf,
          rakeLf: j.measurement!.rakeLf,
          flashingLf: j.measurement!.flashingLf,
          penetrations: j.measurement!.penetrations,
          existingLayers: j.measurement!.existingLayers,
          roofAgeYears: j.measurement!.roofAgeYears,
          deckingCondition: j.measurement!
            .deckingCondition as MeasurementInput['deckingCondition'],
        },
        priceModelVersionId: j.quote!.priceModelVersionId,
      }));
  },
};
