# Rafter

Fixed-price roof replacement quoting with mandatory cost-actuals capture.
The quoting tool is distribution; the variance dataset is the asset.

## Quick start

```bash
pnpm install
bash dev.sh   # Postgres + migrations + seed + api (4000) + web (3000)
```

## Workspace

| Path | Purpose |
| --- | --- |
| `packages/types` | Domain types, Zod schemas, API contract |
| `packages/engine` | Pure quote + variance math (no I/O — CI-enforced) |
| `packages/db` | Prisma schema, tenant-scoped repositories, seed |
| `packages/measurement` | Measurement provider adapters |
| `packages/ingest` | Invoice → draft line items seam (LLM never touches pricing) |
| `apps/api` | Fastify 5 REST API |
| `apps/web` | Next.js app |

See `ROADMAP.md` for phases and locked decisions.
