import type { FastifyInstance } from 'fastify';
import { tenants } from '@rafter/db';

export function tenantRoutes(app: FastifyInstance): void {
  app.get('/api/tenants', async () => tenants.list());
}
