import type {
  BenchmarkRecord,
  BenchmarkReport,
  StratumResult,
  YourStanding,
} from '@rafter/types';
import { BPS_ONE, toMoney } from '@rafter/types';
import { divHalfEven } from './money';

/**
 * Phase 6 — pooled benchmark aggregation (D10): aggregate-only output, opaque
 * tenant keys, k-anonymity floor. Pure and deterministic — no clock, no
 * randomness; the report deliberately carries no generatedAt.
 *
 * CUSTOMER_SCOPE_CHANGE never enters any distribution: a BenchmarkRecord
 * carries only CONCEALED_CONDITION cents by construction (the upstream
 * extractor sums concealed-condition attributions exclusively), so no
 * reason filter exists — or is needed — here.
 */

const K_JOBS_DEFAULT = 20;
const K_TENANTS_DEFAULT = 3;

/** Closed jobs a roofer needs before their own median is worth showing. */
const OWN_MIN_JOBS_DEFAULT = 3;

interface Observation {
  tenantKey: string;
  /** Deflated concealed-condition variance as bps of contract value. */
  pctBps: number;
}

interface BandDef {
  key: string;
  label: string;
  match: (r: BenchmarkRecord) => boolean;
}

/** squaresX100 band edges are inclusive as written (1 square = 100 X100). */
const SQUARES_BANDS: readonly BandDef[] = [
  { key: 'squares:<15', label: '<15 squares', match: (r) => r.squaresX100 <= 1499 },
  {
    key: 'squares:15-25',
    label: '15–25 squares',
    match: (r) => r.squaresX100 >= 1500 && r.squaresX100 <= 2500,
  },
  {
    key: 'squares:25-35',
    label: '25–35 squares',
    match: (r) => r.squaresX100 >= 2501 && r.squaresX100 <= 3500,
  },
  { key: 'squares:>35', label: '>35 squares', match: (r) => r.squaresX100 >= 3501 },
];

const PITCH_BANDS: readonly BandDef[] = [
  { key: 'pitch:<=4', label: '≤4/12 pitch', match: (r) => r.pitchTwelfths <= 4 },
  {
    key: 'pitch:5-8',
    label: '5–8/12 pitch',
    match: (r) => r.pitchTwelfths >= 5 && r.pitchTwelfths <= 8,
  },
  { key: 'pitch:>=9', label: '≥9/12 pitch', match: (r) => r.pitchTwelfths >= 9 },
];

const LAYERS_BANDS: readonly BandDef[] = [
  { key: 'layers:1', label: '1 layer', match: (r) => r.existingLayers <= 1 },
  { key: 'layers:2+', label: '2+ layers', match: (r) => r.existingLayers >= 2 },
];

const AGE_BANDS: readonly BandDef[] = [
  {
    key: 'age:<10',
    label: '<10 yrs',
    match: (r) => r.roofAgeYears !== null && r.roofAgeYears <= 9,
  },
  {
    key: 'age:10-20',
    label: '10–20 yrs',
    match: (r) => r.roofAgeYears !== null && r.roofAgeYears >= 10 && r.roofAgeYears <= 20,
  },
  {
    key: 'age:>20',
    label: '>20 yrs',
    match: (r) => r.roofAgeYears !== null && r.roofAgeYears >= 21,
  },
  { key: 'age:unknown', label: 'unknown', match: (r) => r.roofAgeYears === null },
];

/**
 * One record's deflated concealed pct, or null when the record is unusable
 * (contract <= 0 has no meaningful denominator). Zero-concealed records are
 * real observations and stay in the distribution.
 *
 * Deflation restates close-month concealed dollars in quote-month dollars via
 * the material index (bps, missing months default to BPS_ONE = no movement):
 * adjusted = concealed × idx(quoteMonth) / idx(closeMonth), half-even.
 *
 * SINGLE SOURCE for per-record math: both the pooled distribution and the
 * viewer's own standing go through this function, so the two can never drift.
 */
function pctBpsOf(record: BenchmarkRecord, indexBps: Record<string, number>): number | null {
  const contract = toMoney(record.contractCents);
  if (contract <= 0n) return null;
  const quoteIdx = indexBps[record.quoteMonth] ?? BPS_ONE;
  const closeIdx = indexBps[record.closeMonth] ?? BPS_ONE;
  const adjusted = divHalfEven(
    toMoney(record.concealedCents) * BigInt(quoteIdx),
    BigInt(closeIdx),
  );
  return Number(divHalfEven(adjusted * BigInt(BPS_ONE), contract));
}

