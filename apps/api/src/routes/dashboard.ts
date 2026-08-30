import type { FastifyInstance } from 'fastify';
import { dashboard } from '@rafter/db';

export function dashboardRoutes(app: FastifyInstance): void {
  app.get('/api/dashboard', async (request) => {
    return dashboard.metrics(request.tenantId, new Date());
  });
}
