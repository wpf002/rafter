import type { FastifyInstance } from 'fastify';
import type { BenchmarkResponse } from '@rafter/types';
import { MATERIAL_PRICE_INDEX, benchmark } from '@rafter/db';
import { computeBenchmark } from '@rafter/engine';

/** Gate threshold (D8): 80% closeout completion on jobs ≥30 days old. */
const GATE_BPS = 8000;

export function benchmarkRoutes(app: FastifyInstance): void {
  // D10 — the pooled rows reduce to k-anonymous percentile strata here and
  // ONLY the aggregate report is serialized: no tenant ids, job ids, or
  // per-job rows ever reach the wire.
  app.get('/api/benchmark', async (request) => {
    const g = await benchmark.gate(request.tenantId, new Date());
    if (g.completionBps < GATE_BPS) {
      const locked: BenchmarkResponse = {
        unlocked: false,
        completionBps: g.completionBps,
        remainingCount: g.remainingCount,
        report: null,
      };
      return locked;
    }

    const records = await benchmark.poolRecords();
    const report = computeBenchmark(records, {
      indexBps: MATERIAL_PRICE_INDEX,
      kJobs: 20,
      kTenants: 3,
    });
    const unlocked: BenchmarkResponse = {
      unlocked: true,
      completionBps: g.completionBps,
      remainingCount: g.remainingCount,
      report,
    };
    return unlocked;
  });
}
