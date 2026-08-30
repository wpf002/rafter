import { describe, expect, it } from 'vitest';
import {
  BenchmarkReport,
  YourStanding,
  type BenchmarkRecord,
  type StratumResult,
} from '@rafter/types';
import { computeBenchmark, computeYourStanding } from '../src/index';

/** Everything unlocked: floor of 1 job / 1 tenant, no index movement. */
const K1 = { indexBps: {}, kJobs: 1, kTenants: 1 };
/** Defaults: kJobs 20, kTenants 3, no index movement. */
const KDEF = { indexBps: {} };

function rec(partial: Partial<BenchmarkRecord> = {}): BenchmarkRecord {
  return {
    tenantKey: 't1',
    concealedCents: '0',
    contractCents: '1000000',
    squaresX100: 2000,
    pitchTwelfths: 6,
    existingLayers: 1,
    roofAgeYears: 15,
    quoteMonth: '2025-01',
    closeMonth: '2025-03',
    ...partial,
  };
}

/** Record whose pctBps is exactly `bps` (contract $10,000.00, no deflation). */
function pct(bps: number, tenantKey = 't1'): BenchmarkRecord {
  return rec({ tenantKey, concealedCents: String(bps * 100), contractCents: '1000000' });
}

function stratum(arr: StratumResult[], key: string): StratumResult {
  const s = arr.find((x) => x.key === key);
  if (!s) throw new Error(`missing stratum ${key}`);
  return s;
}

describe('computeBenchmark percentiles (nearest-rank)', () => {
  it('n=1: p50/p90/p95 all equal the single observation', () => {
    const report = computeBenchmark([pct(1234)], K1);
    expect(report.overall.jobs).toBe(1);
    expect(report.overall.tenants).toBe(1);
    expect(report.overall.locked).toBe(false);
    expect(report.overall.p50Bps).toBe(1234);
    expect(report.overall.p90Bps).toBe(1234);
    expect(report.overall.p95Bps).toBe(1234);
  });

  it('n=20: exact nearest-rank indices 9, 17, 18', () => {
    // Values 100..2000 supplied in descending order; 3 tenants cycling so the
    // default floor (20 jobs / 3 tenants) is met exactly.
    const records: BenchmarkRecord[] = [];
    for (let i = 20; i >= 1; i--) {
      records.push(pct(i * 100, `t${(i % 3) + 1}`));
    }
    const report = computeBenchmark(records, KDEF);
    expect(report.overall.locked).toBe(false);
    // sorted asc = [100, 200, ..., 2000]
    expect(report.overall.p50Bps).toBe(1000); // ceil(0.50·20)=10 → index 9
    expect(report.overall.p90Bps).toBe(1800); // ceil(0.90·20)=18 → index 17
    expect(report.overall.p95Bps).toBe(1900); // ceil(0.95·20)=19 → index 18
  });

  it('n=5: hand-computed ranks (p50→3rd, p90→5th, p95→5th)', () => {
    const report = computeBenchmark([50, 10, 40, 20, 30].map((b) => pct(b)), K1);
    expect(report.overall.p50Bps).toBe(30); // ceil(2.5)=3 → index 2
    expect(report.overall.p90Bps).toBe(50); // ceil(4.5)=5 → index 4
    expect(report.overall.p95Bps).toBe(50); // ceil(4.75)=5 → index 4
  });

  it('n=4: p50 lands on the exact rank ceil(2)=2 → index 1', () => {
    const report = computeBenchmark([4, 3, 2, 1].map((b) => pct(b)), K1);
    expect(report.overall.p50Bps).toBe(2);
    expect(report.overall.p90Bps).toBe(4); // ceil(3.6)=4 → index 3
    expect(report.overall.p95Bps).toBe(4); // ceil(3.8)=4 → index 3
  });

  it('ties sort by value only', () => {
    const report = computeBenchmark([500, 500, 100, 500, 100].map((b) => pct(b)), K1);
    // sorted asc = [100, 100, 500, 500, 500]
    expect(report.overall.p50Bps).toBe(500);
    expect(report.overall.p90Bps).toBe(500);
  });
});

