import type { FastifyInstance } from 'fastify';
import { CreateModelVersionRequest } from '@rafter/types';
import { priceModels } from '@rafter/db';
import { HttpError } from '../errors';

export function priceModelRoutes(app: FastifyInstance): void {
  app.get('/api/price-models', async (request) => {
    return priceModels.list(request.tenantId);
  });

  // D3 — a rate edit is a NEW immutable version, never a mutation.
  app.post<{ Params: { id: string } }>(
    '/api/price-models/:id/versions',
    async (request, reply) => {
      const body = CreateModelVersionRequest.parse(request.body);
      try {
        const version = await priceModels.createVersion(
          request.tenantId,
          request.params.id,
          body.rates,
        );
        return await reply.status(201).send(version);
      } catch (err) {
        if (err instanceof Error && err.message === 'price model not found') {
          throw new HttpError(404, err.message);
        }
        throw err;
      }
    },
  );
}
