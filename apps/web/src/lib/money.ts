import type { Money, Unit } from '@rafter/types';

/**
 * D1 — Money stays bigint cents. Everything here is pure string/integer math.
 * No parseFloat / Number() ever touches a money value.
 */

/** Parse a dollars string ("1,234.56", "$120", "-45.5", ".75") into bigint cents. Null when invalid. */
export function parseDollarsToCents(raw: string): Money | null {
  const s = raw.replace(/[$,\s]/g, '');
  if (s.length === 0) return null;
  const m = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[2] ?? '';
  const fracRaw = m[3];
  if (whole === '' && (fracRaw === undefined || fracRaw === '')) return null;
  const frac = (fracRaw ?? '').padEnd(2, '0');
  const cents = BigInt(whole === '' ? '0' : whole) * 100n + BigInt(frac);
  return m[1] === '-' ? -cents : cents;
}

/** Bigint cents → editable dollars string: 1234550n → "12345.50". Pure string math. */
export function centsToDollarsInput(m: Money): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  return `${neg ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Parse a percent string ("15.5", "10%") into integer bps: 1550. Not money — bps are numbers. */
export function parsePercentToBps(raw: string): number | null {
  const s = raw.replace(/[%\s]/g, '');
  if (s.length === 0) return null;
  const m = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[2] ?? '';
  const fracRaw = m[3];
  if (whole === '' && (fracRaw === undefined || fracRaw === '')) return null;
  const frac = (fracRaw ?? '').padEnd(2, '0');
  const bps = parseInt(whole === '' ? '0' : whole, 10) * 100 + parseInt(frac, 10);
  return m[1] === '-' ? -bps : bps;
}

/** Integer bps → editable percent string: 1550 → "15.50". */
export function bpsToPercentInput(bps: number): string {
  const neg = bps < 0;
  const a = Math.abs(bps);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${(a % 100).toString().padStart(2, '0')}`;
}

/** Parse a multiplier string ("1.15", "×1.05") into bps: 11500. */
export function parseMultiplierToBps(raw: string): number | null {
  const s = raw.replace(/[×x\s]/g, '');
  if (s.length === 0) return null;
  const m = /^(\d*)(?:\.(\d{0,4}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '';
  const fracRaw = m[2];
  if (whole === '' && (fracRaw === undefined || fracRaw === '')) return null;
  const frac = (fracRaw ?? '').padEnd(4, '0');
  return parseInt(whole === '' ? '0' : whole, 10) * 10000 + parseInt(frac, 10);
}

/** Integer bps → editable multiplier string: 11500 → "1.15", 10000 → "1". */
export function bpsToMultiplierInput(bps: number): string {
  const whole = Math.floor(bps / 10000);
  const frac = (bps % 10000).toString().padStart(4, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a non-negative integer count ("240"). Not money. */
export function parseCount(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

/** Quantity in hundredths of a unit → display string: 2430 → "24.3". Quantities are not money. */
export function formatQtyX100(q: number): string {
  const neg = q < 0;
  const a = Math.abs(q);
  const whole = Math.floor(a / 100).toLocaleString('en-US');
  const frac = (a % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac.length > 0 ? `.${frac}` : ''}`;
}

export const UNIT_LABEL: Record<Unit, string> = {
  SQ: 'sq',
  LF: 'lf',
  EA: 'ea',
  SHEET: 'sheets',
  FLAT: 'flat',
  PCT: '%',
};

export function sumMoney(values: Money[]): Money {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