describe('computeBenchmark k-anonymity floor', () => {
  it('19 jobs / 3 tenants is locked under the defaults', () => {
    const records: BenchmarkRecord[] = [];
    for (let i = 0; i < 19; i++) records.push(pct(i * 10, `t${(i % 3) + 1}`));
    const overall = computeBenchmark(records, KDEF).overall;
    expect(overall.jobs).toBe(19);
    expect(overall.tenants).toBe(3);
    expect(overall.locked).toBe(true);
    expect(overall.p50Bps).toBeNull();
    expect(overall.p90Bps).toBeNull();
    expect(overall.p95Bps).toBeNull();
  });

  it('20 jobs / 2 tenants is locked under the defaults', () => {
    const records: BenchmarkRecord[] = [];
    for (let i = 0; i < 20; i++) records.push(pct(i * 10, `t${(i % 2) + 1}`));
    const overall = computeBenchmark(records, KDEF).overall;
    expect(overall.jobs).toBe(20);
    expect(overall.tenants).toBe(2);
    expect(overall.locked).toBe(true);
    expect(overall.p50Bps).toBeNull();
  });

  it('20 jobs / 3 tenants is unlocked under the defaults', () => {
    const records: BenchmarkRecord[] = [];
    for (let i = 0; i < 20; i++) records.push(pct(i * 10, `t${(i % 3) + 1}`));
    const overall = computeBenchmark(records, KDEF).overall;
    expect(overall.locked).toBe(false);
    expect(overall.p50Bps).not.toBeNull();
  });

  it('report echoes default floors 20/3 and honors custom floors', () => {
    const def = computeBenchmark([], KDEF);
    expect(def.kJobs).toBe(20);
    expect(def.kTenants).toBe(3);

    const custom = computeBenchmark(
      [pct(100, 'a'), pct(200, 'b'), pct(300, 'a'), pct(400, 'b'), pct(500, 'a')],
      { indexBps: {}, kJobs: 5, kTenants: 2 },
    );
    expect(custom.kJobs).toBe(5);
    expect(custom.kTenants).toBe(2);
    expect(custom.overall.locked).toBe(false);
  });

  it('locked strata still report jobs and tenants counts (aggregate-only, D10)', () => {
    const report = computeBenchmark([pct(100, 'a'), pct(200, 'b')], KDEF);
    expect(report.overall.locked).toBe(true);
    expect(report.overall.jobs).toBe(2);
    expect(report.overall.tenants).toBe(2);
  });
});

describe('computeBenchmark strata bands', () => {
  it('squares band edges 1499/1500/2500/2501/3500/3501 (X100, inclusive)', () => {
    const records = [1499, 1500, 2500, 2501, 3500, 3501].map((s) => rec({ squaresX100: s }));
    const report = computeBenchmark(records, K1);
    expect(report.bySquares.map((s) => s.key)).toEqual([
      'squares:<15',
      'squares:15-25',
      'squares:25-35',
      'squares:>35',
    ]);
    expect(stratum(report.bySquares, 'squares:<15').jobs).toBe(1);
    expect(stratum(report.bySquares, 'squares:15-25').jobs).toBe(2);
    expect(stratum(report.bySquares, 'squares:25-35').jobs).toBe(2);
    expect(stratum(report.bySquares, 'squares:>35').jobs).toBe(1);
  });

  it('pitch band edges 4/5/8/9', () => {
    const records = [4, 5, 8, 9].map((p) => rec({ pitchTwelfths: p }));
    const report = computeBenchmark(records, K1);
    expect(stratum(report.byPitch, 'pitch:<=4').jobs).toBe(1);
    expect(stratum(report.byPitch, 'pitch:5-8').jobs).toBe(2);
    expect(stratum(report.byPitch, 'pitch:>=9').jobs).toBe(1);
  });

  it('layers band edges 1/2 (2+ absorbs higher counts)', () => {
    const records = [1, 2, 3].map((l) => rec({ existingLayers: l }));
    const report = computeBenchmark(records, K1);
    expect(stratum(report.byLayers, 'layers:1').jobs).toBe(1);
    expect(stratum(report.byLayers, 'layers:2+').jobs).toBe(2);
  });

  it('age band edges 9/10/20/21 and null → unknown', () => {
    const records = [9, 10, 20, 21, null].map((a) => rec({ roofAgeYears: a }));
    const report = computeBenchmark(records, K1);
    expect(stratum(report.byRoofAge, 'age:<10').jobs).toBe(1);
    expect(stratum(report.byRoofAge, 'age:10-20').jobs).toBe(2);
    expect(stratum(report.byRoofAge, 'age:>20').jobs).toBe(1);
    expect(stratum(report.byRoofAge, 'age:unknown').jobs).toBe(1);
  });

  it('all bands are always present, empty ones locked with zero counts', () => {
    const report = computeBenchmark([], KDEF);
    expect(report.bySquares).toHaveLength(4);
    expect(report.byPitch).toHaveLength(3);
    expect(report.byLayers).toHaveLength(2);
    expect(report.byRoofAge).toHaveLength(4);
    for (const s of [
      report.overall,
      ...report.bySquares,
      ...report.byPitch,
      ...report.byLayers,
      ...report.byRoofAge,
    ]) {
      expect(s.jobs).toBe(0);
      expect(s.tenants).toBe(0);
      expect(s.locked).toBe(true);
      expect(s.p50Bps).toBeNull();
      expect(s.p90Bps).toBeNull();
      expect(s.p95Bps).toBeNull();
    }
  });
});

