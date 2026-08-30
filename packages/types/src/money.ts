import { z } from 'zod';

/**
 * D1 — Money is integer cents as bigint. No floats anywhere.
 * Over the wire (JSON), money travels as a decimal string of cents: "1234500".
 * Formatting to "$12,345.00" happens only at the final render call.
 */
export type Money = bigint;

/** Decimal-string-of-cents wire format. May be negative. */
export const MoneyString = z.string().regex(/^-?\d+$/, 'money must be a decimal string of cents');
export type MoneyString = z.infer<typeof MoneyString>;

export function toMoney(s: MoneyString): Money {
  return BigInt(s);
}

export function fromMoney(m: Money): MoneyString {
  return m.toString();
}

/**
 * Format integer cents for display. Pure string math — no floats (D1).
 * formatMoney(1234500n) === "$12,345.00"
 */
export function formatMoney(m: Money, opts?: { sign?: boolean }): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const dollarsRaw = (abs / 100n).toString();
  const dollars = dollarsRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = neg ? '-' : opts?.sign ? '+' : '';
  return `${sign}$${dollars}.${cents}`;
}

/**
 * Basis points: 10000 = 1.0000 (×1). All multipliers and percentages are
 * integer bps so multiplier chains stay in integer arithmetic.
 */
export const Bps = z.number().int().min(0).max(1_000_000);
export type Bps = z.infer<typeof Bps>;
export const BPS_ONE = 10_000;

/** Format bps as a percent string: 1550 → "15.50%" */
export function formatBps(bps: number): string {
  const neg = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}%`;
}

/** Format bps as a multiplier string: 11500 → "×1.15" */
export function formatMultiplier(bps: number): string {
  const whole = Math.floor(bps / BPS_ONE).toString();
  const frac = (bps % BPS_ONE).toString().padStart(4, '0').replace(/0+$/, '');
  return frac.length > 0 ? `×${whole}.${frac}` : `×${whole}`;
}
