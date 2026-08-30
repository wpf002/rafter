import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  MeasurementInput,
  QuoteComputation,
  VarianceAttribution,
  VarianceReport,
} from '@rafter/types';

/** Phase 5/6 repo suite — skips entirely without DATABASE_URL (see CLAUDE.md). */
const hasDb = Boolean(process.env.DATABASE_URL);

type Db = typeof import('../src/index');

function comp(priceModelVersionId: string, asOf: string): QuoteComputation {
  return {
    priceModelVersionId,
    engineVersion: 'engine@test',
    asOf,
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

function measurement(roofAgeYears: number | null): MeasurementInput {
  return {
    roofAreaSqFt: 2430,
    pitchTwelfths: 8,
    stories: 2,
    facets: 12,
    ridgeHipLf: 80,
    valleyLf: 40,
    eaveLf: 130,
    rakeLf: 90,
    flashingLf: 30,
    penetrations: 10,
    existingLayers: 1,
    roofAgeYears,
    deckingCondition: 'UNKNOWN',
  };
}

/** VarianceReport consistent with comp()'s totals and the given attributions. */
function reportFor(attrs: VarianceAttribution[]): VarianceReport {
  const variance = attrs.reduce((a, x) => a + BigInt(x.amountCents), 0n);
  const actual = 627000n + variance;
  const byReason: Record<string, string> = {};
  for (const a of attrs) {
    byReason[a.reason] = (BigInt(byReason[a.reason] ?? '0') + BigInt(a.amountCents)).toString();
  }
  return {
    revenueCents: '741000',
    quotedCostCents: '627000',
    plannedMarginCents: '114000',
    plannedMarginBps: 1538,
    actualCostCents: actual.toString(),
    actualMarginCents: (741000n - actual).toString(),
    actualMarginBps: Number(((741000n - actual) * 10000n) / 741000n),
    varianceCents: variance.toString(),
    byReason: byReason as VarianceReport['byReason'],
    byCategory: { MATERIAL: actual.toString() },
    attributedCents: variance.toString(),
    unattributedCents: '0',
  };
}

describe.runIf(hasDb)('@rafter/db phase 5/6 repos', () => {
  let db: Db;
  let tenant1: string;
  let tenant2: string;
  let modelAId: string;
  let modelBId: string;
  let versionAId: string;
  let versionBId: string;
  let job1Id: string; // model A, closed 2026-04-15
  let job2Id: string; // model A, closed 2026-05-20
  let job3Id: string; // model B, closed 2026-05-01
  let job4Id: string; // model A, quoted only

  async function makeJob(n: number) {
    return db.jobs.create(tenant1, {
      name: `__t5 job ${n}`,
      address: `${n} Phase5 St, Testville, TS 00000`,
      customerName: 'Test Customer',
    });
  }

  async function closeJob(
    jobId: string,
    versionId: string,
    asOf: string,
    submittedAt: string,
    attrs: VarianceAttribution[],
    roofAgeYears: number | null,
  ) {
    await db.measurements.attach(
      tenant1,
      jobId,
      'MANUAL',
      measurement(roofAgeYears),
      undefined,
      new Date(asOf),
    );
    await db.quotes.issue(tenant1, jobId, comp(versionId, asOf));
    await db.jobs.transition(tenant1, jobId, 'SOLD');
    await db.jobs.transition(tenant1, jobId, 'IN_PROGRESS');
    await db.jobs.transition(tenant1, jobId, 'AWAITING_CLOSEOUT');
    const closeoutInput = {
      actualLines: [
        {
          description: 'All-in actuals',
          category: 'MATERIAL' as const,
          amountCents: reportFor(attrs).actualCostCents,
        },
      ],
      attributions: attrs,
    };
    await db.closeouts.submit(tenant1, jobId, closeoutInput, reportFor(attrs), new Date(submittedAt));
  }

  beforeAll(async () => {
    db = await import('../src/index');
    const t1 = await db.prisma.tenant.create({ data: { name: '__t5 tenant 1' } });
    const t2 = await db.prisma.tenant.create({ data: { name: '__t5 tenant 2' } });
    tenant1 = t1.id;
    tenant2 = t2.id;

    const modelA = await db.prisma.priceModel.create({
      data: { tenantId: tenant1, name: '__t5 model A' },
    });
    const modelB = await db.prisma.priceModel.create({
      data: { tenantId: tenant1, name: '__t5 model B' },
    });
    modelAId = modelA.id;
    modelBId = modelB.id;
    versionAId = (await db.priceModels.createVersion(tenant1, modelAId, db.baseRates())).id;
    versionBId = (await db.priceModels.createVersion(tenant1, modelBId, db.baseRates())).id;

    // Create job2 BEFORE job1 so tuningHistory ordering must come from
    // closeout.submittedAt, not insertion order.
    const j2 = await makeJob(2);
    job2Id = j2.id;
    await closeJob(
      job2Id,
      versionAId,
      '2026-04-05T00:00:00.000Z',
      '2026-05-20T00:00:00.000Z',
      [
        { reason: 'PRICING_ERROR', amountCents: '3000' },
        { reason: 'PRICING_ERROR', amountCents: '4000' },
        { reason: 'MEASUREMENT_ERROR', amountCents: '1000' },
      ],
      null,
    );

    const j1 = await makeJob(1);
    job1Id = j1.id;
    await closeJob(
      job1Id,
      versionAId,
      '2026-03-10T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
      [
        { reason: 'PRICING_ERROR', amountCents: '5000' },
        { reason: 'CONCEALED_CONDITION', amountCents: '3000', photoId: 'photo-evidence' },
      ],
      17,
    );

    const j3 = await makeJob(3);
    job3Id = j3.id;
    await closeJob(
      job3Id,
      versionBId,
      '2026-04-20T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      [{ reason: 'PRICING_ERROR', amountCents: '-2000' }],
      30,
    );

    const j4 = await makeJob(4);
    job4Id = j4.id;
    await db.measurements.attach(tenant1, job4Id, 'MANUAL', measurement(8));
    await db.quotes.issue(tenant1, job4Id, comp(versionAId, '2026-05-25T00:00:00.000Z'));
  });

  afterAll(async () => {
    const ids = [tenant1, tenant2].filter(Boolean);
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

  it('tuningHistory returns only the model’s closed jobs, oldest close first, with summed pricing error', async () => {
    const rows = await db.tuning.tuningHistory(tenant1, modelAId);
    expect(rows.map((r) => r.jobId)).toEqual([job1Id, job2Id]); // submittedAt asc
    expect(rows.map((r) => r.jobId)).not.toContain(job3Id); // other model
    expect(rows.map((r) => r.jobId)).not.toContain(job4Id); // not closed

    expect(rows[0]!.pricingErrorCents).toBe('5000');
    expect(rows[1]!.pricingErrorCents).toBe('7000'); // 3000 + 4000, MEASUREMENT_ERROR excluded
    expect(rows[0]!.closedAt).toBe('2026-04-15T00:00:00.000Z');
    expect(rows[0]!.lineItems).toEqual([
      { code: 'FIELD_SHINGLE', quantityX100: 2000, totalCents: '570000' },
    ]);
  });

  it('tuningHistory reports 0 pricing error when none was attributed, and is tenant-scoped', async () => {
    const other = await db.tuning.tuningHistory(tenant2, modelAId);
    expect(other).toEqual([]);

    const modelBRows = await db.tuning.tuningHistory(tenant1, modelBId);
    expect(modelBRows.map((r) => r.jobId)).toEqual([job3Id]);
    expect(modelBRows[0]!.pricingErrorCents).toBe('-2000');
  });

  it('recentQuotes returns newest-first quotes with the full measurement', async () => {
    const rows = await db.tuning.recentQuotes(tenant1, modelAId);
    expect(rows.map((r) => r.jobId)).toEqual([job4Id, job2Id, job1Id]);
    expect(rows[0]!.issuedAt).toBe('2026-05-25T00:00:00.000Z');
    expect(rows[0]!.totalCents).toBe('741000');
    expect(rows[0]!.priceModelVersionId).toBe(versionAId);
    expect(rows[2]!.measurement).toEqual(measurement(17));
    expect(rows[1]!.measurement.roofAgeYears).toBeNull();

    const capped = await db.tuning.recentQuotes(tenant1, modelAId, 2);
    expect(capped.map((r) => r.jobId)).toEqual([job4Id, job2Id]);
  });

  it('poolRecords is anonymized: opaque 12-hex tenant keys, never raw tenant ids (D10)', async () => {
    const records = await db.benchmark.poolRecords();
    expect(records.length).toBeGreaterThanOrEqual(3);
    for (const r of records) {
      expect(r.tenantKey).toMatch(/^[0-9a-f]{12}$/);
      expect(r.tenantKey).not.toBe(tenant1);
      expect(r.tenantKey).not.toBe(tenant2);
      expect((r as Record<string, unknown>)['tenantId']).toBeUndefined();
    }

    const key1 = createHash('sha256').update(tenant1).digest('hex').slice(0, 12);
    const mine = records.filter((r) => r.tenantKey === key1);
    expect(mine).toHaveLength(3); // job1, job2, job3

    const rec1 = mine.find((r) => r.quoteMonth === '2026-03')!;
    expect(rec1).toMatchObject({
      concealedCents: '3000',
      contractCents: '741000',
      squaresX100: 2430,
      pitchTwelfths: 8,
      existingLayers: 1,
      roofAgeYears: 17,
      quoteMonth: '2026-03',
      closeMonth: '2026-04',
    });
    // No concealed attribution → "0", and null roof age survives pooling.
    const rec2 = mine.find((r) => r.closeMonth === '2026-05' && r.roofAgeYears === null)!;
    expect(rec2.concealedCents).toBe('0');
  });

  it('gate: 10000 bps on an empty window, then closed/eligible with 80% remaining math', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(await db.benchmark.gate(tenant2, now)).toEqual({
      completionBps: 10000,
      remainingCount: 0,
    });

    const mk = (state: 'CLOSED' | 'AWAITING_CLOSEOUT' | 'QUOTED', daysAgo: number) =>
      db.prisma.job.create({
        // INSERTs bypass the close-gate trigger (it guards UPDATE OF state) —
        // fine here: these synthetic rows only exercise gate() counting.
        data: {
          tenantId: tenant2,
          name: `__t5 gate ${state} ${daysAgo}`,
          address: '1 Gate St',
          customerName: 'Gate Test',
          state,
          createdAt: new Date(now.getTime() - daysAgo * 86_400_000),
        },
      });

    await mk('CLOSED', 60);
    await mk('CLOSED', 55);
    await mk('CLOSED', 50);
    await mk('AWAITING_CLOSEOUT', 45);
    await mk('AWAITING_CLOSEOUT', 10); // too recent — not eligible
    await mk('QUOTED', 60); // never reached closeout — not eligible

    // eligible 4, closed 3 → 7500 bps; ceil(0.8×4)=4 → 1 more close needed
    expect(await db.benchmark.gate(tenant2, now)).toEqual({
      completionBps: 7500,
      remainingCount: 1,
    });

    await mk('CLOSED', 40);
    // eligible 5, closed 4 → 8000 bps, remaining 0
    expect(await db.benchmark.gate(tenant2, now)).toEqual({
      completionBps: 8000,
      remainingCount: 0,
    });

    // gate is tenant-scoped: tenant1's own history (3 closed, 0 awaiting once
    // aged past 30 days) is untouched by tenant2's synthetic jobs.
    const later = new Date(Date.now() + 40 * 86_400_000);
    const t1 = await db.benchmark.gate(tenant1, later);
    expect(t1).toEqual({ completionBps: 10000, remainingCount: 0 });
  });
});
