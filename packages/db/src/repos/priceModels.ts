import type { Prisma } from '@prisma/client';
import { PriceModelRates } from '@rafter/types';
import { prisma } from '../client';

function toWireVersion(v: {
  id: string;
  priceModelId: string;
  version: number;
  rates: unknown;
  createdAt: Date;
}) {
  return {
    id: v.id,
    priceModelId: v.priceModelId,
    version: v.version,
    rates: PriceModelRates.parse(v.rates),
    createdAt: v.createdAt.toISOString(),
  };
}

export const priceModels = {
  async list(tenantId: string) {
    const rows = await prisma.priceModel.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return rows.map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      name: m.name,
      versions: m.versions.map(toWireVersion),
      currentVersion: m.versions.length > 0 ? toWireVersion(m.versions[0]!) : undefined,
    }));
  },

  /**
   * D3: rate edits create a NEW version. Prior rows are never touched; the
   * @@unique([priceModelId, version]) constraint kills concurrent duplicates.
   */
  async createVersion(tenantId: string, modelId: string, rates: PriceModelRates) {
    const model = await prisma.priceModel.findFirst({ where: { id: modelId, tenantId } });
    if (!model) throw new Error('price model not found');
    return prisma.$transaction(async (tx) => {
      const latest = await tx.priceModelVersion.findFirst({
        where: { priceModelId: modelId },
        orderBy: { version: 'desc' },
      });
      const created = await tx.priceModelVersion.create({
        data: {
          priceModelId: modelId,
          tenantId,
          version: (latest?.version ?? 0) + 1,
          rates: rates as unknown as Prisma.InputJsonValue,
        },
      });
      return toWireVersion(created);
    });
  },
};