describe('computeBenchmark deflation', () => {
  it('deflates concealed by idx(quote)/idx(close): 100000 at 10000→10500 gives 95238 (half-even)', () => {
    // contract 10000 makes pctBps equal the adjusted cents directly.
    const record = rec({
      concealedCents: '100000',
      contractCents: '10000',
      quoteMonth: '2025-01',
      closeMonth: '2025-06',
    });
    const report = computeBenchmark([record], {
      indexBps: { '2025-01': 10000, '2025-06': 10500 },
      kJobs: 1,
      kTenants: 1,
    });
    expect(report.overall.p50Bps).toBe(95238); // 1_000_000_000 / 10500 half-even
    expect(report.deflated).toBe(true);
  });

  it('exact bps vs contract after deflation: adjusted 95238 on 1000000 → 952 bps', () => {
    const record = rec({
      concealedCents: '100000',
      contractCents: '1000000',
      quoteMonth: '2025-01',
      closeMonth: '2025-06',
    });
    const report = computeBenchmark([record], {
      indexBps: { '2025-01': 10000, '2025-06': 10500 },
      kJobs: 1,
      kTenants: 1,
    });
    expect(report.overall.p50Bps).toBe(952); // 95238 × 10000 / 1000000 = 952.38 → 952
  });

  it('a month missing from indexBps defaults to 10000', () => {
    // Both months missing → no adjustment at all.
    const both = computeBenchmark(
      [rec({ concealedCents: '50000', contractCents: '1000000' })],
      { indexBps: { '1990-01': 12345 }, kJobs: 1, kTenants: 1 },
    );
    expect(both.overall.p50Bps).toBe(500);

    // Quote month present at 10500, close month missing → ×10500/10000.
    const one = computeBenchmark(
      [rec({ concealedCents: '100000', contractCents: '10000', quoteMonth: '2025-01' })],
      { indexBps: { '2025-01': 10500 }, kJobs: 1, kTenants: 1 },
    );
    expect(one.overall.p50Bps).toBe(105000);
  });

  it('adjusts upward when the index fell between quote and close', () => {
    const record = rec({
      concealedCents: '100000',
      contractCents: '10000',
      quoteMonth: '2025-01',
      closeMonth: '2025-06',
    });
    const report = computeBenchmark([record], {
      indexBps: { '2025-01': 10500, '2025-06': 10000 },
      kJobs: 1,
      kTenants: 1,
    });
    expect(report.overall.p50Bps).toBe(105000);
  });

  it('rounds the deflation step half-to-even', () => {
    const opts = { indexBps: { '2025-03': 20000 }, kJobs: 1, kTenants: 1 };
    // closeMonth 2025-03 at 20000: adjusted = concealed × 10000 / 20000.
    const half = computeBenchmark([rec({ concealedCents: '1', contractCents: '10000' })], opts);
    expect(half.overall.p50Bps).toBe(0); // 0.5 → 0 (even)
    const up = computeBenchmark([rec({ concealedCents: '3', contractCents: '10000' })], opts);
    expect(up.overall.p50Bps).toBe(2); // 1.5 → 2 (even)
  });

  it('rounds the bps-of-contract step half-to-even', () => {
    const half = computeBenchmark(
      [rec({ concealedCents: '1', contractCents: '20000' })],
      K1,
    );
    expect(half.overall.p50Bps).toBe(0); // 10000/20000 = 0.5 → 0 (even)
    const up = computeBenchmark([rec({ concealedCents: '3', contractCents: '20000' })], K1);
    expect(up.overall.p50Bps).toBe(2); // 30000/20000 = 1.5 → 2 (even)
  });
});

describe('computeBenchmark record filtering', () => {
  it('zero-concealed records stay in the distribution', () => {
    const report = computeBenchmark([pct(0), pct(1000)], K1);
    expect(report.overall.jobs).toBe(2);
    expect(report.overall.p50Bps).toBe(0); // sorted [0, 1000], ceil(1)=1 → index 0
    expect(report.overall.p95Bps).toBe(1000);
  });

  it('records with contract <= 0 are skipped entirely', () => {
    const report = computeBenchmark(
      [
        rec({ tenantKey: 't9', concealedCents: '5000', contractCents: '0' }),
        rec({ tenantKey: 't8', concealedCents: '5000', contractCents: '-100' }),
        pct(700, 't1'),
      ],
      K1,
    );
    expect(report.overall.jobs).toBe(1);
    expect(report.overall.tenants).toBe(1); // skipped tenants don't count either
    expect(report.overall.p50Bps).toBe(700);
  });
});

