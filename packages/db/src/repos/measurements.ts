import type { Measurement, MeasurementInput, MeasurementSource } from '@rafter/types';
import { prisma } from '../client';

export const measurements = {
  /** Attach (or replace) the measurement for a job. One measurement per job. */
  async attach(
    tenantId: string,
    jobId: string,
    source: MeasurementSource,
    input: MeasurementInput,
    providerRef?: string,
    capturedAt?: Date,
  ): Promise<Measurement> {
    const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new Error('job not found');
    const at = capturedAt ?? new Date();
    const data = { tenantId, source, providerRef: providerRef ?? null, capturedAt: at, ...input };
    const m = await prisma.measurement.upsert({
      where: { jobId },
      create: { jobId, ...data },
      update: data,
    });
    return {
      id: m.id,
      jobId: m.jobId,
      source: m.source as MeasurementSource,
      providerRef: m.providerRef,
      capturedAt: m.capturedAt.toISOString(),
      roofAreaSqFt: m.roofAreaSqFt,
      pitchTwelfths: m.pitchTwelfths,
      stories: m.stories,
      facets: m.facets,
      ridgeHipLf: m.ridgeHipLf,
      valleyLf: m.valleyLf,
      eaveLf: m.eaveLf,
      rakeLf: m.rakeLf,
      flashingLf: m.flashingLf,
      penetrations: m.penetrations,
      existingLayers: m.existingLayers,
      deckingCondition: m.deckingCondition as Measurement['deckingCondition'],
    };
  },
};
