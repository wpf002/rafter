import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { tenants } from '@rafter/db';
import { EngineError } from '@rafter/engine';
import { HttpError, postgresMessage } from './errors';
import { healthRoutes } from './routes/health';
import { tenantRoutes } from './routes/tenants';
import { dashboardRoutes } from './routes/dashboard';
import { jobRoutes } from './routes/jobs';
import { quoteRoutes } from './routes/quotes';
import { photoRoutes } from './routes/photos';
import { closeoutRoutes } from './routes/closeouts';
import { priceModelRoutes } from './routes/priceModels';
import { ingestRoutes } from './routes/ingest';
import { tuningRoutes } from './routes/tuning';
import { benchmarkRoutes } from './routes/benchmark';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the tenancy preHandler for every /api/* route except /api/tenants. */
    tenantId: string;
  }
}

const TENANT_CACHE_MS = 30_000;

/** 30s cache of known tenant ids so every request doesn't hit Postgres. */
function tenantIdCache() {
  let ids: Set<string> | null = null;
  let fetchedAt = 0;
  return async (): Promise<Set<string>> => {
    const now = Date.now();
    if (ids === null || now - fetchedAt >= TENANT_CACHE_MS) {
      ids = new Set((await tenants.list()).map((t) => t.id));
      fetchedAt = now;
    }
    return ids;
  };
}

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024, // base64 photo uploads
  });

  void app.register(cors, { origin: true });

  app.decorateRequest('tenantId', '');
  const knownTenantIds = tenantIdCache();

  // Tenancy gate: every /api/* route except /api/tenants needs a valid x-tenant-id.
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/api/') || path === '/api/tenants') return;
    const header = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(header) ? header[0] : header;
    if (!tenantId || !(await knownTenantIds()).has(tenantId)) {
      return reply.status(401).send({ error: 'unknown tenant' });
    }
    request.tenantId = tenantId;
  });

  app.setErrorHandler((rawErr: unknown, request, reply) => {
    const err = rawErr as Error & { statusCode?: number };
    // Zod validation failure → 400 with the flattened issue map.
    if (err instanceof Error && err.name === 'ZodError') {
      const zerr = err as Error & { flatten: () => unknown };
      return reply.status(400).send({ error: 'validation', detail: zerr.flatten() });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    // Engine-domain failures (closeout blocking messages pass through verbatim).
    if (err instanceof EngineError || err.name === 'EngineError') {
      return reply.status(422).send({ error: err.message });
    }
    // Postgres trigger exceptions surface through Prisma → 409 with the pg message.
    if (err.constructor.name.startsWith('PrismaClient')) {
      return reply.status(409).send({ error: postgresMessage(err.message) });
    }
    // Fastify's own client errors (bad JSON, body too large, ...).
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'internal error' });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: 'not found' });
  });

  void app.register(healthRoutes);
  void app.register(tenantRoutes);
  void app.register(dashboardRoutes);
  void app.register(jobRoutes);
  void app.register(quoteRoutes);
  void app.register(photoRoutes);
  void app.register(closeoutRoutes);
  void app.register(priceModelRoutes);
  void app.register(ingestRoutes);
  void app.register(tuningRoutes);
  void app.register(benchmarkRoutes);

  return app;
}