describe('computeBenchmark determinism and shape', () => {
  it('is deterministic across 50 runs', () => {
    const records: BenchmarkRecord[] = [];
    for (let i = 0; i < 25; i++) {
      records.push(
        rec({
          tenantKey: `t${(i * 7) % 4}`,
          concealedCents: String(((i * 31) % 11) * 1000),
          contractCents: '2000000',
          squaresX100: 1000 + i * 120,
          pitchTwelfths: i % 12,
          existingLayers: (i % 3) + 1,
          roofAgeYears: i % 5 === 0 ? null : (i * 3) % 40,
          quoteMonth: `2025-0${(i % 6) + 1}`,
          closeMonth: `2025-0${(i % 4) + 3}`,
        }),
      );
    }
    const opts = {
      indexBps: { '2025-01': 9800, '2025-03': 10200, '2025-05': 10500, '2025-06': 10450 },
      kJobs: 5,
      kTenants: 2,
    };
    const first = JSON.stringify(computeBenchmark(records, opts));
    for (let run = 0; run < 50; run++) {
      expect(JSON.stringify(computeBenchmark(records, opts))).toBe(first);
    }
  });

  it('overall unlocks while sparse strata stay locked in the same run', () => {
    const bands = [1000, 2000, 3000, 4000]; // one squaresX100 value per band
    const records: BenchmarkRecord[] = [];
    for (let i = 0; i < 20; i++) {
      records.push(
        rec({
          tenantKey: `t${(i % 3) + 1}`,
          concealedCents: String(i * 100),
          squaresX100: bands[i % 4] as number,
        }),
      );
    }
    const report = computeBenchmark(records, KDEF);
    expect(report.overall.locked).toBe(false);
    for (const s of report.bySquares) {
      expect(s.jobs).toBe(5);
      expect(s.locked).toBe(true); // 5 < kJobs 20
      expect(s.p50Bps).toBeNull();
    }
  });

  it('output parses against the BenchmarkReport schema and has no timestamp', () => {
    const report = computeBenchmark([pct(100, 'a'), pct(200, 'b')], K1);
    expect(() => BenchmarkReport.parse(report)).not.toThrow();
    expect(report.deflated).toBe(true);
    expect('generatedAt' in report).toBe(false);
    expect(report.overall.key).toBe('overall');
  });
});

/* ---------------- computeYourStanding ---------------- */

/** An unlocked pool whose overall P50 is exactly `p50Bps`. */
function poolAt(p50Bps: number) {
  const report = computeBenchmark([pct(p50Bps, 'pool')], K1);
  expect(report.overall.p50Bps).toBe(p50Bps); // guard the fixture itself
  return report;
}

/** A pool with nothing in it — overall P50 is null. */
const EMPTY_POOL = computeBenchmark([], KDEF);

const OWN = { indexBps: {} };

describe('computeYourStanding median', () => {
  it('odd count: nearest-rank P50 is the middle value', () => {
    const you = computeYourStanding([pct(100), pct(300), pct(200)], poolAt(200), OWN);
    expect(you.jobs).toBe(3);
    expect(you.medianBps).toBe(200); // sorted [100,200,300], ceil(1.5)=2 → index 1
  });

  it('even count: nearest-rank P50 takes the lower middle, matching the pool', () => {
    const records = [pct(100), pct(200), pct(300), pct(400)];
    const you = computeYourStanding(records, poolAt(200), OWN);
    expect(you.jobs).toBe(4);
    expect(you.medianBps).toBe(200); // ceil(2)=2 → index 1, no averaging
    // The pool's own P50 over the same four values agrees.
    expect(computeBenchmark(records, K1).overall.p50Bps).toBe(200);
  });

  it('counts only records with a usable contract', () => {
    const you = computeYourStanding(
      [pct(100), pct(300), pct(200), rec({ concealedCents: '5000', contractCents: '0' })],
      poolAt(200),
      OWN,
    );
    expect(you.jobs).toBe(3);
    expect(you.medianBps).toBe(200);
  });
});

