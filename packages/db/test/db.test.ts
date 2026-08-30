import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloseoutInput, JobSummary, QuoteComputation, VarianceReport } from '@rafter/types';

/** Integration suite — skips entirely without DATABASE_URL (see CLAUDE.md). */
const hasDb = Boolean(process.env.DATABASE_URL);

type Db = typeof import('../src/index');

function comp(priceModelVersionId: string): QuoteComputation {
  return {
    priceModelVersionId,
    engineVersion: 'engine@test',
    asOf: '2026-06-10T00:00:00.000Z',
    lineItems: [
      {
        code: 'FIELD_SHINGLE',
        description: 'Field shingle',
        unit: 'SQ',
        quantityX100: 2000,
        unitRateCents: '28500',
        netMultiplierBps: 10000,
        totalCents: '570000',
        factors: [
          { kind: 'RATE', label: 'Field rate', value: '$285.00/SQ', ruleVersion: 'test@1' },
        ],
      },
    ],
    subtotalCents: '570000',
    overheadCents: '57000',
    marginCents: '114000',
    totalCents: '741000',
  };
}

describe.runIf(hasDb)('@rafter/db integration', () => {
  let db: Db;
  let tenantAId: string;
  let tenantBId: string;
  let versionId: string;
  let jobA: JobSummary;

  const newJob = (n: number) => ({
    name: `__test job ${n}`,
    address: `${n} Test St, Testville, TS 00000`,
    customerName: 'Test Customer',
  });

  beforeAll(async () => {
    db = await import('../src/index');
    const a = await db.prisma.tenant.create({ data: { name: '__test tenant A' } });
    const b = await db.prisma.tenant.create({ data: { name: '__test tenant B' } });
    tenantAId = a.id;
    tenantBId = b.id;
    const model = await db.prisma.priceModel.create({
      data: { tenantId: tenantAId, name: '__test model' },
    });
    const version = await db.priceModels.createVersion(tenantAId, model.id, db.baseRates());
    versionId = version.id;
    jobA = await db.jobs.create(tenantAId, newJob(1));
  });

  afterAll(async () => {
    // Scoped wipe of throwaway tenants; immutability triggers bypassed for cleanup only.
    const ids = [tenantAId, tenantBId].filter(Boolean);
    await db.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const scope = { where: { tenantId: { in: ids } } };
      await tx.event.deleteMany(scope);
      await tx.varianceRecord.deleteMany(scope);
      await tx.closeoutLineItem.deleteMany(scope);
      await tx.closeout.deleteMany(scope);
      await tx.quoteLineItem.deleteMany(scope);
      await tx.quote.deleteMany(scope);
      await tx.photo.deleteMany(scope);
      await tx.measurement.deleteMany(scope);
      await tx.job.deleteMany(scope);
      await tx.priceModelVersion.deleteMany(scope);
      await tx.priceModel.deleteMany(scope);
      await tx.user.deleteMany(scope);
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    await db.prisma.$disconnect();
  });

  it('never leaks jobs across tenants', async () => {
    const listB = await db.jobs.list(tenantBId);
    expect(listB).toHaveLength(0);
    expect(listB.find((j) => j.id === jobA.id)).toBeUndefined();

    const listA = await db.jobs.list(tenantAId);
    expect(listA.some((j) => j.id === jobA.id)).toBe(true);

    expect(await db.jobs.get(tenantBId, jobA.id)).toBeNull();
    expect((await db.jobs.get(tenantAId, jobA.id))?.id).toBe(jobA.id);
  });

  it('DB rejects CLOSED without a closeout (D6) — even via raw update', async () => {
    await expect(
      db.prisma.job.update({ where: { id: jobA.id }, data: { state: 'CLOSED' } }),
    ).rejects.toThrow(/cannot close/);
    const still = await db.prisma.job.findUniqueOrThrow({ where: { id: jobA.id } });
    expect(still.state).toBe('DRAFT');
  });

  it('issued quotes are immutable (D3) — trigger rejects UPDATE', async () => {
    const jobQ = await db.jobs.create(tenantAId, newJob(2));
    await db.quotes.issue(tenantAId, jobQ.id, comp(versionId));

    await expect(
      db.prisma.quote.update({
        where: { jobId: jobQ.id },
        data: { engineVersion: 'tampered' },
      }),
    ).rejects.toThrow(/immutable/);

    const line = await db.prisma.quoteLineItem.findFirstOrThrow({
      where: { tenantId: tenantAId },
    });
    await expect(
      db.prisma.quoteLineItem.update({
        where: { id: line.id },
        data: { description: 'tampered' },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it('events are append-only — trigger rejects UPDATE', async () => {
    const ev = await db.prisma.event.findFirstOrThrow({
      where: { tenantId: tenantAId, kind: 'JOB_CREATED' },
    });
    await expect(
      db.prisma.event.update({ where: { id: ev.id }, data: { kind: 'REWRITTEN' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.prisma.event.delete({ where: { id: ev.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('CHECK rejects CONCEALED_CONDITION attribution without a photo (D7)', async () => {
    const jobV = await db.jobs.create(tenantAId, newJob(3));
    const closeout = await db.prisma.closeout.create({
      data: {
        jobId: jobV.id,
        tenantId: tenantAId,
        submittedAt: new Date('2026-06-20T00:00:00.000Z'),
        actualCostCents: 0n,
        varianceCents: 0n,
        attributedCents: 0n,
        unattributedCents: 0n,
      },
    });
    await expect(
      db.prisma.varianceRecord.create({
        data: {
          closeoutId: closeout.id,
          tenantId: tenantAId,
          reason: 'CONCEALED_CONDITION',
          amountCents: 12345n,
          photoId: null,
        },
      }),
    ).rejects.toThrow();
    // photo present → allowed; other reasons need no photo
    await db.prisma.varianceRecord.create({
      data: {
        closeoutId: closeout.id,
        tenantId: tenantAId,
        reason: 'CONCEALED_CONDITION',
        amountCents: 12345n,
        photoId: 'photo-ref',
      },
    });
    await db.prisma.varianceRecord.create({
      data: {
        closeoutId: closeout.id,
        tenantId: tenantAId,
        reason: 'MEASUREMENT_ERROR',
        amountCents: -500n,
        photoId: null,
      },
    });
  });

  it('jobs.transition guards legality and never closes', async () => {
    const jobT = await db.jobs.create(tenantAId, newJob(4));
    await expect(db.jobs.transition(tenantAId, jobT.id, 'SOLD')).rejects.toThrow(
      /illegal transition/,
    );
    await expect(db.jobs.transition(tenantAId, jobT.id, 'CLOSED')).rejects.toThrow(/CLOSED/);
    // cross-tenant transition is also invisible
    await expect(db.jobs.transition(tenantBId, jobT.id, 'QUOTED')).rejects.toThrow(/not found/);
  });

  it('a complete closeout closes the job through the real trigger', async () => {
    const jobC = await db.jobs.create(tenantAId, newJob(5));
    await db.quotes.issue(tenantAId, jobC.id, comp(versionId));
    await db.jobs.transition(tenantAId, jobC.id, 'SOLD');
    await db.jobs.transition(tenantAId, jobC.id, 'IN_PROGRESS');
    await db.jobs.transition(tenantAId, jobC.id, 'AWAITING_CLOSEOUT');

    const closeoutInput: CloseoutInput = {
      actualLines: [{ description: 'All-in actuals', category: 'MATERIAL', amountCents: '650000' }],
      attributions: [{ reason: 'MEASUREMENT_ERROR', amountCents: '23000', note: 'test' }],
    };
    const report: VarianceReport = {
      revenueCents: '741000',
      quotedCostCents: '627000',
      plannedMarginCents: '114000',
      plannedMarginBps: 1538,
      actualCostCents: '650000',
      actualMarginCents: '91000',
      actualMarginBps: 1228,
      varianceCents: '23000',
      byReason: { MEASUREMENT_ERROR: '23000' },
      byCategory: { MATERIAL: '650000' },
      attributedCents: '23000',
      unattributedCents: '0',
    };
    await db.closeouts.submit(
      tenantAId,
      jobC.id,
      closeoutInput,
      report,
      new Date('2026-06-25T00:00:00.000Z'),
    );

    const closed = await db.jobs.get(tenantAId, jobC.id);
    expect(closed?.state).toBe('CLOSED');
    expect(closed?.closeout?.unattributedCents).toBe('0');

    const summary = (await db.jobs.list(tenantAId)).find((j) => j.id === jobC.id);
    // (741000 − 650000) × 10000 / 741000 = 1228 bps, pure bigint math
    expect(summary?.actualMarginBps).toBe(1228);
  });

  it('dashboard.metrics takes `now` as a parameter', async () => {
    const m = await db.dashboard.metrics(tenantAId, new Date('2026-06-15T00:00:00.000Z'));
    const totalJobs = Object.values(m.jobsByState).reduce((a, b) => a + b, 0);
    expect(totalJobs).toBe((await db.jobs.list(tenantAId)).length);
    // both test quotes issued 2026-06-10 → in June window: 741000 × 2
    expect(m.quotedThisMonthCents).toBe('1482000');
    const outside = await db.dashboard.metrics(tenantAId, new Date('2026-09-15T00:00:00.000Z'));
    expect(outside.quotedThisMonthCents).toBe('0');
  });
});
