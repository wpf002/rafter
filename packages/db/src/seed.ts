/**
 * Deterministic seed: 3 tenants, 40 jobs across all 6 states.
 * Seeded PRNG + fixed base date 2026-06-01 — reruns produce equivalent data.
 * Quotes and variance reports come from @rafter/engine (the seed may import the
 * engine; the engine never imports the db). The CLOSED transition goes through
 * closeouts.submit so the real Postgres gate trigger validates every close.
 */
import { pathToFileURL } from 'node:url';
import type { Prisma } from '@prisma/client';
import { computeQuote, computeVariance } from '@rafter/engine';
import {
  JOB_TRANSITIONS,
  fromMoney,
  toMoney,
  type CloseoutInput,
  type JobState,
  type MeasurementInput,
  type MeasurementSource,
  type PriceModelRates,
  type VarianceAttribution,
  type VarianceReason,
} from '@rafter/types';
import { prisma } from './client';
import { closeouts } from './repos/closeouts';
import { photos } from './repos/photos';
import { quotes } from './repos/quotes';

/* ------------------------------------------------------------------ */
/* Seed helpers (exported via the package barrel)                      */
/* ------------------------------------------------------------------ */

export const SEED_BASE_DATE = new Date('2026-06-01T00:00:00.000Z');

/** mulberry32 — tiny deterministic PRNG. Never used for money math. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Scale a MoneyString rate by bps (10000 = ×1) in pure bigint math (D1). */
export function scaleRateCents(cents: string, bps: number): string {
  return ((BigInt(cents) * BigInt(bps)) / 10_000n).toString();
}

/** Baseline rates (mirrors the engine test fixture); varied per tenant via bps. */
export function baseRates(): PriceModelRates {
  return {
    tearOffPerSquarePerLayerCents: '5500',
    underlaymentPerSquareCents: '2850',
    fieldShinglePerSquareCents: '28500',
    ridgeHipPerLfCents: '1275',
    valleyPerLfCents: '1400',
    flashingPerLfCents: '950',
    penetrationEachCents: '4500',
    deckingPerSheetCents: '9500',
    deckingAllowanceSheets: 2,
    permitFlatCents: '35000',
    disposalPerSquareCents: '2200',
    overheadBps: 1000,
    marginBps: 2000,
    wasteBps: 1000,
    pitchMultipliers: [
      { upTo: 6, bps: 10000 },
      { upTo: 9, bps: 11500 },
      { upTo: 24, bps: 13000 },
    ],
    storyMultipliers: [
      { upTo: 1, bps: 10000 },
      { upTo: 2, bps: 10500 },
      { upTo: 4, bps: 11000 },
    ],
    facetMultipliers: [
      { upTo: 10, bps: 10000 },
      { upTo: 20, bps: 10750 },
      { upTo: 200, bps: 11500 },
    ],
  };
}

export function varyRates(rates: PriceModelRates, bps: number): PriceModelRates {
  return {
    ...rates,
    tearOffPerSquarePerLayerCents: scaleRateCents(rates.tearOffPerSquarePerLayerCents, bps),
    underlaymentPerSquareCents: scaleRateCents(rates.underlaymentPerSquareCents, bps),
    fieldShinglePerSquareCents: scaleRateCents(rates.fieldShinglePerSquareCents, bps),
    ridgeHipPerLfCents: scaleRateCents(rates.ridgeHipPerLfCents, bps),
    valleyPerLfCents: scaleRateCents(rates.valleyPerLfCents, bps),
    flashingPerLfCents: scaleRateCents(rates.flashingPerLfCents, bps),
    penetrationEachCents: scaleRateCents(rates.penetrationEachCents, bps),
    deckingPerSheetCents: scaleRateCents(rates.deckingPerSheetCents, bps),
    permitFlatCents: scaleRateCents(rates.permitFlatCents, bps),
    disposalPerSquareCents: scaleRateCents(rates.disposalPerSquareCents, bps),
  };
}

