# Rafter — Roadmap

Fixed-price roof replacement quoting with mandatory cost-actuals capture.
The quoting tool is distribution. The variance dataset is the asset.

## Locked decisions

Do not silently reverse these. Flag disagreement before implementing.

- **D1** — Money is integer cents as BigInt. No floats, including display logic
  until the final format call.
- **D2** — `@rafter/engine` is pure. No I/O, no DB, no network, no clock. `asOf`
  is an explicit input. Enforced by CI boundary guard.
- **D3** — Price models are immutable and versioned. Issued quotes snapshot the
  version used. Rate edits create a new version, never mutate an issued quote.
- **D4** — Every computed line item carries `Factor[]` provenance.
- **D5** — No LLM in the pricing path, ever. LLM is confined to invoice-parse
  draft suggestions the contractor confirms.
- **D6** — Closeout is required before a job reaches terminal state. Enforced in
  schema and state machine, not UI validation.
- **D7** — Unattributed variance blocks closeout. Every dollar maps to exactly
  one of: `CONCEALED_CONDITION`, `CUSTOMER_SCOPE_CHANGE`, `MEASUREMENT_ERROR`,
  `PRICING_ERROR`.
- **D8** — Never block quoting on closeout completion. Withhold benefits, never
  the tool.
- **D9** — Measurement providers are swappable adapters. No vendor name appears
  in the engine.
- **D10** — Pooled data is anonymized and aggregate-only. No contractor ever
  sees another contractor's individual jobs at any tier.

## Out of scope for v1

No guarantee, underwriting, escrow, or risk-bearing logic. No consumer-facing
app. No payments. No CRM — JobNimbus/AccuLynx integration is post-v1.

## Stack

TypeScript strict · pnpm 9 · Turborepo · Next.js (web) · Fastify 5 (api) ·
Prisma + Postgres 16 · Vitest · Zod at every boundary · Railway.
No `type: module` in the Fastify app.

## Phase 0 — Bootstrap
Repo, workspace, CI, boundary guard, dev.sh. Verify: clean clone → pnpm i →
dev.sh → both apps respond; guard fails on a planted `import fs` in engine.

## Phase 1 — Domain types and pure engine
Types, computeQuote with full line-item set and multiplier chains, Factor[]
provenance on every line, computeVariance, exact-cents money helpers.
Verify: ≥60 unit tests, determinism across 100 runs, line items sum exactly.

## Phase 2 — Persistence and tenancy
Prisma schema, append-only Event table, job state machine with DB-enforced
CLOSED gate, tenant-scoped repositories, seed (3 tenants, 40 jobs).

## Phase 3 — Quoting flow
Measurement providers (manual + stub aerial), job → measurement → model version
→ issued quote (immutable, DB trigger), web quoting UI with provenance + PDF.

## Phase 4 — Closeout and the margin report
Closeout entry, delta vs quote, per-dollar attribution, photo required for
CONCEALED_CONDITION, per-job margin report with variance waterfall, ingest seam.

## Phase 5 — Auto-tune
After N closed jobs: quoted vs realized per-rate comparison, one-click accept →
new model version, replay of last 20 quotes. Deterministic. Own history only.

## Phase 6 — Pooled benchmark
P50/P90/P95 concealed-condition variance by stratum, k-anonymity floor (20 jobs,
≥3 tenants), 80% closeout-completion gate with locked panel.
