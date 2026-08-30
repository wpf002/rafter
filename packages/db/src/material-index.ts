/**
 * Material price index, monthly, in bps (10000 = the 2025-01 baseline).
 *
 * Stub for a real published series (e.g. BLS WPU081 — lumber & wood products,
 * or a roofing-materials composite). Hardcoded so the demo is deterministic;
 * swap this table for a real feed without touching the engine — the engine
 * only ever receives index values as explicit inputs (D2).
 */
export const MATERIAL_PRICE_INDEX: Record<string, number> = {
  '2025-01': 10000,
  '2025-02': 10022,
  '2025-03': 10041,
  '2025-04': 10068,
  '2025-05': 10095,
  '2025-06': 10118,
  '2025-07': 10139,
  '2025-08': 10165,
  '2025-09': 10194,
  '2025-10': 10221,
  '2025-11': 10243,
  '2025-12': 10262,
  '2026-01': 10290,
  '2026-02': 10315,
  '2026-03': 10344,
  '2026-04': 10371,
  '2026-05': 10396,
  '2026-06': 10428,
  '2026-07': 10455,
  '2026-08': 10481,
  '2026-09': 10512,
  '2026-10': 10540,
  '2026-11': 10571,
  '2026-12': 10602,
};

/** Index bps for a 'YYYY-MM' month; 10000 (baseline) for months off the table. */
export function getIndexBps(month: string): number {
  return MATERIAL_PRICE_INDEX[month] ?? 10000;
}
