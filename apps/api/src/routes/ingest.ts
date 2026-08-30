import type { FastifyInstance } from 'fastify';
import { IngestDraftRequest, type IngestDraftResponse } from '@rafter/types';
import { getParser } from '@rafter/ingest';

export function ingestRoutes(app: FastifyInstance): void {
  // D5 — draft suggestions only; nothing enters the record unconfirmed.
  app.post('/api/ingest/invoice', async (request): Promise<IngestDraftResponse> => {
    const body = IngestDraftRequest.parse(request.body);
    const parser = getParser('stub');
    const draftLines = await parser.parseDraft(body.text);
    return { draftLines, provider: parser.id };
  });
}
