import type { FastifyInstance } from 'fastify';
import exifr from 'exifr';
import { UploadPhotoRequest } from '@rafter/types';
import { jobs, photos } from '@rafter/db';
import { HttpError } from '../errors';
import { contentTypeForFilename } from '../serialize';

/** EXIF DateTimeOriginal, or null when absent/unparseable. Never throws. */
async function exifTakenAt(bytes: Buffer): Promise<Date | null> {
  try {
    const meta: unknown = await exifr.parse(bytes, ['DateTimeOriginal']);
    const value = (meta as { DateTimeOriginal?: unknown } | undefined)?.DateTimeOriginal;
    return value instanceof Date ? value : null;
  } catch {
    return null;
  }
}

export function photoRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>('/api/jobs/:id/photos', async (request, reply) => {
    const body = UploadPhotoRequest.parse(request.body);
    const graph = await jobs.get(request.tenantId, request.params.id);
    if (!graph) throw new HttpError(404, 'job not found');

    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.length === 0) throw new HttpError(400, 'photo payload is empty');
    const takenAt = await exifTakenAt(bytes);
    const photo = await photos.add(
      request.tenantId,
      request.params.id,
      body.filename,
      bytes,
      takenAt,
    );
    return reply.status(201).send(photo);
  });

  app.get<{ Params: { id: string; photoId: string } }>(
    '/api/jobs/:id/photos/:photoId',
    async (request, reply) => {
      const found = await photos.getData(request.tenantId, request.params.photoId);
      if (!found) throw new HttpError(404, 'photo not found');
      return reply
        .header('content-type', contentTypeForFilename(found.filename))
        .send(found.data);
    },
  );
}
