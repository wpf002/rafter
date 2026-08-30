import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocate,
  divHalfEven,
  EngineError,
  mulBps,
  mulRatio,
  sumMoney,
} from '../src/index';

describe('divHalfEven', () => {
  it('returns exact quotient when there is no remainder', () => {
    expect(divHalfEven(10n, 2n)).toBe(5n);
    expect(divHalfEven(0n, 7n)).toBe(0n);
    expect(divHalfEven(-9n, 3n)).toBe(-3n);
  });

  it('rounds below-half down', () => {
    expect(divHalfEven(249n, 100n)).toBe(2n); // 2.49
    expect(divHalfEven(41n, 10n)).toBe(4n); // 4.1
  });

  it('rounds above-half up', () => {
    expect(divHalfEven(251n, 100n)).toBe(3n); // 2.51
    expect(divHalfEven(7n, 4n)).toBe(2n); // 1.75
  });

  it('rounds exact half toward the even neighbor (down)', () => {
    expect(divHalfEven(5n, 2n)).toBe(2n); // 2.5 → 2
    expect(divHalfEven(1n, 2n)).toBe(0n); // 0.5 → 0
    expect(divHalfEven(9n, 2n)).toBe(4n); // 4.5 → 4
  });

  it('rounds exact half toward the even neighbor (up)', () => {
    expect(divHalfEven(3n, 2n)).toBe(2n); // 1.5 → 2
    expect(divHalfEven(7n, 2n)).toBe(4n); // 3.5 → 4
    expect(divHalfEven(11n, 2n)).toBe(6n); // 5.5 → 6
  });

  it('handles negative numerators with half-even ties', () => {
    expect(divHalfEven(-5n, 2n)).toBe(-2n); // -2.5 → -2 (even)
    expect(divHalfEven(-3n, 2n)).toBe(-2n); // -1.5 → -2 (even)
    expect(divHalfEven(-7n, 2n)).toBe(-4n); // -3.5 → -4 (even)
    expect(divHalfEven(-7n, 4n)).toBe(-2n); // -1.75 → -2
    expect(divHalfEven(-249n, 100n)).toBe(-2n); // -2.49 → -2
  });

  it('handles negative denominators', () => {
    expect(divHalfEven(5n, -2n)).toBe(-2n); // -2.5 → -2
    expect(divHalfEven(-5n, -2n)).toBe(2n); // 2.5 → 2
    expect(divHalfEven(10n, -5n)).toBe(-2n);
  });

  it('is exact at large magnitudes', () => {
    const big = 10n ** 30n;
    expect(divHalfEven(big * 3n, 3n)).toBe(big);
    expect(divHalfEven(big * 2n + 1n, 2n)).toBe(big); // …0.5 → even
  });

  it('throws EngineError on zero denominator', () => {
    expect(() => divHalfEven(1n, 0n)).toThrow(EngineError);
  });
});

describe('mulBps', () => {
  it('is identity at 10000 bps', () => {
    expect(mulBps(1_000_000n, 10000)).toBe(1_000_000n);
    expect(mulBps(-1234n, 10000)).toBe(-1234n);
  });

  it('computes exact percentages without drift', () => {
    expect(mulBps(1_000_000n, 1000)).toBe(100_000n); // 10%
    expect(mulBps(1_000_000n, 2000)).toBe(200_000n); // 20%
    expect(mulBps(880_000n, 1250)).toBe(110_000n); // 12.5%
  });

  it('rounds half to even', () => {
    expect(mulBps(100n, 1550)).toBe(16n); // 15.5 → 16
    expect(mulBps(100n, 1450)).toBe(14n); // 14.5 → 14
    expect(mulBps(300n, 50)).toBe(2n); // 1.5 → 2
    expect(mulBps(100n, 50)).toBe(0n); // 0.5 → 0
  });

  it('handles negative money', () => {
    expect(mulBps(-100n, 1550)).toBe(-16n); // -15.5 → -16
    expect(mulBps(-100n, 1450)).toBe(-14n); // -14.5 → -14
  });

  it('rejects non-integer bps', () => {
    expect(() => mulBps(100n, 10.5)).toThrow(EngineError);
    expect(() => mulBps(100n, Number.NaN)).toThrow(EngineError);
  });
});

