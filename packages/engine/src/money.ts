import { BPS_ONE } from '@rafter/types';
import { EngineError } from './errors';

/**
 * Exact-cents money helpers (D1). Everything is bigint cents; multipliers and
 * percentages are integer basis points (10000 = ×1). All rounding is a single
 * half-even (banker's) step via divHalfEven.
 */

/** Sum a variadic list of cent amounts. addMoney() === 0n. */
export function addMoney(...m: bigint[]): bigint {
  let total = 0n;
  for (const x of m) total += x;
  return total;
}

/** Sum an array of cent amounts. sumMoney([]) === 0n. */
export function sumMoney(list: bigint[]): bigint {
  let total = 0n;
  for (const x of list) total += x;
  return total;
}

/**
 * Banker's-rounding division core: numerator / denominator rounded half to
 * even. Correct for negative numerators and denominators. Throws on zero
 * denominator.
 */
export function divHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new EngineError('divHalfEven: division by zero');
  }
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncates toward zero
  const r = n % d; // same sign as n
  if (r === 0n) return q;
  const twiceAbsR = (r < 0n ? -r : r) * 2n;
  const step = n < 0n ? -1n : 1n; // away from zero
  if (twiceAbsR > d) return q + step;
  if (twiceAbsR < d) return q;
  return q % 2n === 0n ? q : q + step; // exactly half: round to even
}

/** m × (bps / 10000), half-even. bps must be an integer. */
export function mulBps(m: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps)) {
    throw new EngineError(`mulBps: bps must be a safe integer, got ${bps}`);
  }
  return divHalfEven(m * BigInt(bps), BigInt(BPS_ONE));
}

/** m × (num / den), half-even. Throws on den === 0. */
export function mulRatio(m: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) {
    throw new EngineError('mulRatio: denominator must not be zero');
  }
  return divHalfEven(m * num, den);
}

/**
 * Split `total` across `weights` by largest-remainder so that the parts sum to
 * `total` exactly. Weights are non-negative integers; throws on an empty or
 * all-zero weight list. Works for negative totals.
 */
export function allocate(total: bigint, weights: number[]): bigint[] {
  if (weights.length === 0) {
    throw new EngineError('allocate: weights must be non-empty');
  }
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) {
      throw new EngineError(`allocate: weights must be non-negative integers, got ${x}`);
    }
    return BigInt(x);
  });
  let totalWeight = 0n;
  for (const x of w) totalWeight += x;
  if (totalWeight === 0n) {
    throw new EngineError('allocate: weights must not all be zero');
  }

  const shares: bigint[] = [];
  const remainders: Array<{ i: number; r: bigint }> = [];
  let assigned = 0n;
  for (let i = 0; i < w.length; i++) {
    const exact = total * (w[i] as bigint);
    let base = exact / totalWeight;
    if (exact % totalWeight !== 0n && exact < 0n) base -= 1n; // floor division
    shares.push(base);
    assigned += base;
    remainders.push({ i, r: exact - base * totalWeight }); // 0 <= r < totalWeight
  }

  // Leftover is a small non-negative integer (< weights.length); hand one cent
  // each to the largest remainders, earliest index winning ties.
  let leftover = total - assigned;
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; leftover > 0n; k++, leftover -= 1n) {
    const target = remainders[k] as { i: number; r: bigint };
    shares[target.i] = (shares[target.i] as bigint) + 1n;
  }
  return shares;
}