/** 1×1 transparent PNG — evidence bytes for CONCEALED_CONDITION photos. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Wipe every row. Triggers (quote immutability, append-only events) are
 * disabled ONLY for this wipe via session_replication_role=replica; the seed
 * path itself runs with all triggers active.
 */
export async function wipeAll(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.event.deleteMany();
    await tx.varianceRecord.deleteMany();
    await tx.closeoutLineItem.deleteMany();
    await tx.closeout.deleteMany();
    await tx.quoteLineItem.deleteMany();
    await tx.quote.deleteMany();
    await tx.photo.deleteMany();
    await tx.measurement.deleteMany();
    await tx.job.deleteMany();
    await tx.priceModelVersion.deleteMany();
    await tx.priceModel.deleteMany();
    await tx.user.deleteMany();
    await tx.tenant.deleteMany();
  });
}

/* ------------------------------------------------------------------ */
/* Fixture data                                                        */
/* ------------------------------------------------------------------ */

const TENANTS = [
  { name: 'Summit Roofing', user: { name: 'Dana Whitfield', email: 'dana@summit-roofing.test' } },
  { name: 'Blue Ridge Exteriors', user: { name: 'Marcus Odell', email: 'marcus@blueridge-ext.test' } },
  { name: 'Casa Verde Roofing', user: { name: 'Lucia Marín', email: 'lucia@casaverde.test' } },
];

const STREETS = [
  'Maple St', 'Oakwood Dr', 'Cedar Ln', 'Birchwood Ave', 'Sycamore Ct', 'Elm St',
  'Hillcrest Rd', 'Juniper Way', 'Willow Bend', 'Chestnut Blvd', 'Dogwood Ter', 'Laurel Pl',
];
const CITIES = ['Asheville, NC 28801', 'Boulder, CO 80302', 'Chattanooga, TN 37402', 'Santa Fe, NM 87501'];
const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Harper', 'Rowan', 'Elliot', 'Sasha'];
const LAST = ['Nguyen', 'Ramirez', 'Okafor', 'Lindqvist', 'Patel', 'Brennan', 'Kowalski', 'Duarte', 'Hale', 'Fontaine'];

const REASONS: readonly VarianceReason[] = [
  'CONCEALED_CONDITION',
  'CUSTOMER_SCOPE_CHANGE',
  'MEASUREMENT_ERROR',
  'PRICING_ERROR',
];

/** 40 jobs spread across all 6 states. */
const STATE_PLAN: JobState[] = [
  ...Array<JobState>(6).fill('DRAFT'),
  ...Array<JobState>(8).fill('QUOTED'),
  ...Array<JobState>(6).fill('SOLD'),
  ...Array<JobState>(6).fill('IN_PROGRESS'),
  ...Array<JobState>(6).fill('AWAITING_CLOSEOUT'),
  ...Array<JobState>(8).fill('CLOSED'),
];

/* ------------------------------------------------------------------ */
/* Seed run                                                            */
/* ------------------------------------------------------------------ */

