import type { PhotoSummary } from '@rafter/types';
import { prisma } from '../client';

export const photos = {
  async add(
    tenantId: string,
    jobId: string,
    filename: string,
    bytes: Buffer,
    exifTakenAt: Date | null,
    uploadedAt?: Date,
  ): Promise<PhotoSummary> {
    const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new Error('job not found');
    const p = await prisma.photo.create({
      data: {
        jobId,
        tenantId,
        filename,
        // Buffer -> plain Uint8Array<ArrayBuffer> for Prisma's Bytes type
        data: Uint8Array.from(bytes),
        exifTakenAt,
        ...(uploadedAt ? { uploadedAt } : {}),
      },
      select: { id: true, jobId: true, filename: true, exifTakenAt: true, uploadedAt: true },
    });
    return {
      id: p.id,
      jobId: p.jobId,
      filename: p.filename,
      exifTakenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
      uploadedAt: p.uploadedAt.toISOString(),
    };
  },

  async getData(
    tenantId: string,
    id: string,
  ): Promise<{ filename: string; data: Buffer } | null> {
    const p = await prisma.photo.findFirst({
      where: { id, tenantId },
      select: { filename: true, data: true },
    });
    if (!p) return null;
    return { filename: p.filename, data: Buffer.from(p.data) };
  },
};