describe('computeYourStanding minimum jobs', () => {
  it('withholds the median below 3 jobs', () => {
    for (const records of [[], [pct(500)], [pct(500), pct(900)]]) {
      const you = computeYourStanding(records, poolAt(400), OWN);
      expect(you.jobs).toBe(records.length);
      expect(you.medianBps).toBeNull();
      expect(you.vsPoolBps).toBeNull();
    }
  });

  it('reports the median at exactly 3 jobs', () => {
    const you = computeYourStanding([pct(500), pct(700), pct(900)], poolAt(400), OWN);
    expect(you.jobs).toBe(3);
    expect(you.medianBps).toBe(700);
  });

  it('honors a custom minJobs floor in both directions', () => {
    const records = [pct(500), pct(700), pct(900)];
    expect(computeYourStanding(records, poolAt(400), { ...OWN, minJobs: 4 }).medianBps).toBeNull();
    expect(computeYourStanding([pct(500)], poolAt(400), { ...OWN, minJobs: 1 }).medianBps).toBe(500);
  });

  it('a contract-less record does not count toward the floor', () => {
    const you = computeYourStanding(
      [pct(500), pct(700), rec({ concealedCents: '5000', contractCents: '0' })],
      poolAt(400),
      OWN,
    );
    expect(you.jobs).toBe(2);
    expect(you.medianBps).toBeNull();
  });
});

describe('computeYourStanding vs the pool', () => {
  it('positive when they eat more than the pool median', () => {
    const you = computeYourStanding([pct(700), pct(800), pct(900)], poolAt(500), OWN);
    expect(you.medianBps).toBe(800);
    expect(you.vsPoolBps).toBe(300);
  });

  it('negative when they eat less than the pool median', () => {
    const you = computeYourStanding([pct(100), pct(200), pct(300)], poolAt(500), OWN);
    expect(you.medianBps).toBe(200);
    expect(you.vsPoolBps).toBe(-300);
  });

  it('zero when they sit exactly on the pool median', () => {
    const you = computeYourStanding([pct(400), pct(500), pct(600)], poolAt(500), OWN);
    expect(you.vsPoolBps).toBe(0);
  });

  it('null when the pool side is withheld, even though their own median exists', () => {
    const you = computeYourStanding([pct(100), pct(200), pct(300)], EMPTY_POOL, OWN);
    expect(you.medianBps).toBe(200);
    expect(you.vsPoolBps).toBeNull();
  });
});

describe('computeYourStanding shares the pool per-record math', () => {
  it('an identical single record yields the same bps on both paths', () => {
    const indexBps = { '2025-01': 10000, '2025-06': 10500 };
    const record = rec({
      concealedCents: '100000',
      contractCents: '1000000',
      quoteMonth: '2025-01',
      closeMonth: '2025-06',
    });
    const pooled = computeBenchmark([record], { indexBps, kJobs: 1, kTenants: 1 });
    const you = computeYourStanding([record], pooled, { indexBps, minJobs: 1 });
    expect(pooled.overall.p50Bps).toBe(952); // deflated, half-even
    expect(you.medianBps).toBe(952);
    expect(you.vsPoolBps).toBe(0);
  });

  it('deflation applies on the own side too, not just the pool', () => {
    // Without deflation this would read 1000 bps; the index movement bends it.
    const record = rec({
      concealedCents: '100000',
      contractCents: '1000000',
      quoteMonth: '2025-01',
      closeMonth: '2025-06',
    });
    const flat = computeYourStanding([record], EMPTY_POOL, { indexBps: {}, minJobs: 1 });
    const deflated = computeYourStanding([record], EMPTY_POOL, {
      indexBps: { '2025-01': 10000, '2025-06': 10500 },
      minJobs: 1,
    });
    expect(flat.medianBps).toBe(1000);
    expect(deflated.medianBps).toBe(952);
  });
});

describe('computeYourStanding determinism and shape', () => {
  it('is deterministic across 50 runs and does not mutate its input', () => {
    const records = [900, 100, 500, 300, 700, 200].map((b) => pct(b));
    const order = records.map((r) => r.concealedCents);
    const pool = poolAt(450);
    const first = JSON.stringify(computeYourStanding(records, pool, OWN));
    for (let run = 0; run < 50; run++) {
      expect(JSON.stringify(computeYourStanding(records, pool, OWN))).toBe(first);
    }
    expect(records.map((r) => r.concealedCents)).toEqual(order); // sorted a copy
  });

  it('output parses against the YourStanding schema and carries no rows', () => {
    const you = computeYourStanding([pct(100), pct(200), pct(300)], poolAt(200), OWN);
    expect(() => YourStanding.parse(you)).not.toThrow();
    expect(Object.keys(you).sort()).toEqual(['jobs', 'medianBps', 'vsPoolBps']);
  });
});
