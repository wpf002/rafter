import type { FastifyInstance } from 'fastify';
import { SubmitCloseoutRequest } from '@rafter/types';
import { closeouts, jobs } from '@rafter/db';
import { computeVariance, validateCloseout } from '@rafter/engine';
import { HttpError } from '../errors';
import { closeoutToWire } from '../serialize';

export function closeoutRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>('/api/jobs/:id/closeout', async (request, reply) => {
    const body = SubmitCloseoutRequest.parse(request.body);
    const graph = await jobs.get(request.tenantId, request.params.id);
    if (!graph) throw new HttpError(404, 'job not found');
    if (graph.state !== 'AWAITING_CLOSEOUT') {
      throw new HttpError(
        422,
        `closeout can only be submitted from AWAITING_CLOSEOUT (job is ${graph.state})`,
      );
    }
    if (!graph.quote) throw new HttpError(422, 'job has no issued quote');

    // D6/D7 gate — blocking messages pass through verbatim.
    const check = validateCloseout(graph.quote, body);
    if (!check.ok) throw new HttpError(422, check.errors.join('\n'));

    const report = computeVariance(graph.quote, body);
    const row = await closeouts.submit(request.tenantId, request.params.id, body, report);
    return reply.status(201).send({ closeout: closeoutToWire(row, body), report });
  });
}
