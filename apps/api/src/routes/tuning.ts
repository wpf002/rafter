import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AcceptTuningRequest,
  TunableRateField,
  fromMoney,
  toMoney,
  type PriceModel,
  type PriceModelVersion,
  type TuningReplayRow,
  type TuningResponse,
} from '@rafter/types';
import { priceModels, tuning } from '@rafter/db';
import { applySuggestions, computeQuote, computeTuning } from '@rafter/engine';
import { HttpError } from '../errors';

/**
 * Phase 5 — auto-tune. Deterministic arithmetic on the tenant's OWN closed
 * jobs. Suggestions only ever land as a NEW immutable version through the
 * explicit accept endpoint (D3) — nothing here auto-applies.
 */

const DEFAULT_MIN_JOBS = 20;

const TuningQuery = z.object({
  minJobs: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().optional(),
  ),
});

/** Default 20, clamped to 1–200. */
function clampMinJobs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MIN_JOBS;
  return Math.min(200, Math.max(1, raw));
}

/** The tenant's model with its latest (highest-version) rates. 404 hides other tenants' models. */
async function loadModelLatest(
  tenantId: string,
  modelId: string,
): Promise<{ model: PriceModel; latest: PriceModelVersion }> {
  const models = await priceModels.list(tenantId);
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new HttpError(404, 'price model not found');
  const latest = model.currentVersion;
  if (!latest) throw new HttpError(422, 'price model has no versions');
  return { model, latest };
}

/** Suggestions + replay against the latest version, recomputed from history every call. */
async function computeTuningResponse(
  tenantId: string,
  modelId: string,
  latest: PriceModelVersion,
  minJobs: number,
): Promise<TuningResponse> {
  const closedJobs = await tuning.tuningHistory(tenantId, modelId);
  const report = computeTuning({ closedJobs, currentRates: latest.rates, minJobs });
  const tunedRates = applySuggestions(latest.rates, report.rows);

  const recent = await tuning.recentQuotes(tenantId, modelId);
  const replay: TuningReplayRow[] = recent.map((q) => {
    const newTotalCents = computeQuote(
      { measurement: q.measurement, rates: tunedRates, priceModelVersionId: 'tuning-preview' },
      new Date(q.asOf),
    ).totalCents;
    return {
      jobId: q.jobId,
      jobName: q.jobName,
      issuedAt: q.issuedAt,
      oldTotalCents: q.totalCents,
      newTotalCents,
      deltaCents: fromMoney(toMoney(newTotalCents) - toMoney(q.totalCents)),
    };
  });

  return {
    modelId,
    baseVersionId: latest.id,
    baseVersion: latest.version,
    report,
    replay,
  };
}

export function tuningRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/api/price-models/:id/tuning',
    async (request) => {
      const query = TuningQuery.parse(request.query);
      const { latest } = await loadModelLatest(request.tenantId, request.params.id);
      return computeTuningResponse(
        request.tenantId,
        request.params.id,
        latest,
        clampMinJobs(query.minJobs),
      );
    },
  );

  // Accept = a NEW immutable version (D3). Rates are recomputed server-side —
  // the client only ever names WHICH suggested fields to take, never values.
  app.post<{ Params: { id: string } }>(
    '/api/price-models/:id/tuning/accept',
    async (request, reply) => {
      const body = AcceptTuningRequest.parse(request.body);
      const { latest } = await loadModelLatest(request.tenantId, request.params.id);
      if (body.baseVersionId !== latest.id) {
        throw new HttpError(
          409,
          'price model changed since suggestions were computed — refresh',
        );
      }

      const closedJobs = await tuning.tuningHistory(request.tenantId, request.params.id);
      const report = computeTuning({ closedJobs, currentRates: latest.rates });
      const rates = applySuggestions(latest.rates, report.rows, body.rateFields);

      // applySuggestions only ever touches tunable fields, so comparing those
      // (as bigints, never floats — D1) is a full equality check.
      const changed = TunableRateField.options.some(
        (f) => toMoney(rates[f]) !== toMoney(latest.rates[f]),
      );
      if (!changed) throw new HttpError(422, 'no suggested changes to accept');

      const version = await priceModels.createVersion(
        request.tenantId,
        request.params.id,
        rates,
      );
      return reply.status(201).send(version);
    },
  );
}
