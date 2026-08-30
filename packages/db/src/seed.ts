/**
 * Deterministic seed: 3 tenants, 78 jobs across all 6 states, with enough
 * closed history to demo Phase 5 (auto-tune) and Phase 6 (pooled benchmark).
 * Seeded PRNG + fixed base date 2026-06-01 — reruns produce equivalent data.
 * Quotes and variance reports come from @rafter/engine (the seed may import the
 * engine; the engine never imports the db). The CLOSED transition goes through
 * closeouts.submit so the real Postgres gate trigger validates every close.
 *
 * Fixture shape (intentional, do not "rebalance"):
 * - Summit Roofing: 26 gate-eligible jobs, 22 CLOSED (≈85% completion) →
 *   benchmark gate OPEN. Its 'Standard Asphalt' model carries systematically
 *   positive PRICING_ERROR (~$2–4/sq of field shingle) on 20 closed jobs so
 *   the tuning demo suggests raising the rate.
 * - Blue Ridge + Casa Verde: ~55% completion → locked-panel demo.
 * - ≥22 closed jobs in the 15–25 squares band, ≥20 at pitch 6/12, ≥20 with a
 *   single existing layer, across all 3 tenants → 'overall', 'squares:15-25',
 *   'layers:1' and a pitch stratum clear the k=20/3 anonymity floor.
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

/** UTC date in the Nth month after 2025-09 (monthIdx 0 = 2025-09). */
function seedMonth(monthIdx: number, day: number): Date {
  return new Date(Date.UTC(2025, 8 + monthIdx, day));
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

/** Plan for one closed job's fixture knobs (see the header comment). */
interface ClosedPlan {
  state: 'CLOSED';
  /** 0 = Standard Asphalt, 1 = Premium Architectural. */
  modelIdx: 0 | 1;
  /** Systematically positive PRICING_ERROR (~$2–4/sq of field shingle). */
  underpriced: boolean;
  /** 15–25 squares band (1500–2500 sqft). */
  inBand: boolean;
  pitch: number;
  layers: number;
}

type JobPlan = { state: Exclude<JobState, 'CLOSED'> } | ClosedPlan;

function closedPlans(
  count: number,
  opts: {
    underpricedCount: number;
    inBandCount: number;
    pitchSixCount: number;
    singleLayerCount: number;
    offPitches: number[];
  },
): ClosedPlan[] {
  const plans: ClosedPlan[] = [];
  for (let i = 0; i < count; i++) {
    plans.push({
      state: 'CLOSED',
      modelIdx: i < opts.underpricedCount ? 0 : 1,
      underpriced: i < opts.underpricedCount,
      inBand: i < opts.inBandCount,
      pitch: i < opts.pitchSixCount ? 6 : opts.offPitches[(i - opts.pitchSixCount) % opts.offPitches.length]!,
      layers: i < opts.singleLayerCount ? 1 : 2,
    });
  }
  return plans;
}

function fill(state: Exclude<JobState, 'CLOSED'>, n: number): JobPlan[] {
  return Array.from({ length: n }, () => ({ state }));
}

/**
 * 78 jobs. Summit: 22 closed + 4 awaiting (gate OPEN at ~85%); Blue Ridge
 * 6/11 and Casa Verde 5/9 (~55%, gate LOCKED). 33 closed total, 27 in the
 * 15–25 squares band, 24 at pitch 6, 26 single-layer — all across 3 tenants.
 */
const TENANT_PLANS: JobPlan[][] = [
  [
    ...closedPlans(22, {
      underpricedCount: 20,
      inBandCount: 18,
      pitchSixCount: 16,
      singleLayerCount: 17,
      offPitches: [4, 8, 9, 12, 11, 3],
    }),
    ...fill('AWAITING_CLOSEOUT', 4),
    ...fill('IN_PROGRESS', 3),
    ...fill('SOLD', 3),
    ...fill('QUOTED', 4),
    ...fill('DRAFT', 3),
  ],
  [
    ...closedPlans(6, {
      underpricedCount: 0,
      inBandCount: 5,
      pitchSixCount: 4,
      singleLayerCount: 5,
      offPitches: [8, 10],
    }),
    ...fill('AWAITING_CLOSEOUT', 5),
    ...fill('IN_PROGRESS', 2),
    ...fill('SOLD', 2),
    ...fill('QUOTED', 3),
    ...fill('DRAFT', 2),
  ],
  [
    ...closedPlans(5, {
      underpricedCount: 0,
      inBandCount: 4,
      pitchSixCount: 4,
      singleLayerCount: 4,
      offPitches: [9],
    }),
    ...fill('AWAITING_CLOSEOUT', 4),
    ...fill('IN_PROGRESS', 3),
    ...fill('SOLD', 2),
    ...fill('QUOTED', 3),
    ...fill('DRAFT', 2),
  ],
];

/* ------------------------------------------------------------------ */
/* Seed run                                                            */
/* ------------------------------------------------------------------ */

export async function runSeed(): Promise<void> {
  const rand = mulberry32(0x5eed);
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  await wipeAll();

  // Tenants, users, price models (immutable versions, rates varied ± per tenant).
  const tenantCtx: {
    id: string;
    models: { id: string; versions: { id: string; rates: PriceModelRates }[] }[];
  }[] = [];

  for (const t of TENANTS) {
    const tenant = await prisma.tenant.create({
      data: { name: t.name, createdAt: addDays(SEED_BASE_DATE, -300) },
    });
    await prisma.user.create({ data: { tenantId: tenant.id, ...t.user } });

    const models: { id: string; versions: { id: string; rates: PriceModelRates }[] }[] = [];
    const tenantBps = 10_000 + randInt(-8, 8) * 100; // ±8% per tenant
    for (const [mi, modelName] of ['Standard Asphalt', 'Premium Architectural'].entries()) {
      const model = await prisma.priceModel.create({
        data: {
          tenantId: tenant.id,
          name: modelName,
          createdAt: addDays(SEED_BASE_DATE, -290 + mi),
        },
      });
      const versionCount = mi === 0 ? 2 : randInt(1, 2);
      let rates = varyRates(baseRates(), tenantBps + mi * 400); // premium model runs richer
      const versions: { id: string; rates: PriceModelRates }[] = [];
      for (let v = 1; v <= versionCount; v++) {
        const created = await prisma.priceModelVersion.create({
          data: {
            priceModelId: model.id,
            tenantId: tenant.id,
            version: v,
            rates: rates as unknown as Prisma.InputJsonValue,
            createdAt: addDays(SEED_BASE_DATE, -280 + v * 7),
          },
        });
        versions.push({ id: created.id, rates });
        rates = varyRates(rates, 10_300); // next version: +3% rate bump, prior row untouched (D3)
      }
      models.push({ id: model.id, versions });
    }
    tenantCtx.push({ id: tenant.id, models });
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
  let jobSeq = 0; // global counter — drives roofAgeYears nulls
  let closedSeq = 0; // global closed-job counter — drives variance mixes

  for (let ti = 0; ti < TENANT_PLANS.length; ti++) {
    const ctx = tenantCtx[ti]!;
    for (const plan of TENANT_PLANS[ti]!) {
      const target = plan.state;
      const i = jobSeq++;
      const num = 100 + randInt(1, 899);
      const street = pick(STREETS);
      const address = `${num} ${street}, ${pick(CITIES)}`;
      const customerName = `${pick(FIRST)} ${pick(LAST)}`;

      // Timeline. Closed jobs spread their quote month over 2025-09..2026-05
      // and close 1–3 months later (≤ 2026-07). Awaiting jobs skew old so the
      // 30-day gate window counts them; open pipeline stays recent.
      let createdAt: Date;
      let asOf: Date | null = null;
      let closeAt: Date | null = null;
      if (target === 'CLOSED') {
        const g = closedSeq++;
        const quoteMonthIdx = (g * 5) % 9; // 0..8 → 2025-09..2026-05
        const closeGapMonths = Math.min(1 + (g % 3), 10 - quoteMonthIdx); // 1..3, close ≤ 2026-07
        asOf = seedMonth(quoteMonthIdx, randInt(3, 24));
        createdAt = addDays(asOf, -randInt(3, 7));
        const monthClose = seedMonth(quoteMonthIdx + closeGapMonths, randInt(2, 26));
        const floorClose = addDays(asOf, 32);
        closeAt = monthClose.getTime() > floorClose.getTime() ? monthClose : floorClose;
      } else if (target === 'AWAITING_CLOSEOUT') {
        createdAt = addDays(SEED_BASE_DATE, -randInt(45, 130));
        asOf = addDays(createdAt, randInt(2, 5));
      } else {
        createdAt = addDays(SEED_BASE_DATE, -randInt(5, 45));
        asOf = addDays(createdAt, randInt(2, 5));
      }

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

      // Measurement — closed jobs follow the stratum plan; the rest vary freely.
      const input: MeasurementInput = {
        roofAreaSqFt:
          plan.state === 'CLOSED'
            ? plan.inBand
              ? randInt(1500, 2500)
              : randInt(2600, 4200)
            : randInt(14, 42) * 100 + randInt(0, 99),
        pitchTwelfths: plan.state === 'CLOSED' ? plan.pitch : randInt(3, 12),
        stories: randInt(1, 3),
        facets: randInt(4, 28),
        ridgeHipLf: randInt(40, 140),
        valleyLf: randInt(0, 80),
        eaveLf: randInt(100, 220),
        rakeLf: randInt(60, 180),
        flashingLf: randInt(10, 60),
        penetrations: randInt(2, 12),
        existingLayers: plan.state === 'CLOSED' ? plan.layers : randInt(1, 2),
        roofAgeYears: i % 9 === 7 ? null : randInt(4, 40),
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
      const model = plan.state === 'CLOSED' ? ctx.models[plan.modelIdx]! : pick(ctx.models);
      const version = pick(model.versions);
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

      const doneAt = addDays(asOf, randInt(13, 20));
      await advance(ctx.id, job.id, 'IN_PROGRESS', 'AWAITING_CLOSEOUT', doneAt);
      if (target === 'AWAITING_CLOSEOUT' || plan.state !== 'CLOSED') continue;

      // CLOSED — build the variance mix the Phase 5/6 demos need, attribute
      // 100% of it (D7), then submit through the real Postgres gate.
      const g = closedSeq - 1; // this job's closed index
      const contract = toMoney(computation.totalCents);
      const quotedCost = toMoney(computation.subtotalCents) + toMoney(computation.overheadCents);

      // Most closed jobs: nonzero concealed-condition cost, 0–8% of contract.
      const concealed = g % 8 === 5 ? 0n : (contract * BigInt(randInt(30, 800))) / 10_000n;

      // Summit's Standard Asphalt: underpriced ~$2–4 per square of field shingle.
      let pricingError = 0n;
      if (plan.underpriced) {
        const fieldQtyX100 = computation.lineItems.find((li) => li.code === 'FIELD_SHINGLE')!
          .quantityX100;
        pricingError = (BigInt(fieldQtyX100) * BigInt(randInt(200, 400))) / 100n;
      } else if (g % 5 === 2) {
        pricingError = BigInt(randInt(-250, 250)) * 100n;
      }

      const measurementError = g % 3 === 0 ? BigInt(randInt(-450, 650)) * 100n : 0n;
      const scopeChange = g % 4 === 1 ? BigInt(randInt(150, 1200)) * 100n : 0n;

      const attributions: VarianceAttribution[] = [];
      if (concealed !== 0n) {
        const photo = await photos.add(
          ctx.id,
          job.id,
          `concealed-${i.toString().padStart(3, '0')}.png`,
          TINY_PNG,
          addDays(doneAt, -2),
          addDays(doneAt, -1),
        );
        photoCount++;
        attributions.push({
          reason: 'CONCEALED_CONDITION',
          amountCents: fromMoney(concealed),
          note: 'Rotten decking found under tear-off',
          photoId: photo.id,
        });
      }
      if (pricingError !== 0n) {
        attributions.push({
          reason: 'PRICING_ERROR',
          amountCents: fromMoney(pricingError),
          note: 'Rate card lagged supplier pricing',
        });
      }
      if (measurementError !== 0n) {
        attributions.push({
          reason: 'MEASUREMENT_ERROR',
          amountCents: fromMoney(measurementError),
          note: 'Field measure differed from takeoff',
        });
      }
      if (scopeChange !== 0n) {
        attributions.push({
          reason: 'CUSTOMER_SCOPE_CHANGE',
          amountCents: fromMoney(scopeChange),
          note: 'Customer added gutter guard mid-job',
        });
      }

      const variance = concealed + pricingError + measurementError + scopeChange;
      const actualCost = quotedCost + variance;
      const material = (actualCost * 45n) / 100n;
      const labor = (actualCost * 40n) / 100n;
      const disposal = actualCost - material - labor;

      const closeoutInput: CloseoutInput = {
        actualLines: [
          { description: 'Shingles, underlayment, accessories (supplier invoice)', category: 'MATERIAL', amountCents: fromMoney(material) },
          { description: 'Crew labor — tear-off and install', category: 'LABOR', amountCents: fromMoney(labor) },
          { description: 'Dumpster and tipping fees', category: 'DISPOSAL', amountCents: fromMoney(disposal) },
        ],
        attributions,
      };
      const report = computeVariance(computation, closeoutInput);
      await closeouts.submit(ctx.id, job.id, closeoutInput, report, closeAt!);
    }
  }

  const counts = await prisma.job.groupBy({ by: ['state'], _count: { _all: true } });
  console.log(
    `Seeded ${TENANTS.length} tenants, ${jobSeq} jobs, ${photoCount} photos —`,
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