/**
 * Nearest-rank percentile on an ascending-sorted array:
 * pN = arr[ceil((N/100)·n) − 1]. Computed as ceil((N·n)/100) — the integer
 * numerator keeps exact ranks exact, immune to any float drift in (N/100)·n.
 */
function nearestRank(sorted: number[], pct: number): number {
  const rank = Math.ceil((pct * sorted.length) / 100);
  return sorted[rank - 1] as number;
}

function buildStratum(
  key: string,
  label: string,
  obs: Observation[],
  kJobs: number,
  kTenants: number,
): StratumResult {
  const jobs = obs.length;
  const tenantKeys = new Set<string>();
  for (const o of obs) tenantKeys.add(o.tenantKey);
  const tenants = tenantKeys.size;
  // k-anonymity floor (D10). jobs === 0 is always locked: percentiles of an
  // empty set do not exist even under a zero floor.
  const locked = jobs === 0 || jobs < kJobs || tenants < kTenants;
  if (locked) {
    return { key, label, jobs, tenants, locked, p50Bps: null, p90Bps: null, p95Bps: null };
  }
  // Ties by value only — plain ascending numeric sort.
  const sorted = obs.map((o) => o.pctBps).sort((a, b) => a - b);
  return {
    key,
    label,
    jobs,
    tenants,
    locked,
    p50Bps: nearestRank(sorted, 50),
    p90Bps: nearestRank(sorted, 90),
    p95Bps: nearestRank(sorted, 95),
  };
}

export function computeBenchmark(
  records: BenchmarkRecord[],
  opts: { indexBps: Record<string, number>; kJobs?: number; kTenants?: number },
): BenchmarkReport {
  const kJobs = opts.kJobs ?? K_JOBS_DEFAULT;
  const kTenants = opts.kTenants ?? K_TENANTS_DEFAULT;

  const usable: Array<{ record: BenchmarkRecord; obs: Observation }> = [];
  for (const record of records) {
    const pctBps = pctBpsOf(record, opts.indexBps);
    if (pctBps === null) continue;
    usable.push({ record, obs: { tenantKey: record.tenantKey, pctBps } });
  }

  const strataFor = (bands: readonly BandDef[]): StratumResult[] =>
    bands.map((band) =>
      buildStratum(
        band.key,
        band.label,
        usable.filter((u) => band.match(u.record)).map((u) => u.obs),
        kJobs,
        kTenants,
      ),
    );

  return {
    overall: buildStratum(
      'overall',
      'Overall',
      usable.map((u) => u.obs),
      kJobs,
      kTenants,
    ),
    bySquares: strataFor(SQUARES_BANDS),
    byPitch: strataFor(PITCH_BANDS),
    byLayers: strataFor(LAYERS_BANDS),
    byRoofAge: strataFor(AGE_BANDS),
    kJobs,
    kTenants,
    deflated: true,
  };
}

/**
 * The viewing roofer's own surprise-cost record, positioned against the pool.
 *
 * This reads ONLY their own rows, so it carries no disclosure risk and no
 * k-anonymity floor applies — the floor exists to protect other roofers, and
 * nobody else's data is touched here. The separate `minJobs` gate is a
 * statistical one: a median over one or two jobs is noise, not a record.
 *
 * Uses the same per-record kernel as the pool (`pctBpsOf`), so a given job
 * contributes the identical number to both sides of the comparison.
 * Pure and deterministic — no clock, no randomness.
 */
export function computeYourStanding(
  ownRecords: BenchmarkRecord[],
  pool: BenchmarkReport,
  opts: { indexBps: Record<string, number>; minJobs?: number },
): YourStanding {
  const minJobs = opts.minJobs ?? OWN_MIN_JOBS_DEFAULT;

  const pctBps: number[] = [];
  for (const record of ownRecords) {
    const p = pctBpsOf(record, opts.indexBps);
    if (p === null) continue; // contract <= 0 has no denominator, same as the pool
    pctBps.push(p);
  }

  const jobs = pctBps.length;
  if (jobs < minJobs) return { jobs, medianBps: null, vsPoolBps: null };

  // Same nearest-rank P50 the pool uses.
  const medianBps = nearestRank([...pctBps].sort((a, b) => a - b), 50);
  const poolP50 = pool.overall.p50Bps;
  return {
    jobs,
    medianBps,
    vsPoolBps: poolP50 === null ? null : medianBps - poolP50,
  };
}
