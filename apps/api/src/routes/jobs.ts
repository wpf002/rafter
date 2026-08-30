import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AttachMeasurementRequest,
  CreateJobRequest,
  JobState,
  TransitionRequest,
  type JobDetail,
} from '@rafter/types';
import { jobs, measurements } from '@rafter/db';
import { computeVariance } from '@rafter/engine';
import { providerRegistry } from '@rafter/measurement';
import { HttpError } from '../errors';

const ListJobsQuery = z.object({
  state: z
    .preprocess((v) => (v === '' ? undefined : v), JobState.optional()),
});

export function jobRoutes(app: FastifyInstance): void {
  app.get('/api/jobs', async (request) => {
    const { state } = ListJobsQuery.parse(request.query);
    return jobs.list(request.tenantId, state);
  });

  app.post('/api/jobs', async (request, reply) => {
    const body = CreateJobRequest.parse(request.body);
    const job = await jobs.create(request.tenantId, body);
    return reply.status(201).send(job);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request) => {
    const graph = await jobs.get(request.tenantId, request.params.id);
    if (!graph) throw new HttpError(404, 'job not found');
    const variance =
      graph.quote && graph.closeout
        ? computeVariance(graph.quote, {
            actualLines: graph.closeout.actualLines,
            attributions: graph.closeout.attributions,
          })
        : null;
    const detail: JobDetail = { ...graph, variance };
    return detail;
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/measurement', async (request) => {
    const body = AttachMeasurementRequest.parse(request.body);
    const graph = await jobs.get(request.tenantId, request.params.id);
    if (!graph) throw new HttpError(404, 'job not found');

    const provider = providerRegistry[body.source];
    const resolved = await provider.getMeasurement(
      body.source === 'MANUAL' ? { input: body.input } : { address: body.address },
    );
    return measurements.attach(
      request.tenantId,
      request.params.id,
      body.source,
      resolved.input,
      resolved.providerRef,
      new Date(),
    );
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/transition', async (request) => {
    const body = TransitionRequest.parse(request.body);
    if (body.to === 'CLOSED') {
      throw new HttpError(422, 'jobs close via closeout submission');
    }
    try {
      return await jobs.transition(request.tenantId, request.params.id, body.to);
    } catch (err) {
      if (err instanceof Error && err.message === 'job not found') {
        throw new HttpError(404, err.message);
      }
      if (err instanceof Error && /illegal transition|only reachable/.test(err.message)) {
        throw new HttpError(422, err.message);
      }
      throw err;
    }
  });
}
