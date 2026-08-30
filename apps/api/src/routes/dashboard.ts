import type { FastifyInstance } from 'fastify';
import { benchmark, dashboard } from '@rafter/db';

export function dashboardRoutes(app: FastifyInstance): void {
  app.get('/api/dashboard', async (request) => {
    const now = new Date();
    // The gate metric comes from benchmark.gate so the dashboard panel and
    // GET /api/benchmark can never disagree about locked/unlocked.
    const [metrics, gate] = await Promise.all([
      dashboard.metrics(request.tenantId, now),
      benchmark.gate(request.tenantId, now),
    ]);
    return {
      ...metrics,
      closeoutCompletionBps: gate.completionBps,
      benchmarkUnlocked: gate.completionBps >= 8000,
    };
  });
}
