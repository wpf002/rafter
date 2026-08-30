import type { TenantSummary } from '@rafter/types';
import { prisma } from '../client';

/** Tenants are intentionally NOT tenant-scoped: the dev tenant switcher needs all of them. */
export const tenants = {
  async list(): Promise<TenantSummary[]> {
    const rows = await prisma.tenant.findMany({ orderBy: { name: 'asc' } });
    return rows.map((t) => ({ id: t.id, name: t.name }));
  },
};