export async function runSeed(): Promise<void> {
  const rand = mulberry32(0x5eed);
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  await wipeAll();

  // Tenants, users, price models (1–2 immutable versions each, rates varied ± per tenant).
  const tenantCtx: {
    id: string;
    versions: { id: string; rates: PriceModelRates }[];
  }[] = [];

  for (const t of TENANTS) {
    const tenant = await prisma.tenant.create({
      data: { name: t.name, createdAt: addDays(SEED_BASE_DATE, -120) },
    });
    await prisma.user.create({ data: { tenantId: tenant.id, ...t.user } });

    const versions: { id: string; rates: PriceModelRates }[] = [];
    const tenantBps = 10_000 + randInt(-8, 8) * 100; // ±8% per tenant
    for (const [mi, modelName] of ['Standard Asphalt', 'Premium Architectural'].entries()) {
      const model = await prisma.priceModel.create({
        data: {
          tenantId: tenant.id,
          name: modelName,
          createdAt: addDays(SEED_BASE_DATE, -110 + mi),
        },
      });
      const versionCount = mi === 0 ? 2 : randInt(1, 2);
      let rates = varyRates(baseRates(), tenantBps + mi * 400); // premium model runs richer
      for (let v = 1; v <= versionCount; v++) {
        const created = await prisma.priceModelVersion.create({
          data: {
            priceModelId: model.id,
            tenantId: tenant.id,
            version: v,
            rates: rates as unknown as Prisma.InputJsonValue,
            createdAt: addDays(SEED_BASE_DATE, -100 + v * 7),
          },
        });
        versions.push({ id: created.id, rates });
        rates = varyRates(rates, 10_300); // next version: +3% rate bump, prior row untouched (D3)
      }
    }
    tenantCtx.push({ id: tenant.id, versions });
  }

  // Deterministic state advance (legality mirrors jobs.transition; CLOSED never goes through here).
  async function advance(tenantId: string, jobId: string, from: JobState, to: JobState, at: Date) {
    if (to === 'CLOSED' || !JOB_TRANSITIONS[from].includes(to)) {
      throw new Error(`seed: illegal transition ${from} -> ${to}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: jobId }, data: { state: to } });
      await tx.event.create({
        data: { jobId, tenantId, kind: 'STATE_CHANGED', payload: { from, to }, at },
      });
    });
  }

  let photoCount = 0;
  for (let i = 0; i < STATE_PLAN.length; i++) {
    const target = STATE_PLAN[i]!;
    const ctx = tenantCtx[i % tenantCtx.length]!;
    const num = 100 + randInt(1, 899);
    const street = pick(STREETS);
    const address = `${num} ${street}, ${pick(CITIES)}`;
    const customerName = `${pick(FIRST)} ${pick(LAST)}`;
    // CLOSED/AWAITING jobs skew older so the 30-day closeout-completion gate has data.
    const ageDays =
      target === 'CLOSED' || target === 'AWAITING_CLOSEOUT' ? randInt(40, 90) : randInt(5, 45);
    const createdAt = addDays(SEED_BASE_DATE, -ageDays);

    const job = await prisma.job.create({
      data: {
        tenantId: ctx.id,
        name: `Re-roof — ${num} ${street}`,
        address,
        customerName,
        state: 'DRAFT',
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.event.create({
      data: {
        jobId: job.id,
        tenantId: ctx.id,
        kind: 'JOB_CREATED',
        payload: { name: job.name },
        at: createdAt,
      },
    });
    if (target === 'DRAFT') continue;

    // Measurement — varied, realistic roofs.
    const input: MeasurementInput = {
      roofAreaSqFt: randInt(14, 42) * 100 + randInt(0, 99),
      pitchTwelfths: randInt(3, 12),
      stories: randInt(1, 3),
      facets: randInt(4, 28),
      ridgeHipLf: randInt(40, 140),
      valleyLf: randInt(0, 80),
      eaveLf: randInt(100, 220),
      rakeLf: randInt(60, 180),
      flashingLf: randInt(10, 60),
      penetrations: randInt(2, 12),
      existingLayers: randInt(1, 2),
      deckingCondition: pick(['UNKNOWN', 'GOOD', 'SUSPECT'] as const),
    };
    const source: MeasurementSource = rand() < 0.5 ? 'MANUAL' : 'AERIAL_STUB';
    await prisma.measurement.create({
      data: {
        jobId: job.id,
        tenantId: ctx.id,
        source,
        providerRef: source === 'AERIAL_STUB' ? `aerial-${i.toString().padStart(3, '0')}` : null,
        capturedAt: addDays(createdAt, 1),
        ...input,
      },
    });

    // Quote — computed by the pure engine with an explicit asOf (D2), issued via the repo.
    const version = pick(ctx.versions);
    const asOf = addDays(createdAt, randInt(2, 5));
    const computation = computeQuote(
      { measurement: input, rates: version.rates, priceModelVersionId: version.id },
      asOf,
    );
    await quotes.issue(ctx.id, job.id, computation);
    if (target === 'QUOTED') continue;

    await advance(ctx.id, job.id, 'QUOTED', 'SOLD', addDays(asOf, randInt(2, 6)));
    if (target === 'SOLD') continue;

    await advance(ctx.id, job.id, 'SOLD', 'IN_PROGRESS', addDays(asOf, randInt(7, 12)));
    if (target === 'IN_PROGRESS') continue;

    const doneAt = addDays(asOf, randInt(14, 21));
    await advance(ctx.id, job.id, 'IN_PROGRESS', 'AWAITING_CLOSEOUT', doneAt);
    if (target === 'AWAITING_CLOSEOUT') continue;

    // CLOSED — fabricate actuals around quoted cost, attribute 100% of the
    // variance (D7), then submit through the real Postgres gate.
    const quotedCost = toMoney(computation.subtotalCents) + toMoney(computation.overheadCents);
    const varianceBps = BigInt(randInt(-1200, 2500));
    const variance = (quotedCost * varianceBps) / 10_000n;
    const actualCost = quotedCost + variance;
    const material = (actualCost * 45n) / 100n;
    const labor = (actualCost * 40n) / 100n;
    const disposal = actualCost - material - labor;

    const attributions: VarianceAttribution[] = [];
    if (variance !== 0n) {
      const shuffled = [...REASONS].sort(() => rand() - 0.5);
      const k = randInt(1, 3);
      let remaining = variance;
      for (let r = 0; r < k; r++) {
        const reason = shuffled[r]!;
        const amount = r === k - 1 ? remaining : (variance * BigInt(randInt(15, 45))) / 100n;
        remaining -= r === k - 1 ? remaining : amount;
        if (amount === 0n) continue;
        let photoId: string | undefined;
        if (reason === 'CONCEALED_CONDITION') {
          const photo = await photos.add(
            ctx.id,
            job.id,
            `concealed-${i.toString().padStart(3, '0')}.png`,
            TINY_PNG,
            addDays(doneAt, -2),
            addDays(doneAt, -1),
          );
          photoId = photo.id;
          photoCount++;
        }
        attributions.push({
          reason,
          amountCents: fromMoney(amount),
          note:
            reason === 'CONCEALED_CONDITION'
              ? 'Rotten decking found under tear-off'
              : reason === 'CUSTOMER_SCOPE_CHANGE'
                ? 'Customer added gutter guard mid-job'
                : reason === 'MEASUREMENT_ERROR'
                  ? 'Field measure differed from takeoff'
                  : 'Rate card lagged supplier pricing',
          ...(photoId ? { photoId } : {}),
        });
      }
    }

    const closeoutInput: CloseoutInput = {
      actualLines: [
        { description: 'Shingles, underlayment, accessories (supplier invoice)', category: 'MATERIAL', amountCents: fromMoney(material) },
        { description: 'Crew labor — tear-off and install', category: 'LABOR', amountCents: fromMoney(labor) },
        { description: 'Dumpster and tipping fees', category: 'DISPOSAL', amountCents: fromMoney(disposal) },
      ],
      attributions,
    };
    const report = computeVariance(computation, closeoutInput);
    await closeouts.submit(ctx.id, job.id, closeoutInput, report, addDays(doneAt, randInt(3, 8)));
  }

  const counts = await prisma.job.groupBy({ by: ['state'], _count: { _all: true } });
  console.log(
    `Seeded ${TENANTS.length} tenants, ${STATE_PLAN.length} jobs, ${photoCount} photos —`,
    Object.fromEntries(counts.map((c) => [c.state, c._count._all])),
  );
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runSeed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
