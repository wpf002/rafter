import type { FastifyInstance } from 'fastify';
import {
  IssueQuoteRequest,
  QuotePreviewRequest,
  type MeasurementInput,
  type PriceModelVersion,
} from '@rafter/types';
import { jobs, priceModels, quotes } from '@rafter/db';
import { computeQuote } from '@rafter/engine';
import { HttpError } from '../errors';
import { quoteToWire } from '../serialize';

/** Resolve a version id across this tenant's price models. */
export async function loadVersion(
  tenantId: string,
  versionId: string,
): Promise<PriceModelVersion> {
  const models = await priceModels.list(tenantId);
  for (const model of models) {
    const found = (model.versions ?? []).find((v) => v.id === versionId);
    if (found) return found;
  }
  throw new HttpError(404, 'price model version not found');
}

export function quoteRoutes(app: FastifyInstance): void {
  // Ephemeral computation — nothing is persisted (the engine stays pure, D2).
  app.post('/api/quote-preview', async (request) => {
    const body = QuotePreviewRequest.parse(request.body);
    const version = await loadVersion(request.tenantId, body.priceModelVersionId);
    return computeQuote(
      {
        measurement: body.measurement,
        rates: version.rates,
        priceModelVersionId: version.id,
      },
      new Date(),
    );
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/quote', async (request, reply) => {
    const body = IssueQuoteRequest.parse(request.body);
    const graph = await jobs.get(request.tenantId, request.params.id);
    if (!graph) throw new HttpError(404, 'job not found');
    if (graph.state !== 'DRAFT') {
      throw new HttpError(422, `quote can only be issued from DRAFT (job is ${graph.state})`);
    }
    if (!graph.measurement) {
      throw new HttpError(422, 'job has no measurement — attach one before quoting');
    }

    const version = await loadVersion(request.tenantId, body.priceModelVersionId);
    const measurement: MeasurementInput = {
      roofAreaSqFt: graph.measurement.roofAreaSqFt,
      pitchTwelfths: graph.measurement.pitchTwelfths,
      stories: graph.measurement.stories,
      facets: graph.measurement.facets,
      ridgeHipLf: graph.measurement.ridgeHipLf,
      valleyLf: graph.measurement.valleyLf,
      eaveLf: graph.measurement.eaveLf,
      rakeLf: graph.measurement.rakeLf,
      flashingLf: graph.measurement.flashingLf,
      penetrations: graph.measurement.penetrations,
      existingLayers: graph.measurement.existingLayers,
      deckingCondition: graph.measurement.deckingCondition,
    };
    const computation = computeQuote(
      { measurement, rates: version.rates, priceModelVersionId: version.id },
      new Date(),
    );
    const row = await quotes.issue(request.tenantId, request.params.id, computation);
    return reply.status(201).send(quoteToWire(computation, row));
  });
}
