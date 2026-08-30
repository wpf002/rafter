import {
  JOB_TRANSITIONS,
  type Closeout,
  type ComputedLineItem,
  type JobEvent,
  type JobState,
  type JobSummary,
  type LineItemCode,
  type Factor,
  type Measurement,
  type MeasurementSource,
  type MoneyString,
  type PhotoSummary,
  type Quote,
  type Unit,
  fromMoney,
} from '@rafter/types';
import { prisma } from '../client';

/** actualMarginBps = (revenue − actualCost) / revenue, in bps. Pure bigint math (D1). */
export function marginBps(revenueCents: bigint, actualCostCents: bigint): number {
  return Number(((revenueCents - actualCostCents) * 10000n) / revenueCents);
}

export interface JobGraph {
  id: string;
  name: string;
  address: string;
  customerName: string;
  state: JobState;
  createdAt: string;
  measurement: Measurement | null;
  quote: Quote | null;
  closeout:
    | (Closeout & {
        actualCostCents: MoneyString;
        varianceCents: MoneyString;
        attributedCents: MoneyString;
        unattributedCents: MoneyString;
      })
    | null;
  photos: PhotoSummary[];
  events: JobEvent[];
}

export const jobs = {
  async list(tenantId: string, state?: JobState): Promise<JobSummary[]> {
    const rows = await prisma.job.findMany({
      where: { tenantId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        quote: { select: { totalCents: true } },
        closeout: { select: { actualCostCents: true } },
      },
    });
    return rows.map((j) => ({
      id: j.id,
      name: j.name,
      address: j.address,
      customerName: j.customerName,
      state: j.state,
      quotedTotalCents: j.quote ? fromMoney(j.quote.totalCents) : null,
      actualMarginBps:
        j.state === 'CLOSED' && j.quote && j.closeout
          ? marginBps(j.quote.totalCents, j.closeout.actualCostCents)
          : null,
      createdAt: j.createdAt.toISOString(),
    }));
  },

  async create(
    tenantId: string,
    data: { name: string; address: string; customerName: string },
  ): Promise<JobSummary> {
    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.job.create({ data: { tenantId, ...data } });
      await tx.event.create({
        data: {
          jobId: j.id,
          tenantId,
          kind: 'JOB_CREATED',
          payload: { name: j.name },
        },
      });
      return j;
    });
    return {
      id: job.id,
      name: job.name,
      address: job.address,
      customerName: job.customerName,
      state: job.state,
      quotedTotalCents: null,
      actualMarginBps: null,
      createdAt: job.createdAt.toISOString(),
    };
  },

  async get(tenantId: string, id: string): Promise<JobGraph | null> {
    const j = await prisma.job.findFirst({
      where: { id, tenantId },
      include: {
        measurement: true,
        quote: { include: { lineItems: { orderBy: { idx: 'asc' } } } },
        closeout: { include: { lines: true, attributions: true } },
        photos: {
          select: { id: true, jobId: true, filename: true, exifTakenAt: true, uploadedAt: true },
        },
        events: { orderBy: { at: 'desc' } },
      },
    });
    if (!j) return null;

    return {
      id: j.id,
      name: j.name,
      address: j.address,
      customerName: j.customerName,
      state: j.state,
      createdAt: j.createdAt.toISOString(),
      measurement: j.measurement
        ? {
            id: j.measurement.id,
            jobId: j.measurement.jobId,
            source: j.measurement.source as MeasurementSource,
            providerRef: j.measurement.providerRef,
            capturedAt: j.measurement.capturedAt.toISOString(),
            roofAreaSqFt: j.measurement.roofAreaSqFt,
            pitchTwelfths: j.measurement.pitchTwelfths,
            stories: j.measurement.stories,
            facets: j.measurement.facets,
            ridgeHipLf: j.measurement.ridgeHipLf,
            valleyLf: j.measurement.valleyLf,
            eaveLf: j.measurement.eaveLf,
            rakeLf: j.measurement.rakeLf,
            flashingLf: j.measurement.flashingLf,
            penetrations: j.measurement.penetrations,
            existingLayers: j.measurement.existingLayers,
            roofAgeYears: j.measurement.roofAgeYears,
            deckingCondition: j.measurement.deckingCondition as Measurement['deckingCondition'],
          }
        : null,
      quote: j.quote
        ? {
            id: j.quote.id,
            jobId: j.quote.jobId,
            priceModelVersionId: j.quote.priceModelVersionId,
            engineVersion: j.quote.engineVersion,
            asOf: j.quote.asOf.toISOString(),
            issuedAt: j.quote.issuedAt.toISOString(),
            subtotalCents: fromMoney(j.quote.subtotalCents),
            overheadCents: fromMoney(j.quote.overheadCents),
            marginCents: fromMoney(j.quote.marginCents),
            totalCents: fromMoney(j.quote.totalCents),
            lineItems: j.quote.lineItems.map(
              (li): ComputedLineItem => ({
                code: li.code as LineItemCode,
                description: li.description,
                unit: li.unit as Unit,
                quantityX100: li.quantityX100,
                unitRateCents: fromMoney(li.unitRateCents),
                netMultiplierBps: li.netMultiplierBps,
                totalCents: fromMoney(li.totalCents),
                factors: li.factors as Factor[],
              }),
            ),
          }
        : null,
      closeout: j.closeout
        ? {
            id: j.closeout.id,
            jobId: j.closeout.jobId,
            submittedAt: j.closeout.submittedAt.toISOString(),
            actualCostCents: fromMoney(j.closeout.actualCostCents),
            varianceCents: fromMoney(j.closeout.varianceCents),
            attributedCents: fromMoney(j.closeout.attributedCents),
            unattributedCents: fromMoney(j.closeout.unattributedCents),
            actualLines: j.closeout.lines.map((l) => ({
              description: l.description,
              category: l.category as Closeout['actualLines'][number]['category'],
              amountCents: fromMoney(l.amountCents),
            })),
            attributions: j.closeout.attributions.map((a) => ({
              reason: a.reason as Closeout['attributions'][number]['reason'],
              amountCents: fromMoney(a.amountCents),
              note: a.note ?? undefined,
              photoId: a.photoId ?? undefined,
            })),
          }
        : null,
      photos: j.photos.map((p) => ({
        id: p.id,
        jobId: p.jobId,
        filename: p.filename,
        exifTakenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
        uploadedAt: p.uploadedAt.toISOString(),
      })),
      events: j.events.map((e) => ({
        id: e.id,
        jobId: e.jobId,
        kind: e.kind,
        payload: e.payload as Record<string, unknown>,
        at: e.at.toISOString(),
      })),
    };
  },

  /**
   * Guarded state transition. CLOSED is NEVER reachable here — only
   * closeouts.submit may close a job, and Postgres enforces the gate (D6/D7).
   */
  async transition(tenantId: string, id: string, to: JobState): Promise<JobSummary> {
    if (to === 'CLOSED') {
      throw new Error('CLOSED is only reachable via closeout submission');
    }
    const job = await prisma.job.findFirst({ where: { id, tenantId } });
    if (!job) throw new Error('job not found');
    if (!JOB_TRANSITIONS[job.state].includes(to)) {
      throw new Error(`illegal transition ${job.state} -> ${to}`);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.job.update({ where: { id: job.id }, data: { state: to } });
      await tx.event.create({
        data: {
          jobId: job.id,
          tenantId,
          kind: 'STATE_CHANGED',
          payload: { from: job.state, to },
        },
      });
      return u;
    });
    return {
      id: updated.id,
      name: updated.name,
      address: updated.address,
      customerName: updated.customerName,
      state: updated.state,
      quotedTotalCents: null,
      actualMarginBps: null,
      createdAt: updated.createdAt.toISOString(),
    };
  },
};
