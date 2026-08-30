# Rafter — agent instructions

Fixed-price roof replacement quoting with mandatory cost-actuals capture.
See ROADMAP.md for phases and locked decisions D1–D10. Never silently reverse a
locked decision.

## Non-negotiables
- Money is integer cents as `bigint`. No floats anywhere, including display math.
  Format only at the final render call (`@rafter/types` `formatMoney`).
- `@rafter/engine` is pure: imports only `@rafter/types` and relative files.
  `scripts/boundary-guard.mjs` enforces this in CI. `asOf` is an explicit input.
- Price model versions are immutable. Issued quotes reference the version id.
- Every computed line item carries `Factor[]` provenance.
- No LLM in the pricing path. `@rafter/ingest` is draft-suggestion only.
- `CLOSED` job state requires a complete closeout with zero unattributed
  variance — enforced in Postgres, not just app code.

## Stack
pnpm 9 workspaces + Turborepo. TS strict everywhere.
- `packages/types` — domain types + Zod schemas + API contract (source of truth)
- `packages/engine` — pure pricing/variance math, Vitest
- `packages/db` — Prisma + Postgres 16, repositories with tenant scoping, seed
- `packages/measurement` — provider adapters (manual, stub aerial). No vendor
  names in engine.
- `packages/ingest` — invoice→draft-line-item seam, stub provider
- `apps/api` — Fastify 5, CommonJS (no `type: module`), Zod-validated routes
- `apps/web` — Next.js App Router, port 3000. API on 4000.

## Commands
- `bash dev.sh` — Postgres + migrate + seed + both apps
- `pnpm build | typecheck | lint | test | guard`
- DB tests need `DATABASE_URL`; they skip when unset.

## Serialization
`bigint` cents cross the wire as decimal strings ("MoneyString"). Prisma maps
them to `BIGINT`. Never `JSON.stringify` a raw bigint.
