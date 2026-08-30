import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  BenchmarkResponse,
  JobDetail,
  JobSummary,
  MeasurementInput,
  PriceModel,
  PriceModelVersion,
  Quote,
  StratumResult,
  TenantSummary,
  TuningResponse,
} from '@rafter/types';

/** Integration suite — skips entirely without DATABASE_URL (see CLAUDE.md). */
const hasDb = Boolean(process.env.DATABASE_URL);

const MEASUREMENT: MeasurementInput = {
  roofAreaSqFt: 2400,
  pitchTwelfths: 6,
  stories: 1,
  facets: 8,
  ridgeHipLf: 60,
  valleyLf: 20,
  eaveLf: 140,
  rakeLf: 80,
  flashingLf: 24,
  penetrations: 7,
  existingLayers: 1,
  roofAgeYears: 17,
  deckingCondition: 'GOOD',
};

describe.skipIf(!hasDb)('@rafter/api integration', () => {
  let app: FastifyInstance;
  let db: typeof import('@rafter/db');
  let tenantId: string;
  let versionId: string;
  let jobId: string;
  let quote: Quote;
  let photoId: string;
  let summitId: string;
  let lowCompletionId: string;
  let standardModel: PriceModel;
  let tuningBefore: TuningResponse;
  let acceptedVersionId: string | undefined;

  const inject = (opts: {
    method: 'GET' | 'POST';
    url: string;
    payload?: unknown;
    tenant?: string | false;
  }) =>
    app.inject({
      method: opts.method,
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: opts.tenant === false ? {} : { 'x-tenant-id': opts.tenant ?? tenantId },
    });

  beforeAll(async () => {
    db = await import('@rafter/db');
    const { buildServer } = await import('../src/server');
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    // Scoped wipe of the throwaway job; triggers bypassed for cleanup only.
    if (db && jobId) {
      await db.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const closeout = await tx.closeout.findUnique({ where: { jobId } });
        if (closeout) {
          await tx.varianceRecord.deleteMany({ where: { closeoutId: closeout.id } });
          await tx.closeoutLineItem.deleteMany({ where: { closeoutId: closeout.id } });
          await tx.closeout.delete({ where: { id: closeout.id } });
        }
        const q = await tx.quote.findUnique({ where: { jobId } });
        if (q) {
          await tx.quoteLineItem.deleteMany({ where: { quoteId: q.id } });
          await tx.quote.delete({ where: { id: q.id } });
        }
        await tx.photo.deleteMany({ where: { jobId } });
        await tx.measurement.deleteMany({ where: { jobId } });
        await tx.event.deleteMany({ where: { jobId } });
        await tx.job.delete({ where: { id: jobId } });
      });
    }
    if (db && acceptedVersionId) {
      await db.prisma.priceModelVersion.delete({ where: { id: acceptedVersionId } });
    }
    if (app) await app.close();
    if (db) await db.prisma.$disconnect();
  });

  it('GET /health responds without a tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects missing and unknown tenants with 401', async () => {
    const missing = await inject({ method: 'GET', url: '/api/jobs', tenant: false });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: 'unknown tenant' });

    const bogus = await inject({ method: 'GET', url: '/api/jobs', tenant: 'not-a-tenant' });
    expect(bogus.statusCode).toBe(401);
  });

  it('lists seeded tenants', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tenants' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as TenantSummary[];
    expect(list.length).toBeGreaterThan(0);
    tenantId = list[0]!.id;
  });

  it('rejects an invalid job body with 400 validation', async () => {
    const res = await inject({ method: 'POST', url: '/api/jobs', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });

  it('creates a fresh job (never mutates seed jobs)', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        name: '__api test job',
        address: '12 Integration Way, Testville, TS 00000',
        customerName: 'API Test Customer',
      },
    });
    expect(res.statusCode).toBe(201);
    const job = res.json() as JobSummary;
    expect(job.state).toBe('DRAFT');
    jobId = job.id;
  });

  it('attaches a MANUAL measurement', async () => {
    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/measurement`,
      payload: { source: 'MANUAL', input: MEASUREMENT },
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.source).toBe('MANUAL');
    expect(m.roofAreaSqFt).toBe(MEASUREMENT.roofAreaSqFt);
    expect(m.roofAgeYears).toBe(17);
  });

  it('issues a quote whose line items sum exactly to the total, all with factors', async () => {
    const modelsRes = await inject({ method: 'GET', url: '/api/price-models' });
    expect(modelsRes.statusCode).toBe(200);
    const models = modelsRes.json() as PriceModel[];
    const withVersion = models.find((m) => m.currentVersion);
    expect(withVersion).toBeDefined();
    versionId = withVersion!.currentVersion!.id;

    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/quote`,
      payload: { priceModelVersionId: versionId },
    });
    expect(res.statusCode).toBe(201);
    quote = res.json() as Quote;
    expect(quote.priceModelVersionId).toBe(versionId);

    const lineSum = quote.lineItems.reduce((acc, li) => acc + BigInt(li.totalCents), 0n);
    expect(lineSum).toBe(BigInt(quote.totalCents));
    expect(quote.lineItems.length).toBeGreaterThan(0);
    for (const li of quote.lineItems) {
      expect(li.factors.length).toBeGreaterThan(0);
    }
  });

  it('quote-preview computes the same totals without persisting', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/quote-preview',
      payload: { measurement: MEASUREMENT, priceModelVersionId: versionId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalCents).toBe(quote.totalCents);
  });

  it('walks the legal transitions and rejects direct CLOSED', async () => {
    for (const to of ['SOLD', 'IN_PROGRESS', 'AWAITING_CLOSEOUT'] as const) {
      const res = await inject({
        method: 'POST',
        url: `/api/jobs/${jobId}/transition`,
        payload: { to },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as JobSummary).state).toBe(to);
    }
    const closed = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/transition`,
      payload: { to: 'CLOSED' },
    });
    expect(closed.statusCode).toBe(422);
    expect(closed.json().error).toBe('jobs close via closeout submission');
  });

  it('blocks closeout with an unattributed remainder, naming the amount', async () => {
    const quotedCost = BigInt(quote.subtotalCents) + BigInt(quote.overheadCents);
    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/closeout`,
      payload: {
        actualLines: [
          {
            description: 'All-in actuals',
            category: 'MATERIAL',
            amountCents: (quotedCost + 50000n).toString(),
          },
        ],
        attributions: [{ reason: 'CUSTOMER_SCOPE_CHANGE', amountCents: '20000' }],
      },
    });
    expect(res.statusCode).toBe(422);
    // remainder = 50000 - 20000 = 30000 cents
    expect(res.json().error).toContain('$300.00');
  });

  it('blocks a fully attributed closeout when CONCEALED_CONDITION lacks a photo', async () => {
    const quotedCost = BigInt(quote.subtotalCents) + BigInt(quote.overheadCents);
    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/closeout`,
      payload: {
        actualLines: [
          {
            description: 'All-in actuals',
            category: 'MATERIAL',
            amountCents: (quotedCost + 50000n).toString(),
          },
        ],
        attributions: [
          { reason: 'CUSTOMER_SCOPE_CHANGE', amountCents: '20000' },
          { reason: 'CONCEALED_CONDITION', amountCents: '30000', note: 'rotten decking' },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/photo/i);
  });

  it('uploads a photo and serves the raw bytes back', async () => {
    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/photos`,
      payload: { filename: 'rotten-decking.png', dataBase64: db.TINY_PNG.toString('base64') },
    });
    expect(res.statusCode).toBe(201);
    const photo = res.json();
    expect(photo.exifTakenAt).toBeNull();
    photoId = photo.id;

    const raw = await inject({ method: 'GET', url: `/api/jobs/${jobId}/photos/${photoId}` });
    expect(raw.statusCode).toBe(200);
    expect(raw.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(raw.rawPayload, db.TINY_PNG)).toBe(0);
  });

  it('closes the job via a complete closeout with photo evidence', async () => {
    const quotedCost = BigInt(quote.subtotalCents) + BigInt(quote.overheadCents);
    const res = await inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/closeout`,
      payload: {
        actualLines: [
          {
            description: 'All-in actuals',
            category: 'MATERIAL',
            amountCents: (quotedCost + 50000n).toString(),
          },
        ],
        attributions: [
          { reason: 'CUSTOMER_SCOPE_CHANGE', amountCents: '20000' },
          {
            reason: 'CONCEALED_CONDITION',
            amountCents: '30000',
            note: 'rotten decking',
            photoId,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.report.unattributedCents).toBe('0');
    expect(body.report.varianceCents).toBe('50000');
    expect(body.closeout.jobId).toBe(jobId);
  });

  it('job detail shows CLOSED state and the variance report', async () => {
    const res = await inject({ method: 'GET', url: `/api/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as JobDetail;
    expect(detail.state).toBe('CLOSED');
    expect(detail.closeout).not.toBeNull();
    expect(detail.variance).not.toBeNull();
    expect(detail.variance!.unattributedCents).toBe('0');
    expect(detail.variance!.varianceCents).toBe('50000');
    expect(detail.variance!.byReason.CONCEALED_CONDITION).toBe('30000');
    expect(detail.photos.length).toBe(1);
    expect(detail.measurement!.roofAgeYears).toBe(17);
  });

  it('serves dashboard metrics and ingest drafts', async () => {
    const dash = await inject({ method: 'GET', url: '/api/dashboard' });
    expect(dash.statusCode).toBe(200);
    expect(dash.json().jobsByState).toHaveProperty('CLOSED');

    const ingest = await inject({
      method: 'POST',
      url: '/api/ingest/invoice',
      payload: { text: 'Architectural shingles $1,234.56\nLabor crew 500' },
    });
    expect(ingest.statusCode).toBe(200);
    const draft = ingest.json();
    expect(draft.provider).toBe('stub');
    expect(draft.draftLines).toEqual([
      { description: 'Architectural shingles', category: 'MATERIAL', amountCents: '123456' },
      { description: 'Labor crew', category: 'LABOR', amountCents: '50000' },
    ]);
  });

  /* ---------------- Phase 5 — auto-tune ---------------- */

  it('tuning 404s for a model belonging to another tenant', async () => {
    const tenantsRes = await app.inject({ method: 'GET', url: '/api/tenants' });
    const list = tenantsRes.json() as TenantSummary[];
    summitId = list.find((t) => t.name === 'Summit Roofing')!.id;
    lowCompletionId = list.find((t) => t.name === 'Blue Ridge Exteriors')!.id;

    const modelsRes = await inject({
      method: 'GET',
      url: '/api/price-models',
      tenant: summitId,
    });
    const models = modelsRes.json() as PriceModel[];
    standardModel = models.find((m) => m.name === 'Standard Asphalt')!;
    expect(standardModel).toBeDefined();

    const wrongTenant = await inject({
      method: 'GET',
      url: `/api/price-models/${standardModel.id}/tuning`,
      tenant: lowCompletionId,
    });
    expect(wrongTenant.statusCode).toBe(404);
  });

  it('computes a tuning report whose replay deltas are exact bigint differences', async () => {
    const res = await inject({
      method: 'GET',
      url: `/api/price-models/${standardModel.id}/tuning`,
      tenant: summitId,
    });
    expect(res.statusCode).toBe(200);
    tuningBefore = res.json() as TuningResponse;

    expect(tuningBefore.modelId).toBe(standardModel.id);
    expect(tuningBefore.baseVersionId).toBe(standardModel.currentVersion!.id);
    expect(tuningBefore.baseVersion).toBe(standardModel.currentVersion!.version);
    expect(tuningBefore.report.jobCount).toBeGreaterThan(0);
    expect(tuningBefore.report.rows.length).toBeGreaterThan(0);
    for (const row of tuningBefore.report.rows) {
      expect(typeof row.currentRateCents).toBe('string');
      expect(typeof row.suggestedRateCents).toBe('string');
      expect(BigInt(row.suggestedRateCents)).toBeGreaterThanOrEqual(0n);
    }
    // Seeded underpricing on Summit's Standard Asphalt must surface a change.
    expect(
      tuningBefore.report.rows.some((r) => r.suggestedRateCents !== r.currentRateCents),
    ).toBe(true);

    expect(tuningBefore.replay.length).toBeGreaterThan(0);
    for (const r of tuningBefore.replay) {
      expect(BigInt(r.deltaCents)).toBe(BigInt(r.newTotalCents) - BigInt(r.oldTotalCents));
    }
  });

  it('rejects accepting suggestions against a stale base version with 409', async () => {
    const res = await inject({
      method: 'POST',
      url: `/api/price-models/${standardModel.id}/tuning/accept`,
      payload: { baseVersionId: 'stale-version-id' },
      tenant: summitId,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('refresh');
  });

  it('accepts suggestions into a NEW immutable version and bumps the base', async () => {
    const res = await inject({
      method: 'POST',
      url: `/api/price-models/${standardModel.id}/tuning/accept`,
      payload: { baseVersionId: tuningBefore.baseVersionId },
      tenant: summitId,
    });
    expect(res.statusCode).toBe(201);
    const version = res.json() as PriceModelVersion;
    expect(version.priceModelId).toBe(standardModel.id);
    expect(version.version).toBe(tuningBefore.baseVersion + 1);
    acceptedVersionId = version.id;

    const reGet = await inject({
      method: 'GET',
      url: `/api/price-models/${standardModel.id}/tuning`,
      tenant: summitId,
    });
    const after = reGet.json() as TuningResponse;
    expect(after.baseVersionId).toBe(version.id);
    expect(after.baseVersion).toBe(tuningBefore.baseVersion + 1);
  });

  /* ---------------- Phase 6 — pooled benchmark ---------------- */

  it('unlocks the aggregate-only benchmark for the gate-open tenant', async () => {
    const res = await inject({ method: 'GET', url: '/api/benchmark', tenant: summitId });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BenchmarkResponse;
    expect(body.unlocked).toBe(true);
    expect(body.completionBps).toBeGreaterThanOrEqual(8000);
    expect(body.report).not.toBeNull();
    expect(body.report!.overall.locked).toBe(false);

    const strata: StratumResult[] = [
      body.report!.overall,
      ...body.report!.bySquares,
      ...body.report!.byPitch,
      ...body.report!.byLayers,
      ...body.report!.byRoofAge,
    ];
    for (const s of strata) {
      if (s.locked) {
        expect(s.p50Bps).toBeNull();
        expect(s.p90Bps).toBeNull();
        expect(s.p95Bps).toBeNull();
      } else {
        expect(s.jobs).toBeGreaterThanOrEqual(20);
        expect(s.tenants).toBeGreaterThanOrEqual(3);
      }
    }

    // The caller's own figures ride alongside the pool so the page can compare.
    expect(body.you).not.toBeNull();
    expect(body.you!.jobs).toBeGreaterThan(0);
    expect(body.you!.medianBps).not.toBeNull();
    expect(Number.isInteger(body.you!.medianBps)).toBe(true);
    // vsPool is exactly the difference against the pool's own median.
    expect(body.you!.vsPoolBps).toBe(body.you!.medianBps! - body.report!.overall.p50Bps!);
    // Their own jobs are a subset of the pool's.
    expect(body.you!.jobs).toBeLessThanOrEqual(body.report!.overall.jobs);

    // D10 — no raw tenant id (any tenant's) may appear anywhere in the payload,
    // and `you` adds no per-job rows: it is three integers.
    const tenantsRes = await app.inject({ method: 'GET', url: '/api/tenants' });
    for (const t of tenantsRes.json() as TenantSummary[]) {
      expect(res.body).not.toContain(t.id);
    }
    expect(Object.keys(body.you!).sort()).toEqual(['jobs', 'medianBps', 'vsPoolBps']);

    // Dashboard panel and benchmark endpoint share benchmark.gate — must agree.
    const dash = await inject({ method: 'GET', url: '/api/dashboard', tenant: summitId });
    expect(dash.json().benchmarkUnlocked).toBe(true);
    expect(dash.json().closeoutCompletionBps).toBe(body.completionBps);
  });

  it('keeps the benchmark locked for a low-completion tenant', async () => {
    const res = await inject({
      method: 'GET',
      url: '/api/benchmark',
      tenant: lowCompletionId,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BenchmarkResponse;
    expect(body.unlocked).toBe(false);
    expect(body.completionBps).toBeLessThan(8000);
    expect(body.remainingCount).toBeGreaterThan(0);
    expect(body.report).toBeNull();
    expect(body.you).toBeNull();
    for (const t of (await app.inject({ method: 'GET', url: '/api/tenants' }))
      .json() as TenantSummary[]) {
      expect(res.body).not.toContain(t.id);
    }

    const dash = await inject({
      method: 'GET',
      url: '/api/dashboard',
      tenant: lowCompletionId,
    });
    expect(dash.json().benchmarkUnlocked).toBe(false);
    expect(dash.json().closeoutCompletionBps).toBe(body.completionBps);
  });
});