describe('mulRatio', () => {
  it('is exact when the ratio divides evenly', () => {
    expect(mulRatio(300n, 1n, 3n)).toBe(100n);
    expect(mulRatio(1000n, 3n, 4n)).toBe(750n);
  });

  it('rounds half to even', () => {
    expect(mulRatio(5n, 1n, 2n)).toBe(2n); // 2.5 → 2
    expect(mulRatio(3n, 1n, 2n)).toBe(2n); // 1.5 → 2
  });

  it('handles negatives', () => {
    expect(mulRatio(100n, -1n, 3n)).toBe(-33n); // -33.33…
    expect(mulRatio(-100n, 1n, 3n)).toBe(-33n);
    expect(mulRatio(100n, 1n, -3n)).toBe(-33n);
  });

  it('throws EngineError on zero denominator', () => {
    expect(() => mulRatio(100n, 1n, 0n)).toThrow(EngineError);
  });
});

describe('allocate', () => {
  it('splits evenly when weights divide the total', () => {
    expect(allocate(100n, [1, 1, 1, 1])).toEqual([25n, 25n, 25n, 25n]);
    expect(allocate(10n, [0, 5, 0, 5])).toEqual([0n, 5n, 0n, 5n]);
  });

  it('distributes the remainder by largest remainder, earliest index on ties', () => {
    expect(allocate(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
    expect(allocate(101n, [1, 1, 1])).toEqual([34n, 34n, 33n]);
    // exact shares 51.5 / 25.75 / 25.75 → remainders favor indexes 1 and 2
    expect(allocate(103n, [500, 250, 250])).toEqual([51n, 26n, 26n]);
  });

  it('sums exactly to the total for a negative total', () => {
    const parts = allocate(-100n, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(-100n);
    expect(parts).toEqual([-33n, -33n, -34n]);
  });

  it('returns all zeros for a zero total', () => {
    expect(allocate(0n, [3, 7])).toEqual([0n, 0n]);
  });

  it('throws EngineError on empty weights', () => {
    expect(() => allocate(100n, [])).toThrow(EngineError);
  });

  it('throws EngineError on all-zero weights', () => {
    expect(() => allocate(100n, [0, 0, 0])).toThrow(EngineError);
  });

  it('throws EngineError on negative or fractional weights', () => {
    expect(() => allocate(100n, [1, -1])).toThrow(EngineError);
    expect(() => allocate(100n, [1.5, 1])).toThrow(EngineError);
  });

  it('property: parts always sum exactly to the total across many totals and weight sets', () => {
    const weightSets = [[1], [1, 2, 3], [5, 5], [7, 3, 9, 1], [0, 10, 0], [13, 1, 1, 1, 84]];
    for (let t = -260; t <= 260; t += 7) {
      const total = BigInt(t) * 997n; // spread across magnitudes, both signs
      for (const weights of weightSets) {
        const parts = allocate(total, weights);
        expect(parts).toHaveLength(weights.length);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      }
    }
  });

  it('property: each part is within one cent of its exact proportional share', () => {
    const weights = [3, 1, 4, 1, 5];
    const totalWeight = 14n;
    for (const total of [1n, 13n, 99n, 12345n, 999_983n]) {
      const parts = allocate(total, weights);
      parts.forEach((p, i) => {
        const scaled = p * totalWeight - total * BigInt(weights[i] as number);
        const abs = scaled < 0n ? -scaled : scaled;
        expect(abs < totalWeight).toBe(true);
      });
    }
  });
});

describe('addMoney / sumMoney', () => {
  it('addMoney sums variadic amounts and defaults to zero', () => {
    expect(addMoney()).toBe(0n);
    expect(addMoney(1n, 2n, 3n)).toBe(6n);
    expect(addMoney(100n, -40n)).toBe(60n);
  });

  it('sumMoney sums a list and handles empty', () => {
    expect(sumMoney([])).toBe(0n);
    expect(sumMoney([5n, 10n, -3n])).toBe(12n);
  });

  it('stays exact far beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 2n ** 80n;
    expect(addMoney(huge, huge)).toBe(2n ** 81n);
    expect(sumMoney([huge, 1n, -huge])).toBe(1n);
  });
});
